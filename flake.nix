# SPDX-License-Identifier: GPL-3.0-or-later
{
  description = "GNOME Settings fork with integrated extension management";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/b6018f87da91d19d0ab4cf979885689b469cdd41";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      packageSet = system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = import ./nix/package.nix { inherit pkgs; source = ./.; };
          development = import ./nix/package.nix { inherit pkgs; source = ./.; development = true; };
        };
    in {
      packages = forAllSystems packageSet;
      nixosModules.default = import ./nix/nixos-module.nix;
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (pkgs) lib;
          upstream = pkgs.gnome-control-center;
          runtime = [ pkgs.gjs pkgs.gnome-shell pkgs.libsoup_3 pkgs.gtk4 pkgs.libadwaita pkgs.glib ];
          schemaPackages = (upstream.buildInputs or []) ++ runtime;
          dataPath = lib.makeSearchPath "share" ((upstream.buildInputs or []) ++ runtime ++ [ pkgs.mutter ])
            + ":" + lib.concatMapStringsSep ":" (package:
              pkgs.glib.getSchemaDataDirPath (package.out or package)) schemaPackages;
          typelibPath = lib.concatStringsSep ":" (
            [
              "${pkgs.gnome-shell}/lib/gnome-shell/girepository-1.0"
              "${pkgs.gjs}/lib/gjs/girepository-1.0"
            ] ++ map (package: "${lib.getLib package}/lib/girepository-1.0") runtime
          );
        in {
          default = pkgs.mkShell {
            inputsFrom = [ self.packages.${system}.development ];
            packages = [ pkgs.nodejs pkgs.gjs pkgs.glib.dev pkgs.patch pkgs.rsync pkgs.util-linux pkgs.dbus pkgs.xorg-server ];
            MONGE_SHELL_PREFIX = "${pkgs.gnome-shell}";
            MONGE_NIX_PATHS_PATCH = "${builtins.head upstream.patches}";
            MONGE_SUBPROJECT_SOURCES = "${self.packages.${system}.development.mongeSubprojectSources}";
            shellHook = ''
              export GI_TYPELIB_PATH="${typelibPath}''${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
              export LD_LIBRARY_PATH="${pkgs.gnome-shell}/lib/gnome-shell:${lib.makeLibraryPath runtime}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
              export XDG_DATA_DIRS="${dataPath}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
              export ADW_DISABLE_PORTAL=1
            '';
          };
        });
      checks = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          packaging = pkgs.runCommand "monge-settings-packaging-tests" { nativeBuildInputs = [ pkgs.nodejs pkgs.bash pkgs.patch pkgs.rsync pkgs.util-linux ]; } ''
            export TMPDIR="$NIX_BUILD_TOP"
            node --test ${self.packages.${system}.development.src}/tests/extensions/packaging.test.mjs
            touch "$out"
          '';
        });
    };
}
