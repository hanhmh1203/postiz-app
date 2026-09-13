#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_DIR="${SCRIPT_DIR:h:h}"
ENV_FILE="$REPO_DIR/.env.codex-local"
COMPOSE=(docker compose --env-file "$ENV_FILE" -p postiz-codex -f "$REPO_DIR/docker-compose.yaml" -f "$REPO_DIR/docker-compose.codex-local.yaml")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

case "${1:-status}" in
  start)
    "${COMPOSE[@]}" up -d --build
    ;;
  stop)
    "${COMPOSE[@]}" down
    ;;
  restart)
    "${COMPOSE[@]}" up -d --build --force-recreate
    ;;
  status)
    "${COMPOSE[@]}" ps
    ;;
  logs)
    "${COMPOSE[@]}" logs --tail=200 -f
    ;;
  bridge-status)
    curl --fail --silent --show-error http://127.0.0.1:${CODEX_BRIDGE_PORT:-4111}/health
    echo
    ;;
  test-ai)
    curl --fail --silent --show-error \
      --request POST \
      --header "Authorization: Bearer ${CODEX_BRIDGE_TOKEN}" \
      --header 'Content-Type: application/json' \
      --data '{"research":"Viết một bài ngắn bằng tiếng Việt giới thiệu lợi ích của việc lên lịch nội dung mạng xã hội.","format":"one_short","tone":"company","isPicture":false}' \
      http://127.0.0.1:${CODEX_BRIDGE_PORT:-4111}/v1/generate-social-posts
    echo
    ;;
  verify-postiz-ai)
    node "$REPO_DIR/scripts/local/verify-postiz-ai.mjs"
    ;;
  open)
    open "${MAIN_URL:-http://localhost:4007}"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|bridge-status|test-ai|verify-postiz-ai|open}" >&2
    exit 2
    ;;
esac
