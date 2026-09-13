#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_DIR="${SCRIPT_DIR:h:h}"
ENV_FILE="$REPO_DIR/.env.codex-local"
PLIST="$HOME/Library/LaunchAgents/com.postiz.codex-bridge.plist"
LOG_DIR="$HOME/Library/Logs/Postiz"
NODE_DIR="${commands[node]:h}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.codex-local.example and generate secrets first." >&2
  exit 1
fi

mkdir -p "${PLIST:h}" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.postiz.codex-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$REPO_DIR/scripts/local/run-codex-bridge.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/ChatGPT.app/Contents/Resources</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/codex-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/codex-bridge.error.log</string>
</dict>
</plist>
EOF

chmod 600 "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/com.postiz.codex-bridge"

echo "Installed com.postiz.codex-bridge"
echo "Logs: $LOG_DIR/codex-bridge.log"
