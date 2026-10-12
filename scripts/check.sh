#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
if [[ -z ${MONGE_SHELL_PREFIX:-} ]]; then
    exec env -u GI_TYPELIB_PATH -u LD_LIBRARY_PATH nix develop "path:$root" --command bash "$root/scripts/check.sh" "$@"
fi
node --test tests/extensions/*.test.mjs
node scripts/build-helper.mjs
glib-compile-schemas tests/extensions/fixtures/modern@monge.test/schemas
bash scripts/isolated.sh bash -c 'test "$DBUS_SYSTEM_BUS_ADDRESS" = "$DBUS_SESSION_BUS_ADDRESS"'
for test in backend installed-view native-host extension-page extension-details extension-reviews extension-view-state controller startup catalog browse-view; do
    bash scripts/isolated.sh gjs -m "tests/extensions/$test.js"
done
bash scripts/test-application.sh "$@"
