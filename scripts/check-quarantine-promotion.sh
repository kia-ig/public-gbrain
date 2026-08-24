#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'quarantine-promotion: %s\n' "$*" >&2
  exit 1
}

tracked=$(git ls-files)

# Runtime authority and operator state never belong in public quarantine.
if printf '%s\n' "$tracked" | grep -E '(^|/)(MEMORY\.md|memory/|\.openclaw/|mounts\.json|config\.json|[^/]*\.(db|sqlite|sqlite3|pglite|log))$' \
  | grep -Ev '^(templates/bootstrap/|test/fixtures/)' >/dev/null; then
  fail 'tracked runtime, memory, config, database, mount, or log state found'
fi

if printf '%s\n' "$tracked" | grep -E '(^|/)\.env($|\.)' | grep -Ev '\.example$' >/dev/null; then
  fail 'tracked environment file found (only synthetic *.example files are allowed)'
fi

# Public automation must be reproducible: external actions use immutable SHAs.
while IFS= read -r workflow; do
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    case "$ref" in
      ./*) continue ;;
    esac
    revision=${ref##*@}
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail "unpinned action in $workflow: ${ref%@*}@<non-sha>"
  done < <(sed -nE 's/^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*([^[:space:]#]+).*/\1/p' "$workflow")
done < <(printf '%s\n' "$tracked" | grep '^\.github/workflows/.*\.ya\?ml$' || true)

# The company name is never legitimate in this public quarantine. The two
# operator names are covered by the existing PII/agent-voice checks because
# they also occur as ordinary synthetic fixture names upstream.
company_pattern='Infinity[[:space:]]+Games'
if git grep -I -i -l -E "$company_pattern" -- . ':!scripts/check-quarantine-promotion.sh' >/dev/null 2>&1; then
  fail 'private company identity found in tracked public content'
fi

# Promotion candidates must be ordinary commits with a deterministic lock.
head=$(git rev-parse --verify HEAD)
[[ "$head" =~ ^[0-9a-f]{40}$ ]] || fail 'HEAD is not a full Git commit'
[ -f bun.lock ] || fail 'bun.lock is missing'

printf 'quarantine-promotion: commit=%s tree=%s lock_sha256=%s\n' \
  "$head" \
  "$(git rev-parse HEAD^{tree})" \
  "$(shasum -a 256 bun.lock | awk '{print $1}')"
