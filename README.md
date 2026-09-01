# MiraiLens

### Browser control infrastructure for MCP agents. Connect MCP-compatible AI clients to a real browser through a controlled Chrome extension.

[![CI](https://github.com/mugenkyou/mirailens/actions/workflows/ci.yml/badge.svg)](https://github.com/mugenkyou/mirailens/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mirailens.svg)](https://www.npmjs.com/package/mirailens)
[![License](https://img.shields.io/badge/license-Community%20Non--Commercial-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-mugenkyou%2Fmirailens-blue)](https://github.com/mugenkyou/mirailens)

[Website](https://mirailens.vercel.app) • [Documentation](https://mirailens.vercel.app) • [NPM](https://www.npmjs.com/package/mirailens) • [GitHub](https://github.com/mugenkyou/mirailens)

---

> **An MCP-based browser control layer for AI agents — with human control, policy enforcement, verification, and browser-side safeguards.**

---

## What is MiraiLens?

MiraiLens sits between Model Context Protocol (MCP) clients (such as Cursor, Claude Desktop, Google Antigravity, or VS Code MCP) and a user's active browser session.

Instead of giving an MCP server direct, unmonitored control over a detached headless browser instance, MiraiLens bridges the MCP protocol to a local Chrome extension over WebSocket. Every action executed by an AI model is subject to local state machine controls, domain policies, real-time user visibility, human takeover, and emergency stop safeguards.

```text
┌──────────────────────────┐
│        AI CLIENT         │
│  Cursor                  │
│  Claude                  │
│  Antigravity             │
│  VS Code / other MCP     │
│  clients                 │
└────────────┬─────────────┘
             │
             │ MCP (stdio)
             ▼
┌──────────────────────────┐
│  MIRAILENS MCP SERVER    │
│  Browser tools           │
│  State management        │
│  Verification            │
│  Control                 │
└────────────┬─────────────┘
             │
             │ Local WebSocket (:29100)
             ▼
┌──────────────────────────┐
│   MIRAILENS CONNECTOR    │
│    Chrome Extension      │
│  Policy                  │
│  Human takeover          │
│  Emergency stop          │
│  Browser-side control    │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│          CHROME          │
└────────────┬─────────────┘
             │
             ▼
            WEB
```

---

## Why MiraiLens?

Browser-capable AI agents can perform complex web tasks on behalf of users, but granting LLMs unconstrained browser control creates serious operational and safety challenges:

* **Real-World Impact**: Actions happen in real user accounts and web environments.
* **Dynamic Web Pages**: Pages mutate unpredictably, which can cause automation to fail or misfire.
* **User Intervention**: Users need the ability to monitor actions and take control when sensitive steps occur.
* **Lack of Boundaries**: Unmonitored automation can perform actions on unexpected domains or sensitive inputs.
* **Visibility Deficit**: Users require clear audit trails of what actions an AI attempted and completed.

MiraiLens is designed around a core engineering principle:

> **AI should be able to operate the browser without removing the user's ability to observe, interrupt, control, and stop that operation.**

---

## Features

### 🌐 Browser Interaction
* `mcp_mirailens_navigate`: Navigate active tab to a target URL.
* `mcp_mirailens_go_back` & `mcp_mirailens_go_forward`: Navigate browser history.
* `mcp_mirailens_click`: Click elements by selector or ARIA query.
* `mcp_mirailens_type`: Type text into specified input fields.
* `mcp_mirailens_hover`: Hover over specified target elements.
* `mcp_mirailens_select_option`: Select option(s) in dropdown elements.
* `mcp_mirailens_press_key`: Send keyboard key events to the active element.
* `mcp_mirailens_wait`: Pause execution for a specified duration.

### 🔍 Inspection & Diagnostics
* `mcp_mirailens_snapshot`: Capture accessibility (ARIA) tree snapshots of the page.
* `mcp_mirailens_screenshot`: Capture full-tab PNG screenshots.
* `mcp_mirailens_get_console_logs`: Retrieve recent JavaScript console output.

### 🛡️ Human Control & Governance
* `get_agent_status`: Inspect control state, connection health, and execution permissions.
* `pause_agent` / `pause_ai`: Pause AI execution.
* `resume_agent` / `resume_ai`: Resume AI execution after pause or takeover.
* `take_control`: Explicitly hand browser control to the human user, blocking AI calls.
* `return_control`: Return control from human back to the AI agent.
* `stop_agent` / `emergency_stop`: Emergency stop all active execution.

### 🔒 Security Policy
* `get_policy`: Retrieve current extension security policy settings.
* `set_policy`: Update trusted/blocked domains and sensitive field handling *(requires browser overlay approval)*.
* **Sensitive Field Protection**: Automatically masks sensitive fields (`password`, `credit_card`) in logs and enforces `ALWAYS_ASK` or `ALWAYS_DENY` rules.

### ⚡ Reliability & Auditability
* `undo_last`: Revert the last reversible form action executed by the AI.
* `get_action_history`: Retrieve bounded, filtered execution audit logs.
* **Action Verification**: Validates DOM mutations before marking actions complete.

---

## Human Control Model

MiraiLens enforces a browser-side control state machine between the AI agent and the active browser session:

```text
  AI CONTROL
      │
      ├── User observes action stream
      ├── User clicks overlay or issues command
      ▼
HUMAN CONTROL
      ├── All AI browser actions blocked immediately
      └── User returns control when ready
      ▼
  AI CONTROL
```

### Emergency Stop
Executing `stop_agent` or triggering the extension's emergency stop overlay transitions the system into an `EMERGENCY_STOP` state. All pending and incoming AI commands are persistently blocked until the control state is explicitly reset.

---

## Security Model

MiraiLens focuses on **execution safety and browser-side governance**. It does NOT claim to eliminate LLM prompt injection or make arbitrary natural language instructions inherently safe.

```text
AI Request ──► MCP Server ──► Chrome Connector ──► Policy / Gate Checks ──► Browser Action
```

1. **Local Boundary**: The MCP server and Chrome extension communicate via a local WebSocket (`127.0.0.1:29100`).
2. **Policy Gates**: Domain whitelists/blacklists and sensitive field rules are checked before dispatching browser commands.
3. **Execution Masking**: Sensitive input parameters are never stored unmasked in diagnostic logs or history ledgers.

For detailed security disclosures, see [SECURITY.md](SECURITY.md) and [threat_model.md](threat_model.md).

---

## Installation

### Quick Start

Run the MCP server via `npx`:

```bash
npx -y mirailens@latest
```

### Setup Flow

```text
1. Install MCP Server  ──►  2. Configure MCP Client  ──►  3. Load Chrome Extension  ──►  4. Connect & Operate
```

---

## Connect an MCP Client

MiraiLens uses standard MCP over `stdio` and works across major MCP-compliant clients.

### Verified Clients

| Client | Status | Configuration |
|---|---|---|
| **Cursor** | Verified | `.cursor/mcp.json` |
| **Claude Desktop** | Verified | `claude_desktop_config.json` |
| **Google Antigravity** | Verified | `mcp_config.json` |
| **MCP Inspector** | Verified | `npx @modelcontextprotocol/inspector npx mirailens@latest` |

#### Cursor Setup
Add to `.cursor/mcp.json`:
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

#### Claude Desktop Setup
Add to `claude_desktop_config.json`:
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

#### Google Antigravity Setup
Add to `mcp_config.json`:
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

### Compatible Clients

The following clients support standard MCP `stdio` servers:
* **Claude Code**
* **VS Code (MCP extension)**
* **Cline**
* **Roo Code**
* **Windsurf**
* **Gemini CLI**

---

## Chrome Extension Setup

1. Locate or download the extension bundle from `extension/` or `mirailens-extension.zip`.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the `extension/` directory.
5. Click the **MiraiLens** extension icon in Chrome to open the control panel and verify connection status on local port `29100`.

---

## Local Development

```bash
# 1. Clone repository
git clone https://github.com/mugenkyou/mirailens.git
cd mirailens

# 2. Install dependencies
npm install

# 3. Typecheck TypeScript
npm run typecheck

# 4. Build bundle
npm run build

# 5. Run test suite
npm test
```

---

## Project Structure

```text
mirailens/
├── src/
│   ├── index.ts               # CLI & stdio entry point
│   ├── server.ts              # MCP server setup & tool registration
│   ├── context.ts             # Application context & WebSocket bridge
│   ├── ws.ts                  # Local WebSocket server (port 29100)
│   ├── state-machine.ts       # Control state machine implementation
│   ├── tools/                 # MCP tool implementations
│   │   ├── common.ts          # Navigation & wait tools
│   │   ├── custom.ts          # Console logs & screenshot tools
│   │   ├── snapshot.ts        # ARIA snapshot & interaction tools
│   │   └── control.ts         # Governance & control tools
│   └── utils/                 # Logging, formatting & helper functions
├── extension/                 # Chrome extension (Manifest V3)
│   ├── manifest.json          # Extension manifest
│   ├── background.js          # Service worker & WebSocket client
│   ├── content.js             # DOM content script
│   ├── popup.html             # Extension popup UI
│   └── overlay.js             # On-screen human control overlay
├── tests/                     # Node.js test suite
├── docs/                      # Technical documentation
├── .github/workflows/         # GitHub Actions CI/CD workflows
├── package.json               # Package configuration
├── SECURITY.md                # Security policy & vulnerability reporting
├── threat_model.md            # Threat model documentation
└── LICENSE                    # Project license
```

---

## Technical Architecture

* **Protocol Bridge**: Concurrently manages MCP JSON-RPC over `stdio` and WebSocket JSON messages over `ws://127.0.0.1:29100`.
* **State Machine**: Enforces valid control state transitions (`IDLE`, `AGENT_RUNNING`, `HUMAN_CONTROL`, `BLOCKED`, `EMERGENCY_STOP`, `VERIFYING`).
* **Policy Engine**: Checks domain authority and sensitive field protection before permitting tool execution.
* **Verification & Recovery**: Captures pre- and post-action DOM states to verify execution outcomes and support `undo_last` form state rollbacks.
* **Audit Ledger**: Stores structured event history locally for accountability and auditing.

---

## Testing

Run the automated test suite locally:

```bash
npm test
```

The test suite validates:
1. **Stdio Safety**: Ensures zero non-JSON-RPC output on `stdout` to maintain protocol integrity.
2. **Port Management**: Tests local port binding and fallback mechanisms for port `29100`.
3. **WebSocket Lifecycle**: Verifies connection handshakes, heartbeats, and graceful disconnection.
4. **State Machine Integrity**: Validates control state transitions and blocking behavior.
5. **Security Gate**: Tests domain whitelists/blacklists, sensitive field masking, and replay tokens.
6. **Accountability Suite**: Tests audit record generation, query filtering, and history storage.
7. **Release Hardening**: Validates package metadata, binary permissions, and extension asset structure.

---

## Compatibility Matrix

| Client / Environment | Status | MCP Transport |
|---|---|---|
| Cursor | Verified | stdio |
| Claude Desktop | Verified | stdio |
| Google Antigravity | Verified | stdio |
| MCP Inspector | Verified | stdio |
| Claude Code | Compatible | stdio |
| VS Code MCP | Compatible | stdio |
| Cline | Compatible | stdio |
| Roo Code | Compatible | stdio |
| Windsurf | Compatible | stdio |
| Gemini CLI | Compatible | stdio |

---

## Limitations

* **Browser Scope**: Requires Chrome or Chromium-based browsers supporting Manifest V3 extensions.
* **Prompt Injection**: Governs execution safety and control boundaries; does not inspect or prevent adversarial reasoning inside the LLM itself.
* **Sensitive Inputs**: Passwords and secret fields are excluded from recovery snapshot storage and masked in logs by design.
* **Single Active Session**: Designed for supervising a single active browser session per MCP server instance.

---

## Roadmap

Future engineering directions under consideration:
* Chrome Web Store & Firefox Add-ons packaging
* Multi-tab concurrent state tracking
* Granular DOM mutation verification rules
* Configurable policy export and import formats

---

## Contributing

Contributions are welcome! Please review [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/improvement`).
3. Commit your changes.
4. Verify tests (`npm run typecheck && npm run build && npm test`).
5. Open a Pull Request.

---

## License

This project is licensed under the [MiraiLens Community Non-Commercial License 1.0](LICENSE).

---

## Maintainers

* **Sachin Patel** — Developer / Project Creator ([GitHub](https://github.com/mugenkyou))
* **Rohit Mohan** — Developer ([GitHub](https://github.com/imrohit44))