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
  yarn format
else
  echo "🎨 Checking formatting..."
  yarn format:ci
fi

# 2. Linting
if [ "$FIX_MODE" = true ]; then
  echo "🔍 Linting and fixing..."
  yarn lint:fix
else
  echo "🔍 Linting..."
  yarn lint
fi

# 3. Type Checking
echo "⌨️  Type checking..."
yarn tsc --noEmit --skipLibCheck

# 4. Build
echo "🏗️  Building..."
yarn build

# 5. Tests
echo "🧪 Running tests..."
yarn test

echo "✅ Validation complete! All checks passed."
