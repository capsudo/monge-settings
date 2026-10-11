# SPDX-License-Identifier: GPL-3.0-or-later
# package the local GNOME Settings fork using the upstream dependency, patch and wrapper definitions
{ pkgs, source ? ../., development ? false, upstream ? pkgs.gnome-control-center }:
let
  inherit (pkgs) lib;
  runtime = [ pkgs.gjs pkgs.libsoup_3 pkgs.gtk4 pkgs.libadwaita pkgs.glib ];
  typelibPath = lib.concatStringsSep ":" (
    [
      "${pkgs.gnome-shell}/lib/gnome-shell/girepository-1.0"
      "${pkgs.gjs}/lib/gjs/girepository-1.0"
    ] ++ map (package: "${lib.getLib package}/lib/girepository-1.0") runtime
  );
  libraryPath = "${pkgs.gnome-shell}/lib/gnome-shell:${lib.makeLibraryPath runtime}";
  subprojectSources = pkgs.runCommand "gnome-control-center-${upstream.version}-subprojects" {
    nativeBuildInputs = [ pkgs.gnutar pkgs.xz ];
  } ''
    mkdir -p "$out"
    tar --extract --xz --file ${upstream.src} --directory "$out" --strip-components=2 \
      gnome-control-center-${upstream.version}/subprojects
  '';
  src = lib.cleanSourceWith {
    src = source;
    filter = path: type:
      lib.cleanSourceFilter path type
      && !(type == "directory" && builtins.elem (baseNameOf path) [ "build" ".direnv" ".private" ])
      && !(builtins.elem (baseNameOf path) [ "result" "result-dev" ]);
  };
in
assert pkgs.gnome-shell.version == "49.4";
upstream.overrideAttrs (old: {
  pname = if development then "monge-settings-development" else "monge-settings";
  inherit src;
  nativeBuildInputs = (old.nativeBuildInputs or []) ++ [ pkgs.gjs pkgs.nodejs pkgs.rsync ];
  buildInputs = (old.buildInputs or []) ++ [ pkgs.gjs pkgs.gnome-shell pkgs.libsoup_3 ];
  mesonFlags = (old.mesonFlags or []) ++ [
    "-Dprofile=default"
    "-Dmonge-development=${lib.boolToString development}"
    "-Dmonge-js-dir=${builtins.placeholder "out"}/share/monge-settings/js"
  ];
  prePatch = (old.prePatch or "") + ''
    # local development may have patched the checkout already; do not reapply that same paths patch to its Nix source snapshot
    if patch --dry-run --batch --reverse --force -p1 < "${builtins.head old.patches}" >/dev/null 2>&1; then
      patches=(${lib.escapeShellArgs (map toString (builtins.tail old.patches))})
    fi
  '';
  preConfigure = (old.preConfigure or "") + ''
    export MONGE_SOURCE_DIR="$PWD"
    export MONGE_SHELL_PREFIX=${pkgs.gnome-shell}
    mkdir -p subprojects
    for project in ${subprojectSources}/*; do
      [ -d "$project" ] || continue
      rsync -a --checksum --delete --chmod=Du+w,Fu+w "$project/" "subprojects/$(basename "$project")/"
    done
    node scripts/build-helper.mjs
  '';
  postInstall = (old.postInstall or "") + ''
    mkdir -p "$out/share/monge-settings/js" "$out/share/monge-settings/helper"
    if [ -d "$MONGE_SOURCE_DIR/panels/extensions/js" ]; then
      cp -R "$MONGE_SOURCE_DIR/panels/extensions/js/." "$out/share/monge-settings/js/"
    fi
    cp -RL "$MONGE_SOURCE_DIR/build/helper/current/." "$out/share/monge-settings/helper/"
  '';
  preFixup = (old.preFixup or "") + ''
    gappsWrapperArgs+=(
      --prefix GI_TYPELIB_PATH : "${typelibPath}"
      --prefix LD_LIBRARY_PATH : "${libraryPath}"
      --set MONGE_SHELL_PREFIX "${pkgs.gnome-shell}"
      --set MONGE_HELPER_DIR "$out/share/monge-settings/helper"
    )
  '';
  passthru = (old.passthru or {}) // {
    mongeSubprojectSources = subprojectSources;
    mongeApplicationId = if development then "org.monge.Settings.Development" else "org.gnome.Settings";
    mongeDevelopment = development;
  };
  meta = old.meta // {
    description = "GNOME Settings with integrated extension management${lib.optionalString development " (development identity)"}";
    license = lib.licenses.gpl3Plus;
  };
})
