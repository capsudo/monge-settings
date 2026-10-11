// render installed Shell extensions; the backend owns state and the parent opens preferences.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';

const stateTitles = new Map([[1, 'Enabled'], [2, 'Disabled'], [3, 'Error'],
    [4, 'Out of Date'], [5, 'Downloading'], [6, 'Initialized'], [99, 'Uninstalled']]);
function safeWebsite(url) {
    if (typeof url !== 'string' || /[\x00-\x20\x7f\\]/.test(url)) return null;
    try {
        const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
        return uri.get_scheme() === 'https' && uri.get_host() && !uri.get_userinfo() ? url : null;
    } catch (_error) { return null; }
}

export function createInstalledView({ backend, onPreferences = () => {}, onError = () => {} }) {
    const widget = new Adw.PreferencesPage();
    const globalGroup = new Adw.PreferencesGroup();
    const globalSwitch = new Adw.SwitchRow({ title: 'Use Extensions',
        subtitle: 'Extensions can cause performance and stability issues',
        active: backend.userExtensionsEnabled });
    globalSwitch.add_prefix(new Gtk.Image({ icon_name: 'application-x-addon-symbolic' }));
    globalGroup.add(globalSwitch);
    widget.add(globalGroup);
    const userGroup = new Adw.PreferencesGroup({ title: 'User-Installed Extensions' });
    const systemGroup = new Adw.PreferencesGroup({ title: 'System Extensions' });
    widget.add(userGroup);
    widget.add(systemGroup);
    const rows = new Map();
    let stopped = false;
    let syncing = false;
    let globalBusy = false;

    function syncControls() {
        syncing = true;
        if (!globalBusy) globalSwitch.active = backend.userExtensionsEnabled;
        globalSwitch.sensitive = !stopped && !globalBusy && backend.writable;
        for (const row of rows.values()) {
            if (!row._busy) row._toggle.active = row._item.enabled;
            row._toggle.sensitive = !stopped && !globalBusy && globalSwitch.active && !row._busy && row._item.canChange === true;
        }
        syncing = false;
    }
    globalSwitch.connect('notify::active', async () => {
        if (syncing || stopped || globalBusy || !backend.writable) return;
        globalBusy = true;
        syncControls();
        try {
            await backend.setUserExtensionsEnabled(globalSwitch.active);
        } catch (error) {
            if (!stopped) onError(error);
        } finally {
            globalBusy = false;
            if (!stopped) syncControls();
        }
    });

    function createRow(item) {
        const row = new Adw.ExpanderRow({ title: item.name, subtitle: item.uuid, use_markup: false });
        row._busy = false;
        row._toggle = new Gtk.Switch({ name: 'installed-enable', active: item.enabled, valign: Gtk.Align.CENTER });
        row._preferences = new Gtk.Button({ icon_name: 'go-next-symbolic',
            tooltip_text: 'Preferences', valign: Gtk.Align.CENTER, visible: item.hasPrefs });
        row._preferences.add_css_class('flat');
        row._preferences.connect('clicked', () => {
            if (!stopped && rows.get(item.uuid) === row) onPreferences(item.uuid);
        });
        // ExpanderRow prepends suffixes; insert the switch first to display arrow, switch, native chevron.
        row.add_suffix(row._toggle);
        row.add_suffix(row._preferences);
        row._description = new Adw.ActionRow({ title: item.description, use_markup: false, title_lines: 0 });
        row.add_row(row._description);
        row._state = new Adw.ActionRow({ use_markup: false, subtitle_lines: 0 });
        row._version = new Adw.ActionRow({ title: 'Version', use_markup: false });
        row._website = new Adw.ActionRow({ title: 'Website', use_markup: false });
        row._link = null;
        row.add_row(row._state);
        row.add_row(row._version);
        row.add_row(row._website);
        row._toggle.connect('notify::active', async () => {
            if (syncing || stopped || row._busy || rows.get(item.uuid) !== row || !row._toggle.sensitive) return;
            row._busy = true;
            syncControls();
            try {
                await backend.setEnabled(item.uuid, row._toggle.active);
            } catch (error) {
                if (!stopped && rows.get(item.uuid) === row) onError(error);
            } finally {
                row._busy = false;
                if (!stopped && rows.get(item.uuid) === row) syncControls();
            }
        });
        return row;
    }

    function render() {
        if (stopped) return;
        for (const row of rows.values()) row._group.remove(row);
        const items = [...backend.extensions].sort((a, b) =>
            a.name.localeCompare(b.name, 'en') || a.uuid.localeCompare(b.uuid, 'en'));
        const uuids = new Set(items.map(item => item.uuid));
        for (const uuid of rows.keys()) if (!uuids.has(uuid)) rows.delete(uuid);
        for (const item of items) {
            const row = rows.get(item.uuid) ?? createRow(item);
            row._item = item;
            row.title = item.name;
            row._description.title = item.description;
            row._description.visible = Boolean(item.description);
            row._state.title = stateTitles.get(item.state) ?? 'Unknown State';
            row._state.subtitle = item.error || '';
            row._version.subtitle = item.version == null ? '' : String(item.version);
            row._version.visible = Boolean(row._version.subtitle);
            const website = safeWebsite(item.url);
            if (row._link) {
                row._website.remove(row._link);
                row._link = null;
            }
            row._website.visible = Boolean(website);
            if (website) {
                row._link = new Gtk.LinkButton({ uri: website, label: 'Visit Website', valign: Gtk.Align.CENTER });
                row._website.add_suffix(row._link);
            }
            row._preferences.visible = item.hasPrefs;
            row._group = item.type === 1 ? systemGroup : userGroup;
            row._group.add(row);
            rows.set(item.uuid, row);
        }
        userGroup.description = items.some(item => item.type !== 1) ? '' : 'No user-installed extensions';
        systemGroup.visible = items.some(item => item.type === 1);
        syncControls();
    }
    render();
    const unsubscribe = backend.subscribe(render);
    return { widget, rows, globalSwitch, userGroup, systemGroup,
        stop() {
            if (stopped) return;
            stopped = true;
            unsubscribe();
            globalSwitch.sensitive = false;
            for (const row of rows.values()) {
                row._toggle.sensitive = false;
                row._preferences.sensitive = false;
            }
        },
    };
}
