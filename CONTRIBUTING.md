# Contributing to CoNote for Confluence

First off, thank you for considering contributing to **CoNote for Confluence**! CoNote is built by and for engineers and technical product managers who value local-first speed, version control, and privacy.

---

## 📜 Code of Conduct
By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior to the project maintainers.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: Version 20 LTS or higher (`node -v`)
- **npm**: Version 10 or higher
- **Git**
- Any modern OS: macOS (Apple Silicon or Intel), Windows 10/11, or Linux (Ubuntu, Debian, Fedora, Arch)

### 1. Clone & Install
```bash
# Clone your fork or the repository
git clone https://github.com/muhakmal/conote-for-confluence.git
cd conote-for-confluence

# Install dependencies
npm install
```

### 2. Running in Development
```bash
# Run Desktop Electron Application
npm run dev

# Or run headless local web server & CLI only
npm start
```

### 3. Running Verification Gates
Before opening a Pull Request, ensure that all syntax and unit tests pass:
```bash
# Syntax and export validation
npm run check

# Unit and integration test suite
npm test
```

---

## 📂 Project Architecture

```text
├── bin/
│   └── cn.js              # CLI entry point (conote / cn command)
├── src/
│   ├── confluence.js      # Confluence Cloud REST API client
│   ├── storage2md.js      # Confluence XHTML storage format -> Clean Markdown
│   ├── xhtml.js           # Markdown -> Valid Confluence XHTML storage format
│   ├── render.js          # Client and server preview rendering
│   ├── publish.js         # Atomic publishing with conflict detection
│   ├── sync.js            # Workspace pull, diffing, and hierarchy building
│   ├── drafts.js          # Local draft versioning, auto-save, and trash
│   ├── history.js         # Time-travel revision history
│   ├── docx.js            # Offline DOCX export generator
│   └── config.js          # Multi-space workspace and environment config
├── electron/
│   ├── main.js            # Electron main process, in-process server, safeStorage
│   └── preload.js         # Secure contextBridge API for window controls
├── web/
│   ├── index.html         # Desktop and web UI single-page application
│   ├── app.js             # Client state, tree navigator, dual editor, dialogs
│   ├── app.css            # Responsive dark/light theme styling
│   └── vendor/            # Offline bundled editor dependencies (marked, mermaid)
├── test/
│   └── *.test.js          # Fast, zero-dependency Node.js test suite
└── electron-builder.yml   # Multi-OS packaging specification
```

---

## 🌿 Git & Pull Request Guidelines

### Branch Naming Conventions
- `feat/feature-name` (e.g. `feat/custom-page-templates`)
- `fix/bug-description` (e.g. `fix/table-alignment-storage-xml`)
- `docs/doc-update` (e.g. `docs/add-arch-linux-aur-guide`)
- `refactor/subsystem` (e.g. `refactor/tree-node-caching`)

### Commit Messages
We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat: add support for Confluence blog posts`
- `fix(xhtml): escape ampersands inside URL parameters in macros`
- `docs: add Windows SmartScreen resolution steps`
- `test: add unit tests for safeStorage fallback on Linux`

### PR Submission
1. Open an issue first to discuss substantial new features or architecture refactors.
2. Ensure `npm run check` and `npm test` pass with 100% success.
3. Keep PRs focused on a single responsibility.
4. Verify that no private credentials, corporate identifiers, or sensitive keys are committed.

---

## 💡 Reporting Issues or Suggesting Features
- To report a bug, use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md).
- To propose a feature, use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md).

Thank you for helping make CoNote better for everyone!
