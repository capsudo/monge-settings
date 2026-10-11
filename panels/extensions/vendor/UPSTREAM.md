# Upstream provenance

- Project: GNOME Shell
- Version: 49.4
- Repository: https://gitlab.gnome.org/GNOME/gnome-shell
- Source archive: https://download.gnome.org/sources/gnome-shell/49/gnome-shell-49.4.tar.xz
- Published checksum file: https://download.gnome.org/sources/gnome-shell/49/gnome-shell-49.4.sha256sum
- License: GPL-2.0-or-later, as declared in the upstream `meson.build`; the original license text is preserved in `COPYING`.

The archive was verified against GNOME's published SHA-256 before extraction. `upstream.json` records the archive digest and every copied file's digest. Paths in that manifest are unchanged relative to the upstream source tree. `tests/provenance.test.mjs` detects any later change to copied files, including comments and licensing text.

## Extracted sources

- `js/dbusServices/extensions/`: native service entry point, preferences service, preferences dialog and error-page UI.
- `js/dbusServices/dbusService.js`: service lifetime and request tracking.
- `js/dbusServices/org.gnome.Shell.Extensions.src.gresource.xml`: original resource manifest.
- `js/extensions/{prefs,sharedInternals}.js`: native extension preferences API, lookup, schema and translation handling.
- `js/misc/`: the helper's utilities and original generated-configuration template.
- `data/dbus-interfaces/org.gnome.Shell.Extensions.xml`: native D-Bus interface.
- `COPYING`: original license text.

## Project-specific additions

`src/bootstrap.js` registers the local bundle at the native resource paths. `src/main.js` starts the copied service under a distinct development D-Bus name and provides command-line selection/listing. The original `js/dbusServices/extensions/main.js` is retained for provenance but **is not the development entry point**.

`scripts/build.mjs` fills the upstream configuration template using development-environment paths, compiles the local resources and generates a development desktop entry. `data/interfaces.gresource.xml` contains only the helper's required interface, rather than unrelated Shell interfaces. These additions do not modify the copied upstream files.

`flake.nix` provides GJS, GTK 4, libadwaita, Shew's typelib/library, schema directories and resource tools from a specified nixpkgs revision. Runtime libraries remain dependencies; this repository does not copy the full GNOME Shell compositor.

No replacement of GNOME's installed helper or service activation is part of this baseline.
