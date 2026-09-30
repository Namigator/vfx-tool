#!/usr/bin/env bash
# Commits the staged changes only if tools/gate.sh passes (its exit code is checked directly — never through a pipe,
# which once let a tsc failure through). Usage: git add ...; bash tools/gate-commit.sh "message"
set -uo pipefail
cd "$(dirname "$0")/.."
log="$(mktemp)"
bash tools/gate.sh > "$log" 2>&1; code=$?
tail -3 "$log"; rm -f "$log"
if [ $code -ne 0 ]; then echo "NOT COMMITTED (gate failed)"; exit 1; fi
git commit -q -m "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git log --oneline -1
