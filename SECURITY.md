# Security Policy

The CoNote project takes the security of your documents and Atlassian Confluence credentials very seriously.

---

## 🔒 Security Architecture Highlights

1. **Local-First Privacy:**
   - CoNote runs an isolated in-process server communicating with your Confluence Cloud tenant directly over HTTPS.
   - None of your document contents, personal metadata, or company credentials pass through any third-party intermediary servers, telemetry networks, or analytics services.
2. **Encrypted Credential Storage:**
   - In desktop application mode, Atlassian API tokens are encrypted at rest using Electron's native `safeStorage` API:
     - **macOS:** Encrypted using keys stored in the user's macOS Keychain.
     - **Windows:** Encrypted using Windows Data Protection API (DPAPI).
     - **Linux:** Encrypted using the FreeDesktop Secret Service API (`libsecret` / GNOME Keyring / KWallet), with an encrypted machine-entropy fallback when headless.
3. **No Unsafe Remote Code Execution:**
   - External links clicked in desktop mode are strictly intercepted and delegated to the host operating system's default browser via `shell.openExternal`.
   - Preload context is strictly isolated with `contextIsolation: true` and `nodeIntegration: false`.

---

## 🛡️ Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.1.x` | ✅ Active Security Support |
| `< 0.1.0` | ❌ End of Life |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability or credential leak issue in CoNote:

1. **Do not disclose the vulnerability publicly** in a GitHub Issue, pull request, or public discussion.
2. Submit a private security advisory via [GitHub Security Advisories](https://github.com/muhakmal/conote-for-confluence/security/advisories/new).
3. If GitHub Advisories are not accessible, contact the maintainer directly via GitHub profile contact details.

### What to Include in Your Report
- A detailed description of the vulnerability.
- Proof of Concept (PoC) or reproduction steps.
- The potential impact of the issue.
- Any suggested remediations or patches.

### Response Timeline
- **Initial Response:** Within 48 hours of report submission.
- **Triage & Status Update:** Within 5 business days.
- **Fix & Public Advisory:** Coordinated release once the patch is thoroughly verified across supported operating systems.
