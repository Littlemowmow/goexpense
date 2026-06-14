#!/bin/bash
# Double-click this file in Finder to launch the Life Ops dashboard.
# It starts the local server and opens it in your browser.

cd "$(dirname "$0")" || exit 1

# Install dependencies on first run.
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies (one time, ~30s)..."
  npm install || { echo "npm install failed"; read -r; exit 1; }
fi

PORT=5173
URL="http://localhost:$PORT/"

# Open the browser once the server is up.
(
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "$URL"; then open "$URL"; break; fi
    sleep 0.5
  done
) &

echo "Starting Life Ops dashboard at $URL"
echo "Leave this Terminal window open while you use it. Press Ctrl+C to quit."
npm run dev -- --port "$PORT"
