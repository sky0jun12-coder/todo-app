#!/bin/bash
# kind 클러스터 todo-app의 DB를 클러스터 밖(VM 호스트)에 백업한다.
# make reset으로 클러스터를 지워도 백업은 남는다. 단, VM을 잃으면 함께 사라진다.
set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/todo-app}"
KEEP_DAYS="${KEEP_DAYS:-14}"
NODE="${KIND_NODE:-lab-control-plane}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

target="$BACKUP_DIR/db-$(date +%Y%m%d-%H%M%S).sql.gz"
tmp="$target.tmp"
trap 'rm -f "$tmp"' EXIT

# 소유자와 권한을 빼서 계정 이름이 다른 새 DB에도 복원할 수 있게 한다.
docker exec "$NODE" kubectl --kubeconfig /etc/kubernetes/admin.conf -n todo-app \
  exec db-0 -c postgres -- \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  | gzip > "$tmp"

# 끝까지 정상적으로 받은 백업만 남긴다.
gzip -t "$tmp"
if ! gzip -dc "$tmp" | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  echo "백업이 완전하지 않습니다: $target" >&2
  exit 1
fi
mv "$tmp" "$target"

# 새 백업이 성공한 뒤에만 오래된 백업을 지운다.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "백업 완료: $target ($(du -h "$target" | cut -f1))"
