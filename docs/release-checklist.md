# Release Checklist

Use this checklist to verify all packaging, testing, and documentation parameters before tag pushes and production releases of MiraiLens.

---

## 1. Version Consistency
- [ ] Version in `package.json` matches semantic versioning.
- [ ] Version in `extension/manifest.json` matches `package.json`.
- [ ] Version strings in `popup.html`, `options.html`, and `history.html` matches release version.
- [ ] Version in `background.js` initialization handshake parameters matches release version.
- [ ] Running `npm install` has updated `package-lock.json` with the identical version.

## 2. Packaging Audits
- [ ] Run `npm run build` and ensure TypeScript builds cleanly with zero errors.
- [ ] Run `npm pack --dry-run` to inspect target package sizes and published file logs.
- [ ] Confirm no local developer credential profiles, private keys, or `.env` files are captured in the pack list.

## 3. Documentation Alignment
- [ ] `README.md` positioning aligns with release capabilities and features.
- [ ] `docs/architecture.md` matches trust boundaries and message paths.
- [ ] `SECURITY.md` contact and advisory steps are accurate.
- [ ] `threat_model.md` incorporates all ledger, verification, and undo limitations.
- [ ] `CONTRIBUTING.md` developer install commands function correctly.
- [ ] `CHANGELOG.md` reflects all added/modified/fixed logs for this release.

## 4. Accessibility Check
- [ ] Human approval overlay contains `role="alertdialog"`, `aria-modal="true"`, and standard focus tracking.
- [ ] Core popup views, options page, and history dashboard support Tab navigation and focus indicator outlines.
- [ ] Color is not the sole conveyor of state changes.

## 5. Failure Testing & Regressions
- [ ] Full regression test suite runs and completes with zero failures:
  ```bash
  npm test
  ```
- [ ] Dry-run installation inside clean temporary environment resolves executable path.
- [ ] Chrome Extension directory successfully loads unpacked without errors or permissions warnings.
