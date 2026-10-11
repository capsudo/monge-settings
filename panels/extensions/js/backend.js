import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const unpack = value => value instanceof GLib.Variant ? value.recursiveUnpack() : value;
const ownKeys = ['uuid', 'name', 'description', 'type', 'state', 'hasPrefs', 'enabled', 'canChange', 'error', 'version', 'url', 'path'];
export function normalizeExtension(uuid, info) {
    const value = Object.fromEntries(ownKeys.map(key => [key, unpack(info[key])]));
    if (![1, 2].includes(value.type) || value.state === 99 || typeof value.path !== 'string' ||
        typeof value.name !== 'string' || !value.name || typeof uuid !== 'string' || !uuid)
        return null;
    return { ...value, uuid, description: typeof value.description === 'string' ? value.description : '',
        hasPrefs: value.hasPrefs === true, enabled: value.enabled === true,
        canChange: value.canChange !== false };
}

function call(connection, destination, interfaceName, method, parameters, resultType) {
    return new Promise((resolve, reject) => connection.call(destination, '/org/gnome/Shell', interfaceName,
        method, parameters, resultType, Gio.DBusCallFlags.NO_AUTO_START, 10000, null, (_connection, result) => {
            try { resolve(connection.call_finish(result)); } catch (error) { reject(error); }
        }));
}

export async function createBackend({ destination = 'org.gnome.Shell', connection = Gio.DBus.session } = {}) {
    const xmlFile = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent()
        .get_child('vendor').get_child('data').get_child('dbus-interfaces').get_child('org.gnome.Shell.Extensions.xml');
    let xml;
    if (xmlFile.query_exists(null))
        xml = new TextDecoder().decode(xmlFile.load_contents(null)[1]);
    else
        xml = new TextDecoder().decode(Gio.resources_lookup_data('/org/gnome/shell/dbus-interfaces/org.gnome.Shell.Extensions.xml', 0).get_data());
    const Proxy = Gio.DBusProxy.makeProxyWrapper(xml);
    const proxy = await new Promise((resolve, reject) => new Proxy(connection, destination, '/org/gnome/Shell',
        (result, error) => error ? reject(error) : resolve(result), null, Gio.DBusProxyFlags.DO_NOT_AUTO_START));
    if (!proxy.g_name_owner)
        throw new Error('GNOME Shell is not running');
    const settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
    const listeners = new Set();
    const entries = new Map();
    let stopped = false;
    let revision = 0;
    let refreshTicket = 0;
    const notify = () => { if (!stopped) for (const listener of listeners) listener(); };
    const backend = {
        get extensions() { return [...entries.values()]; },
        get userExtensionsEnabled() { return proxy.UserExtensionsEnabled === true; },
        get writable() { return settings.is_writable('disable-user-extensions'); },
        get shellVersion() { return proxy.ShellVersion; },
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        async refresh() {
            const ticket = ++refreshTicket;
            const before = revision;
            const [listed] = await proxy.ListExtensionsAsync();
            if (stopped || ticket !== refreshTicket)
                return;
            // a state signal received during the request is newer than its list snapshot; request a fresh snapshot instead.
            if (before !== revision)
                return backend.refresh();
            entries.clear();
            for (const [uuid, info] of Object.entries(listed)) {
                const extension = normalizeExtension(uuid, info);
                if (extension)
                    entries.set(uuid, extension);
            }
            notify();
        },
        async getExtension(uuid) {
            const [info] = await proxy.GetExtensionInfoAsync(uuid);
            if (!normalizeExtension(uuid, info))
                throw new Error(`Extension is not installed: ${uuid}`);
            return info;
        },
        async setUserExtensionsEnabled(enabled) {
            if (typeof enabled !== 'boolean' || !backend.writable)
                throw new Error('The global extensions setting is locked');
            await call(connection, destination, 'org.freedesktop.DBus.Properties', 'Set',
                new GLib.Variant('(ssv)', ['org.gnome.Shell.Extensions', 'UserExtensionsEnabled', new GLib.Variant('b', enabled)]), null);
            const reply = await call(connection, destination, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.gnome.Shell.Extensions', 'UserExtensionsEnabled']), new GLib.VariantType('(v)'));
            const actual = reply.recursiveUnpack()[0];
            proxy.set_cached_property('UserExtensionsEnabled', new GLib.Variant('b', actual));
            notify();
            if (actual !== enabled)
                throw new Error('GNOME Shell did not accept the extensions setting');
        },
        async setEnabled(uuid, enabled) {
            if (typeof uuid !== 'string' || !uuid || typeof enabled !== 'boolean')
                throw new Error('Invalid extension operation');
            const [success] = enabled ? await proxy.EnableExtensionAsync(uuid) : await proxy.DisableExtensionAsync(uuid);
            if (!success)
                throw new Error(`Could not ${enabled ? 'enable' : 'disable'} this extension`);
            await backend.refresh();
            const actual = entries.get(uuid);
            if (!actual || actual.enabled !== enabled)
                throw new Error('GNOME Shell did not accept the extension setting');
        },
        stop() {
            if (stopped) return;
            stopped = true; ++refreshTicket;
            proxy.disconnectSignal(extensionSignal);
            proxy.disconnect(propertiesSignal);
            settings.disconnect(settingsSignal);
            listeners.clear();
        },
    };
    const extensionSignal = proxy.connectSignal('ExtensionStateChanged', (_proxy, _sender, [uuid, info]) => {
        if (stopped) return;
        revision++;
        const extension = normalizeExtension(uuid, info);
        if (extension) entries.set(uuid, extension); else entries.delete(uuid);
        notify();
    });
    const propertiesSignal = proxy.connect('g-properties-changed', notify);
    const settingsSignal = settings.connect('writable-changed::disable-user-extensions', notify);
    await backend.refresh();
    return backend;
}
