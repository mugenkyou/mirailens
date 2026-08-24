# <img src="https://mirailens.vercel.app/logo/favicon-32x32.png" width="28" height="28" align="center" alt="MiraiLens Logo"> MiraiLens

### The browser control layer for AI agents.

[![npm version](https://img.shields.io/npm/v/mirailens.svg)](https://www.npmjs.com/package/mirailens)
[![License: Custom](https://img.shields.io/badge/License-Community%20Non--Commercial-blue.svg)](LICENSE)
[![CI Status](https://github.com/mugenkyou/mcp-server-mirailens/actions/workflows/ci.yml/badge.svg)](https://github.com/mugenkyou/mcp-server-mirailens/actions/workflows/ci.yml)
[![Protocol Version](https://img.shields.io/badge/Protocol-1.0-orange.svg)](#protocol-compatibility)

---

## Resources

- **Website**: [mirailens.vercel.app](https://mirailens.vercel.app)
- **Chrome Extension**: [MiraiLens Connector on Chrome Web Store](https://chromewebstore.google.com/detail/cjkgpjbjjefoecfbiehiognojjdhofmg)
- **npm Package**: [npm/mirailens](https://www.npmjs.com/package/mirailens)
- **GitHub Repository**: [mugenkyou/mcp-server-mirailens](https://github.com/mugenkyou/mcp-server-mirailens)
- **Security Policy**: [SECURITY.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/SECURITY.md)
- **Threat Model**: [threat_model.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/threat_model.md)
- **Architecture Details**: [docs/architecture.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/docs/architecture.md)
- **Contributing Guide**: [CONTRIBUTING.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/CONTRIBUTING.md)

---

## Why MiraiLens?

Browser agents can perform powerful actions on behalf of users, but direct, unrestricted AI browser control creates a security and accountability problem.

The key question is: **"Who is actually in control when the AI starts acting?"**

MiraiLens introduces a separate browser-side control layer between the AI client and your browser session. The AI can propose and execute actions only under the supervision of a local client-side state machine.

```text
   AI Agent
      |
      | MCP (JSON-RPC)
      v
   MiraiLens MCP Server
      |
      | Local WebSocket
      v
   MiraiLens Connector (Chrome Extension)
      |
      +-- Policy checks (Blocked domains, Sensitive fields)
      +-- Human control (Approve / Deny, Pause, Emergency Stop)
      +-- Verification (Verify DOM status & URL redirections)
      +-- Accountability (Append-only local ledger)
      |
      v
   Active Browser Tab
```

---

## Key Capabilities

### Browser Control
Provides the AI client with rich, granular automation tools:
- Navigate tabs, go back, and go forward.
- Click elements and hover.
- Type text inputs and select dropdown options.
- Press keyboard keys and sleep/wait.
- Capture accessibility ARIA tree snapshots, console logs, and screenshots.

### Human Control
Enables real-time human intervention over active AI runs:
- Pause and resume AI executions.
- Take manual control of the browser at any time.
- Trigger an emergency stop to immediately block active operations.
- Explicitly approve or deny actions using visual confirmation overlays on the active page.

### Browser-Side Policy Enforcement
Critical security constraints are evaluated inside the browser extension, isolating enforcement rules from the untrusted server and client:
- **Blocked Domains**: Actions on configured blocked domains are immediately denied.
- **Sensitive Fields**: Passwords, PINs, CVVs, and payment forms automatically trigger policy blocks or human overlays.
- **Draft-Only Mode**: Prevents form submissions while allowing inputs to be filled for drafting.

### Verification
The extension inspects the target tab's post-action state (verifying changes to element values or URL redirects) and records outcome results as:
- `VERIFIED`: Target condition succeeded.
- `FAILED`: Action failed or did not achieve expected state.
- `UNVERIFIED_COMPLETE`: Action ran but state could not be programmatically evaluated.

### Accountability
Logs execution events in a local, sandboxed, append-only ledger stored in extension storage (`chrome.storage.local`). The ledger tracks:
- Proposed actions and target selectors.
- Actor information (`AI` vs `HUMAN`).
- Human decisions (approved/denied).
- Execution timestamps, state transitions, and verification outcomes.
- Values entered in sensitive fields are automatically masked/redacted before writing to the ledger.

### Recovery
Supports targeted, origin-bound recovery for text input value changes. Snapshots are restricted to non-sensitive fields and expire immediately if the tab URL redirects, navigates, or is closed.

---

## Security Model

> **AI can act. You remain in control.**

MiraiLens does **NOT** claim to solve prompt injection. A malicious webpage or injection payload can still manipulate an AI client into requesting a harmful action. Instead, MiraiLens provides an independent browser-side control boundary around the requested action, ensuring no operation runs without human verification or policy matches.

```text
    Prompt Injection
          |
          v
    AI Requests Action
          |
          v
    MiraiLens Policy / Control Layer
          |
          +----> BLOCK (Domain/Sensitive rule matches)
          |
          +----> ASK HUMAN (Interactive Shadow DOM confirmation overlay)
          |
          +----> EXECUTE
                   |
                   v
                VERIFY (Inspect DOM and active URL)
                   |
                   v
              RECORD RESULT (Write to sandboxed local ledger)
```

For more information, please read the [threat_model.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/threat_model.md) and [SECURITY.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/SECURITY.md) guidelines.

---

## Installation

The npm package provides the local MiraiLens MCP server. Start the server directly via `npx`:

```bash
npx mirailens@latest
```

Alternatively, install it locally:

```bash
npm install -g mirailens
```

---

## Chrome Extension

The **MiraiLens Connector** bridges the MCP server to your active browser environment.

1. Install the [MiraiLens Connector](https://chromewebstore.google.com/detail/cjkgpjbjjefoecfbiehiognojjdhofmg) from the Chrome Web Store.
2. Start the MiraiLens MCP Server using `npx`.
3. Configure your favorite MCP client (see below).
4. Click the extension icon and select **CONNECT TO MCP SERVER**.

*Note: For extension development, you can clone the repository and load the `extension` folder as an unpacked extension in `chrome://extensions/`.*

---

## MCP Client Configuration

### Cursor
Add the following config to your Cursor `mcp.json` parameters:

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

### Claude Desktop
Add the following to your `claude_desktop_config.json`:

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

## Technical Architecture

```text
    +--------------+       Model Context Protocol (JSON-RPC)       +---------------+
    |  MCP Client  | <-------------------------------------------> |  MCP Server   |
    | (Proposer)   |                                               | (Translator)  |
    +--------------+                                               +---------------+
                                                                           |
                                                                 WebSocket | (JSON-RPC)
                                                                           v
    +--------------+            Chrome Message Passing             +---------------+
    |  Browser     | <-------------------------------------------- |  Extension    |
    |  Tab DOM     |                                               |  Service      |
    +--------------+                                               |  Worker       |
                                                                   |  (Enforcer)   |
                                                                   +---------------+
```

- **MCP Client**: Evaluates goals and proposes browser actions.
- **MCP Server**: Coordinates stdio streams and translates requests into local WebSocket messages.
- **Browser Extension**:authoritative client-side security authority; evaluates policies, prompts for confirmation, verifies states, and records audits.
- **Browser Tab DOM**: Executes supported automation scripts and renders confirmation overlays.

For structural details, see [docs/architecture.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/docs/architecture.md).

---

## Supported Clients & Browsers

### Known Integrations
- **Cursor** (v0.40.4+)
- **Claude Desktop** (v0.7.0+)
- **MCP Inspector** (v0.1.0+)

### Web Browsers
- **Google Chrome / Chromium**: Fully Supported (Recommended).
- **Microsoft Edge**: Fully Supported.
- **Mozilla Firefox**: Not currently supported (extension relies on Chromium-specific MV3 scripting namespace APIs).

---

## Protocol Compatibility

The server communication protocol is frozen at version **v1.0**. All future patch releases in the v1.2.x series will maintain backward compatibility with v1.0 clients.

---

## Development

```bash
# Clone the repository
git clone https://github.com/mugenkyou/mcp-server-mirailens.git
cd mcp-server-mirailens

# Clean dependency installation
npm ci

# Perform type checks
npm run typecheck

# Build the server target
npm run build

# Run the test runner
npm test

# Dry-run package inspection
npm pack --dry-run
```

---

## Contributing

For coding conventions and pull request rules, see [CONTRIBUTING.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/CONTRIBUTING.md). Security issues must be reported privately following [SECURITY.md](https://github.com/mugenkyou/mcp-server-mirailens/blob/main/SECURITY.md).

---

## License

Distributed under the **MiraiLens Community Non-Commercial License, Version 1.0**. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>MiraiLens</strong><br>
  <em>"Watch it. Interrupt it. Control it. Trust it."</em>
</p>

<p align="center">
  <a href="https://mirailens.vercel.app">Website</a> |
  <a href="https://chromewebstore.google.com/detail/cjkgpjbjjefoecfbiehiognojjdhofmg">Chrome Extension</a> |
  <a href="https://www.npmjs.com/package/mirailens">npm</a> |
  <a href="https://github.com/mugenkyou/mcp-server-mirailens">GitHub</a>
</p>