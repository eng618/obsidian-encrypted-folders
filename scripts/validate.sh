#!/usr/bin/env bash

# obsidian-encrypted-folders validation script
# Usage: ./scripts/validate.sh [--fix]

set -e

FIX_MODE=false
if [[ "$1" == "--fix" ]]; then
  FIX_MODE=true
fi

echo "🚀 Starting validation..."

# 1. Formatting
if [ "$FIX_MODE" = true ]; then
  echo "🎨 Formatting files..."
  bun run format
else
  echo "🎨 Checking formatting..."
  bun run format:ci
fi

# 2. Linting
if [ "$FIX_MODE" = true ]; then
  echo "🔍 Linting and fixing..."
  bun run lint:fix
else
  echo "🔍 Linting..."
  bun run lint
fi

# 3. Type Checking
echo "⌨️  Type checking..."
bun run tsc --noEmit --skipLibCheck

# 4. Build
echo "🏗️  Building..."
bun run build

# 5. Tests
echo "🧪 Running tests..."
bun run test

echo "✅ Validation complete! All checks passed."
