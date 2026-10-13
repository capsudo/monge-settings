// build the read-only catalog sidebar; the parent owns navigation and native preferences cleanup.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import { createCatalog } from './catalog.js';
import { ensureBrowseStyle } from './browse-style.js';

export function createBrowseView({ shellVersion, onDetails, onInstall, onError = () => {}, canInstall = () => true, installedUuids = [],
    catalog = createCatalog({ shellVersion }) }) {
    ensureBrowseStyle();
    const installed = new Set(installedUuids);
    const installing = new Set();
    const rows = new Map();
    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12, margin_start: 24, margin_end: 24,
        margin_top: 12, margin_bottom: 24 });
    const widget = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER,
        child: new Adw.Clamp({ maximum_size: 720, child: content }) });
    widget.add_css_class('monge-browse');
    const search = new Gtk.SearchEntry({ name: 'browse-search', placeholder_text: 'Search extensions',
        hexpand: true });
    search.add_css_class('browse-search');
    const searchBox = new Gtk.Box(); searchBox.add_css_class('linked'); searchBox.add_css_class('browse-search-controls');
    const sorts = ['popularity', 'downloads', 'created', 'name'];
    const sort = new Gtk.DropDown({ name: 'browse-sort', tooltip_text: 'Sort extensions',
        model: Gtk.StringList.new(['Popularity', 'Downloads', 'Newest', 'Name']) });
    sort.add_css_class('heading');
    const sortIcon = new Gtk.Box(); sortIcon.add_css_class('browse-sort-icon');
    sortIcon.append(new Gtk.Image({ name: 'browse-sort-icon', icon_name: 'view-sort-descending-symbolic' }));
    searchBox.append(search); searchBox.append(sortIcon); searchBox.append(sort); content.append(searchBox);
    const list = new Gtk.ListBox({ name: 'browse-results', selection_mode: Gtk.SelectionMode.NONE, show_separators: true });
    list.add_css_class('boxed-list');
    const state = new Gtk.Stack({ name: 'browse-state', hhomogeneous: false, vhomogeneous: false });
    state.add_named(list, 'results');
    const loading = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12,
        valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER });
    loading.append(new Gtk.Spinner({ spinning: true, halign: Gtk.Align.CENTER }));
    loading.append(new Gtk.Label({ label: 'Loading extensions…' }));
    state.add_named(loading, 'loading');
    const empty = new Adw.StatusPage({ title: 'No Extensions Found',
        description: `Try a different search. Only extensions compatible with GNOME Shell ${shellVersion} are shown.`,
        icon_name: 'edit-find-symbolic' });
    empty.add_css_class('compact');
    state.add_named(empty, 'empty');
    const retry = new Gtk.Button({ name: 'browse-retry', label: 'Retry', halign: Gtk.Align.CENTER });
    const error = new Adw.StatusPage({ title: 'Could Not Load Extensions',
        description: 'Check your connection and try again.', icon_name: 'network-error-symbolic', child: retry });
    error.add_css_class('compact');
    state.add_named(error, 'error');
    content.append(state);
    const moreList = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE, visible: false }); moreList.add_css_class('boxed-list');
    const more = new Adw.ButtonRow({ name: 'browse-more', title: 'Load More Results', start_icon_name: 'view-more-symbolic' });
    moreList.append(more); content.append(moreList);
    const moreError = new Gtk.Label({ use_markup: false, wrap: true, visible: false }); content.append(moreError);
    let active = false;
    let page = 1;
    let pages = 0;
    let busy = false;
    let debounce = 0;
    let requestedPage = 1;
    let request = null;
    let generation = 0;
    let currentItems = [];
    retry.connect('clicked', () => {
        if (active && !busy)
            load(requestedPage);
    });
    function changed() {
        if (!active)
            return;
        // discard the old reply immediately; delaying cancellation until the debounce can repaint stale results.
        generation++;
        request?.cancel();
        request = null;
        busy = true;
        clearRows();
        moreList.visible = false;
        moreError.visible = false;
        state.visible_child_name = 'loading';
        if (debounce)
            GLib.source_remove(debounce);
        debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            debounce = 0;
            load();
            return GLib.SOURCE_REMOVE;
        });
    }
    search.connect('notify::text', changed);
    sort.connect('notify::selected', changed);
    more.connect('activated', () => {
        if (active && !busy && page < pages)
            load(page + 1, true);
    });
    list.connect('row-activated', (_list, row) => {
        if (!active || !row)
            return;
        onDetails(row._catalogItem);
    });

    function clearRows() { list.remove_all(); rows.clear(); currentItems = []; }
    function updateInstall(row) {
        const uuid = row._catalogItem.uuid; const button = row._install;
        button.label = installed.has(uuid) ? 'Installed' : installing.has(uuid) ? 'Installing…' : 'Install…';
        button.sensitive = active && !installed.has(uuid) && !installing.has(uuid) && Boolean(onInstall) && canInstall();
        if (installed.has(uuid)) button.remove_css_class('suggested-action'); else button.add_css_class('suggested-action');
    }
    function render(items, append = false) {
        if (!append) clearRows();
        for (const item of items) {
            if (rows.has(item.uuid)) continue;
            currentItems.push(item);
            const content = new Gtk.Box({ spacing: 12, margin_start: 14, margin_end: 14, margin_top: 8, margin_bottom: 8 });
            const textBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, hexpand: true });
            for (const [text, style] of [[item.name, null], [item.creator, 'caption'], [item.description, 'dim-label']]) {
                const label = new Gtk.Label({ label: text.replace(/\s+/g, ' ').trim(), use_markup: false, xalign: 0, wrap: true,
                    wrap_mode: Pango.WrapMode.WORD_CHAR, ellipsize: Pango.EllipsizeMode.END,
                    lines: 2, max_width_chars: 28 });
                if (style)
                    label.add_css_class(style);
                if (style === 'caption') label.add_css_class('dim-label');
                if (style === 'dim-label') label.margin_top = 4;
                textBox.append(label);
            }
            content.append(textBox);
            const install = new Gtk.Button({ name: 'browse-install', valign: Gtk.Align.CENTER }); content.append(install);
            content.append(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
            const row = new Gtk.ListBoxRow({ child: content, selectable: false });
            row._catalogItem = item;
            row._install = install; rows.set(item.uuid, row); updateInstall(row);
            install.connect('clicked', async () => {
                if (!install.sensitive || installing.has(item.uuid) || !active) return;
                installing.add(item.uuid); updateInstall(row);
                try {
                    const result = await onInstall(item.uuid);
                    if (result) {
                        if (result.uuid !== item.uuid) throw new Error('Installed extension identity does not match');
                        installed.add(item.uuid);
                    }
                } catch (error) { onError(error); }
                finally {
                    installing.delete(item.uuid);
                    const current = rows.get(item.uuid); if (active && current) updateInstall(current);
                }
            });
            list.append(row);
        }
    }

    async function load(targetPage = 1, append = false) {
        if (!active)
            return;
        request?.cancel();
        const currentGeneration = ++generation;
        const cancellable = new Gio.Cancellable();
        request = cancellable;
        requestedPage = targetPage;
        busy = true;
        more.sensitive = false; more.title = 'Loading…'; moreError.visible = false;
        if (!append) { moreList.visible = false; state.visible_child_name = 'loading'; clearRows(); }
        try {
            const result = await catalog.query({ search: search.text, sort: sorts[sort.selected], page: targetPage, cancellable });
            if (!active || currentGeneration !== generation)
                return;
            render(result.items, append);
            page = result.page;
            pages = result.pages;
            moreList.visible = page >= 1 && page < pages;
            state.visible_child_name = currentItems.length ? 'results' : 'empty';
        } catch (_error) {
            if (active && currentGeneration === generation) {
                if (append) { moreError.label = 'More results could not be loaded. Try again.'; moreError.visible = true; }
                else state.visible_child_name = 'error';
            }
        } finally {
            if (currentGeneration === generation) {
                busy = false;
                more.sensitive = true; more.title = 'Load More Results';
                request = null;
            }
        }
    }

    return {
        widget,
        updateInstalled(uuids) {
            installed.clear(); for (const uuid of uuids) installed.add(uuid);
            for (const row of rows.values()) updateInstall(row);
        },
        start() {
            if (active)
                return;
            active = true;
            return load();
        },
        stop() {
            active = false;
            generation++;
            request?.cancel();
            request = null;
            if (debounce) {
                GLib.source_remove(debounce);
                debounce = 0;
            }
            busy = false;
            clearRows();
            moreList.visible = false; moreError.visible = false;
            state.visible_child_name = 'results';
        },
    };
}
