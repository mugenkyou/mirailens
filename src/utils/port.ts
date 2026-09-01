import { execSync } from "node:child_process";
import net from "node:net";
import { debugLog } from "./log";

export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true)); // Port is in use
    server.once("listening", () => {
      server.close(() => resolve(false)); // Port is free
    });
    server.listen(port);
  });
}

/**
 * Finds PIDs listening on the specified port.
 */
export function getListeningPids(port: number): number[] {
  const pids = new Set<number>();
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano -p tcp`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("TCP")) continue;
        const tokens = trimmed.split(/\s+/);
        // Format: Proto Local_Address Foreign_Address State PID
        if (tokens.length >= 5) {
          const localAddr = tokens[1];
          const state = tokens[3];
          const pidStr = tokens[4];
          if (
            (localAddr.endsWith(`:${port}`) || localAddr.endsWith(`]:${port}`)) &&
            state === "LISTENING"
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
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
    }
  } catch (_) {
    // If command fails or returns non-zero, return collected PIDs
  }
  return Array.from(pids);
}

/**
 * Gracefully terminates processes occupying the specified port if needed.
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  const inUse = await isPortInUse(port);
  if (!inUse) {
    return true;
  }

  const pids = getListeningPids(port);
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${pid}`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } else {
        execSync(`kill -9 ${pid}`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      }
    } catch (_) {
      // Process may have already exited or requires elevated permissions
    }
  }

  return !(await isPortInUse(port));
}

/**
 * Ensures that the given port is available for binding within maxWaitMs.
 */
export async function ensurePortAvailable(
  port: number,
  maxWaitMs: number = 2000,
): Promise<boolean> {
  if (!(await isPortInUse(port))) {
    return true;
  }

  await killProcessOnPort(port);

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (!(await isPortInUse(port))) {
      return true;
    }
    await new Promise((res) => setTimeout(res, 50));
  }

  return !(await isPortInUse(port));
}

