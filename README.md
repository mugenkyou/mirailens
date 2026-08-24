# <img src="https://mirailens.vercel.app/logo/favicon-32x32.png" width="28" height="28" align="center" alt="MiraiLens Logo"> MiraiLens

### The browser agent you can watch, interrupt, control, and trust.

[![npm version](https://img.shields.io/npm/v/mirailens.svg)](https://www.npmjs.com/package/mirailens)
[![License: Custom](https://img.shields.io/badge/License-Community%20Non--Commercial-blue.svg)](LICENSE)
[![CI Status](https://github.com/mugenkyou/mcp-server-mirailens/actions/workflows/ci.yml/badge.svg)](https://github.com/mugenkyou/mcp-server-mirailens/actions/workflows/ci.yml)
[![Protocol Version](https://img.shields.io/badge/Protocol-1.0-orange.svg)](#protocol-compatibility-policy)

[Website](https://mirailens.io) | [Documentation](https://github.com/mugenkyou/mcp-server-mirailens#readme) | [Security](SECURITY.md) | [Architecture](docs/architecture.md) | [Developers](CONTRIBUTING.md) | [GitHub](https://github.com/mugenkyou/mcp-server-mirailens) | [npm](https://www.npmjs.com/package/mirailens)

---

## What is MiraiLens?

Unrestricted browser agents present massive security challenges. When an AI agent runs browser automation directly on your system, it is difficult to audit what the agent is doing in real-time, interrupt unsafe operations, or enforce security policies independently of the model itself.

**MiraiLens** solves this problem by placing a secure browser extension between the AI client and your browser session. The extension observes proposed actions, applies local client-side policy rules, captures confirmation overlays, verifies outcomes, and logs accountability records locally.

---

## Key Capabilities

### Browser Control
Allows the AI client to navigate tabs, click elements, hover, type text, choose dropdown options, press keys, and inspect DOM structures.

### Human Control
Provides interactive controls to pause operations, take manual control, trigger emergency stops, and approve or deny actions directly inside the tab.

### Extension-Enforced Policy
Gated actions (trusted domains, blocked domains, and draft-only mode overrides) are evaluated directly inside the browser extension, isolating execution rules from the untrusted server.

### Accountability
Every proposed action, user decision, and execution status is recorded locally inside a bounded, append-only execution ledger.

### Verification & Recovery
Enables post-action status verification (validating form fields and redirect destinations) with targeted, origin-bound recovery snapshots to undo text input changes.

### MCP Integration
Fully compatible with the Model Context Protocol (MCP), enabling seamless connections to orchestration clients (like Cursor or Claude Desktop) via a local Node server.

---

> [!IMPORTANT]
> **Security Policy & Threat Model**
> MiraiLens does not claim to solve prompt injection. The browser extension enforces strict policy boundaries on requested browser actions, but it cannot prevent an AI model from being manipulated into requesting a harmful action. Users must remain vigilant when approving actions.
> For details, read our [Threat Model](threat_model.md) and [Security Policy](SECURITY.md).

---

## Technical Architecture

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

- **MCP Client**: Decides goals and proposes browser actions.
- **MCP Server**: Translates standard MCP JSON-RPC requests into WebSocket command packages.
- **Browser Extension**: Hosts the state machine, evaluates policy, and serves as the trusted client-side enforcement boundary.
- **Active Browser Tab**: Renders the Shadow DOM visual approval overlays to receive trusted human input.
- **Local Ledger**: Saves secure session audits inside browser extension sandbox storage.

For detailed boundary models, view the [Architecture Guide](docs/architecture.md).

---

## Installation

### 1. Run the MCP Server

Start the local stdio MCP server process via `npx`:

```bash
npx mirailens@latest
```

### 2. Load the Chrome Extension

1. Clone this repository locally:
   ```bash
   git clone https://github.com/mugenkyou/mcp-server-mirailens.git
   ```
2. Navigate your browser to `chrome://extensions/` and toggle **Developer mode** (top right).
3. Click **Load unpacked** (top left) and select the repository's `extension` directory.
4. Confirm the extension has loaded and displays version `v1.2.0`.

---

## MCP Client Configuration

### Cursor Preset
Add the following block to your Cursor `mcp.json` settings:

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

### Claude Desktop Preset
Add the following block to your `claude_desktop_config.json` settings:

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

## Browser Extension Options & Permissions

The browser extension relies on standard permissions to manage automation safety:
- **`scripting`**: Injects page automation controls and retrieves accessibility nodes.
- **`tabs` / `activeTab`**: Obtains active tab hostnames to check policy matches and redirect targets.
- **`storage`**: Persists Trusted/Blocked domain lists and the append-only action ledger.
- **`<all_urls>` host permissions**: Permits execution on page origins targeted by automation tasks.

---

## Supported Clients & Browsers

### MCP Clients
- **Cursor**: Fully supported (v0.40.4+).
- **Claude Desktop**: Fully supported (v0.7.0+).
- **MCP Inspector**: Fully supported (v0.1.0+).

### Web Browsers
- **Google Chrome / Chromium**: Fully supported (Recommended).
- **Microsoft Edge**: Fully supported.
- **Mozilla Firefox**: Not supported (incompatible scripting execution models).

### Protocol Compatibility Policy
- The server protocol is frozen at version **v1.0**.
- Future patches in the v1.2.x series will maintain backward compatibility with all v1.0 clients.

---

## Contributing & Development

For setup parameters, branch conventions, and testing commands, please read our [Contributing Guide](CONTRIBUTING.md) and [Changelog](CHANGELOG.md).

---

## License

Distributed under the **MiraiLens Community Non-Commercial License (Version 1.0)**. See the [LICENSE](LICENSE) file for details.
