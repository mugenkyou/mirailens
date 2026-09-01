import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { WebSocket } from 'ws';

test('MiraiLens Universal MCP Stdio Safety & Protocol Compliance', async (suite) => {
  await suite.test('MCP stdio stdout contains ONLY valid JSON-RPC and no diagnostic text corruption', async () => {
    const serverPath = path.resolve('dist/index.js');
    const child = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const stdoutLines = [];
    const stderrLines = [];
    let stdoutRawBuffer = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutRawBuffer += text;
      const lines = stdoutRawBuffer.split(/\r?\n/);
      // Keep unfinished last element in buffer
      stdoutRawBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim().length > 0) {
          stdoutLines.push(line.trim());
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrLines.push(chunk.toString());
    });

    // Helper to send JSON-RPC request and wait for matching response
    let msgId = 1;
    function sendRpc(method, params = {}) {
      const id = msgId++;
      const req = { jsonrpc: '2.0', id, method, params };
      child.stdin.write(JSON.stringify(req) + '\n');
      return id;
    }

    // Wait a brief moment for server to bind WebSocket
    await new Promise((res) => setTimeout(res, 500));

    // 1. Send initialize
    const initId = sendRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'antigravity-test-client', version: '1.0.0' },
    });

    // Wait for response
    await new Promise((res) => setTimeout(res, 500));

    // Send notifications/initialized
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }) + '\n'
    );

    // 2. Send tools/list
    const toolsId = sendRpc('tools/list', {});
    await new Promise((res) => setTimeout(res, 500));

    // 3. Connect a mock Chrome Extension WebSocket client to port 29100
    const ws = new WebSocket('ws://127.0.0.1:29100');
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    // Simulate extension handshake and control state change
    ws.send(
      JSON.stringify({
        type: 'extension_connected',
        data: { version: '1.2.2', capabilities: ['navigate', 'click'] },
      })
    );
    await new Promise((res) => setTimeout(res, 100));

    ws.send(
      JSON.stringify({
        type: 'control_state_changed',
        payload: { state: 'AGENT_RUNNING' },
      })
    );
    await new Promise((res) => setTimeout(res, 100));

    ws.send(
      JSON.stringify({
        type: 'control_state_changed',
        payload: { state: 'IDLE' },
      })
    );
    await new Promise((res) => setTimeout(res, 100));

    // 4. Send get_agent_status tool call
    const callToolId = sendRpc('tools/call', {
      name: 'get_agent_status',
      arguments: {},
    });

    // Hook message for get_agent_status on WS
    const wsMsgHandler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'get_agent_status') {
          ws.send(
            JSON.stringify({
              id: msg.id,
              result: {
                state: 'IDLE',
                connectionStatus: 'connected',
                allowedToExecute: true,
              },
            })
          );
        }
      } catch (_) {}
    };
    ws.on('message', wsMsgHandler);

    await new Promise((res) => setTimeout(res, 500));

    // 5. Disconnect WebSocket extension
    ws.close();
    await new Promise((res) => setTimeout(res, 300));

    // 6. Send get_agent_status again when disconnected
    const callToolDiscId = sendRpc('tools/call', {
      name: 'get_agent_status',
      arguments: {},
    });
    await new Promise((res) => setTimeout(res, 500));

    // 7. Flush remaining stdout buffer
    if (stdoutRawBuffer.trim().length > 0) {
      stdoutLines.push(stdoutRawBuffer.trim());
      stdoutRawBuffer = '';
    }

    // 8. Close child stdin
    child.stdin.end();

    const exitCode = await new Promise((resolve) => {
      child.on('exit', resolve);
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve(-1);
      }, 3000);
    });

    assert.strictEqual(exitCode, 0, 'MCP server must exit with code 0 on stdin close');

    // CRITICAL PROTOCOL VERIFICATION:
    // Every single line that was output to stdout MUST be valid JSON with a jsonrpc field.
    assert.ok(stdoutLines.length > 0, 'Must have received stdout JSON-RPC responses');

    for (let i = 0; i < stdoutLines.length; i++) {
      const line = stdoutLines[i];
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        assert.fail(
          `Stdout was corrupted with non-JSON text at line ${i + 1}: "${line}". Error: ${err.message}`
        );
      }
      assert.ok(
        parsed.jsonrpc === '2.0',
        `Stdout line ${i + 1} must be a valid JSON-RPC 2.0 message: ${line}`
      );
    }

    // Verify initialize response
    const initResponse = stdoutLines
      .map((l) => JSON.parse(l))
      .find((m) => m.id === initId);
    assert.ok(initResponse, 'Must have received initialize response');
    assert.strictEqual(
      initResponse.result.serverInfo.name,
      'Mirailens',
      'Server info name must match'
    );

    // Verify tools/list response
    const toolsResponse = stdoutLines
      .map((l) => JSON.parse(l))
      .find((m) => m.id === toolsId);
    assert.ok(toolsResponse, 'Must have received tools/list response');
    assert.ok(
      Array.isArray(toolsResponse.result.tools),
      'tools/list result must contain tools array'
    );
    const toolNames = toolsResponse.result.tools.map((t) => t.name);
    assert.ok(
      toolNames.includes('get_agent_status'),
      'tools list must include get_agent_status'
    );
    assert.ok(
      toolNames.includes('mcp_mirailens_navigate'),
      'tools list must include mcp_mirailens_navigate'
    );
    assert.ok(
      toolNames.includes('mcp_mirailens_snapshot'),
      'tools list must include mcp_mirailens_snapshot'
    );

    // Verify tool call response when connected
    const callResponse = stdoutLines
      .map((l) => JSON.parse(l))
      .find((m) => m.id === callToolId);
    assert.ok(callResponse, 'Must have received get_agent_status response');
    const content = JSON.parse(callResponse.result.content[0].text);
    assert.strictEqual(content.state, 'IDLE');
    assert.strictEqual(content.connectionStatus, 'connected');

    // Verify tool call response when disconnected
    const discResponse = stdoutLines
      .map((l) => JSON.parse(l))
      .find((m) => m.id === callToolDiscId);
    assert.ok(discResponse, 'Must have received get_agent_status response after disconnect');
    const discContent = JSON.parse(discResponse.result.content[0].text);
    assert.strictEqual(discContent.connectionStatus, 'disconnected');
    assert.strictEqual(discContent.allowedToExecute, false);
  });
});
