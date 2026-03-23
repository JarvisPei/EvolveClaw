#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/../plugin"

# Default OpenClaw extensions directory
OPENCLAW_EXT_DIR="${OPENCLAW_EXTENSIONS_DIR:-$HOME/.openclaw/extensions}"

echo "EvolveClaw Plugin Installer"
echo "==========================="

if [ ! -d "$OPENCLAW_EXT_DIR" ]; then
    echo "Creating OpenClaw extensions directory: $OPENCLAW_EXT_DIR"
    mkdir -p "$OPENCLAW_EXT_DIR"
fi

TARGET="$OPENCLAW_EXT_DIR/evolveclaw"

if [ -L "$TARGET" ] || [ -d "$TARGET" ]; then
    echo "Removing existing installation at $TARGET"
    rm -rf "$TARGET"
fi

echo "Symlinking plugin: $PLUGIN_DIR -> $TARGET"
ln -s "$(cd "$PLUGIN_DIR" && pwd)" "$TARGET"

echo ""
echo "Done! Now enable the plugin:"
echo "  openclaw plugins enable evolveclaw"
echo ""
echo "Then restart the gateway:"
echo "  openclaw gateway restart"
