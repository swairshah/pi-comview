#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/rockorager/comview.git}"
TARGETS=(
  "darwin/arm64"
  "darwin/amd64"
  "linux/arm64"
  "linux/amd64"
)

pick_latest_tag() {
  git ls-remote --tags --refs "$UPSTREAM_REPO" \
    | awk -F/ '{print $3}' \
    | sort -V \
    | tail -n 1
}

TAG="${1:-${COMVIEW_TAG:-}}"
if [[ -z "$TAG" ]]; then
  TAG="$(pick_latest_tag || true)"
fi

if [[ -n "$TAG" ]]; then
  echo "[pi-comview] Updating bundled comview binaries from tag: $TAG"
else
  echo "[pi-comview] No upstream tags found. Falling back to default branch HEAD."
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ -n "$TAG" ]]; then
  git clone --depth 1 --branch "$TAG" "$UPSTREAM_REPO" "$TMP_DIR/comview"
else
  git clone --depth 1 "$UPSTREAM_REPO" "$TMP_DIR/comview"
fi
COMMIT_SHA="$(git -C "$TMP_DIR/comview" rev-parse HEAD)"
VERSION_LABEL="$TAG"
if [[ -z "$VERSION_LABEL" ]]; then
  VERSION_LABEL="main-$(git -C "$TMP_DIR/comview" rev-parse --short HEAD)"
fi

mkdir -p "$ROOT_DIR/bin"

for target in "${TARGETS[@]}"; do
  goos="${target%/*}"
  goarch="${target#*/}"
  out="$ROOT_DIR/bin/comview-$goos-$goarch"
  echo "[pi-comview] Building $goos/$goarch -> $out"
  (
    cd "$TMP_DIR/comview"
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -trimpath -ldflags='-s -w' -o "$out" ./cmd/comview
  )
  chmod +x "$out"
done

(
  cd "$ROOT_DIR/bin"
  shasum -a 256 comview-* > checksums.txt
)

cat > "$ROOT_DIR/bin/metadata.json" <<EOF
{
  "upstreamRepo": "${UPSTREAM_REPO}",
  "version": "${VERSION_LABEL}",
  "commit": "${COMMIT_SHA}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "targets": [
    "darwin-arm64",
    "darwin-amd64",
    "linux-arm64",
    "linux-amd64"
  ]
}
EOF

echo "${VERSION_LABEL}" > "$ROOT_DIR/COMVIEW_VERSION"

echo "[pi-comview] Done. Updated files:"
echo "  - COMVIEW_VERSION"
echo "  - bin/comview-*"
echo "  - bin/checksums.txt"
echo "  - bin/metadata.json"
