import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { WebSocket } from 'ws';

test('MiraiLens WebSocket Lifecycle & Resilience', async (suite) => {
  const serverPath = path.resolve('dist/index.js');
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const stdoutMessages = [];
  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim().length > 0) {
        try {
          stdoutMessages.push(JSON.parse(line.trim()));
        } catch (_) {}
      }
    }
  });

  let msgId = 1;
  function sendRpc(method, params = {}) {
    const id = msgId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return id;
  }

  async function waitForResponse(id, timeoutMs = 3000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const found = stdoutMessages.find((m) => m.id === id);
      if (found) return found;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error(`Timeout waiting for response to message ID ${id}`);
  }

  // Wait for server startup
  await new Promise((res) => setTimeout(res, 500));

  const initId = sendRpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'lifecycle-test-client', version: '1.0.0' },
  });
  await waitForResponse(initId);

  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }) + '\n'
  );

  await suite.test('1. Heartbeat ping-pong works cleanly', async () => {
    const ws = new WebSocket('ws://127.0.0.1:29100');
    await new Promise((res) => ws.once('open', res));

    const pingId = 'hb_123';
    ws.send(JSON.stringify({ id: pingId, type: 'heartbeat_ping' }));

    const pong = await new Promise((resolve) => {
      ws.on('message', (data) => {
        try {
          const m = JSON.parse(data.toString());
          if (m.id === pingId) resolve(m);
        } catch (_) {}
      });
    });

    assert.strictEqual(pong.type, 'heartbeat_pong');
    assert.strictEqual(pong.result, 'pong');
    ws.close();
    await new Promise((res) => setTimeout(res, 200));
  });

  await suite.test('2. Multiple successive reconnections restore state cleanly', async () => {
    for (let round = 1; round <= 3; round++) {
      const ws = new WebSocket('ws://127.0.0.1:29100');
      await new Promise((res) => ws.once('open', res));

      // Handle server get_agent_status request
      ws.on('message', (data) => {
        try {
          const m = JSON.parse(data.toString());
          if (m.type === 'get_agent_status') {
            ws.send(
              JSON.stringify({
                id: m.id,
                result: {
                  state: round % 2 === 0 ? 'AGENT_RUNNING' : 'IDLE',
                  connectionStatus: 'connected',
                  allowedToExecute: true,
                },
              })
            );
          }
        } catch (_) {}
      });

      ws.send(
        JSON.stringify({
          type: 'extension_connected',
          data: { version: '1.2.2', capabilities: ['navigate'] },
        })
      );
      ws.send(
        JSON.stringify({
          type: 'control_state_changed',
          payload: { state: round % 2 === 0 ? 'AGENT_RUNNING' : 'IDLE' },
        })
      );

      await new Promise((res) => setTimeout(res, 100));

      // Query status via MCP
      const id = sendRpc('tools/call', { name: 'get_agent_status', arguments: {} });
      const resp = await waitForResponse(id);

      assert.ok(resp, `Must receive response for round ${round}`);
      const content = JSON.parse(resp.result.content[0].text);
      assert.strictEqual(content.connectionStatus, 'connected');

      ws.close();
      await new Promise((res) => setTimeout(res, 200));
    }
  });

  await suite.test('3. Tool call returns structured error when extension is disconnected', async () => {
    const navId = sendRpc('tools/call', {
      name: 'mcp_mirailens_navigate',
      arguments: { url: 'https://example.com' },
    });

    const navResp = await waitForResponse(navId);
    assert.ok(navResp, 'Must receive tool response');
    assert.strictEqual(navResp.result.isError, true, 'Result must have isError: true');
    assert.ok(
      navResp.result.content[0].text.includes('No connection to browser extension'),
      'Error message must explain extension connection is required'
    );
  });

  // Cleanup child process
  child.stdin.end();
  await new Promise((res) => child.once('exit', res));
});
