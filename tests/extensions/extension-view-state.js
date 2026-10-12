import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const assert = (value, message) => { if (!value) throw new Error(message); };
const { createExtensionViewState } = await import('../../panels/extensions/js/extension-view-state.js');
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();
const dir = GLib.dir_make_tmp('monge-view-state-XXXXXX');
root.get_child('shell/org.gnome.Settings.gschema.xml').copy(Gio.File.new_for_path(`${dir}/org.gnome.Settings.gschema.xml`), Gio.FileCopyFlags.NONE, null, null);
const compiler = Gio.Subprocess.new(['glib-compile-schemas', dir], Gio.SubprocessFlags.NONE);
assert(compiler.wait_check(null), 'Actual Settings schemas compile');
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(dir, null, false);
try {
    const development = createExtensionViewState({ applicationId: 'org.monge.Settings.Development', schemaSource });
    assert(development.get() === 'preferences', 'Preferences remains the initial row-click view');
    development.set('details');
    const reopened = createExtensionViewState({ applicationId: 'org.monge.Settings.Development', schemaSource });
    assert(reopened.get() === 'details', 'A new state object restores the last selected view');
    reopened.set('preferences');
    assert(development.get() === 'preferences', 'Preferences selection is saved too');
    const release = createExtensionViewState({ applicationId: 'org.gnome.Settings', schemaSource });
    development.set('details');
    assert(release.get() === 'preferences', 'Development state does not change release preferences');
    reopened.set('invalid');
    assert(development.get() === 'details', 'Invalid view names do not overwrite the remembered selection');
    print('PASS extension view state: last tab restoration, validation and development/release isolation');
} finally {
    for (const name of ['gschemas.compiled', 'org.gnome.Settings.gschema.xml']) Gio.File.new_for_path(`${dir}/${name}`).delete(null);
    Gio.File.new_for_path(dir).delete(null);
}
