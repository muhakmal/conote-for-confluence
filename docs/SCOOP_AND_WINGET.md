# 🪟 Windows Package Manager Distribution (Winget & Scoop)

Windows users can install and keep **CoNote for Confluence** updated using either **Winget** (the official Windows Package Manager) or **Scoop**.

---

## ⚡ Installation via Winget

Once published to the `microsoft/winget-pkgs` repository:
```powershell
# Install CoNote
winget install muhakmal.conote

# Upgrade CoNote
winget upgrade muhakmal.conote
```

### Winget Manifest Specification (`muhakmal.conote.yaml`)
```yaml
PackageIdentifier: muhakmal.conote
PackageVersion: 0.1.0
PackageName: CoNote for Confluence
Publisher: Akmal Muhamad
License: MIT
ShortDescription: Fast, local-first PRD & Markdown desktop notebook for Confluence Cloud.
Installers:
  - Architecture: x64
    InstallerType: nullsoft
    InstallerUrl: https://github.com/muhakmal/conote-for-confluence/releases/download/v0.1.0/CoNote-0.1.0-win-x64.exe
    InstallerSha256: WIN_X64_SHA256_HASH_PLACEHOLDER
  - Architecture: arm64
    InstallerType: nullsoft
    InstallerUrl: https://github.com/muhakmal/conote-for-confluence/releases/download/v0.1.0/CoNote-0.1.0-win-arm64.exe
    InstallerSha256: WIN_ARM64_SHA256_HASH_PLACEHOLDER
ManifestType: singleton
ManifestVersion: 1.6.0
```

---

## 🍦 Installation via Scoop

```powershell
# Add custom bucket or local bucket
scoop bucket add conote https://github.com/muhakmal/scoop-conote

# Install CoNote
scoop install conote
```

### Scoop Manifest Specification (`conote.json`)
```json
{
  "version": "0.1.0",
  "description": "Fast, local-first PRD & Markdown desktop notebook for Confluence Cloud",
  "homepage": "https://github.com/muhakmal/conote-for-confluence",
  "license": "MIT",
  "architecture": {
    "64bit": {
      "url": "https://github.com/muhakmal/conote-for-confluence/releases/download/v0.1.0/CoNote-0.1.0-win-x64.exe#/dl.7z",
      "hash": "WIN_X64_SHA256_HASH_PLACEHOLDER"
    }
  },
  "shortcuts": [
    ["CoNote.exe", "CoNote"]
  ],
  "checkver": "github",
  "autoupdate": {
    "architecture": {
      "64bit": {
        "url": "https://github.com/muhakmal/conote-for-confluence/releases/download/v$version/CoNote-$version-win-x64.exe#/dl.7z"
      }
    }
  }
}
```
