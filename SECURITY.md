# Security Policy

We take the security of MiraiLens seriously. This document outlines supported versions, vulnerability reporting procedures, disclosure guidelines, and known architectural security limitations.

---

## 1. Supported Versions

Security updates and patches are actively provided for the following versions:

| Version | Supported | Notes |
|---------|-----------|-------|
| v1.2.x  | Yes       | Latest production release. |
| < v1.2.0| No        | Legacy development releases. Please upgrade to v1.2.0+. |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability in MiraiLens, please report it responsibly using our GitHub repository's built-in **Private Vulnerability Reporting** mechanism.

### How to Submit a Report
1. Go to the repository on GitHub: `https://github.com/mugenkyou/mirailens`
2. Navigate to the **Security** tab.
3. Click **Report a vulnerability** to open the draft advisory page.

### What to Include
To help us assess and resolve the issue quickly, please include:
- A detailed description of the vulnerability.
- Steps to reproduce the issue (including any payload strings or configuration files).
- Impact assessment (e.g. bypass of policy rules, data exposure, prompt injection).
- Proof of Concept (PoC) scripts or screencasts if applicable.

---

## 3. Vulnerability Response Timeline

Upon receiving a valid report, our team will:
- Acknowledge receipt within **48 hours**.
- Provide a preliminary evaluation of the report's severity.
- Work on a patch or mitigation strategy, targeting release within **30 days**.
- Coordinate public disclosure in the GitHub repository release notes.

---

## 4. Known Security Limitations

When deploying MiraiLens, keep the following security properties in mind:

- **Prompt Injection Risks**: MiraiLens does NOT prevent indirect or direct prompt injections on the AI orchestration client. Compromised page contents can influence the AI client to attempt malicious browser actions (like clicking delete buttons or navigating to dangerous URLs). The extension's human-in-the-loop approval overlay and domain restrictions serve as the defense boundary against these attempts.
- **Form Snapshots & Sensitivity**: While password, PIN, CVV, and standard payment field inputs are flagged as sensitive and excluded from snapshots, custom form layouts may fail detection. Maintain vigilance when approving automated inputs.
- **Local Ledger Integrity**: The local action ledger is stored within local extension storage. It does not provide cryptographic immutability (e.g., signing or hashes) and is intended for audit trail transparency rather than formal compliance reports.
