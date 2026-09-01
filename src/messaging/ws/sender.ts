import { WebSocket } from "ws";

export interface SocketMessageSender<T> {
  sendSocketMessage<K extends keyof T>(
    type: K,
    payload: T[K],
    options?: { timeoutMs?: number }
  ): Promise<any>;
}

export function createSocketMessageSender<T>(
  ws: WebSocket
): SocketMessageSender<T> {
  return {
    async sendSocketMessage<K extends keyof T>(
      type: K,
      payload: T[K],
      options: { timeoutMs?: number } = { timeoutMs: 30000 }
    ): Promise<any> {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return reject(
            new Error(
              "No connection to browser extension. WebSocket is not open."
            )
          );
        }

        const messageId = Math.random().toString(36).substring(2, 11);
        let cleanupDone = false;

        const message = {
          id: messageId,
          type,
          payload,
        };

        const cleanup = () => {
          if (cleanupDone) return;
          cleanupDone = true;
          clearTimeout(timeout);
          ws.off("message", handleMessage);
          ws.off("close", handleClose);
          ws.off("error", handleError);
        };

        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Request timeout"));
        }, options.timeoutMs);

        const handleMessage = (data: any) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.id === messageId) {
              cleanup();
              if (response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response.result);
              }
            }
          } catch (_) {
            // Ignore malformed messages
          }
        };

        const handleClose = (event?: any) => {
          cleanup();
          reject(
            new Error(
              `WebSocket closed during request${
                event ? ` (Code: ${event})` : ""
              }`
            )
          );
        };

        const handleError = (err?: any) => {
          cleanup();
          reject(
            new Error(
              `WebSocket error during request: ${
                err?.message || String(err)
              }`
            )
          );
        };

        ws.on("message", handleMessage);
        ws.once("close", handleClose);
        ws.once("error", handleError);

        try {
          ws.send(JSON.stringify(message));
        } catch (sendErr) {
          cleanup();
          reject(sendErr);
        }
      });
    },
  };
}



