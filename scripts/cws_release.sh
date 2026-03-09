#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
MANIFEST_FILE="$ROOT_DIR/manifest.json"

if [[ -f "$ROOT_DIR/.cws.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.cws.env"
  set +a
fi

usage() {
  cat <<'EOF'
Usage:
  scripts/cws_release.sh package
  scripts/cws_release.sh upload
  scripts/cws_release.sh publish
  scripts/cws_release.sh release

Actions:
  package  Build dist/opendict-<version>.zip from tracked extension files.
  upload   Build the zip and upload it as the new draft package.
  publish  Publish the latest uploaded draft on Chrome Web Store.
  release  Build, upload, and publish in one command.

Environment variables:
  CWS_EXTENSION_ID
  CWS_PUBLISHER_ID
  CWS_CLIENT_ID
  CWS_CLIENT_SECRET
  CWS_REFRESH_TOKEN

Tip:
  Copy .cws.env.example to .cws.env, fill in the values, then run:
    scripts/cws_release.sh release
EOF
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

manifest_value() {
  local key="$1"
  sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/p" "$MANIFEST_FILE" | head -n 1
}

build_package() {
  require_command git
  require_command zip

  local version
  version="$(manifest_value version)"
  if [[ -z "$version" ]]; then
    echo "Could not read version from manifest.json" >&2
    exit 1
  fi

  mkdir -p "$DIST_DIR"
  local package_path="$DIST_DIR/opendict-${version}.zip"
  rm -f "$package_path"

  local files=()
  while IFS= read -r -d '' path; do
    case "$path" in
      .gitignore|README.md|PRIVACY.md|STORE_LISTING.md|LICENSE|.cws.env.example|scripts/*)
        continue
        ;;
    esac
    files+=("$path")
  done < <(cd "$ROOT_DIR" && git ls-files -z)

  if [[ ${#files[@]} -eq 0 ]]; then
    echo "No tracked extension files found to package" >&2
    exit 1
  fi

  (
    cd "$ROOT_DIR"
    zip -q "$package_path" "${files[@]}"
  )

  printf '%s\n' "$package_path"
}

get_access_token() {
  require_command curl
  require_env CWS_CLIENT_ID
  require_env CWS_CLIENT_SECRET
  require_env CWS_REFRESH_TOKEN

  local response
  response="$(
    curl -fsS "https://oauth2.googleapis.com/token" \
      -d "client_id=${CWS_CLIENT_ID}" \
      -d "client_secret=${CWS_CLIENT_SECRET}" \
      -d "refresh_token=${CWS_REFRESH_TOKEN}" \
      -d "grant_type=refresh_token"
  )"

  local token
  token="$(printf '%s' "$response" | sed -nE 's/.*"access_token"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  if [[ -z "$token" ]]; then
    echo "Failed to extract access token from OAuth response" >&2
    printf '%s\n' "$response" >&2
    exit 1
  fi

  printf '%s\n' "$token"
}

upload_package() {
  local token="$1"
  local package_path="$2"

  require_env CWS_EXTENSION_ID
  require_env CWS_PUBLISHER_ID

  curl -fsS \
    -X POST \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/zip" \
    --data-binary @"$package_path" \
    "https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:upload"
}

publish_item() {
  local token="$1"

  require_env CWS_EXTENSION_ID
  require_env CWS_PUBLISHER_ID

  curl -fsS \
    -X POST \
    -H "Authorization: Bearer ${token}" \
    "https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:publish"
}

main() {
  local action="${1:-release}"
  local package_path=""
  local token=""

  case "$action" in
    package)
      package_path="$(build_package)"
      echo "Built package: $package_path"
      ;;
    upload)
      package_path="$(build_package)"
      token="$(get_access_token)"
      echo "Uploading package: $package_path"
      upload_package "$token" "$package_path"
      echo
      echo "Upload complete."
      ;;
    publish)
      token="$(get_access_token)"
      echo "Publishing latest draft..."
      publish_item "$token"
      echo
      echo "Publish request submitted."
      ;;
    release)
      package_path="$(build_package)"
      token="$(get_access_token)"
      echo "Uploading package: $package_path"
      upload_package "$token" "$package_path"
      echo
      echo "Publishing latest draft..."
      publish_item "$token"
      echo
      echo "Release flow submitted."
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown action: $action" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
