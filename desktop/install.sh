#!/usr/bin/env bash
# Installs Claude Console for the current user: dependencies, a starter
# configuration, a systemd user service that serves the console on
# http://127.0.0.1:5178, a launcher that opens it in its own window, a menu
# entry, and the claudeconsole:// link handler. Safe to run again.
#
# Usage: desktop/install.sh [--autostart]
#   --autostart  also open the console window at login

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="$(dirname "$here")"
config_dir="$HOME/.config/claude-console"
autostart=false

[ "${1:-}" = "--autostart" ] && autostart=true

missing=()

for tool in node npm git gh jq curl ss systemctl; do
	command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done

if [ ${#missing[@]} -gt 0 ]; then
	echo "Missing required tools: ${missing[*]}" >&2
	exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"

if [ "$node_major" -lt 20 ]; then
	echo "Node 20 or later is required (found $(node --version))." >&2
	exit 1
fi

for tool in xdotool wmctrl; do
	command -v "$tool" >/dev/null 2>&1 || echo "Optional: install $tool to size and focus the console window." >&2
done

command -v ghostty >/dev/null 2>&1 || echo "Optional: the Resume and worktree buttons open tabs in Ghostty, which is not installed." >&2

(cd "$app" && npm ci --no-audit --no-fund)

install -d -m 0700 "$config_dir"

if [ ! -e "$config_dir/config.json" ]; then
	install -m 0644 "$app/config.example.json" "$config_dir/config.json"
	echo "Created $config_dir/config.json: set \"repo\" to the git repository to watch."
fi

if [ ! -e "$config_dir/env" ]; then
	install -m 0600 "$app/env.example" "$config_dir/env"
fi

chmod 600 "$config_dir/env"

node_bin="$(command -v node)"
path="$(dirname "$node_bin"):$(dirname "$(command -v gh)"):/usr/local/bin:/usr/bin:/bin"

install -d "$HOME/.config/systemd/user"
sed -e "s|@APP_DIR@|$app|" -e "s|@NODE@|$node_bin|g" -e "s|@PATH@|$path|" \
	"$here/claude-console.service.in" > "$HOME/.config/systemd/user/claude-console.service"

install -D -m 0755 "$here/claude-console" "$HOME/.local/bin/claude-console"
install -D -m 0644 "$here/claude-console.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/claude-console.svg"
install -d "$HOME/.local/share/applications"
sed "s|^Exec=claude-console$|Exec=$HOME/.local/bin/claude-console|" "$here/claude-console.desktop" \
	> "$HOME/.local/share/applications/claude-console.desktop"
sed "s|^Exec=claude-console %u$|Exec=$HOME/.local/bin/claude-console %u|" "$here/claude-console-url.desktop" \
	> "$HOME/.local/share/applications/claude-console-url.desktop"
xdg-mime default claude-console-url.desktop x-scheme-handler/claudeconsole 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

if $autostart; then
	if ! install -D -m 0644 "$HOME/.local/share/applications/claude-console.desktop" \
		"$HOME/.config/autostart/claude-console.desktop" 2>/dev/null; then
		echo "Skipped the autostart entry: $HOME/.config/autostart is not writable." >&2
	fi
fi

systemctl --user daemon-reload
systemctl --user enable claude-console.service
systemctl --user restart claude-console.service

echo "Installed. The console is served at http://127.0.0.1:5178; open its window with: claude-console"
