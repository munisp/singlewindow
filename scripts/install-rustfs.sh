#!/usr/bin/env bash
# install-rustfs.sh — Downloads and installs the RustFS binary for Linux x86_64.
set -e
RUSTFS_VERSION="${RUSTFS_VERSION:-latest}"
DEST="${RUSTFS_DEST:-/usr/local/bin/rustfs}"
TMP=$(mktemp -d)
echo "[rustfs] Downloading RustFS ($RUSTFS_VERSION) for linux-x86_64-musl..."
curl -fsSL "https://github.com/rustfs/rustfs/releases/latest/download/rustfs-x86_64-unknown-linux-musl" -o "$TMP/rustfs"
chmod +x "$TMP/rustfs"
sudo mv "$TMP/rustfs" "$DEST"
echo "[rustfs] Installed at $DEST"
"$DEST" --version || true
