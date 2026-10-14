#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
if [[ -z ${MONGE_SHELL_PREFIX:-} ]]; then
    exec nix develop "path:$root" --command bash "$root/scripts/test-application.sh" "$@"
fi
if [[ ${1:-} != --no-build ]]; then
    bash scripts/dev-build.sh -j2
fi
mkdir -p build/test-results build/test-screenshots
cc -Wall -Wextra tests/keyboard/window-manager-fixture.c \
    $(pkg-config --cflags --libs x11) -o build/test-results/window-manager-fixture
glib-compile-schemas tests/extensions/fixtures/modern@monge.test/schemas
rm -f build/test-results/application.json
export MONGE_SETTINGS_TEST_BACKEND="file://$root/tests/extensions/application-backend.js"
export MONGE_SETTINGS_TEST_MODULE="file://$root/tests/extensions/application.js"
export MONGE_SETTINGS_RESULT="$root/build/test-results/application.json"
export MONGE_SCREENSHOT_DIR="$root/build/test-screenshots"
export XDG_CURRENT_DESKTOP=GNOME
bash scripts/isolated.sh bash -c 'build/test-results/window-manager-fixture && exec bash scripts/run.sh --no-build extensions'
node --input-type=module -e 'import {readFileSync} from "node:fs"; const result=JSON.parse(readFileSync(process.argv[1], "utf8")); if (!result.passed) throw new Error(result.error); console.log(`Verified ${result.checks.length} actual GNOME Settings assertions`);' "$MONGE_SETTINGS_RESULT"
