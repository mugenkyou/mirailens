import { createSocketMessageSender } from "@/messaging/ws/sender";
import { WebSocket } from "ws";

import { mcpConfig } from "@/config/mcp.config";
import { MessagePayload, MessageType } from "@/types/messaging/types";
import { SocketMessageMap } from "@/types/messages/ws";

export const noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Mirailens extension icon in the browser toolbar and clicking the 'Connect' button.`;

export type ExtensionConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED";

export type BrowserState = "UNAVAILABLE" | "CONNECTED";

export interface ExtensionInfo {
  version?: string;
  capabilities?: string[];
  connectedTabId?: number;
  activeUrl?: string;
  [key: string]: any;
}

export class Context {
  private _ws: WebSocket | undefined;
  private _mcpServerState: "READY" = "READY";
  private _extensionState: ExtensionConnectionState = "DISCONNECTED";
  private _browserState: BrowserState = "UNAVAILABLE";
  private _controlState: string = "IDLE";
  private _extensionInfo: ExtensionInfo | undefined;

  get ws(): WebSocket {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }

  set ws(ws: WebSocket | undefined) {
    this._ws = ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      this._extensionState = "CONNECTED";
    } else {
      this._extensionState = "DISCONNECTED";
      this._browserState = "UNAVAILABLE";
    }
  }

  get mcpServerState(): string {
    return this._mcpServerState;
  }

  get extensionState(): ExtensionConnectionState {
    return this._extensionState;
  }

  set extensionState(state: ExtensionConnectionState) {
    this._extensionState = state;
    if (state === "DISCONNECTED") {
      this._browserState = "UNAVAILABLE";
    }
  }

  get browserState(): BrowserState {
    return this._browserState;
  }

  set browserState(state: BrowserState) {
    this._browserState = state;
  }

  get controlState(): string {
    return this._controlState;
  }

  set controlState(state: string) {
    this._controlState = state;
  }

  get extensionInfo(): ExtensionInfo | undefined {
    return this._extensionInfo;
  }

  set extensionInfo(info: ExtensionInfo | undefined) {
    this._extensionInfo = info;
  }

  hasWs(): boolean {
    return !!this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  onExtensionDisconnect() {
    this._ws = undefined;
    this._extensionState = "DISCONNECTED";
    this._browserState = "UNAVAILABLE";
  }

  getStatusReport() {
    const isConnected = this.hasWs();
    const allowed =
      isConnected &&
      (this._controlState === "IDLE" ||
        this._controlState === "AGENT_RUNNING" ||
        this._controlState === "AGENT_RESUMING");

    return {
      mcpServer: this._mcpServerState,
      extensionState: isConnected ? "CONNECTED" : "DISCONNECTED",
      browserState: isConnected ? this._browserState : "UNAVAILABLE",
      controlState: isConnected ? this._controlState : "BLOCKED",
      connectionStatus: isConnected ? "connected" : "disconnected",
      allowedToExecute: allowed,
      extensionInfo: this._extensionInfo,
    };
  }

  async sendSocketMessage<T extends MessageType<SocketMessageMap>>(
    type: T,
    payload: MessagePayload<SocketMessageMap, T>,
    options: { timeoutMs?: number } = { timeoutMs: 30000 },
  ) {
    const { sendSocketMessage } = createSocketMessageSender<SocketMessageMap>(
      this.ws,
    );
    try {
      return await sendSocketMessage(type, payload, options);
    } catch (e) {
      if (
        e instanceof Error &&
        (e.message === mcpConfig.errors.noConnectedTab ||
          e.message.includes("No connection to browser") ||
          e.message.includes("WebSocket closed"))
      ) {
        throw new Error(noConnectionMessage);
      }
      throw e;
    }
  }

  async close() {
    if (!this._ws) {
      return;
    }
    try {
      await this._ws.close();
    } catch (_) {}
    this._ws = undefined;
    this._extensionState = "DISCONNECTED";
    this._browserState = "UNAVAILABLE";
  }
}

