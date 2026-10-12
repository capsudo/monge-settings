import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject';
import { NativeRoot, createExtensionsPanel } from './native-root.js';
Adw.init();
const assert = (value, message) => { if (!value) throw new Error(message); };
const loop = new GLib.MainLoop(null, false);
(async () => {
    try {
        const { ExtensionsController } = await import('../../panels/extensions/js/extensions-controller.js');
        const window = new NativeRoot({ default_width: 980, default_height: 640 });
        const counters = { closed: 0 };
        globalThis.fixtureControllerCounters = counters;
        const dir = GLib.dir_make_tmp('monge-controller-prefs-XXXXXX');
        Gio.File.new_for_path(`${dir}/prefs.js`).replace_contents(`
            import Adw from 'gi://Adw?version=1';
            export default class {
                async fillPreferencesWindow(window) {
                    const page = new Adw.PreferencesPage({ title: 'Native' });
                    const group = new Adw.PreferencesGroup();
                    const row = new Adw.SwitchRow({ title: 'Actual Native Control' }); group.add(row); page.add(group); window.add(page);
                    window.controllerFixtureRow = row;
                    window.connect('close-request', () => { fixtureControllerCounters.closed++; return false; });
                }
            }
        `, null, false, Gio.FileCreateFlags.NONE, null);
        const backend = { extensions: [{ uuid: 'fixture@example', name: 'Fixture', description: '', state: 1, type: 2, enabled: true, hasPrefs: true, canChange: true }],
            userExtensionsEnabled: true, writable: true, shellVersion: '49.4', subscribe: () => () => {}, stop() {},
            async getExtension(uuid) {
                if (uuid !== 'fixture@example') throw new Error('Missing fixture');
                return Object.fromEntries(Object.entries({uuid,name:'Fixture',type:2,state:1,enabled:true,hasPrefs:true,path:dir})
                    .map(([key, value]) => [key, new GLib.Variant(typeof value === 'string' ? 's' : typeof value === 'boolean' ? 'b' : 'd', value)]));
            },
        };
        let rememberedView = 'preferences';
        const controller = new ExtensionsController({ window, backend,
            viewState: { get: () => rememberedView, set: value => { rememberedView = value; } },
            catalog: { query: async () => ({ page: 1, pages: 0, items: [] }) } });
        window.active_panel = createExtensionsPanel(); window.present();
        await controller.ready;
        assert(controller.current.viewStack.get_pages().get_n_items() === 2, 'Installed/Browse tabs in native Settings panel');
        assert(await controller.select('fixture@example'), 'arrow selection opens native preferences');
        assert(window.controllerFixtureRow.get_root() === window, 'native control rooted in Settings');
        const information = controller.current.information?.widget;
        assert(information instanceof Adw.PreferencesGroup, 'extension information is available on Details');
        assert(information.get_root() === window, 'information retains the actual Settings root');
        assert(information.is_ancestor(controller.pageLayout.details), 'information belongs to Details rather than native settings');
        assert(controller.pageLayout.inlineSwitcher instanceof Adw.InlineViewSwitcher, 'native page switching is inline');
        controller.pageLayout.viewStack.visible_child_name = 'details';
        assert(counters.closed === 0 && window.controllerFixtureRow.get_root() === window, 'Details retains the loaded preferences session');
        controller.pageLayout.viewStack.visible_child_name = 'preferences';
        const surface = window.get_surface();
        assert(controller.current.navigation.get_visible_page() === controller.current.preferencesPage, 'navigation subpage, not modal');
        assert(await controller.back(), 'Back accepted');
        assert(counters.closed === 1, 'Back delivers native cleanup');
        assert(window.get_surface() === surface, 'Back keeps same window surface');
        assert(controller.current.navigation.get_visible_page() === controller.current.landing, 'Back restores Installed list');
        assert(await controller.select('fixture@example'), 'round trip');
        controller.pageLayout.viewStack.visible_child_name = 'details';
        assert(await controller.back(), 'Back from Details accepts native cleanup');
        assert(await controller.select('fixture@example'), 'reopen after Details');
        assert(controller.pageLayout.viewStack.visible_child_name === 'details', 'row reopening restores the last selected view');
        controller.pageLayout.viewStack.visible_child_name = 'preferences';
        const veto = window.connect_after('close-request', () => true);
        assert(!await controller.back(), 'veto retains preferences');
        assert(controller.current.navigation.get_visible_page() === controller.current.preferencesPage, 'veto retains displayed page');
        window.disconnect(veto);
        assert(await controller.back(), 'Back after veto removed');
        assert(await controller.select('fixture@example'), 'section retirement fixture');
        let continued = 0;
        GObject.Object.prototype.connect.call(window, 'monge-continue-panel', () => continued++);
        assert(window.emit('monge-request-panel', 'background'), 'section replacement deferred');
        await controller.idle;
        assert(continued === 1 && !window._extension.uuid, 'other Settings section waits for retirement');
        assert(!window.monge_preferences_content.get_parent(), 'native content retained before old panel disposal');
        await controller.close();
        Gio.File.new_for_path(`${dir}/prefs.js`).delete(null); Gio.File.new_for_path(dir).delete(null);
        print('PASS controller: tabs, native subpage, Back, veto, same root/surface and section retirement');
    } catch (error) { logError(error); globalThis.failed = true; }
    finally { loop.quit(); }
})();
loop.run();
if (globalThis.failed) imports.system.exit(1);
