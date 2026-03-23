#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/../server"

cd "$SERVER_DIR"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate

echo "Installing dependencies..."
pip install -q -r requirements.txt

if [ ! -f ".env" ] && [ -f ".env.template" ]; then
    echo "Warning: No .env found. Copy .env.template to .env and configure it."
    echo "  cp server/.env.template server/.env"
    exit 1
fi

echo "Starting EvolveClaw SCOPE server..."
python server.py
