#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../plugin" && pwd)"

echo "EvolveClaw Plugin Installer"
echo "==========================="
echo ""
echo "Installing plugin from: $PLUGIN_DIR"
echo ""

# Use OpenClaw's native link-install for proper discovery
openclaw plugins install -l "$PLUGIN_DIR"

echo ""
echo "Done! Now enable the plugin:"
echo "  openclaw plugins enable evolveclaw"
echo ""
echo "Then restart the gateway:"
echo "  openclaw gateway restart"
