# CoNote for Confluence

<div align="center">

**The fast, local-first PRD & Markdown notebook for Confluence Cloud.**

*Draft PRDs and technical architecture documents at the speed of thought. Zero editor lag, offline-ready, with safe, conflict-aware publishing to Confluence.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS | Windows | Linux](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)]()
[![Status: In_Development](https://img.shields.io/badge/Status-In%20Development-orange.svg)]()

</div>

---

> [!NOTE]  
> **Trademark Disclaimer:** CoNote is an independent, community-driven open-source tool and is **not** affiliated with, endorsed by, or sponsored by Atlassian Corporation. Confluence is a registered trademark of Atlassian Corporation.

---

## 💡 What is CoNote?

Writing Product Requirement Documents (PRDs) and RFCs in the native Confluence web editor can be frustrating: heavy loading times, clunky table formatting, editor lag, and fear of losing unsaved drafts when your connection drops.

**CoNote** bridges the gap between **local-first Markdown speed** and **enterprise Confluence collaboration**:
- You write and organize documents locally in fast, plain Markdown (`.md`).
- You navigate your Confluence space hierarchy visually with an interactive tree.
- When ready, you publish directly to Confluence Cloud with automated XHTML validation, diagram attachment rendering, and bidirectional conflict prevention.

---

## ✨ Key Features & Unique Value

- **⚡ Fast & Offline-First:** Read, search, and write PRDs completely offline. No waiting for web spinners.
- **📝 Dual Writing Experience:**
  - **Write Mode:** Distraction-free WYSIWYG editor for product managers.
  - **Markdown Mode:** Split-pane editor with live syntax preview for engineers and technical writers.
  - Both modes edit and save to the exact same clean `.md` files.
- **🌳 Interactive Space Tree:**
  - Mirrors your entire Confluence space hierarchy.
  - Native drag-and-drop to reorder and reparent pages with instant visual feedback and Undo.
- **🛡️ Conflict-Aware Safe Publishing:**
  - Detects if someone updated the page on Confluence Cloud while you were drafting.
  - Shows visual side-by-side diffs before overwriting.
  - Validates XHTML storage format and cleans up invalid tags before dispatching to the API.
- **📊 Embedded Diagrams (Mermaid & PlantUML):**
  - Render sequence diagrams, flowcharts, and architecture models locally.
  - Automatically converts and uploads diagrams as Confluence attachments upon publish.
- **🏢 Multi-Space Support:**
  - Switch between multiple spaces (e.g., Engineering, Product, Core Services) with a single click.
- **🔒 Private & Secure:**
  - 100% client-to-cloud communication. No intermediate proxy, no analytics, no third-party telemetry.
  - Atlassian API tokens stay exclusively on your local machine (macOS Keychain).

---

## 🚦 Project Status

**Current Version:** `v0.2.0-alpha` (In active transition to Standalone Desktop App)

| Milestone | Status | Description |
| :--- | :---: | :--- |
| **Core Engine & Local Server** | ✅ Completed | Local HTTP server, Markdown $\leftrightarrow$ Confluence XHTML parser, sync & conflict logic. |
| **Sanitization & Open-Source Separation** | ✅ Completed | Decoupled proprietary enterprise configurations into a clean, generic core with MIT license. |
| **First-Run Onboarding & Settings UI** | 🔄 In Progress | GUI setup wizard for Atlassian domain, email, token, and space selection. |
| **Cross-Platform Desktop Packaging** | ⏳ Planned | Electron bundle: macOS (`.dmg`), Windows (`.exe` NSIS/portable), Linux (`.AppImage`, `.deb`). |
| **Multi-OS CI/CD & Distribution** | ⏳ Planned | GitHub Actions matrix build, Homebrew Cask, Winget, and direct releases. |

See the full [Implementation Plan](IMPLEMENTATION_PLAN.md) for details.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   CoNote Desktop App                   │
│   (Electron / Native macOS Window & Menu Bar Tray)    │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
   ┌───────────────────┐       ┌───────────────────┐
   │  Web UI Frontend  │       │ Local Node Server │
   │ (Vanilla JS, CSS) │◄─────►│ (Sync, Markdown,  │
   │  - Tree Navigator │       │  Storage XHTML)   │
   │  - Dual Editor    │       └─────────┬─────────┘
   └───────────────────┘                 │
                                         ▼
            ┌───────────────────────────────────────────┐
            │             Local File System             │
            │  - workspace/ (Synced Confluence pages)   │
            │  - drafts/ (Local versioned markdown)     │
            │  - macOS Keychain (Encrypted API Token)   │
            └─────────────────────┬─────────────────────┘
                                  │ Direct HTTPS
                                  ▼
                    ┌───────────────────────────┐
                    │  Atlassian Confluence API │
                    └───────────────────────────┘
```

---

## 📦 Downloads & Desktop Installers

Pre-built binaries for every release are available on the [GitHub Releases page](https://github.com/muhakmal/conote-for-confluence/releases):

| Operating System | Package Type | Architecture | Notes |
| :--- | :--- | :--- | :--- |
| **macOS** | `.dmg`, `.zip` | Apple Silicon (`arm64`), Intel (`x64`) | See [macOS Gatekeeper guide](docs/TROUBLESHOOTING.md#macos-troubleshooting) |
| **Windows** | Setup `.exe` (NSIS), Portable `.exe` | `x64`, `arm64` | See [SmartScreen guide](docs/TROUBLESHOOTING.md#windows-troubleshooting) |
| **Linux** | `.AppImage`, `.deb`, `.rpm` | `x64`, `arm64` | One-click execution or native distro package |

> [!TIP]
> Encountering an unsigned app warning on macOS or Windows? Check our [Troubleshooting Guide](docs/TROUBLESHOOTING.md) for quick 1-click unquarantine steps.

---

## 🚀 Getting Started (Development Mode)

### Prerequisites
- Node.js 20 or later
- npm or yarn
- macOS (Intel or Apple Silicon), Windows 10/11, or Linux (Ubuntu, Debian, Fedora, Arch)

### Installation
```bash
# Clone the repository
git clone https://github.com/muhakmal/conote-for-confluence.git
cd conote-for-confluence

# Install dependencies
npm install

# Start desktop app in development mode
npm run dev

# Or run headless local web server & CLI only
npm start
```

### 🛠️ Building Desktop Packages Locally
```bash
# Build for current host platform
npm run build

# Or target specific operating systems
npm run build:mac     # Generates DMG and ZIP in dist/
npm run build:win     # Generates NSIS installer and Portable EXE in dist/
npm run build:linux   # Generates AppImage, DEB, and RPM in dist/
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - see the LICENSE file for details.

