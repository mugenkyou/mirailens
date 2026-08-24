# MiraiLens — MCP Browser Agent

MiraiLens is the browser agent you can watch, interrupt, control, and trust. It implements the Model Context Protocol (MCP) to bridge the gap between advanced AI orchestrators and your browser, allowing AI assistants to execute operations on your active browser session under strict, client-side safety policies.

---

## Why MiraiLens

Web automation powered by AI assistants carries significant security risks. MiraiLens provides browser protection:

- **Browser Control**: Enables AI to execute high‑level clicks, input values, dropdown selection, navigation, and keyboard inputs on your active browser tab.
- **Observability**: Exposes detailed visual and structural state inspection (such as screenshots, console log feeds, and ARIA accessibility tree snapshots) to the AI client.
- **Human Approval**: Every consequential browser action (clicks, values, external navigation) requires physical human approval on the browser tab overlay.
- **Extension-side Policy Enforcement**: Enforces security constraints (Trusted Domains, Blocked Domains, and Draft-Only mode) inside the browser context, ensuring the AI cannot bypass policies or run actions silently.
- **Accountability**: Generates an append‑only local execution ledger tracking sessions, actors, actions, decisions, and outcome statuses.
- **Recovery (Undo)**: Supports targeted rollback snapshots for form input values to easily restore previous states without full-page reloads.

---

## Architecture

MiraiLens uses a three-tier design to keep security enforcement on the user's client side:

```text
  +------------+       Model Context Protocol (JSON-RPC)       +------------+
  |    MCP     | <-------------------------------------------> |    MCP     |
  | Orchestrator |                                             |   Server   |
  +------------+                                               +------------+
                                                                     |
                                                           WebSocket | (JSON-RPC)
                                                                     v
  +------------------+     Content Script Overlay     +---------------------+
  |   Active Web     | <----------------------------- |  Browser Extension  |
  |   Tab Overlay    |                                |   (Service Worker)  |
  +------------------+                                +---------------------+
```

For more details, see the [Architecture Guide](docs/architecture.md).

---

## Requirements

- **Node.js**: Version 18.0.0 or higher.
- **Browser**: Google Chrome, Chromium, or Microsoft Edge.
- **MCP Client**: Cursor, Claude Desktop, or Model Context Protocol Inspector.
- **Extension Mode**: Developer mode enabled in browser to load extension unpacked.

---

## Installation

### 1. Install & Run MCP Server

To run the MCP server, simply use `npx`:

```bash
npx mirailens@latest
```

This will launch the Model Context Protocol stdio server on your local machine, listening for incoming stdio streams from your MCP client.

### 2. Install Browser Extension

1. Clone this repository locally if you haven't already:
   ```bash
   git clone https://github.com/mugenkyou/mcp-server-mirailens.git
   ```
2. Open your browser and navigate to the Extensions page: `chrome://extensions/`
3. Toggle the **Developer mode** switch in the top right.
4. Click **Load unpacked** in the top left.
5. Select the `extension` folder inside the cloned repository.
6. Note the extension ID and confirm the version is showing `v1.2.0`.

---

## Browser Extension Configuration

The MiraiLens extension handles the ultimate enforcement authority:
- **Permissions Required**:
  - `scripting`: Required to inject selectors, retrieve element states, and automate input filling inside target web frames.
  - `tabs` & `activeTab`: Used to query tab URLs, focus active windows, and verify page navigation outcomes.
  - `storage`: Required to maintain policy settings and save the audit ledger list locally.
  - `windows` & `alarms`: Used to handle background connection lifecycles and reconnect timers.
  - `<all_urls>` Host Permission: Needed to interact with arbitrary target pages selected by the orchestrator.

---

## First Run

1. Start your local MCP Client (Cursor or Claude Desktop).
2. Click the **MiraiLens** extension icon in your browser toolbar to open the console popup.
3. Click **CONNECT TO MCP SERVER**.
4. Navigate your active tab to a page (e.g. `http://localhost:3000` or a public domain).
5. Request your AI assistant to click an element or type text in the active window.
6. The action overlay will highlight the element and present Approve/Deny buttons. Confirm the action to execute.

---

## MCP Client Configuration Examples

### Cursor Configuration

Open your Cursor configuration file (`mcp.json`):

- **Windows**: `%APPDATA%/Cursor/User/globalStorage/cursor.mcp/mcp.json`
- **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/mcp.json`
- **Linux**: `~/.config/Cursor/User/globalStorage/cursor.mcp/mcp.json`

```json
{
  "mcpServers": {
    "mirailens": {
      "command": "npx",
      "args": ["-y", "mirailens@latest"],
      "env": {}
    }
  }
}
```

### Claude Desktop Configuration

Open Claude Desktop's configuration file (`claude_desktop_config.json`):

- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mirailens": {
      "command": "npx",
      "args": ["-y", "mirailens@latest"]
    }
  }
}
```

---

## Available Tools

- **mcp_mirailens_navigate**: Directs the active browser tab to a new URL.
- **mcp_mirailens_go_back**: Navigates back in history.
- **mcp_mirailens_go_forward**: Navigates forward in history.
- **mcp_mirailens_click**: Simulates a click event on an element.
- **mcp_mirailens_hover**: Simulates hovering over an element.
- **mcp_mirailens_type**: Inputs text into a target field.
- **mcp_mirailens_select_option**: Selects dropdown choice list values.
- **mcp_mirailens_press_key**: Simulates a keyboard key press.
- **mcp_mirailens_wait**: Sleeps browser automation for a specified number of seconds.
- **mcp_mirailens_snapshot**: Captures an accessibility ARIA snapshot tree of the page.
- **mcp_mirailens_get_console_logs**: Retrieves the tab console output.
- **mcp_mirailens_screenshot**: Captures a full-view screenshot.
- **undo_last**: Reverts the last input restoration.
- **get_action_history**: Returns action history logs.

---

## Security Model & Trust Boundaries

The security boundaries of MiraiLens reside inside the extension context:

1. **Extension Enforcement**: The browser extension is the ultimate enforcement authority. It validates client requests independently of the server.
2. **Draft-Only Mode**: When enabled, the extension blocks form submissions (`submit` buttons, `ENTER` keys, form submittals) to prevent accidental mutation while still allowing data-filling.
3. **Sensitive-Field Protection**: The extension identifies password, PIN, CVV, and credit card fields, and blocks AI access unless policy is explicitly set, and automatically redacts all input data in local ledger feeds.
4. **Trusted & Blocked Domains**: Blocked domains are immediately denied. Trusted domains allow low-risk automation to proceed without human overlays, while unknown domains default to approval gating.

For details, view the [Threat Model](threat_model.md) and [Security Policy](SECURITY.md).

---

## Accountability & Ledger

MiraiLens creates an append-only local action history log saved securely under `chrome.storage.local`. It records:
- Timestamp, Actor (`AI` vs `HUMAN`), Action Type, Target element selector, Policy parameters, and Outcome verification status.
- Session logs can be inspected and exported to JSON in the **History Dashboard Console**.

---

## Undo Limitations

The input undo recovery feature has the following constraints:
- **Restoration Scope**: Only non-sensitive input text elements (`browser_type` actions) are snapshot.
- **Irreversible Actions**: Button clicks, navigation changes, form submissions, and background API queries triggered by scripts cannot be reversed.
- **Expiry Check**: Snapshots expire immediately upon tab URL redirects, page navigation, or tab closure.

---

## Compatibility Matrix

### Supported Clients

| Client | Status | Tested Version | Notes |
|--------|--------|----------------|-------|
| Cursor | **SUPPORTED** | v0.40.4+ | Works natively via stdio npx configurations. |
| MCP Inspector | **SUPPORTED** | v0.1.0+ | Verified for direct JSON-RPC validation checks. |
| Claude Desktop | **SUPPORTED** | v0.7.0+ | Fully compatible with configuration presets. |

### Supported Browsers

- **Google Chrome / Chromium**: **SUPPORTED** (Recommended for full extension capabilities).
- **Microsoft Edge**: **SUPPORTED** (Fully compatible).
- **Mozilla Firefox**: **NOT SUPPORTED** (Uses MV3 APIs not fully aligned with Chrome scripting namespace).

### Protocol Compatibility Policy
- The current stable protocol is frozen at **v1.0**.
- **Breaking Changes**: Altering socket command JSON payloads or changing schema keys constitutes a breaking change.
- **Guarantees**: Version v1.0 clients will be supported for all future patch releases in the v1.2.x line.

---

## Development

Build and run tests inside the repository:

```bash
# Type check TypeScript codebase
npm run typecheck

# Build server distribution
npm run build

# Run all test suites
npm test
```

For more info, read the [Contributing Guide](CONTRIBUTING.md).

---

## License

Distributed under the **MiraiLens Community Non-Commercial License (Version 1.0)**. See the [LICENSE](LICENSE) file for details.
