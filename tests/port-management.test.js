import test from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import { execSync } from 'node:child_process';

// Test port utility logic in pure ESM test runner
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port);
  });
}

function getListeningPids(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano -p tcp', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('TCP')) continue;
        const tokens = trimmed.split(/\s+/);
        if (tokens.length >= 5) {
          const localAddr = tokens[1];
          const state = tokens[3];
          const pidStr = tokens[4];
          if (
            (localAddr.endsWith(`:${port}`) || localAddr.endsWith(`]:${port}`)) &&
            state === 'LISTENING'
          ) {
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
              pids.add(pid);
            }
          }
        }
      }
    } else {
      const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
    }
  } catch (_) {}
  return Array.from(pids);
}

async function killProcessOnPort(port) {
  const inUse = await isPortInUse(port);
  if (!inUse) return true;

  const pids = getListeningPids(port);
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: ['ignore', 'ignore', 'ignore'] });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: ['ignore', 'ignore', 'ignore'] });
      }
    } catch (_) {}
  }
  return !(await isPortInUse(port));
}

test('MiraiLens Port Management & Cross-Platform Cleanup', async (suite) => {
  await suite.test('isPortInUse accurately identifies free and occupied ports', async () => {
    const testPort = 29199;
    const initialInUse = await isPortInUse(testPort);
    assert.strictEqual(initialInUse, false, 'Port should initially be free');

    const server = net.createServer();
    await new Promise((resolve) => server.listen(testPort, resolve));

    const duringInUse = await isPortInUse(testPort);
    assert.strictEqual(duringInUse, true, 'Port should be detected as in use');

    await new Promise((resolve) => server.close(resolve));

    const afterInUse = await isPortInUse(testPort);
    assert.strictEqual(afterInUse, false, 'Port should be detected as free after server close');
  });

  await suite.test('killProcessOnPort handles already-free ports safely without throwing', async () => {
    const freePort = 29198;
    const result = await killProcessOnPort(freePort);
    assert.strictEqual(result, true, 'killProcessOnPort on a free port should return true');
  });

  await suite.test('getListeningPids does not include process.pid or invalid values', () => {
    const pids = getListeningPids(29196);
    assert.ok(Array.isArray(pids), 'getListeningPids must return an array');
    for (const pid of pids) {
      assert.notStrictEqual(pid, process.pid, 'Should not return current process pid');
      assert.ok(Number.isInteger(pid) && pid > 0, 'PID must be positive integer');
    }
  });
});
