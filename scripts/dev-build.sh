#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# incrementally build and install into this checkout; nothing is installed into the system
# Usage: nix develop path:. --command bash scripts/dev-build.sh [-j2 | other ninja arguments]
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
build_dir=${MONGE_DEV_BUILD_DIR:-"$root/build/dev"}
source_dir="${build_dir}-source"
prefix="$build_dir/install"
: "${MONGE_SHELL_PREFIX:?Run inside nix develop path:.}"
: "${MONGE_NIX_PATHS_PATCH:?Run inside nix develop path:. to obtain the upstream paths patch.}"
: "${MONGE_SUBPROJECT_SOURCES:?Run inside nix develop path:. to obtain the bundled upstream subprojects.}"
for tool in node meson ninja patch rsync flock glib-compile-schemas; do
    command -v "$tool" >/dev/null || { printf 'Missing tool: %s\n' "$tool" >&2; exit 1; }
done
mkdir -p "$build_dir" "$source_dir"
exec 9>"$build_dir/.build.lock"
flock 9
rsync -a --checksum --delete --chmod=Du+w,Fu+w --exclude=/.git/ --exclude=/build/ --exclude=/.private/ \
    --exclude=/.direnv/ --exclude=/result --exclude=/result-dev --exclude='/subprojects/*/' \
    "$root/" "$source_dir/"
mkdir -p "$source_dir/subprojects"
for project in "$MONGE_SUBPROJECT_SOURCES"/*; do
    [[ -d "$project" ]] || continue
    rsync -a --checksum --delete --chmod=Du+w,Fu+w "$project/" "$source_dir/subprojects/${project##*/}/"
done
cd "$source_dir"

# apply the substituted nixpkgs paths patch once; reject partial or incompatible source changes instead of hiding them with a stamp
if patch --dry-run --batch --forward -p1 < "$MONGE_NIX_PATHS_PATCH" >/dev/null 2>&1; then
    patch --batch --forward --no-backup-if-mismatch -p1 < "$MONGE_NIX_PATHS_PATCH"
elif ! patch --dry-run --batch --reverse --force -p1 < "$MONGE_NIX_PATHS_PATCH" >/dev/null 2>&1; then
    printf 'The nixpkgs paths patch is neither applicable nor already applied; inspect source changes before building.\n' >&2
    exit 1
fi

node "$root/scripts/build-helper.mjs"
setup_args=(setup)
if [[ -f "$build_dir/meson-private/coredata.dat" ]]; then
    if [[ -f "$build_dir/.source-snapshot" ]]; then
        setup_args+=(--reconfigure)
    else
        setup_args+=(--wipe)
    fi
fi
meson "${setup_args[@]}" "$build_dir" "$source_dir" \
    "--prefix=$prefix" --libdir=lib --datadir=share --buildtype=debugoptimized \
    --wrap-mode=nofallback -Dprofile=default -Dmonge-development=true \
    "-Dmonge-js-dir=$root/panels/extensions/js" -Dtests=false
printf '%s\n' "$source_dir" > "$build_dir/.source-snapshot"
ninja -C "$build_dir" "$@"
meson install -C "$build_dir" --no-rebuild --only-changed
glib-compile-schemas "$prefix/share/glib-2.0/schemas"
