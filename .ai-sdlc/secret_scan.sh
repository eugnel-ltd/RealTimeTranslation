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
# The optional root .secret-scan-allow list is read from the head commit only. Each entry has
# four tab-separated fields: the file's sha256 (64 lower-case hex characters), path, rule and
# non-empty upstream source. Blank lines and lines starting with # are ignored. An exemption
# needs the exact head blob hash, path and rule; every use prints file, line, rule and source,
# never the matched text. Malformed entries fail the scan.
#
#   exit 0  nothing matched, or every match was allowed
#   exit 1  an unallowed match or a malformed list: read the named line in the file
#   exit 2  the inputs are wrong, git failed or hashing is unavailable
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

if command -v sha256sum >/dev/null 2>&1; then
  hash_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  hash_tool=shasum
else
  echo "SECRET-SCAN RECORD ERROR: neither sha256sum nor shasum is available" >&2
  exit 2
fi
scan_tmp=$(mktemp -d) || { echo "SECRET-SCAN RECORD ERROR: cannot create temporary directory" >&2; exit 2; }
trap 'rm -rf "$scan_tmp"' 0
trap 'exit 2' HUP INT TERM

# A missing list means no exemptions. Do not consult the base or the working tree.
: > "$scan_tmp/allow"
if git cat-file -e "$head:.secret-scan-allow" 2>/dev/null; then
  git show "$head:.secret-scan-allow" > "$scan_tmp/allow" ||
    { echo "SECRET-SCAN RECORD ERROR: cannot read head .secret-scan-allow" >&2; exit 2; }
fi
rule_names=$(printf '%s\n' "$rules" | cut -f1)
# Rule names reach awk through the environment: BSD awk (macOS) refuses a -v value with a newline.
SCAN_RULES="$rule_names" awk -F '\t' '
    BEGIN { n = split(ENVIRON["SCAN_RULES"], rules, "\n"); for (i = 1; i <= n; i++) known[rules[i]] = 1 }
    /^#/ || /^$/ { next }
    NF != 4 || length($1) != 64 || $1 ~ /[^0123456789abcdef]/ ||
        $2 == "" || !($3 in known) || $4 == "" {
        printf "SECRET-SCAN FAIL: .secret-scan-allow:%d malformed\n", NR
        malformed = 1
    }
    END { exit malformed }
' "$scan_tmp/allow" || exit 1

hits=""
texts=$(printf '%s\n' "$added" | cut -f3-)
while IFS='	' read -r name regex; do
  [ -n "$name" ] || continue
  # grep -n numbers the added lines; the number maps back to the path and line of that entry.
  for i in $(printf '%s\n' "$texts" | grep -nE -e "$regex" | cut -d: -f1); do
    entry=$(printf '%s\n' "$added" | sed -n "${i}p")
    path=$(printf '%s\n' "$entry" | cut -f1)
    line=$(printf '%s\n' "$entry" | cut -f2)
    source=""
    if [ -s "$scan_tmp/allow" ] && git cat-file -e "$head:$path" 2>/dev/null; then
      # Check git show itself before hashing: a failed read must never hash an empty blob.
      git show "$head:$path" > "$scan_tmp/blob" ||
        { echo "SECRET-SCAN RECORD ERROR: cannot read head blob" >&2; exit 2; }
      if [ "$hash_tool" = sha256sum ]; then
        hash=$(sha256sum "$scan_tmp/blob") ||
          { echo "SECRET-SCAN RECORD ERROR: sha256sum failed" >&2; exit 2; }
      else
        hash=$(shasum -a 256 "$scan_tmp/blob") ||
          { echo "SECRET-SCAN RECORD ERROR: shasum failed" >&2; exit 2; }
      fi
      hash=${hash%% *}
      source=$(SCAN_HASH="$hash" SCAN_PATH="$path" SCAN_RULE="$name" awk -F '\t' '
          /^#/ || /^$/ { next }
          $1 == ENVIRON["SCAN_HASH"] && $2 == ENVIRON["SCAN_PATH"] && $3 == ENVIRON["SCAN_RULE"] {
              print $4; exit
          }
      ' "$scan_tmp/allow")
    fi
    if [ -n "$source" ]; then
      printf 'SECRET-SCAN ALLOWED: %s:%s %s (%s)\n' "$path" "$line" "$name" "$source"
    else
      hits="$hits$path:$line $name
"
    fi
  done
done <<EOF
$rules
EOF

if [ -n "$hits" ]; then
  echo "SECRET-SCAN FAIL: credential-shaped text added in this PR. Read secrets from the environment or the secret store."
  printf '%s' "$hits" | sed 's/^/  /'
  exit 1
fi
echo "SECRET-SCAN OK: sample patterns found no blocked matches (add gitleaks for a full scan)"
exit 0
