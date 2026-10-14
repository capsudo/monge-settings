#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
if [[ -z ${MONGE_SHELL_PREFIX:-} ]]; then
    exec nix develop "path:$root" --command bash "$root/scripts/test-keyboard.sh" "$@"
fi
if [[ ${1:-} != --no-build ]]; then
    bash scripts/dev-build.sh -j2
else
    shift
fi
build_dir=${MONGE_DEV_BUILD_DIR:-"$root/build/dev"}
mkdir -p build/test-results build/test-screenshots
export MONGE_SCREENSHOT_DIR="$root/build/test-screenshots"
cc -g -Wall -Wextra -Wno-unused-parameter -Wno-sign-compare -Wno-deprecated-declarations \
    -include "$build_dir/config.h" -I"$build_dir" -I"$root" \
    -Ipanels/common -Ipanels/keyboard -I"$build_dir/panels/keyboard" \
    tests/keyboard/test-keyboard-shortcut-editor.c \
    panels/keyboard/cc-keyboard-shortcut-row.c \
    panels/keyboard/cc-keyboard-item.c panels/keyboard/cc-keyboard-manager.c \
    panels/keyboard/keyboard-shortcuts.c panels/common/cc-util.c \
    "$build_dir/panels/keyboard/cc-keyboard-resources.c" \
    $(pkg-config --cflags --libs gtk4 libadwaita-1 gio-unix-2.0 x11) \
    -o build/test-results/test-keyboard-shortcut-editor
bash scripts/isolated.sh build/test-results/test-keyboard-shortcut-editor "$@"
