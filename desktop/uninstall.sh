#!/usr/bin/env bash
# Removes everything install.sh put in place. Your configuration in
# ~/.config/claude-console and the window's browser profile under
# ~/.local/share/claude-console are kept; delete them by hand to reset.

set -euo pipefail

systemctl --user disable --now claude-console.service 2>/dev/null || true
rm -f \
	"$HOME/.config/systemd/user/claude-console.service" \
	"$HOME/.local/bin/claude-console" \
	"$HOME/.local/share/icons/hicolor/scalable/apps/claude-console.svg" \
	"$HOME/.local/share/applications/claude-console.desktop" \
	"$HOME/.local/share/applications/claude-console-url.desktop" \
	"$HOME/.config/autostart/claude-console.desktop"
systemctl --user daemon-reload

echo "Uninstalled."
