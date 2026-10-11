# Monge Settings

A GNOME Settings with extra features and fixes

## Extra Features

- **Extensions section:**:
	- list of installed GNOME extensions
	- switch to disable the extensions globally
	- individual extensions switches
	- extension settings on right arrow click (not in a modal) 
	- browse tab to find extensions online. Currently read-only: installation, removal and updates are not implemented.

	Note: heavily inspired by [mjakeman's Extension Manager](https://github.com/mjakeman/extension-manager) 

## Install

### Build from source

<details>
<summary>Without the nix CLI</summary>

1. Install the GNOME Settings 49.5 build dependencies, including development headers, plus a C compiler, Meson, Ninja, Python 3, pkg-config, gettext, Blueprint Compiler, Node.js, curl and GLib's resource/schema tools. The full library requirements are checked by `meson.build`; they include GJS, GTK 4, libadwaita and libsoup 3. The supported desktop runtime is GNOME Shell 49.4. Distribution package names vary; the optional nix CLI build below supplies its own build dependencies.
2. When a Monge Settings release is available, download **Source code (tar.gz)** from [Releases](https://github.com/capsudo/monge-settings/releases), extract the archive, and open a terminal in the extracted directory. No fork releases are published yet; for now, use the local `49.5` checkout.
3. Build with Meson and Ninja into a local installation directory. GitHub source archives omit the `gvc` submodule, so first obtain the bundled subprojects from the matching GNOME Settings release archive:

   ```sh
   mkdir -p build/upstream
   curl --fail --location \
     https://download.gnome.org/sources/gnome-control-center/49/gnome-control-center-49.5.tar.xz \
     --output build/upstream.tar.xz
   tar --extract --xz --file build/upstream.tar.xz \
     --directory build/upstream --strip-components=1 \
     gnome-control-center-49.5/subprojects
   for project in build/upstream/subprojects/*; do
     if [ -d "$project" ]; then
       cp -R "$project" subprojects/
     fi
   done

   export MONGE_SHELL_PREFIX=/usr
   node scripts/build-helper.mjs
   meson setup build/native --prefix="$PWD/build/native/install" \
     --libdir=lib --buildtype=release --wrap-mode=nofallback \
     -Dmonge-js-dir="$PWD/panels/extensions/js" -Dtests=false
   meson compile -C build/native
   meson install -C build/native
   ```

   `/usr` is the GNOME Shell installation prefix on a conventional distribution; adjust `MONGE_SHELL_PREFIX` if yours differs. Missing development packages or incompatible library versions must be resolved before Meson can configure the build. No `sudo` is needed, and nothing is installed into the system.

4. Close any running Settings window, then launch the local build:

   ```sh
   XDG_DATA_DIRS="$PWD/build/native/install/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
     MONGE_SHELL_PREFIX="${MONGE_SHELL_PREFIX:-/usr}" \
     ./build/native/install/bin/gnome-control-center
   ```

   Keep the extracted source directory: this local build loads its JavaScript and generated helper resources from there.

</details>

<details>
<summary>With the nix CLI</summary>

From the extracted source directory or local `49.5` checkout, with flakes enabled, run `nix build path:.#default`, then launch `./result/bin/gnome-control-center`.
This supplies the build/runtime dependencies and creates the `result` symlink; the manual Meson steps above are not needed for this alternative.

</details>

Note: This runs the downloaded version without replacing the system package. To do so on NixOS, use the [NixOS module](#nixos-module) below and activate the changed configuration. A supported system-replacement installation for other distributions is not provided yet; these source-build instructions are for local use.

### AppImage

Not available yet.

### NixOS module

#### Manual Import

Import `nix/nixos-module.nix` into a NixOS configuration and explicitly enable `programs.monge-settings.enable`.
This replaces the default Settings application: it overrides `pkgs.gnome-control-center` with the fork and retains the standard `org.gnome.Settings` identity by default, so the usual Settings launcher opens the modified application after activation.

Example import with monge-settings outside the nix configuration repository:

```nix
{
  imports = [ /path/to/monge-settings/nix/nixos-module.nix ];
  programs.monge-settings = {
    enable = true;
    source = /path/to/monge-settings;
    development = false;
  };
}
```

Note: This absolute local-path import requires `--impure` when evaluating/building a flake-based NixOS configuration.

#### Flake input

Add this repository as an input, import its `nixosModules.default` and enable `programs.monge-settings.enable`. The module default source is that input's snapshot.

Note: When using an absolute local path input, refresh that input's lock entry when you want a new snapshot.

## Target GNOME Shell Version

Monge Settings currently requires the **GNOME Shell 49.4** runtime it was validated against. Porting to another GNOME release requires updating and retesting the retained helper resources and native integration.

Only selected **GNOME Shell** releases are targeted:

| Monge Settings | Validated against GNOME Shell |
| --- | --- |
| [v49.5](../../tree/49.5) | v49.4 |

Note: Monge Settings's version matches the **GNOME Settings** version it is based on. **GNOME Settings** and **GNOME Shell** are separate components whose versions don't need to match exactly.

## Local development

Run these commands from the checkout root. Both workflows use the separate `org.monge.Settings.Development` application identity.

<details>
<summary>Without the nix CLI</summary>

Install the dependencies and prepare the bundled subprojects as described in [Build from source](#build-from-source). For the isolated tests, also install Bash, Xvfb, D-Bus (`dbus-run-session`) and coreutils (`timeout`). Use a separate `build/dev-native` directory so this workflow does not reuse the nix CLI build's Meson configuration.

```sh
export MONGE_SHELL_PREFIX=/usr
export MONGE_DEV_BUILD_DIR="$PWD/build/dev-native"
export XDG_DATA_DIRS="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
export TMPDIR="${TMPDIR:-$PWD/build/tmp}"
mkdir -p "$TMPDIR"

node scripts/build-helper.mjs
meson setup "$MONGE_DEV_BUILD_DIR" \
  --prefix="$MONGE_DEV_BUILD_DIR/install" --libdir=lib \
  --buildtype=debugoptimized --wrap-mode=nofallback \
  -Dprofile=default -Dmonge-development=true \
  -Dmonge-js-dir="$PWD/panels/extensions/js" -Dtests=false
meson compile -C "$MONGE_DEV_BUILD_DIR" -j2
meson install -C "$MONGE_DEV_BUILD_DIR"
```

Adjust `MONGE_SHELL_PREFIX` if GNOME Shell is installed somewhere other than `/usr`. The exported variables must remain set for the following commands:

- Run: `bash scripts/run.sh --no-build extensions`.
- After C/Blueprint edits, rerun `meson compile -C "$MONGE_DEV_BUILD_DIR" -j2` and `meson install -C "$MONGE_DEV_BUILD_DIR"` before launching or testing again.

The source directory and generated helper resources must remain available to this local build.

</details>

<details>
<summary>With the nix CLI</summary>

Requires flakes enabled. The development environment provides the GNOME Shell 49.4 preferences API, GJS, GTK, libadwaita, native build tools and test dependencies. Use a fresh shell when switching from the manual workflow so its `MONGE_DEV_BUILD_DIR` override is not carried into this one.

- Build: `nix develop path:. --command bash scripts/dev-build.sh -j2`
- Run: `nix develop path:. --command bash scripts/run.sh --no-build extensions`
- Build the replacement package without installing it: `nix build path:.#default`

This workflow uses an ignored, writable source snapshot under `build/dev-source/`. Nix-specific path substitutions stay there rather than modifying tracked upstream files. The matching upstream release archive supplies bundled subprojects, including volume control (`gvc`) and the desktop portal helper (`libgxdp`), for both local and packaged nix CLI builds; Git checkouts do not need separate submodule initialization or wrap downloads for this workflow.

</details>

The local development binary does not replace the installed Settings application or take ownership of GNOME's extension-preferences helper service. JavaScript edits take effect on relaunch with `--no-build`. C/Blueprint changes require an incremental build/install. No hot reload is provided.

**Interactive runs use your real GNOME Shell and settings.** The automated suite instead uses private Xvfb, isolated session/system D-Bus, in-memory settings and test fixtures. Screenshots of the actual Settings binary are written to `build/test-screenshots/`; test results are under `build/test-results/`. Fixture screenshots are not claims about a live desktop session.

## Repository layout

- `panels/extensions/`: native panel, runtime JavaScript (`js/`) and retained GNOME Shell helper sources (`vendor/`).
- `tests/extensions/`: automated tests and extension fixtures.
- `scripts/`: build, launch and isolated test tools.
- `nix/`: package definition and optional NixOS module; the flake stays at the root.
- `build/`: generated resources, source snapshots, native build outputs and test captures; not committed.

## Limitations

## Extension preferences

The extension’s preferences code runs inside Monge Settings, therefore certain situations can arise:

- Monge Settings may crash or freeze: a fatal failure in extension preferences can affect the whole app. Ordinary loading errors are caught and displayed instead.
- Navigation my be blocked: if extension preferences gets stuck loading, navigating back, switching sections, and normal quitting may remain blocked. Force-closing and restarting Monge Settings may be necessary.
- Leaving extension's preferences may be blocked: Monge Settings waits for the extension’s preferences page to finish closing before continuing. If the extension refuses to close, its preference page stays open when trying to navigate back or quit.
- External changes may not appear: some extensions do not refresh their open preferences when settings change elsewhere. This depends on the extension.
- Unsaved changes can be lost: if the extension discards unsaved changes when closing (on leave), Monge Settings cannot do anything about it.

Tests with example extensions do not guarantee that every extension works.

## Credits

- **GNOME Settings (`gnome-control-center`)** provide the upstream application and native Settings interface on which this fork is based.
- **[mjakeman's Extension Manager](https://github.com/mjakeman/extension-manager)** heavily inspired the Extensions section, including the Installed/Browse organization and extension-management layout.

Inherited code retains its original copyright and license notices. The upstream GPLv2 license document is preserved in [COPYING](COPYING); the retained helper's license is in `panels/extensions/vendor/COPYING`.
