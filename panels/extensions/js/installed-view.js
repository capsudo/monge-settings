// render installed Shell extensions; the backend owns state and the parent opens preferences.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { decodeExtensionImage } from './extension-image.js';

const stateTitles = new Map([[1, 'Enabled'], [2, 'Disabled'], [3, 'Error'],
    [4, 'Out of Date'], [5, 'Downloading'], [6, 'Initialized'], [99, 'Uninstalled']]);
const versionsByIconCache = new WeakMap();
function safeWebsite(url) {
    if (typeof url !== 'string' || /[\x00-\x20\x7f\\]/.test(url)) return null;
    try {
        const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
        return uri.get_scheme() === 'https' && uri.get_host() && !uri.get_userinfo() ? url : null;
    } catch (_error) { return null; }
}

export function createExtensionInfo(item) {
    const widget = new Adw.PreferencesGroup({ title: 'Extension Information' });
    const description = new Adw.ActionRow({ use_markup: false, title_lines: 0 });
    const uuid = new Adw.ActionRow({ title: 'UUID', use_markup: false });
    const state = new Adw.ActionRow({ use_markup: false, subtitle_lines: 0 });
    const version = new Adw.ActionRow({ title: 'Version', use_markup: false });
    const website = new Adw.ActionRow({ title: 'Website', use_markup: false });
    for (const row of [description, uuid, state, version, website]) widget.add(row);
    let link = null;
    function update(value) {
        description.title = value.description ?? '';
        description.visible = Boolean(value.description);
        uuid.subtitle = value.uuid;
        state.title = stateTitles.get(value.state) ?? 'Unknown State';
        state.subtitle = value.error || '';
        version.subtitle = value.version == null ? '' : String(value.version);
        version.visible = Boolean(version.subtitle);
        const url = safeWebsite(value.url);
        if (link) { website.remove(link); link = null; }
        website.visible = Boolean(url);
        if (url) {
            link = new Gtk.LinkButton({ uri: url, label: 'Visit Website', valign: Gtk.Align.CENTER });
            website.add_suffix(link);
        }
    }
    update(item);
    return { widget, update };
}

export function createInstalledView({ backend, catalog, iconCache = new Map(), onPreferences = () => {}, onError = () => {}, onUpdatesChanged = () => {} }) {
    if (!versionsByIconCache.has(iconCache)) versionsByIconCache.set(iconCache, new Map());
    const versions = versionsByIconCache.get(iconCache);
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
    const iconCancellation = new Gio.Cancellable();
    async function loadIcon(row, uuid) {
        if (iconCache.has(uuid)) {
            const image = iconCache.get(uuid);
            if (image) row._icon.paintable = image;
            return;
        }
        if (!catalog?.details) return;
        try {
            const details = await catalog.details({ uuid, cancellable: iconCancellation });
            if (stopped || rows.get(uuid) !== row) return;
            versions.set(uuid, Number.isSafeInteger(details.version) && details.version > 0 ? details.version : null);
            updateIndicators();
            if (!details.icon || details.icon === '/static/images/plugin.png') { iconCache.set(uuid, null); return; }
            if (!catalog.media) return;
            const bytes = await catalog.media({ path: details.icon, cancellable: iconCancellation });
            if (stopped || rows.get(uuid) !== row) return;
            const image = decodeExtensionImage(bytes, 32);
            iconCache.set(uuid, image); row._icon.paintable = image;
        } catch (_error) {}
    }

    function updateState(item) {
        if (item.type !== 2) return null;
        if (item.hasUpdate === true) return 'pending';
        const latest = versions.get(item.uuid);
        return Number.isSafeInteger(item.version) && item.version > 0 && latest != null && latest > item.version ? 'available' : null;
    }
    function updateCounts() {
        const counts = { available: 0, pending: 0 };
        for (const row of rows.values()) { const state = updateState(row._item); if (state) counts[state]++; }
        return counts;
    }
    function updateIndicators() {
        if (stopped) return;
        for (const row of rows.values()) {
            const state = updateState(row._item);
            row._update.visible = Boolean(state);
            row._update.tooltip_text = state === 'pending' ? 'This extension will be updated on next login' :
                state === 'available' ? `Update available: v${versions.get(row._item.uuid)}` : null;
            row._update.remove_css_class('warning'); row._update.remove_css_class('accent');
            if (state) row._update.add_css_class('accent');
        }
        onUpdatesChanged(updateCounts());
    }
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
        const row = new Adw.ActionRow({ title: item.name, subtitle: item.uuid, use_markup: false, activatable: true });
        row._icon = new Gtk.Image({ icon_name: 'application-x-addon-symbolic', icon_size: Gtk.IconSize.LARGE, pixel_size: 32,
            accessible_role: Gtk.AccessibleRole.PRESENTATION });
        row._icon.add_css_class('lowres-icon'); row.add_prefix(row._icon);
        row._busy = false;
        row._toggle = new Gtk.Switch({ name: 'installed-enable', active: item.enabled, valign: Gtk.Align.CENTER });
        row._update = new Gtk.Image({ icon_name: 'software-update-available-symbolic', visible: false, valign: Gtk.Align.CENTER, margin_end: 18 });
        row._preferences = new Gtk.Image({ icon_name: 'go-next-symbolic',
            accessible_role: Gtk.AccessibleRole.PRESENTATION, valign: Gtk.Align.CENTER, margin_start: 9, margin_end: 9 });
        row.connect('activated', () => {
            if (!stopped && rows.get(item.uuid) === row) onPreferences(item.uuid);
        });
        // ExpanderRow prepends suffixes; insert the switch first to display arrow, switch, native chevron.
        // ActionRow appends suffixes instead, placing the navigation arrow after the switch.
        row.add_suffix(row._update);
        row.add_suffix(row._toggle);
        row.add_suffix(row._preferences);
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
            row.tooltip_text = item.hasPrefs ? 'Preferences' : 'Extension Information';
            row._group = item.type === 1 ? systemGroup : userGroup;
            row._group.add(row);
            rows.set(item.uuid, row);
            row._iconPromise ??= loadIcon(row, item.uuid);
        }
        userGroup.description = items.some(item => item.type !== 1) ? '' : 'No user-installed extensions';
        systemGroup.visible = items.some(item => item.type === 1);
        updateIndicators();
        syncControls();
    }
    render();
    const unsubscribe = backend.subscribe(render);
    return { widget, rows, globalSwitch, userGroup, systemGroup,
        get updateCounts() { return updateCounts(); },
        whenIconsReady() { return Promise.all([...rows.values()].map(row => row._iconPromise)); },
        stop() {
            if (stopped) return;
            stopped = true;
            iconCancellation.cancel();
            unsubscribe();
            globalSwitch.sensitive = false;
            for (const row of rows.values()) {
                row._toggle.sensitive = false;
                row._preferences.sensitive = false;
                row.activatable = false;
            }
        },
    };
}
