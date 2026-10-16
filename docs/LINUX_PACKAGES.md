# 🐧 Linux Package Distribution Guide

CoNote provides multiple native distribution channels for Linux developers and teams.

---

## ⚡ Direct Executables

### 1. AppImage (Universal)
```bash
# Make executable and launch
chmod +x CoNote-0.1.0-linux-x64.AppImage
./CoNote-0.1.0-linux-x64.AppImage
```

### 2. Debian / Ubuntu (`.deb`)
```bash
sudo dpkg -i CoNote-0.1.0-linux-amd64.deb
sudo apt-get install -f # Fix any missing dependencies if needed
```

### 3. Fedora / RHEL (`.rpm`)
```bash
sudo rpm -i CoNote-0.1.0-linux-x86_64.rpm
```

---

## 🏔️ Arch Linux (AUR PKGBUILD)

For the Arch User Repository (AUR), `PKGBUILD` definition:

```bash
# Maintainer: Akmal Muhamad <github.com/muhakmal>
pkgname=conote-bin
pkgver=0.1.0
pkgrel=1
pkgdesc="Fast, local-first PRD & Markdown desktop notebook for Confluence Cloud"
arch=('x86_64' 'aarch64')
url="https://github.com/muhakmal/conote-for-confluence"
license=('MIT')
depends=('gtk3' 'libnotify' 'nss' 'libxss' 'libsecret')
options=('!strip')

source_x86_64=("https://github.com/muhakmal/conote-for-confluence/releases/download/v${pkgver}/CoNote-${pkgver}-linux-x64.AppImage")
source_aarch64=("https://github.com/muhakmal/conote-for-confluence/releases/download/v${pkgver}/CoNote-${pkgver}-linux-arm64.AppImage")

sha256sums_x86_64=('LINUX_X64_SHA256_PLACEHOLDER')
sha256sums_aarch64=('LINUX_ARM64_SHA256_PLACEHOLDER')

package() {
    install -dm755 "${pkgdir}/opt/${pkgname}"
    install -dm755 "${pkgdir}/usr/bin"

    if [ "$CARCH" = "x86_64" ]; then
        install -m755 "${srcdir}/CoNote-${pkgver}-linux-x64.AppImage" "${pkgdir}/opt/${pkgname}/conote"
    else
        install -m755 "${srcdir}/CoNote-${pkgver}-linux-arm64.AppImage" "${pkgdir}/opt/${pkgname}/conote"
    fi

    ln -s "/opt/${pkgname}/conote" "${pkgdir}/usr/bin/conote"
}
```

---

## 📦 Flathub (Flatpak Manifest Preview)

```yaml
app-id: com.conote.app
runtime: org.freedesktop.Platform
runtime-version: '23.08'
sdk: org.freedesktop.Sdk
command: conote
finish-args:
  - --share=network
  - --share=ipc
  - --socket=x11
  - --socket=wayland
  - --filesystem=host
modules:
  - name: conote
    buildsystem: simple
    build-commands:
      - install -D conote /app/bin/conote
```
