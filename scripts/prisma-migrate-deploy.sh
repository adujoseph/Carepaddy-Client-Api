#!/usr/bin/env bash
# Apply pending Prisma migrations on servers that already have schema from an earlier
# db push / manual setup (empty or incomplete _prisma_migrations).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

# Last migration known to match staging before admin/store migrations (Oct 2026).
BASELINE_UNTIL="${PRISMA_BASELINE_UNTIL:-20260805091252_faq_and_account_disable}"

log() { echo "==> $*"; }

run_migrate_deploy() {
  npx prisma migrate deploy
}

baseline_pre_admin_migrations() {
  log "Baselining migration history through ${BASELINE_UNTIL}"
  shopt -s nullglob
  for dir in "${ROOT}"/prisma/migrations/*/; do
    name="$(basename "${dir}")"
    log "Mark applied: ${name}"
    local out
    if ! out="$(npx prisma migrate resolve --applied "${name}" 2>&1)"; then
      if grep -q 'P3008' <<<"${out}"; then
        log "Already recorded as applied: ${name}"
      else
        echo "${out}" >&2
        return 1
      fi
    fi
    if [[ "${name}" == "${BASELINE_UNTIL}" ]]; then
      break
    fi
  done
}

err_file="$(mktemp)"
trap 'rm -f "${err_file}"' EXIT

set +e
run_migrate_deploy 2>"${err_file}"
code=$?
set -e

if [[ "${code}" -eq 0 ]]; then
  log "Migrations up to date"
  exit 0
fi

cat "${err_file}" >&2

if grep -q 'relation "HealthCheck" already exists' "${err_file}" \
  || grep -q 'P3018' "${err_file}" \
  || grep -q 'P3009' "${err_file}"; then
  log "Existing database detected without init migration recorded — baselining"
  baseline_pre_admin_migrations
  run_migrate_deploy
  log "Migrations applied after baseline"
  exit 0
fi

log "migrate deploy failed (not a baseline case); see errors above"
exit 1
