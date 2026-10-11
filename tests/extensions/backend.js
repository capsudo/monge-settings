import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const loop = new GLib.MainLoop(null, false);
const assert = (value, message) => { if (!value) throw new Error(message); };
let exported;
let calls = [];
let globalEnabled = true;
let data = {
    'user@example': { uuid: new GLib.Variant('s', 'user@example'), name: new GLib.Variant('s', 'User'),
        type: new GLib.Variant('d', 2), state: new GLib.Variant('d', 2),
        enabled: new GLib.Variant('b', true), hasPrefs: new GLib.Variant('b', true),
        path: new GLib.Variant('s', '/fixture/user') },
    'system@example': { uuid: new GLib.Variant('s', 'system@example'), name: new GLib.Variant('s', 'System'),
        type: new GLib.Variant('d', 1), state: new GLib.Variant('d', 1),
        enabled: new GLib.Variant('b', true), path: new GLib.Variant('s', '/fixture/system') },
};
const xml = new TextDecoder().decode(Gio.File.new_for_path(`${GLib.get_current_dir()}/panels/extensions/vendor/data/dbus-interfaces/org.gnome.Shell.Extensions.xml`).load_contents(null)[1]);
const service = {
    ListExtensions() { return data; },
    GetExtensionInfo(uuid) { return data[uuid] ?? {}; },
    EnableExtension(uuid) { calls.push(['enable', uuid]); return uuid !== 'reject@example'; },
    DisableExtension(uuid) { calls.push(['disable', uuid]); if (data[uuid]) data[uuid].enabled = new GLib.Variant('b', false); return Boolean(data[uuid]); },
    get ShellVersion() { return '49.4'; },
    get UserExtensionsEnabled() { return globalEnabled; },
    set UserExtensionsEnabled(value) {
        calls.push(['global', value]); globalEnabled = value;
        exported.emit_property_changed('UserExtensionsEnabled', new GLib.Variant('b', value));
    },
};
const owner = Gio.bus_own_name(Gio.BusType.SESSION, 'org.monge.Settings.BackendFixture', Gio.BusNameOwnerFlags.NONE,
    connection => { exported = Gio.DBusExportedObject.wrapJSObject(xml, service); exported.export(connection, '/org/gnome/Shell'); },
    async () => {
        try {
            const { createBackend } = await import('../../panels/extensions/js/backend.js');
            const backend = await createBackend({ destination: 'org.monge.Settings.BackendFixture' });
            assert(calls.length === 0, 'startup must not change extensions');
            assert(backend.extensions.length === 2, 'all installed types retained');
            assert(backend.extensions.find(x => x.uuid === 'user@example').enabled, 'requested enabled survives inactive state');
            assert(backend.extensions.find(x => x.uuid === 'system@example').type === 1, 'system type');
            let notifications = 0;
            const unsubscribe = backend.subscribe(() => notifications++);
            await backend.setUserExtensionsEnabled(false);
            assert(!backend.userExtensionsEnabled, 'global state read back');
            assert(backend.extensions.find(x => x.uuid === 'user@example').enabled, 'global switch preserves per-extension state');
            await backend.setEnabled('user@example', false);
            assert(!backend.extensions.find(x => x.uuid === 'user@example').enabled, 'individual state read back');
            let rejected = false;
            try { await backend.setEnabled('reject@example', true); } catch { rejected = true; }
            assert(rejected, 'false D-Bus enable result rejected');
            data['system@example'].name = new GLib.Variant('s', 'Updated');
            exported.emit_signal('ExtensionStateChanged', new GLib.Variant('(sa{sv})', ['system@example', data['system@example']]));
            await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { resolve(); return GLib.SOURCE_REMOVE; }));
            assert(backend.extensions.find(x => x.uuid === 'system@example').name === 'Updated', 'live metadata reflected');
            assert(notifications > 0, 'subscriptions notified');
            unsubscribe(); backend.stop();
            print('PASS backend: real private D-Bus reads, writes, rejection, live metadata and teardown');
        } catch (error) { logError(error); globalThis.failed = true; }
        finally { exported.unexport(); Gio.bus_unown_name(owner); loop.quit(); }
    }, null);
loop.run();
if (globalThis.failed)
    imports.system.exit(1);
