#!/bin/sh
# Secret scan: no credential-shaped text among the lines a PR adds.
#
#   secret_scan.sh <base-ref> [head-ref]
#
# Scans the lines added between the merge base of <base-ref> and <head-ref> (default HEAD) with a
# few sample patterns (private keys, AWS, GitHub, OpenAI-style and Slack tokens, and quoted
# assignments to key, secret, token or password). It reports the file, the line number and the
# rule, never the matched text, so the check log cannot leak what it found. Add gitleaks or the
# platform's secret scanning for depth.
#
#   exit 0  nothing matched
#   exit 1  a match: read the named line in the file
#   exit 2  the inputs are wrong or git failed
set -u
base=${1:-}; head=${2:-HEAD}
[ -n "$base" ] || { echo "usage: secret_scan.sh <base-ref> [head-ref]" >&2; exit 2; }
git rev-parse --verify --quiet "$base^{commit}" >/dev/null || { echo "SECRET-SCAN RECORD ERROR: unknown base '$base'" >&2; exit 2; }
git rev-parse --verify --quiet "$head^{commit}" >/dev/null || { echo "SECRET-SCAN RECORD ERROR: unknown head '$head'" >&2; exit 2; }

# The diff is captured first and its exit code checked, so a failing git diff (no shared history,
# a bad ref) is an error, never an empty scan.
diff=$(git diff -U0 --no-color "$base...$head" -- . ':(exclude)*.lock' ':(exclude)package-lock.json' && printf x) ||
  { echo "SECRET-SCAN RECORD ERROR: git diff $base...$head failed" >&2; exit 2; }
diff=${diff%x}

# Added lines as "<path>\t<line number>\t<text>", from the hunk headers of a zero-context diff.
# A file header ("+++ b/path") is recognised only between "diff --git" and the first "@@"; inside
# a hunk an added line that happens to start with "++" is content, not a header.
added=$(printf '%s' "$diff" | awk '
    /^diff --git / { hunk = 0; next }
    !hunk && /^\+\+\+ / { path = substr($0, 5); sub(/^b\//, "", path); next }
    /^@@/ { n = $3; sub(/^\+/, "", n); sub(/,.*/, "", n); line = n + 0; hunk = 1; next }
    hunk && /^\+/ { printf "%s\t%d\t%s\n", path, line, substr($0, 2); line++; next }
    hunk && /^-/ { next }')

q="[\"']"
rules="private-key	-----BEGIN [A-Z ]*PRIVATE KEY-----
aws-access-key	AKIA[0-9A-Z]{16}
github-token	gh[pousr]_[A-Za-z0-9]{36}
openai-style-key	sk-[A-Za-z0-9_-]{20,}
slack-token	xox[abprs]-[A-Za-z0-9-]{10,}
quoted-secret-assignment	(api[_-]?key|secret|token|password)${q}?[[:space:]]*[:=][[:space:]]*${q}[^\"'[:space:]]{12,}"

hits=""
texts=$(printf '%s\n' "$added" | cut -f3-)
while IFS='	' read -r name regex; do
  [ -n "$name" ] || continue
  # grep -n numbers the added lines; the number maps back to the path and line of that entry.
  for i in $(printf '%s\n' "$texts" | grep -nE -e "$regex" | cut -d: -f1); do
    where=$(printf '%s\n' "$added" | sed -n "${i}p" | cut -f1,2 | tr '\t' ':')
    hits="$hits$where $name
"
  done
done <<EOF
$rules
EOF

if [ -n "$hits" ]; then
  echo "SECRET-SCAN FAIL: credential-shaped text added in this PR. Read secrets from the environment or the secret store."
  printf '%s' "$hits" | sed 's/^/  /'
  exit 1
fi
echo "SECRET-SCAN OK: sample patterns found nothing (add gitleaks for a full scan)"
exit 0
