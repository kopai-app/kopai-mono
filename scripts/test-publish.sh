#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR=$(mktemp -d)
TARBALL_DIR="$ROOT_DIR/.tarballs"

cleanup() { rm -rf "$TEST_DIR"; }
trap cleanup EXIT

# Build all
cd "$ROOT_DIR"
pnpm build

# Pack all public packages, collect their names
rm -rf "$TARBALL_DIR" && mkdir -p "$TARBALL_DIR"
PUBLIC_PACKAGES=()
for pkg in packages/*; do
  if [ -f "$pkg/package.json" ]; then
    IS_PRIVATE=$(node -p "require('./$pkg/package.json').private || false")
    if [ "$IS_PRIVATE" = "false" ]; then
      PKG_NAME=$(node -p "require('./$pkg/package.json').name")
      PUBLIC_PACKAGES+=("$PKG_NAME")
      (cd "$pkg" && pnpm pack --pack-destination "$TARBALL_DIR")
    fi
  fi
done

echo "Public packages: ${PUBLIC_PACKAGES[*]}"

# Create test project
cd "$TEST_DIR"
cat > package.json << 'EOF'
{
  "name": "kopai-publish-test",
  "type": "module",
  "dependencies": {}
}
EOF

# Install all tarballs at once
npm install "$TARBALL_DIR"/*.tgz

# Packages to skip import tests (apps/CLIs with side effects)
SKIP_IMPORT=("@kopai/app" "@kopai/cli")

is_skipped() {
  local pkg="$1"
  for skip in "${SKIP_IMPORT[@]}"; do
    [[ "$pkg" == "$skip" ]] && return 0
  done
  return 1
}

# Test ESM imports for library packages
for pkg in "${PUBLIC_PACKAGES[@]}"; do
  if is_skipped "$pkg"; then
    echo "[ESM] $pkg: skipped (app/cli)"
  else
    node -e "import('$pkg').then(m => console.log('[ESM] $pkg:', Object.keys(m)))"
  fi
done

# Test CJS imports (only for packages with CJS exports)
for pkg in "${PUBLIC_PACKAGES[@]}"; do
  if is_skipped "$pkg"; then
    echo "[CJS] $pkg: skipped (app/cli)"
  else
    HAS_CJS=$(node -e "
      const p = require('$pkg/package.json');
      const has = p.main?.includes('.cjs') || p.exports?.['.']?.require;
      console.log(has ? 'true' : 'false');
    " 2>/dev/null || echo "false")
    if [ "$HAS_CJS" = "true" ]; then
      node -e "console.log('[CJS] $pkg:', Object.keys(require('$pkg')))"
    fi
  fi
done

# Test CLI binary if @kopai/cli is installed
if npm ls @kopai/cli >/dev/null 2>&1; then
  npx @kopai/cli --help
fi

echo "All tests passed!"
