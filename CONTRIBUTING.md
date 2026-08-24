# Contributing to MiraiLens

Thank you for your interest in contributing to MiraiLens! Please follow these development guidelines to ensure a smooth contribution process.

---

## 1. Development Environment Setup

### Requirements
- **Node.js**: Version 18.0.0 or higher.
- **npm**: Version 9.0.0 or higher.
- **Browser**: Google Chrome, Edge, or any Chromium-based browser.

### Clone and Install Dependencies
```bash
git clone https://github.com/mugenkyou/mcp-server-mirailens.git
cd mcp-server-mirailens
npm ci
```

---

## 2. Compilation and Build Commands

Build the TypeScript files into executable ES Modules:
```bash
# Type check TypeScript codebase
npm run typecheck

# Build server distribution
npm run build

# Watch for server changes during active coding
npm run watch
```

---

## 3. Running the Test Suite

We use Node's native test runner to evaluate behaviors. Ensure all tests pass before proposing any pull requests:

```bash
# Run all tests (regression, security, accountability, release)
npm test

# Run individual test files
node --test tests/state-machine.test.js
node --test tests/security.test.js
node --test tests/accountability.test.js
node --test tests/release.test.js
```

---

## 4. Coding & Architecture Conventions

### Adding or Modifying MCP Tools
1. Edit target files in `src/tools/` (e.g. `src/tools/snapshot.ts` or `src/tools/control.ts`).
2. Add corresponding test coverage in `tests/security.test.js` or `tests/accountability.test.js`.
3. Register the new tool in `src/index.ts` under the appropriate categories.

### Modifying Extension Background Logic
- Code is structured inside `extension/background.js`.
- Always ensure any new asynchronous logic catches rejections gracefully and transitions the core state machine (`STATES`) correctly.
- Do NOT weaken verification state assertions or remove value masking rules.

### Security-Sensitive Changes & Regression Testing
- Any modifications to the policy engine (`evaluatePolicy`), HTML form sanitizations, or overlay confirmation prompts (`requestHumanApproval`) require full regression verification.
- Always run `npm test` after editing `background.js` or `content.js`.

---

## 5. Pull Request Guidelines

1. **Branch Naming**: Use clean, descriptive branch prefixes:
   - `feat/` for new features or tools
   - `fix/` for bug fixes and state synchronizations
   - `docs/` for documentation updates
2. **Commit Messages**: Write semantic commit messages (e.g., `feat: expose get_action_history tool`).
3. **Automated Testing**: Pull Requests will trigger our automated GitHub Actions workflow verifying builds, formatting, and unit tests.
