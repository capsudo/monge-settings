#!/usr/bin/env bash
set -euo pipefail
scratch=$(mktemp -d "${TMPDIR:?}/monge-settings-test.XXXXXX")
pid=
cleanup() {
    if [[ -n $pid ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
    rm -rf -- "$scratch"
}
trap cleanup EXIT
node "$(dirname -- "${BASH_SOURCE[0]}")/prepare-test.mjs" "$scratch"
Xvfb -displayfd 3 -screen 0 1366x900x24 -nolisten tcp 3>"$scratch/display" >"$scratch/xvfb.log" 2>&1 &
pid=$!
for ((i=0; i<100; i++)); do
    [[ -s $scratch/display ]] && break
    kill -0 "$pid" || { printf 'Xvfb failed\n' >&2; exit 1; }
    sleep 0.05
done
[[ -s $scratch/display ]] || { printf 'Xvfb did not become ready\n' >&2; exit 1; }
read -r display < "$scratch/display"
export DISPLAY=":$display" GDK_BACKEND=x11 GSETTINGS_BACKEND=memory GIO_USE_VFS=local
export GTK_A11Y=none GSK_RENDERER=cairo LIBGL_ALWAYS_SOFTWARE=1 G_DEBUG=fatal-criticals
export XDG_RUNTIME_DIR="$scratch/runtime" XDG_CONFIG_HOME="$scratch/config" XDG_CACHE_HOME="$scratch/cache" XDG_STATE_HOME="$scratch/state"
export MONGE_TEST_SCRATCH="$scratch"
timeout 90 dbus-run-session --config-file="$scratch/session.conf" -- bash -c 'export DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"; exec "$@"' bash "$@"
