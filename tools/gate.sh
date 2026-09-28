#!/usr/bin/env bash
# Commit gate: type-check, then the full test suite on a FRESH log. Exits non-zero on any failure, so
# `bash tools/gate.sh && git commit ...` can never commit on a stale log or a failed type-check.
set -uo pipefail
cd "$(dirname "$0")/.."
log="$(mktemp)"
if ! node node_modules/typescript/bin/tsc --noEmit; then echo "GATE FAIL: tsc"; exit 1; fi
node --experimental-strip-types --test tests/*.test.ts > "$log" 2>&1
code=$?
grep -E "^ℹ (tests|pass|fail)" "$log"
if [ $code -ne 0 ] || ! grep -q "^ℹ fail 0" "$log"; then grep -A8 "✖" "$log" | head -30; echo "GATE FAIL: tests"; rm -f "$log"; exit 1; fi
rm -f "$log"
echo "GATE OK"
