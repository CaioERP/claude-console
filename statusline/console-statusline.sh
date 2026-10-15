#!/usr/bin/env bash
# Claude Code status line for Claude Console.
#
# Claude Code hands the status line the session's state on stdin. This script
# saves that state to ~/.claude/fleet/<session>.json, where the console reads
# each session's folder, branch, model, context use, rate limits and cost, and
# then prints a status line:
#
#   - With CLAUDE_CONSOLE_NEXT_STATUSLINE set to a command, that command gets
#     the same stdin and prints the line, so you keep your own status line.
#   - Otherwise it prints the session name and an "Open in console" link.
#
# Requires jq and git.

input=$(cat)

field() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null; }

sid=$(field '.session_id')
dir=$(field '.workspace.current_dir')
name=$(field '.session_name')

{
	if [ -n "$sid" ] && [ -n "$dir" ]; then
		top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
		branch=$(git -C "$dir" branch --show-current 2>/dev/null)
		pct=$(field '.context_window.used_percentage')
		ctx=$(printf '%.0f' "${pct:-0}" 2>/dev/null || echo 0)
		h5=$(field '.rate_limits.five_hour.used_percentage')
		h5resetAt=$(field '.rate_limits.five_hour.resets_at')
		h5reset=""
		[ -n "$h5resetAt" ] && h5reset=$(date -d "@${h5resetAt%.*}" +%H:%M 2>/dev/null)
		h5=$([ -n "$h5" ] && printf '%.0f' "$h5" 2>/dev/null)

		mkdir -p "${HOME}/.claude/fleet"
		snap="${HOME}/.claude/fleet/${sid}.json"
		jq --null-input --compact-output \
			--arg top "${top:-$dir}" --arg dir "$dir" --arg name "$name" \
			--arg branch "$branch" --arg model "$(field '.model.display_name')" \
			--arg h5 "${h5:-}" --arg h5reset "$h5reset" --arg h5resetAt "${h5resetAt:-}" \
			--arg d7 "$(field '.rate_limits.seven_day.used_percentage')" \
			--arg d7resetAt "$(field '.rate_limits.seven_day.resets_at')" \
			--arg cost "$(field '.cost.total_cost_usd')" \
			--argjson ctx "${ctx:-0}" \
			'{top: $top, dir: $dir, name: $name, branch: $branch, model: $model, ctx: $ctx,
			  h5: $h5, h5reset: $h5reset, h5resetAt: $h5resetAt, d7: $d7, d7resetAt: $d7resetAt,
			  cost: $cost}' \
			> "${snap}.tmp" && mv -f "${snap}.tmp" "$snap"
	fi

	# Sessions that have not rendered for a day are gone from the console.
	find "${HOME}/.claude/fleet" -name '*.json' -mtime +1 -delete
} >/dev/null 2>&1 || :

if [ -n "${CLAUDE_CONSOLE_NEXT_STATUSLINE:-}" ]; then
	printf '%s' "$input" | bash -c "$CLAUDE_CONSOLE_NEXT_STATUSLINE"
	exit
fi

label="${name:-$(basename "${dir:-session}")}"

if [ -n "$sid" ]; then
	# An OSC 8 link: ctrl+click in terminals that support it.
	printf '%s · \033]8;;claudeconsole://session/%s\033\\Open in console\033]8;;\033\\' "$label" "$sid"
else
	printf '%s' "$label"
fi
