import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const loop = new GLib.MainLoop(null, false);
const assert = (value, message) => { if (!value) throw new Error(message); };
let exported;
let sessionExport;
const sessionOwner = Gio.bus_own_name(Gio.BusType.SESSION, 'org.gnome.SessionManager', Gio.BusNameOwnerFlags.NONE,
    connection => {
        sessionExport = Gio.DBusExportedObject.wrapJSObject('<node><interface name="org.gnome.SessionManager"><method name="Logout"><arg type="u" direction="in"/></method></interface></node>',
            { Logout(mode) { calls.push(['logout', mode]); } });
        sessionExport.export(connection, '/org/gnome/SessionManager');
    }, null, null);
let calls = [];
let globalEnabled = true;
let data = {
    'user@example': { uuid: new GLib.Variant('s', 'user@example'), name: new GLib.Variant('s', 'User'),
        type: new GLib.Variant('d', 2), state: new GLib.Variant('d', 2),
        enabled: new GLib.Variant('b', true), hasPrefs: new GLib.Variant('b', true),
        hasUpdate: new GLib.Variant('b', true),
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
    InstallRemoteExtension(uuid) {
        calls.push(['install', uuid]);
        if (uuid === 'cancel@example') return 'cancelled';
        if (uuid === 'missing@example') return 'successful';
        if (uuid === 'reject@example') throw new Error('Installation rejected');
        data[uuid] = { ...data['user@example'], uuid: new GLib.Variant('s', uuid),
            name: new GLib.Variant('s', 'Installed from catalog'), enabled: new GLib.Variant('b', true) };
        return 'successful';
    },
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
            assert(backend.extensions.find(x => x.uuid === 'user@example').hasUpdate === true,
                'Shell staged-update flags are retained as booleans');
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
            await backend.requestLogout();
            assert(calls.some(([method, mode]) => method === 'logout' && mode === 0), 'Logout uses the native confirmation mode on the private session service');
            const installed = await backend.install('catalog@example');
            assert(installed.uuid === 'catalog@example' && backend.extensions.some(item => item.uuid === installed.uuid),
                'Installation is successful only after exact installed-state read-back');
            assert(await backend.install('cancel@example') === null && !backend.extensions.some(item => item.uuid === 'cancel@example'),
                'Cancelling the native installation prompt is not a success');
            for (const uuid of ['missing@example', 'reject@example']) {
                let failed = false; try { await backend.install(uuid); } catch { failed = true; }
                assert(failed, 'Installation errors and missing read-back are rejected');
            }
            let duplicate = false; try { await backend.install('catalog@example'); } catch { duplicate = true; }
            assert(duplicate && calls.filter(([method, uuid]) => method === 'install' && uuid === 'catalog@example').length === 1,
                'Already-installed extensions are not silently reinstalled or updated');
            const concurrent = await Promise.all([backend.install('concurrent@example'), backend.install('concurrent@example')]);
            assert(concurrent.every(item => item.uuid === 'concurrent@example') &&
                calls.filter(([method, uuid]) => method === 'install' && uuid === 'concurrent@example').length === 1,
                'Concurrent installation requests share one native consent request');
            const settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            settings.set_boolean('allow-extension-installation', false);
            let locked = false; try { await backend.install('locked@example'); } catch { locked = true; }
            assert(locked && !calls.some(([method, uuid]) => method === 'install' && uuid === 'locked@example'),
                'Shell installation policy prevents the request, not only the button');
            unsubscribe(); backend.stop();
            settings.set_boolean('allow-extension-installation', true);
            const retiring = await createBackend({ destination: 'org.monge.Settings.BackendFixture' });
            const pendingInstall = retiring.install('late@example'); retiring.stop();
            let closed = false; try { await pendingInstall; } catch (error) { closed = error.message.includes('closed'); }
            assert(closed, 'Stopped backends reject late installation results instead of claiming success');
            print('PASS backend: real private D-Bus reads, writes, rejection, live metadata and teardown');
        } catch (error) { logError(error); globalThis.failed = true; }
        finally { exported.unexport(); sessionExport?.unexport(); Gio.bus_unown_name(sessionOwner); Gio.bus_unown_name(owner); loop.quit(); }
    }, null);
loop.run();
if (globalThis.failed)
    imports.system.exit(1);
