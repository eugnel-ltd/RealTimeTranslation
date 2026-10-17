#!/bin/sh
# PreToolUse hook for Bash: the expenditure gate. Asks the owner before a command that matches a
# spend pattern. Patterns live in .claude/hooks/spend-patterns.txt, one extended regex per line;
# the defaults below apply when that file is absent. Needs jq.
#
# This hook is a reminder, not the control. Matching a command string is easy to sidestep; the
# control is that agents hold no payment credentials and that every new paid service, API key for
# a paid service, spend-cap rise or ad spend needs an "Expenditure:" owner decision first.
cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0
dir=${CLAUDE_PROJECT_DIR:-.}
patterns=$dir/.claude/hooks/spend-patterns.txt
if [ -f "$patterns" ]; then
  hit=$(printf '%s' "$cmd" | grep -Ef "$patterns" | head -1)
else
  hit=$(printf '%s' "$cmd" | grep -E -e 'stripe (products|prices|subscriptions|payment_links|charges) create' \
    -e 'wrangler (r2 bucket create|d1 create|queues create)' -e 'domains? (register|buy|purchase)' \
    -e '(gcloud|aws|az) .*(create|provision|purchase|reserve)' -e 'billing' -e 'spend[_-]?(cap|limit)' \
    -e 'fastlane produce' -e 'ads? (campaign|budget)' | head -1)
fi
[ -n "$hit" ] || exit 0
mkdir -p "$dir/.claude"
printf '%s\task\t%s\n' "$(date -u +%FT%TZ)" "$cmd" >> "$dir/.claude/gate.log"
jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask",
  permissionDecisionReason: "Expenditure gate (AI-SDLC): this command may create a cost. The owner approves spend; record the decision as an Expenditure entry first."}}'
exit 0
