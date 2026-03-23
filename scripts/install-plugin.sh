#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../plugin" && pwd)"

echo "EvolveClaw Plugin Installer"
echo "==========================="
echo ""

# Locate OpenClaw config
OPENCLAW_CONFIG="${OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"

if [ ! -f "$OPENCLAW_CONFIG" ]; then
    echo "Error: OpenClaw config not found at $OPENCLAW_CONFIG"
    echo "Make sure OpenClaw is installed: npm install -g openclaw@latest"
    exit 1
fi

echo "Plugin source:  $PLUGIN_DIR"
echo "OpenClaw config: $OPENCLAW_CONFIG"
echo ""

# Try native install first (copy mode)
if openclaw plugins install "$PLUGIN_DIR" 2>/dev/null; then
    echo ""
    echo "Installed via openclaw plugins install."
else
    echo "Native install not supported for local paths on this version."
    echo "Configuring plugins.load.paths instead..."
    echo ""

    # Use node to safely modify the JSON config
    node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$OPENCLAW_CONFIG', 'utf8'));

if (!cfg.plugins) cfg.plugins = {};
if (!cfg.plugins.load) cfg.plugins.load = {};
if (!Array.isArray(cfg.plugins.load.paths)) cfg.plugins.load.paths = [];

const pluginPath = '$PLUGIN_DIR';
if (!cfg.plugins.load.paths.includes(pluginPath)) {
    cfg.plugins.load.paths.push(pluginPath);
    console.log('Added plugin path to plugins.load.paths');
} else {
    console.log('Plugin path already in plugins.load.paths');
}

if (!cfg.plugins.entries) cfg.plugins.entries = {};
if (!cfg.plugins.entries.evolveclaw) {
    cfg.plugins.entries.evolveclaw = { enabled: true };
    console.log('Enabled evolveclaw in plugins.entries');
} else {
    cfg.plugins.entries.evolveclaw.enabled = true;
    console.log('evolveclaw already in plugins.entries');
}

fs.writeFileSync('$OPENCLAW_CONFIG', JSON.stringify(cfg, null, 2) + '\n');
"
fi

echo ""
echo "Done! Restart the gateway to activate:"
echo "  openclaw gateway restart"
echo ""
echo "Verify with:"
echo "  openclaw plugins list | grep evolveclaw"
