# <img src="https://mirailens.vercel.app/logo/favicon-32x32.png" width="28" height="28" align="center" alt="MiraiLens Logo"> MiraiLens

### The browser control layer for AI agents.

[![npm version](https://img.shields.io/npm/v/mirailens.svg)](https://www.npmjs.com/package/mirailens)
[![License: Custom](https://img.shields.io/badge/License-Community%20Non--Commercial-blue.svg)](LICENSE)
[![CI Status](https://github.com/mugenkyou/mirailens/actions/workflows/ci.yml/badge.svg)](https://github.com/mugenkyou/mirailens/actions/workflows/ci.yml)
[![Protocol Version](https://img.shields.io/badge/Protocol-1.0-orange.svg)](#protocol-compatibility)

---

## Resources

- **Website**: [mirailens.vercel.app](https://mirailens.vercel.app)
- **Chrome Extension**: [MiraiLens Connector on Chrome Web Store](https://chromewebstore.google.com/detail/cjkgpjbjjefoecfbiehiognojjdhofmg)
- **npm Package**: [npm/mirailens](https://www.npmjs.com/package/mirailens)
- **GitHub Repository**: [mugenkyou/mirailens](https://github.com/mugenkyou/mirailens)
- **Security Policy**: [SECURITY.md](https://github.com/mugenkyou/mirailens/blob/main/SECURITY.md)
- **Threat Model**: [threat_model.md](https://github.com/mugenkyou/mirailens/blob/main/threat_model.md)
- **Architecture Details**: [docs/architecture.md](https://github.com/mugenkyou/mirailens/blob/main/docs/architecture.md)
- **Contributing Guide**: [CONTRIBUTING.md](https://github.com/mugenkyou/mirailens/blob/main/CONTRIBUTING.md)

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

For more information, please read the [threat_model.md](https://github.com/mugenkyou/mirailens/blob/main/threat_model.md) and [SECURITY.md](https://github.com/mugenkyou/mirailens/blob/main/SECURITY.md) guidelines.

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

## Universal MCP Client Configuration

MiraiLens is client-agnostic and fully standards-compliant with the Model Context Protocol (MCP) JSON-RPC specification over `stdio`. The same MiraiLens installation connects with any compliant MCP client without client-specific hacks.

### Google Antigravity
Add MiraiLens in your Antigravity MCP settings or configuration file (`~/.gemini/antigravity-ide/mcp_config.json` or workspace settings):

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

### Cursor
Add to your Cursor settings under `Features > MCP Servers` or directly in `mcp.json`:

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
Add to your `claude_desktop_config.json` (`%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

### Claude Code (CLI)
Add using the Claude Code CLI tool:

```bash
claude mcp add mirailens npx -y mirailens@latest
```

### VS Code (Cline / Roo Code / Continue)
Add to your MCP server configuration:

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

### Windsurf
Add to `~/.codeium/windsurf/mcp_config.json`:

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

### Gemini CLI
Add to your Gemini CLI configuration:

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

### MCP Inspector
Test and inspect MiraiLens interactively via the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx -y mirailens@latest
```

---

## Technical Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                       MCP CLIENTS                           │
│  [Google Antigravity]  [Cursor]  [Claude]  [VS Code]  [...] │
└──────────────────────────────┬──────────────────────────────┘
                               │ MCP stdio (Strict JSON-RPC)
                               │ (All diagnostic logs -> stderr)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    MIRAILENS MCP SERVER                     │
│  • Stdio JSON-RPC Transport & Message Framing               │
│  • Authoritative State Tracking (MCP / Extension / Tab)     │
│  • Safe Non-Blocking Port Management (Port 29100)           │
│  • Bounded WebSocket Communication & Error Handling         │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebSocket (JSON-RPC)
                               │ (Connect / Reconnect / Heartbeat)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  MIRAILENS CONNECTOR EXTENSION              │
│  • State Machine: IDLE, RUNNING, HUMAN_CONTROLLED, BLOCKED  │
│  • Security Policy Gate (Blocked Domains, Sensitive Fields) │
│  • Human Intervention (Approve / Deny, Pause, Stop)         │
│  • Post-Action DOM & Navigation Verification                │
│  • Tamper-Evident Sandboxed Action Ledger                   │
└──────────────────────────────┬──────────────────────────────┘
                               │ Chromium MV3 APIs
                               ▼
                        [Browser Tabs / Web]
```

- **MCP Client**: Formulates intents and proposes browser actions over stdio.
- **MCP Server**: Coordinates stdio streams, ensures stdout remains 100% clean protocol traffic, and communicates with the Chrome extension over WebSocket.
- **Browser Extension**: Authoritative client-side security authority; evaluates policies, prompts for confirmation, verifies states, and records audits.
- **Browser Tab DOM**: Executes supported automation scripts and renders confirmation overlays.

For structural details, see [docs/architecture.md](https://github.com/mugenkyou/mirailens/blob/main/docs/architecture.md).

---

## Client Compatibility Matrix

| MCP Client | Transport | Tested Status | Extension Compatibility |
| :--- | :--- | :--- | :--- |
| **Google Antigravity** | stdio | **Tested & Verified** | Seamless |
| **Cursor** | stdio | **Tested & Verified** | Seamless |
| **MCP Inspector** | stdio | **Tested & Verified** | Seamless |
| **Claude Desktop** | stdio | **Tested & Verified** | Seamless |
| **Claude Code** | stdio | **Compatible** | Seamless |
| **VS Code (MCP / Cline / Roo)** | stdio | **Compatible** | Seamless |
| **Windsurf** | stdio | **Compatible** | Seamless |
| **Gemini CLI** | stdio | **Compatible** | Seamless |

### Web Browsers
- **Google Chrome / Chromium**: Fully Supported (Recommended).
- **Microsoft Edge**: Fully Supported.
- **Brave / Arc / Vivaldi**: Fully Supported.
- **Mozilla Firefox**: Not currently supported (extension relies on Chromium-specific MV3 scripting namespace APIs).

---

## Protocol Compatibility

The server communication protocol is frozen at version **v1.0**. All future patch releases in the v1.2.x series maintain backward compatibility with v1.0 clients.


---

## Development

```bash
# Clone the repository
git clone https://github.com/mugenkyou/mirailens.git
cd mirailens

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

For coding conventions and pull request rules, see [CONTRIBUTING.md](https://github.com/mugenkyou/mirailens/blob/main/CONTRIBUTING.md). Security issues must be reported privately following [SECURITY.md](https://github.com/mugenkyou/mirailens/blob/main/SECURITY.md).

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
  <a href="https://github.com/mugenkyou/mirailens">GitHub</a>
</p>