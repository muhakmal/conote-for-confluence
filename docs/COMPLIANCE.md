# Regulatory, Privacy & API Use Compliance Guide

This document establishes the official regulatory compliance, privacy safeguards, and Atlassian API usage policies for **CoNote for Confluence**.

---

## 1. Atlassian API Terms & Usage Compliance

CoNote interacts directly with Atlassian Confluence Cloud via the official [Confluence Cloud REST API](https://developer.atlassian.com/cloud/confluence/rest/v1/intro/).

### Direct-to-Tenant Communication (Zero Proxy)
- **Direct TLS 1.3 HTTPS:** All API calls are executed directly from the user's desktop application or local daemon to the user's specific Atlassian Cloud tenant URL (e.g., `https://your-domain.atlassian.net/wiki`).
- **Zero Intermediary Servers:** CoNote operates without any hosted backend, cloud relays, middleman servers, or proxy nodes.
- **Scoped Basic Authentication:** In accordance with Atlassian security standards, credentials use standard HTTP Basic Auth headers (`email:api_token`) encoded in Base64 over encrypted TLS.

### Rate Limit & Performance Hygiene
- CoNote employs client-side space indexing (`workspace/_index.json`) and ETags to ensure incremental pulls.
- Requests are throttled to prevent triggering Atlassian Cloud 429 (Rate Limit Exceeded) thresholds.

### Document & Storage Format Integrity
- CoNote converts Markdown into valid **Confluence Storage Format (XHTML)** using strict XML entity escaping and Atlassian macro schema compliance.
- Auto-validation gates prevent malformed storage format tags from corrupting remote pages.

---

## 2. Atlassian Trademark & Brand Disclaimer

> [!IMPORTANT]
> **CoNote** is an independent, community-driven open-source project created by Akmal, M. under BaskomLabs. CoNote is **not** affiliated with, endorsed by, sponsored by, or certified by Atlassian Corporation.
> 
> - **Confluence®** is a registered trademark of Atlassian Corporation in the United States and other countries.
> - The naming "CoNote for Confluence" adheres to Atlassian's trademark naming guidelines for third-party developer tools by clearly indicating interoperability rather than origin.

---

## 3. Data Protection & Privacy Compliance

CoNote is engineered from the ground up as a **local-first** application, satisfying stringent global data protection regulations:

### Indonesian PDP Law (UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi)
1. **Data Sovereignty:** All technical specifications, PRDs, architectural diagrams, and user notes remain 100% on the user's local machine under `workspace/` and `drafts/`.
2. **No Data Processing Third Parties:** No personal data, company data, or draft content is shared with, transferred to, or processed by any external data processor.

### GDPR (EU) & CCPA (California) Compliance
1. **Zero Telemetry / Zero Tracking:** CoNote includes no analytics trackers, advertising identifiers, tracking pixels, or telemetry collectors (no Google Analytics, no Mixpanel, no Sentry telemetry).
2. **Offline-First Resilience:** Users can disconnect entirely from the internet and continue reading, writing, and versioning their drafts locally without restriction.

---

## 4. Cryptographic Credential Protection (`safeStorage`)

To prevent plaintext credential harvesting, desktop releases of CoNote protect Atlassian API tokens at rest using hardware-backed OS keyrings:

| Operating System | Enclave / Cryptographic Subsystem | Key Storage Mechanism |
| :--- | :--- | :--- |
| **macOS** | Apple Keychain Services | AES-128/256 hardware enclave / login keychain |
| **Windows** | Windows Data Protection API (DPAPI) | Triple-DES/AES user-profile bound master key |
| **Linux** | FreeDesktop Secret Service API (`libsecret`) | GNOME Keyring / KWallet with machine-derived fallback |

---

## 5. Open Source Licensing & Supply Chain Audits

- **Core License:** CoNote is distributed under the [MIT License](https://github.com/muhakmal/conote-for-confluence/blob/main/LICENSE), providing total transparency, freedom to audit source code, and rights to modify.
- **Dependency Vetting:** All runtime dependencies are vetted for permissive licensing (MIT, Apache 2.0, BSD-3-Clause) with zero viral GPL/copyleft license contaminations.
- **BaskomLabs Open Source Standards:** Part of the BaskomLabs portfolio ([https://baskom.fun/open-source](https://baskom.fun/open-source)), adhering to open community contribution standards.
