import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
Adw.init();
const loop = new GLib.MainLoop(null, false);
const assert = (value, message) => { if (!value) throw new Error(message); };
const NativeRoot = GObject.registerClass({
    Properties: {
        'monge-emitting-close': GObject.ParamSpec.boolean('monge-emitting-close', '', '', GObject.ParamFlags.READWRITE, false),
        'monge-close-accepted': GObject.ParamSpec.boolean('monge-close-accepted', '', '', GObject.ParamFlags.READABLE, false),
    },
    Signals: { 'monge-preferences-loaded': {} },
}, class NativeRoot extends Adw.PreferencesWindow {
    get monge_emitting_close() { return this._emitting ?? false; }
    set monge_emitting_close(value) { this._emitting = value; if (value) this._accepted = false; }
    get monge_close_accepted() { return this._accepted ?? false; }
    vfunc_close_request() { this._accepted = true; return false; }
});
(async () => {
    try {
        const { attachPreferencesHost } = await import('../../panels/extensions/js/preferences-host.js');
        assert(typeof attachPreferencesHost === 'function', 'existing native Settings root must accept the preferences host');
        const window = new NativeRoot({ default_width: 980, default_height: 640 });
        const native = window.get_content(); window.set_content(null);
        const navigation = new Adw.NavigationView();
        const list = new Adw.NavigationPage({ title: 'Extensions', child: new Gtk.Label({ label: 'Installed' }) });
        const settings = new Adw.NavigationPage({ title: 'Fixture', child: native });
        navigation.add(list); navigation.add(settings); window.set_content(navigation);
        let closes = 0;
        window.fixtureClose = () => closes++;
        attachPreferencesHost(window, native);
        await window.ready;
        assert(window.get_content() === navigation, 'attaching host must not replace Settings shell');
        const dir = GLib.dir_make_tmp('monge-native-prefs-XXXXXX');
        const Gio = (await import('gi://Gio')).default;
        const path = `${dir}/prefs.js`;
        Gio.File.new_for_path(path).replace_contents(`
            import Adw from 'gi://Adw?version=1';
            export default class {
                async fillPreferencesWindow(window) {
                    const page = new Adw.PreferencesPage({ title: 'Native Fixture' });
                    const group = new Adw.PreferencesGroup();
                    const row = new Adw.SwitchRow({ title: 'Native Switch' }); group.add(row); page.add(group); window.add(page);
                    window.connect('close-request', () => { window.fixtureClose(); return false; });
                    window.fixtureRow = row;
                    window.set_default_size(500, 300);
                }
            }
        `, null, false, Gio.FileCreateFlags.NONE, null);
        const extension = { uuid: 'fixture@example', metadata: { name: 'Fixture' }, dir: Gio.File.new_for_path(dir), path: dir };
        navigation.push(settings); window.present();
        assert(await window.switchTo(extension), 'loads installed prefs.js into existing Settings root');
        assert(window.fixtureRow.get_root() === window, 'native control root is actual Settings window');
        assert(window.get_default_size().join(',') === '980,640', 'native preferences cannot resize persistent Settings');
        const surface = window.get_surface();
        assert(await window.switchTo(null), 'Back retirement accepted');
        assert(closes === 1, 'native close cleanup delivered once');
        assert(window.get_surface() === surface, 'same root and surface after retirement');
        assert(!window.fixtureRow, 'extension state retired');
        navigation.pop();
        assert(await window.switchTo(extension), 'preferences load again after Back');
        const veto = window.connect_after('close-request', () => true);
        assert(!await window.switchTo(null), 'Back respects after-handler veto');
        window.disconnect(veto);
        assert(await window.switchTo(null), 'Back accepted after veto removed');
        let closeRequests = 0;
        window.onCloseRequested = () => closeRequests++;
        window.close();
        assert(closeRequests === 1, 'application controller must serialize shutdown against pending selections');
        Gtk.Window.prototype.destroy.call(window);
        Gio.File.new_for_path(path).delete(null); Gio.File.new_for_path(dir).delete(null);
        print('PASS native host: existing preferences root, native controls, geometry, Back cleanup and veto');
    } catch (error) { logError(error); globalThis.failed = true; }
    finally { loop.quit(); }
})();
loop.run();
if (globalThis.failed) imports.system.exit(1);
