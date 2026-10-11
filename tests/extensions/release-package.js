import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [binary] = imports.system.programArgs;
if (!binary)
    throw new Error('Pass the packaged release gnome-control-center binary');
const loop = new GLib.MainLoop(null, false);
const checks = [];
const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
let child;
let exported;
let reads = 0;
let writes = 0;
let failed = false;
const fixtureRoot = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('fixtures').get_path();
const entry = {
    uuid: new GLib.Variant('s', 'modern@monge.test'),
    name: new GLib.Variant('s', 'Package Fixture'),
    path: new GLib.Variant('s', `${fixtureRoot}/modern@monge.test`),
    type: new GLib.Variant('d', 2), state: new GLib.Variant('d', 1),
    enabled: new GLib.Variant('b', true), hasPrefs: new GLib.Variant('b', true),
};
const xmlFile = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
    .get_child('panels/extensions/vendor/data/dbus-interfaces/org.gnome.Shell.Extensions.xml');
const xml = new TextDecoder().decode(xmlFile.load_contents(null)[1]);
const service = {
    ListExtensions() {
        reads++;
        if (reads === 1) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                const actions = Gio.DBusActionGroup.get(Gio.DBus.session, 'org.gnome.Settings', '/org/gnome/Settings');
                actions.activate_action('quit', null);
                return GLib.SOURCE_REMOVE;
            });
        }
        return { 'modern@monge.test': entry };
    },
    GetExtensionInfo() { return entry; },
    EnableExtension() { writes++; return false; },
    DisableExtension() { writes++; return false; },
    get ShellVersion() { return '49.4'; },
    get UserExtensionsEnabled() { return true; },
    set UserExtensionsEnabled(_value) { writes++; },
};
const watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
    failed = true;
    printerr(`FAIL release package: startup/quit did not finish; ${reads} backend reads`);
    if (child) child.force_exit(); else loop.quit();
    return GLib.SOURCE_REMOVE;
});
const owner = Gio.bus_own_name(Gio.BusType.SESSION, 'org.gnome.Shell', Gio.BusNameOwnerFlags.NONE,
    connection => {
        exported = Gio.DBusExportedObject.wrapJSObject(xml, service);
        exported.export(connection, '/org/gnome/Shell');
    }, () => {
        const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE });
        for (const name of ['GI_TYPELIB_PATH', 'LD_LIBRARY_PATH', 'GSETTINGS_SCHEMA_DIR', 'XDG_DATA_DIRS', 'MONGE_HELPER_DIR'])
            launcher.unsetenv(name);
        launcher.setenv('MONGE_SETTINGS_TEST_BACKEND', 'file:///invalid-release-injection.js', true);
        launcher.setenv('MONGE_SETTINGS_TEST_MODULE', 'file:///invalid-release-injection.js', true);
        launcher.setenv('XDG_CURRENT_DESKTOP', 'GNOME', true);
        child = launcher.spawnv([binary, 'extensions']);
        child.communicate_utf8_async(null, null, (process, result) => {
            try {
                const [, stdout, stderr] = process.communicate_utf8_finish(result);
                check(process.get_successful(), `packaged release exited successfully: ${stderr}`);
                check(reads > 0, 'release uses the real D-Bus backend despite fixture environment variables');
                check(writes === 0, 'release startup makes no extension mutations');
                check(!/JS ERROR|CRITICAL|Could not load Extensions/.test(`${stdout}\n${stderr}`), 'installed runtime loads from package without inherited typelibs or helper paths');
                print(`PASS packaged release: ${checks.length} assertions`);
            } catch (error) { failed = true; logError(error); }
            finally { loop.quit(); }
        });
    }, () => { failed = true; printerr('FAIL release package: could not own isolated Shell service'); loop.quit(); });
loop.run();
if (!failed)
    GLib.source_remove(watchdog);
exported?.unexport();
Gio.bus_unown_name(owner);
if (failed)
    imports.system.exit(1);
