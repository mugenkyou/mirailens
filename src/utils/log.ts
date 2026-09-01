/**
 * Logs diagnostic messages to stderr.
 * Standard input/output (stdio) is strictly reserved for JSON-RPC transport in MCP.
 */
export const debugLog: typeof console.error = (...args) => {
  console.error(...args);
};

let stdioProtected = false;

/**
 * Redirects stdout-oriented console methods (log, info, debug) to stderr
 * to guarantee that stdout remains 100% clean for MCP JSON-RPC protocol frames.
 */
export function protectStdioTransport(): void {
  if (stdioProtected) return;
  stdioProtected = true;

  console.log = (...args: any[]) => {
    console.error(...args);
  };
  console.info = (...args: any[]) => {
    console.error(...args);
  };
  console.debug = (...args: any[]) => {
    console.error(...args);
  };
}

