#!/bin/bash
# Updates ICE18 in place from its git remote, then reinstalls and rebuilds.
# If anything fails, it rolls back to the version that was running before.
# Only touches the ICE18 checkout it lives in. .env and other ignored files are kept.
#
# Usage: bash scripts/update.sh
# Env:   GIT_BRANCH (default main), GIT_REPO (optional: switch the remote URL)
#
# A version that fails to install is written to .ice18-update-failed and skipped until
# a newer one is pushed (or an admin retries it from the panel, which removes the file).

main() {
  set -uo pipefail
  cd "$(dirname "$0")/.." || exit 1
  local root branch old new
  root="$(pwd)"
  FAILED_MARKER="$root/.ice18-update-failed"
  branch="${GIT_BRANCH:-main}"
  export GIT_TERMINAL_PROMPT=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0

  if [[ ! "$branch" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    echo "[update] Invalid GIT_BRANCH '$branch', skipping update."
    return 0
  fi
  if [ ! -d .git ] || ! command -v git > /dev/null; then
    echo "[update] Not a git checkout (or git missing), skipping update."
    return 0
  fi

  g() { git -c safe.directory="$root" "$@"; }

  if [ -n "${GIT_REPO:-}" ] && [ "$(g remote get-url origin 2>/dev/null)" != "$GIT_REPO" ]; then
    g remote set-url origin "$GIT_REPO"
  fi

  echo "[update] Checking for updates on ${branch}…"
  if ! timeout 120 git -c safe.directory="$root" fetch --quiet --depth 1 origin "$branch"; then
    echo "[update] Could not reach the git remote, starting the current version."
    return 0
  fi

  old="$(g rev-parse HEAD)"
  new="$(g rev-parse FETCH_HEAD)"
  if [ "$old" = "$new" ]; then
    echo "[update] Already up to date (${old:0:7})."
    return 0
  fi
  if [ -f "$FAILED_MARKER" ] && [ "$(cat "$FAILED_MARKER")" = "$new" ]; then
    echo "[update] ${new:0:7} failed to install before, staying on ${old:0:7} until a newer version is pushed."
    return 0
  fi
  if [ -n "$(g status --porcelain --untracked-files=no)" ]; then
    echo "[update] Files in the ICE18 folder were edited by hand, not overwriting them. Skipping update."
    return 0
  fi

  echo "[update] Updating ${old:0:7} -> ${new:0:7}"
  g reset --quiet --hard "$new"
  if install_and_build; then
    rm -f "$FAILED_MARKER"
    echo "[update] Updated to ${new:0:7}."
    return 0
  fi

  echo "[update] Update failed. Rolling back to ${old:0:7}…"
  # Remember the broken version so it isn't retried on every check.
  echo "$new" > "$FAILED_MARKER"
  g reset --quiet --hard "$old"
  if install_and_build; then
    echo "[update] Rolled back to ${old:0:7}."
  else
    echo "[update] Rollback build failed too. Reinstall the server from Pterodactyl to repair it."
  fi
  return 1
}

pnpm_cmd() {
  if command -v pnpm > /dev/null; then
    pnpm "$@"
  elif command -v corepack > /dev/null; then
    corepack pnpm "$@"
  else
    npx --yes pnpm@10 "$@"
  fi
}

install_and_build() {
  pnpm_cmd install --frozen-lockfile --config.package-import-method=copy && pnpm_cmd build
}

# Everything runs inside main() so bash has read the whole file before a git
# reset can replace it.
main "$@"
exit $?
