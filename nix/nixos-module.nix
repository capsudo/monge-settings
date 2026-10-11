# SPDX-License-Identifier: GPL-2.0-or-later
# optionally replace pkgs.gnome-control-center for consumers of the system package set; importing this module alone changes nothing
{ config, lib, ... }:
let
  cfg = config.programs.monge-settings;
in
{
  options.programs.monge-settings = {
    enable = lib.mkEnableOption "the local GNOME Settings fork overlay";
    source = lib.mkOption {
      type = lib.types.path;
      default = ../.;
      description = "Local fork source directory, including untracked files. The build excludes local build outputs.";
    };
    development = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Use org.monge.Settings.Development instead of the release org.gnome.Settings identity.";
    };
  };
  config = lib.mkIf cfg.enable {
    nixpkgs.overlays = [
      (final: prev: {
        gnome-control-center = import ./package.nix {
          pkgs = final;
          upstream = prev.gnome-control-center;
          inherit (cfg) source development;
        };
      })
    ];
  };
}
