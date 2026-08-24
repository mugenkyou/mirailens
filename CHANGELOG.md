# Changelog

All notable changes to the MiraiLens project will be documented in this file. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2026-08-25

### Added
- **Accountability Local Ledger**: Append-only local action history log in extension storage, bounded to 1,000 items with eviction logic.
- **Verification State Machine**: Added `VERIFYING` state transition post-execution to inspect target browser tab value changes and location redirections.
- **Undo Form Snapshots**: Scope-restricted restoration of form input values for text inputs with domain security guards.
- **Interactive History Dashboard**: Dedicated `history.html` and `history.js` UI console to inspect logs, apply session filters, search domains, and export logs to JSON.
- **Header History Icon**: Added link trigger button to popup header to navigate directly to the History console view.
- **Accessibility Enhancements**: Added roles (`role="alertdialog"`), ARIA modal state tags, and keyboard focus defaults to confirmation overlay components.
- **Automated Test Coverage**: Added comprehensive test runner suites validating state changes, ledger entries, and reversal policies.

### Changed
- **NPM Binary Mapping**: Added `mirailens` to package binary config files to resolve execution via `npx mirailens` seamlessly.
- **Licensing Designations**: Aligned all packaging file records to reference the `SEE LICENSE IN LICENSE` Community Non-Commercial license.

### Security
- **Sensitive Field Redaction**: Redacted typed inputs on credential/passwords fields inside the service worker from ledger snapshots.
- **Origin Replay Guards**: Bound undo/reversal operations to match origin URLs, preventing value restoration replays on mismatched tabs.

---

## [1.1.8] — 2026-08-20

### Added
- Phase 4 Security and Action Governance policies.
- Trusted and Blocked domain configurations in extension options.
- Draft-Only mode toggle to block form submit actions during data filling.
- Shadow DOM visual overlays for human confirmation actions.
