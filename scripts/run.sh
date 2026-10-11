#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# run org.monge.Settings.Development from the checkout, leaving the system Settings launcher untouched
# Usage: nix develop path:. --command bash scripts/run.sh [--no-build] [panel | application arguments]
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
build_dir=${MONGE_DEV_BUILD_DIR:-"$root/build/dev"}
prefix="$build_dir/install"
: "${MONGE_SHELL_PREFIX:?Run inside nix develop path:.}"
if [[ ${1:-} == --no-build ]]; then
    shift
else
    bash "$root/scripts/dev-build.sh"
fi
binary="$prefix/bin/gnome-control-center"
if [[ ! -x "$binary" ]]; then
    printf 'No local development binary at %s; run scripts/dev-build.sh first.\n' "$binary" >&2
    exit 1
fi
export GSETTINGS_SCHEMA_DIR="$prefix/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$prefix/share${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
# resolve the snapshot once because running extension preferences can load bundled resources after the next build
export MONGE_HELPER_DIR="${MONGE_HELPER_DIR:-$(readlink -f "$root/build/helper/current")}"
exec "$binary" "$@"
