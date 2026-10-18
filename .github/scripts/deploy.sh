#!/usr/bin/env bash
# Выкладка на VPS. Запускает cd.yml по SSH, уже после git checkout нужного коммита.
#
#   deploy.sh <образ api с digest> <коммит, который был до checkout>
#
# 1. Текущий образ api помечается как aboutme-api:previous — это точка отката.
# 2. docker-compose.override.yml закрепляет api на новом digest. Compose читает
#    этот файл сам, поэтому и ручной `docker compose up -d` возьмёт тот же образ.
# 3. pull, up без сборки, ожидание healthy, nginx -t, reload, проверка через nginx.
# 4. Если любой шаг упал — возврат прежнего коммита и прежнего образа, exit 1.
#
# Скрипт копируется во временный файл перед запуском: откат делает git checkout,
# и этот файл в рабочей копии может поменяться прямо во время работы.

set -euo pipefail

readonly IMAGE_RE='^ghcr\.io/[a-z0-9-]+/aboutme-api@sha256:[0-9a-f]{64}$'
readonly SHA_RE='^[0-9a-f]{40}$'
readonly SITE=koppa0.dev
readonly APP_DIR="${APP_DIR:-$HOME/app/aboutme}"
readonly ROLLBACK_TAG=aboutme-api:previous

new_image="${1:-}"
prev_sha="${2:-}"

if ! [[ "$new_image" =~ $IMAGE_RE ]]; then
  echo "bad image: $new_image" >&2
  exit 2
fi
if ! [[ "$prev_sha" =~ $SHA_RE ]]; then
  echo "bad previous commit: $prev_sha" >&2
  exit 2
fi

cd "$APP_DIR"

log() {
  printf '==> %s\n' "$*"
}

pin_api() {
  # Только этот файл задаёт образ api на сервере. В git его нет (.gitignore).
  cat > docker-compose.override.yml <<EOF
# Пишет .github/scripts/deploy.sh при каждой выкладке. Руками не менять.
services:
  api:
    image: $1
EOF
}

wait_api() {
  local cid status
  for _ in $(seq 1 40); do
    cid="$(docker compose ps -q api || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
      if [ "$status" = healthy ]; then
        log "api healthy"
        return 0
      fi
    fi
    sleep 3
  done
  docker compose ps
  docker compose logs --tail 80 api
  return 1
}

# Проверка через сам nginx на этой машине, в обход DNS: --resolve ведёт
# koppa0.dev на 127.0.0.1, сертификат при этом проверяется как обычно.
# Ответ сначала сохраняется: `curl | grep -q` под pipefail даёт ложный провал.
smoke() {
  local body
  for _ in $(seq 1 10); do
    body="$(curl -fsS --max-time 10 --resolve "$SITE:443:127.0.0.1" "https://$SITE/api/health" || true)"
    if [[ "$body" == *'"status":"ok"'* ]] &&
      curl -fsS --max-time 10 --resolve "$SITE:443:127.0.0.1" -o /dev/null "https://$SITE/"; then
      log "smoke ok"
      return 0
    fi
    sleep 3
  done
  echo "smoke failed" >&2
  return 1
}

# Вызывается из `if`, а там bash не применяет set -e к телу функции,
# поэтому каждый шаг проверяется явно.
roll_out() {
  local image="$1"
  pin_api "$image" || return 1
  # Точку отката не скачивают: она есть только локально.
  if [[ "$image" == *@sha256:* ]]; then
    log "pull $image"
    docker compose pull api || return 1
  fi
  # Без сборки: на сервере образы только скачиваются. Пересоздаются те
  # сервисы, у которых поменялся образ или настройки в compose.
  docker compose up -d --no-build || return 1
  wait_api || return 1
  docker compose exec -T nginx nginx -t || return 1
  docker compose exec -T nginx nginx -s reload || return 1
  smoke || return 1
}

# Точка отката: образ, на котором api работает прямо сейчас.
current_cid="$(docker compose ps -q api || true)"
if [ -n "$current_cid" ]; then
  docker tag "$(docker inspect -f '{{.Image}}' "$current_cid")" "$ROLLBACK_TAG"
  log "rollback point: $ROLLBACK_TAG ($prev_sha)"
else
  log "api is not running, no rollback point"
fi

if roll_out "$new_image"; then
  # Старые образы api больше не нужны: остаётся текущий и точка отката.
  docker images --format '{{.Repository}}@{{.Digest}} {{.ID}}' "${new_image%@*}" \
    | while read -r ref id; do
        [ "$ref" = "$new_image" ] && continue
        docker rmi "$id" >/dev/null 2>&1 || true
      done
  docker image prune -f >/dev/null
  log "deployed $new_image"
  docker compose ps
  exit 0
fi

echo "deploy failed, rolling back to $prev_sha" >&2
git checkout -f -B main "$prev_sha"
if docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1; then
  if ! roll_out "$ROLLBACK_TAG"; then
    echo "ROLLBACK FAILED, check the server by hand" >&2
  fi
else
  echo "no rollback image, check the server by hand" >&2
fi
exit 1
