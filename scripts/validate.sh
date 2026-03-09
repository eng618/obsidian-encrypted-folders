#!/usr/bin/env bash

# obsidian-encrypted-folders validation script
# Usage: ./scripts/validate.sh [--fix]

set -uo pipefail

FIX_MODE=false
if [[ "${1:-}" == "--fix" ]]; then
  FIX_MODE=true
fi

declare -a CHECK_NAMES=()
declare -a CHECK_STATUS=()
FAILED_COUNT=0

run_check() {
  local name="$1"
  local banner="$2"
  shift 2

  echo "$banner"
  if "$@"; then
    CHECK_NAMES+=("$name")
    CHECK_STATUS+=("passed")
  else
    CHECK_NAMES+=("$name")
    CHECK_STATUS+=("failed")
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

echo "🚀 Starting validation..."

# 1. Formatting
if [ "$FIX_MODE" = true ]; then
  run_check "Formatting" "🎨 Formatting files..." bun run format
else
  run_check "Formatting" "🎨 Checking formatting..." bun run format:ci
fi

# 2. Linting
if [ "$FIX_MODE" = true ]; then
  run_check "Lint" "🔍 Linting and fixing..." bun run lint:fix
else
  run_check "Lint" "🔍 Linting..." bun run lint
fi

# 3. Type Checking
run_check "Typecheck" "⌨️  Type checking..." bun run tsc --noEmit --skipLibCheck

# 4. Build
run_check "Build" "🏗️  Building..." bun run build

# 5. Tests
run_check "Tests" "🧪 Running tests..." bun run test

echo
echo "📋 Validation summary"
for i in "${!CHECK_NAMES[@]}"; do
  printf -- "- %-10s %s\n" "${CHECK_NAMES[$i]}:" "${CHECK_STATUS[$i]}"
done

if [ "$FAILED_COUNT" -eq 0 ]; then
  echo "✅ Validation complete! All checks passed."
  exit 0
fi

echo "❌ Validation complete with ${FAILED_COUNT} failed check(s)."
exit 1
