import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { bindtextdomain } from 'gettext';

export const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
export const resourceBase = 'resource:///org/gnome/Shell/Extensions/js';
const helperRoot = `${root}/../../build/helper`;
const build = GLib.getenv('MONGE_HELPER_DIR') ??
    (Gio.File.new_for_path(`${root}/helper`).query_exists(null) ? `${root}/helper` :
        `${helperRoot}/${GLib.file_read_link(`${helperRoot}/current`)}`);
Gio.Resource.load(`${build}/org.gnome.Shell.Extensions.src.gresource`)._register();
Gio.Resource.load(`${build}/gnome-shell-dbus-interfaces.gresource`)._register();
GLib.setenv('GNOME_SHELL_DATADIR', build, true);
imports.package.initFormat();
const prefix = GLib.getenv('MONGE_SHELL_PREFIX');
if (prefix)
    bindtextdomain('gnome-shell', `${prefix}/share/locale`);
