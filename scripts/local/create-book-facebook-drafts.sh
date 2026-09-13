#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
PROJECTS_DIR="$(cd "$REPO_DIR/.." && pwd -P)"

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/local/create-book-facebook-drafts.sh /absolute/batch/path [--dry-run] [--limit N]" >&2
  exit 64
fi

BATCH_ROOT="$1"
if [[ "$BATCH_ROOT" != /* ]]; then
  echo "The batch path must be absolute: $BATCH_ROOT" >&2
  exit 64
fi

cd "$REPO_DIR"
if [[ -f .env.codex-local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.codex-local
  set +a
fi

export POSTIZ_URL="${POSTIZ_URL:-http://localhost:4007}"
export POSTIZ_CREDENTIAL_FILE="${POSTIZ_CREDENTIAL_FILE:-$REPO_DIR/.postiz-local-credentials}"
export POSTIZ_FACEBOOK_PAGE_NAME="${POSTIZ_FACEBOOK_PAGE_NAME:-Vì cuộc sống là ko chờ đợi}"
export BOOK_LIBRARY_DATABASE="${BOOK_LIBRARY_DATABASE:-$PROJECTS_DIR/book_library/.book-library-data/library.sqlite3}"
export BOOK_FACEBOOK_DRAFT_OUTPUT="${BOOK_FACEBOOK_DRAFT_OUTPUT:-$PROJECTS_DIR/book_reader/outputs/facebook-postiz-drafts}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required." >&2
  exit 69
fi

exec env NODE_NO_WARNINGS=1 node scripts/local/create-book-facebook-drafts.mjs "$@"
