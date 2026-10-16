# CoNote Troubleshooting Guide

This guide covers common questions, platform-specific security prompts, and connection troubleshooting for **CoNote for Confluence**.

---

## 🍎 macOS Troubleshooting

### 1. "CoNote cannot be opened because the developer cannot be verified" (Gatekeeper)
Because CoNote is a community open-source project without Apple's costly paid developer certificate, macOS Gatekeeper may display a security prompt on first launch.

**Resolution Options:**
1. **Quickest:** Right-click (or Control-click) on `CoNote.app` in `/Applications`, choose **Open**, and click **Open** in the confirmation dialog. macOS will remember this decision.
2. **Terminal (Quarantine Removal):**
   ```bash
   xattr -cr /Applications/CoNote.app
   ```

### 2. Apple Silicon (M1/M2/M3/M4) vs Intel Architecture
- If your Mac uses Apple Silicon, download the `arm64.dmg` installer.
- If your Mac uses an Intel processor, download the `x64.dmg` installer.

---

## 🪟 Windows Troubleshooting

### 1. "Windows protected your PC" (Microsoft Defender SmartScreen)
When launching an unsigned `.exe` installer or portable executable:
1. Click **More info**.
2. Click **Run anyway**.

### 2. Antivirus False Positives
Open-source Electron executables packaged without an Extended Validation (EV) certificate may occasionally trigger false positives with third-party antivirus suites. Verify that the SHA256 checksum matches the one published on our [GitHub Releases](https://github.com/muhakmal/conote-for-confluence/releases).

---

## 🐧 Linux Troubleshooting

### 1. AppImage does not launch when double-clicked
Ensure executable permissions are set:
```bash
chmod +x CoNote-*-linux-x64.AppImage
./CoNote-*-linux-x64.AppImage
```

### 2. AppImage requires FUSE (`libfuse.so.2`) on Ubuntu 22.04+ or Debian 12+
Modern Ubuntu and Debian releases use `fuse3` by default:
```bash
# Ubuntu / Debian
sudo apt install libfuse2

# Fedora / RHEL
sudo dnf install fuse-libs
```
Alternatively, run without FUSE:
```bash
./CoNote-*-linux-x64.AppImage --appimage-extract-and-run
```

### 3. Native Debian / RPM packages
If you prefer native package management:
```bash
# Ubuntu / Debian
sudo dpkg -i CoNote-*-linux-amd64.deb

# Fedora / RHEL
sudo rpm -i CoNote-*-linux-x86_64.rpm
```

---

## 🔐 Confluence Connection & Token Issues

### 1. HTTP 401 Unauthorized
- **Cause:** Invalid email or API token.
- **Fix:**
  1. Generate a new API token at [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
  2. Confirm your Atlassian account email matches the one that created the token.
  3. Ensure you entered your full Atlassian Cloud URL (e.g. `https://your-domain.atlassian.net/wiki`).

### 2. HTTP 403 Forbidden
- **Cause:** Your Atlassian user account does not have read/write permissions for the requested space or page.
- **Fix:** Contact your Confluence space administrator to grant your account **View** and **Add/Edit** permissions for the space.

### 3. Space list is empty during onboarding
- If your organization restricts space discovery, manually enter your known **Space Key** in the settings.

---

## 💬 Getting Further Help
If you run into an issue not listed here:
- Check existing reports on [GitHub Issues](https://github.com/muhakmal/conote-for-confluence/issues).
- Open a new bug report with log outputs from developer tools (`Cmd+Option+I` / `Ctrl+Shift+I`).
