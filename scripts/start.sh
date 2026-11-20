#!/bin/bash
# Pterodactyl startup command for ICE18: `bash scripts/start.sh`
#
# Updates ICE18 before starting it (when AUTO_UPDATE is on), and restarts it when
# the panel asks to apply an update (exit code 75). Any other exit stops the server.

main() {
  cd "$(dirname "$0")/.." || exit 1
  local stopping=0 code
  trap 'stopping=1' INT TERM
  export ICE18_SUPERVISED=true

  while true; do
    case "${AUTO_UPDATE:-true}" in
      true | 1 | yes | on) bash scripts/update.sh || echo "[start] Starting the current version." ;;
    esac

    node apps/api/dist/main.js &
    local pid=$!
    # Pass stop signals from Pterodactyl on to the panel.
    trap 'stopping=1; kill -INT "$pid" 2>/dev/null' INT TERM
    wait "$pid"
    code=$?
    # `wait` returns early when a signal arrives; wait for the panel to finish shutting down.
    while kill -0 "$pid" 2>/dev/null; do
      wait "$pid"
      code=$?
    done
    trap 'stopping=1' INT TERM

    if [ "$stopping" = 1 ]; then
      exit 0
    fi
    if [ "$code" = 75 ]; then
      echo "[start] Restarting to apply an update…"
      continue
    fi
    exit "$code"
  done
}

# Everything runs inside main() so bash has read the whole file before an
# update can replace it.
main "$@"
exit $?
