# 🍺 Homebrew Cask Distribution for macOS

CoNote can be installed and updated on macOS via Homebrew Cask.

---

## ⚡ Installation via Homebrew

```bash
# Tap the official repository
brew tap muhakmal/conote

# Install CoNote Cask
brew install --cask conote
```

To update when a new version is released:
```bash
brew upgrade --cask conote
```

---

## 📋 Cask Formula Definition (`Casks/conote.rb`)

For maintainers or custom private taps, here is the official Cask specification:

```ruby
cask "conote" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "ARM64_SHA256_CHECKSUM_PLACEHOLDER",
         intel: "X64_SHA256_CHECKSUM_PLACEHOLDER"

  url "https://github.com/muhakmal/conote-for-confluence/releases/download/v#{version}/CoNote-#{version}-mac-#{arch}.dmg",
      verified: "github.com/muhakmal/conote-for-confluence/"
  name "CoNote for Confluence"
  desc "Local-first PRD & Markdown desktop notebook for Confluence Cloud"
  homepage "https://github.com/muhakmal/conote-for-confluence"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :catalina"

  app "CoNote.app"

  zap trash: [
    "~/Library/Application Support/conote",
    "~/Library/Preferences/com.conote.app.plist",
    "~/Library/Saved Application State/com.conote.app.savedState",
  ]
end
```

---

## 🛠️ Setting up the Tap Repository

To host the tap on GitHub:
1. Create a public repository named `homebrew-conote` under your GitHub account (`github.com/muhakmal/homebrew-conote`).
2. Add the formula above to `Casks/conote.rb`.
3. Update the `version` and `sha256` checksums automatically via GitHub Actions on new release tags.
