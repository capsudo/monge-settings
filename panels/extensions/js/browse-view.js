// build the read-only catalog sidebar; the parent owns navigation and native preferences cleanup.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import { createCatalog } from './catalog.js';

export function createBrowseView({ shellVersion, onDetails, installedUuids = [],
    catalog = createCatalog({ shellVersion }) }) {
    const installed = new Set(installedUuids);
    const widget = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
    const search = new Gtk.SearchEntry({ name: 'browse-search', placeholder_text: 'Search extensions',
        margin_start: 12, margin_end: 12, margin_top: 12, margin_bottom: 6 });
    widget.append(search);
    const list = new Gtk.ListBox({ name: 'browse-results', selection_mode: Gtk.SelectionMode.SINGLE });
    list.add_css_class('navigation-sidebar');
    const state = new Gtk.Stack({ name: 'browse-state', vexpand: true });
    state.add_named(new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER,
        child: list }), 'results');
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
    widget.append(state);
    const pagination = new Gtk.Box({ spacing: 6, margin_start: 12, margin_end: 12,
        margin_top: 6, margin_bottom: 12 });
    const previous = new Gtk.Button({ name: 'browse-previous', icon_name: 'go-previous-symbolic',
        tooltip_text: 'Previous page', sensitive: false });
    const pageLabel = new Gtk.Label({ name: 'browse-page', hexpand: true });
    const next = new Gtk.Button({ name: 'browse-next', icon_name: 'go-next-symbolic',
        tooltip_text: 'Next page', sensitive: false });
    pagination.append(previous);
    pagination.append(pageLabel);
    pagination.append(next);
    widget.append(pagination);
    let active = false;
    let page = 1;
    let pages = 0;
    let busy = false;
    let debounce = 0;
    let requestedPage = 1;
    let request = null;
    let generation = 0;
    retry.connect('clicked', () => {
        if (active && !busy)
            load(requestedPage);
    });
    search.connect('notify::text', () => {
        if (!active)
            return;
        // discard the old reply immediately; delaying cancellation until the debounce can repaint stale results.
        generation++;
        request?.cancel();
        request = null;
        busy = true;
        list.remove_all();
        previous.sensitive = false;
        next.sensitive = false;
        pageLabel.label = '';
        state.visible_child_name = 'loading';
        if (debounce)
            GLib.source_remove(debounce);
        debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            debounce = 0;
            load();
            return GLib.SOURCE_REMOVE;
        });
    });
    previous.connect('clicked', () => {
        if (active && !busy && page > 1)
            load(page - 1);
    });
    next.connect('clicked', () => {
        if (active && !busy && page < pages)
            load(page + 1);
    });
    list.connect('row-selected', (_list, row) => {
        if (!active || !row)
            return;
        const item = row._catalogItem;
        const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18,
            margin_start: 24, margin_end: 24, margin_top: 32, margin_bottom: 32 });
        for (const [text, style] of [[item.name, 'title-1'], [`By ${item.creator}`, 'dim-label'],
            [item.description, null], ...(installed.has(item.uuid) ? [['Installed', 'dim-label']] : [])]) {
            const label = new Gtk.Label({ label: text, use_markup: false, xalign: 0,
                wrap: true, wrap_mode: Pango.WrapMode.WORD_CHAR, selectable: true });
            if (style)
                label.add_css_class(style);
            content.append(label);
        }
        if (typeof item.website === 'string' &&
            /^https:\/\/extensions\.gnome\.org\/extension\/[1-9]\d*\/[a-z0-9-]+\/$/.test(item.website)) {
            content.append(new Gtk.LinkButton({ uri: item.website,
                label: 'View on extensions.gnome.org', halign: Gtk.Align.START }));
        }
        onDetails(new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER,
            child: new Adw.Clamp({ maximum_size: 640, child: content }) }));
        list.unselect_all();
    });

    function render(items) {
        list.remove_all();
        for (const item of items) {
            const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4,
                margin_start: 12, margin_end: 12, margin_top: 10, margin_bottom: 10 });
            for (const [text, style] of [[item.name, 'heading'], [item.description, null],
                [`By ${item.creator}`, 'dim-label'], ...(installed.has(item.uuid) ? [['Installed', 'dim-label']] : [])]) {
                const label = new Gtk.Label({ label: text.replace(/\s+/g, ' ').trim(), use_markup: false, xalign: 0, wrap: true,
                    wrap_mode: Pango.WrapMode.WORD_CHAR, ellipsize: Pango.EllipsizeMode.END,
                    lines: 2, max_width_chars: 28 });
                if (style)
                    label.add_css_class(style);
                content.append(label);
            }
            const row = new Gtk.ListBoxRow({ child: content });
            row._catalogItem = item;
            list.append(row);
        }
    }

    async function load(targetPage = 1) {
        if (!active)
            return;
        request?.cancel();
        const currentGeneration = ++generation;
        const cancellable = new Gio.Cancellable();
        request = cancellable;
        requestedPage = targetPage;
        busy = true;
        previous.sensitive = false;
        next.sensitive = false;
        pageLabel.label = '';
        state.visible_child_name = 'loading';
        list.remove_all();
        try {
            const result = await catalog.query({ search: search.text, page: targetPage, cancellable });
            if (!active || currentGeneration !== generation)
                return;
            render(result.items);
            page = result.page;
            pages = result.pages;
            const hasPage = page >= 1 && page <= pages;
            pageLabel.label = hasPage ? `Page ${page} of ${pages}` : '';
            previous.sensitive = hasPage && page > 1;
            next.sensitive = hasPage && page < pages;
            state.visible_child_name = result.items.length ? 'results' : 'empty';
        } catch (_error) {
            if (active && currentGeneration === generation)
                state.visible_child_name = 'error';
        } finally {
            if (currentGeneration === generation) {
                busy = false;
                request = null;
            }
        }
    }

    return {
        widget,
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
            list.remove_all();
            previous.sensitive = false;
            next.sensitive = false;
            pageLabel.label = '';
            state.visible_child_name = 'results';
        },
    };
}
