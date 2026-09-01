import { WebSocketServer } from "ws";

import { mcpConfig } from "@/config/mcp.config";
import { ensurePortAvailable } from "@/utils/port";
import { debugLog } from "@/utils/log";

export async function createWebSocketServer(
  port: number = mcpConfig.defaultWsPort,
): Promise<WebSocketServer> {
  const isAvailable = await ensurePortAvailable(port, 2500);
  if (!isAvailable) {
    debugLog(
      `[MiraiLens] Warning: Port ${port} is occupied. Attempting to bind WebSocket server...`,
    );
  }

  try {
    const wss = new WebSocketServer({ port });
    debugLog(`[MiraiLens] WebSocket server listening on port ${port}`);
    return wss;
  } catch (error) {
    debugLog(`[MiraiLens] Failed to bind WebSocket server on port ${port}:`, error);
    throw error;
  }
}

