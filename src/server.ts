import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { Context } from "@/context";
import type { Resource } from "@/resources/resource";
import type { Tool } from "@/tools/tool";
import { createWebSocketServer } from "@/ws";
import { debugLog } from "@/utils/log";

type Options = {
  name: string;
  version: string;
  tools: Tool[];
  resources: Resource[];
};

export async function createServerWithTools(options: Options): Promise<Server> {
  const { name, version, tools, resources } = options;
  const context = new Context();
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  const wss = await createWebSocketServer();
  wss.on("connection", (websocket) => {
    debugLog("[MiraiLens] Extension WebSocket connection established");

    // Close any existing active connection
    if (context.hasWs()) {
      try {
        context.ws.close();
      } catch (_) {}
    }
    context.ws = websocket;

    websocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "heartbeat_ping") {
          websocket.send(
            JSON.stringify({
              id: message.id,
              type: "heartbeat_pong",
              result: "pong",
            }),
          );
        } else if (message.type === "extension_connected") {
          context.extensionInfo = message.data || {};
          context.extensionState = "CONNECTED";
          debugLog(
            `[MiraiLens] Extension identified: v${message.data?.version || "unknown"}`,
          );
        } else if (message.type === "control_state_changed") {
          context.controlState = message.payload?.state || "IDLE";
          debugLog(
            `[MiraiLens] Extension control state updated to: ${context.controlState}`,
          );
        } else if (message.type === "tab_state_changed") {
          if (message.payload?.connected) {
            context.browserState = "CONNECTED";
          } else {
            context.browserState = "UNAVAILABLE";
          }
        }
      } catch (err) {
        // Ignore malformed messages
      }
    });

    websocket.on("close", (code, reason) => {
      debugLog(
        `[MiraiLens] Extension WebSocket closed (Code: ${code}, Reason: ${reason || "none"})`,
      );
      if (context.hasWs() && context.ws === websocket) {
        context.onExtensionDisconnect();
      }
    });

    websocket.on("error", (err) => {
      debugLog("[MiraiLens] Extension WebSocket error:", err);
      if (context.hasWs() && context.ws === websocket) {
        context.onExtensionDisconnect();
      }
    });
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool) => tool.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handle(context, request.params.arguments);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: errorMessage }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource) => resource.schema.uri === request.params.uri,
    );
    if (!resource) {
      return { contents: [] };
    }

    const contents = await resource.read(context, request.params.uri);
    return { contents };
  });

  const originalClose = server.close.bind(server);
  server.close = async () => {
    try {
      await originalClose();
    } catch (_) {}
    try {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    } catch (_) {}
    try {
      await context.close();
    } catch (_) {}
  };

  return server;
}

