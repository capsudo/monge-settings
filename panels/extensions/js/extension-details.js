import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import { createExtensionInfo } from './installed-view.js';
import { ensureDetailsStyle } from './extension-details-style.js';
import { createExtensionReviews } from './extension-reviews.js';
import { decodeExtensionImage } from './extension-image.js';

function safeLink(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
        const uri = GLib.Uri.parse(value, GLib.UriFlags.NONE);
        return uri.get_scheme() === 'https' && uri.get_host() && !uri.get_userinfo() ? value : null;
    } catch (_error) { return null; }
}

export function createExtensionDetails({ item, catalog }) {
    ensureDetailsStyle();
    const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 24,
        margin_start: 24, margin_end: 24, margin_top: 32, margin_bottom: 32 });
    const hero = new Gtk.Box({ spacing: 18 });
    const icon = new Gtk.Image({ icon_name: 'application-x-addon-symbolic', pixel_size: 64, valign: Gtk.Align.START });
    const identity = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, hexpand: true });
    const title = new Gtk.Label({ label: item.name, use_markup: false, xalign: 0, wrap: true, selectable: true });
    title.add_css_class('title-1');
    const author = new Gtk.Label({ use_markup: false, xalign: 0, wrap: true, visible: false });
    author.add_css_class('dim-label');
    identity.append(title); identity.append(author);
    const installed = new Gtk.Button({ label: 'Installed', sensitive: false, focusable: false, valign: Gtk.Align.CENTER });
    const installedVersion = new Gtk.Label({ use_markup: false }); installedVersion.add_css_class('heading');
    const installedVersionButton = new Gtk.Button({ child: installedVersion, sensitive: false, focusable: false });
    installedVersionButton.add_css_class('monge-installed-version');
    const installedBadge = new Gtk.Box({ valign: Gtk.Align.CENTER });
    installedBadge.append(installed); installedBadge.append(installedVersionButton);
    hero.append(icon); hero.append(identity); hero.append(installedBadge); body.append(hero);
    const preview = new Gtk.Picture({ visible: false, can_shrink: true, content_fit: Gtk.ContentFit.CONTAIN });
    body.append(preview);
    const descriptionHeading = new Gtk.Label({ label: 'Description', xalign: 0 });
    descriptionHeading.add_css_class('heading');
    const description = new Gtk.Label({ label: item.description ?? '', use_markup: false, xalign: 0,
        wrap: true, selectable: true });
    body.append(descriptionHeading); body.append(description);
    const metrics = new Gtk.Box({ homogeneous: true, overflow: Gtk.Overflow.HIDDEN });
    metrics.add_css_class('card'); metrics.add_css_class('monge-details-metrics');
    const downloads = new Adw.ActionRow({ title: 'Downloads', visible: false, use_markup: false });
    const version = new Adw.ActionRow({ title: 'Latest compatible version', use_markup: false });
    const metricLists = [downloads, version].map((row, index) => {
        row.add_css_class('property');
        row.add_prefix(new Gtk.Image({ icon_name: index === 0 ? 'folder-download-symbolic' : 'system-software-install-symbolic' }));
        const list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
        list.append(row); metrics.append(list); return list;
    });
    body.append(metrics);

    const links = new Adw.PreferencesGroup({ title: 'Links' });
    body.append(links);
    const reviews = createExtensionReviews({ catalog }); body.append(reviews.widget);
    const information = createExtensionInfo({ ...item, description: '', version: null, url: null });
    body.append(information.widget);
    const status = new Gtk.Label({ xalign: 0, wrap: true }); status.add_css_class('dim-label');
    const retry = new Gtk.Button({ label: 'Retry', halign: Gtk.Align.START, visible: false });
    body.append(status); body.append(retry);
    const widget = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true,
        child: new Adw.Clamp({ maximum_size: 720, child: body }) });
    let stopped = false;
    let started = false;
    let request = null;
    let online = null;
    let loading = Promise.resolve();
    const linkRows = [];
    function updateLinks() {
        for (const row of linkRows) links.remove(row);
        linkRows.length = 0;
        for (const [label, uri, iconName] of [['Homepage', online?.homepage ?? item.url, 'go-home-symbolic'],
            ['View on Extensions', online?.website, 'web-browser-symbolic']]) {
            const safe = safeLink(uri);
            if (!safe) continue;
            const row = new Adw.ActionRow({ title: label, subtitle: safe, use_markup: false });
            row.add_prefix(new Gtk.Image({ icon_name: iconName }));
            const button = new Gtk.LinkButton({ uri: safe, icon_name: 'adw-external-link-symbolic', valign: Gtk.Align.CENTER });
            button.add_css_class('flat'); button.add_css_class('monge-details-link');
            row.add_suffix(button); row.activatable_widget = button; links.add(row); linkRows.push(row);
        }
        links.visible = Boolean(linkRows.length);
    }
    function update(value) {
        item = value;
        title.label = item.name;
        description.label = online?.description ?? item.description ?? '';
        const available = Number.isSafeInteger(online?.version) && online.version > 0 ? online.version : null;
        version.subtitle = available == null ? '' : `v${available}`;
        version.visible = available != null;
        installedVersion.label = item.version == null ? '' : `v${item.version}`;
        installedVersion.visible = item.version != null;
        installedVersionButton.visible = installedVersion.visible;
        installedVersionButton.tooltip_text = item.version == null ? null : `Installed version: ${item.version}`;
        if (installedVersion.visible) installedBadge.add_css_class('linked'); else installedBadge.remove_css_class('linked');
        metricLists[0].visible = downloads.visible;
        metricLists[1].visible = version.visible;
        metrics.visible = downloads.visible || version.visible;
        if (downloads.visible && version.visible) metrics.add_css_class('split'); else metrics.remove_css_class('split');
        information.update({ ...item, description: '', version: null, url: null });
        updateLinks();
    }
    function start() {
        if (stopped || started) return loading;
        loading = load();
        return loading;
    }
    async function load() {
        started = true;
        if (!catalog?.details) { status.label = 'Additional details are not available.'; return; }
        const cancellable = new Gio.Cancellable(); request = cancellable;
        status.label = 'Loading additional details…'; retry.visible = false;
        try {
            const result = await catalog.details({ uuid: item.uuid, cancellable });
            if (stopped || request !== cancellable) return;
            online = result;
            author.label = result.creator ? `By ${result.creator}` : ''; author.visible = Boolean(result.creator);
            downloads.subtitle = result.downloads == null ? '' : result.downloads.toLocaleString('en-US');
            downloads.visible = Boolean(downloads.subtitle);
            update(item); status.label = '';
            for (const [path, apply] of [[result.icon, value => { icon.paintable = value; }],
                [result.screenshot, value => {
                    preview.paintable = value;
                    preview.height_request = Math.min(420, value.get_height());
                    preview.visible = true;
                }]]) {
                if (!path || !catalog.media || path === '/static/images/plugin.png') continue;
                try {
                    const bytes = await catalog.media({ path, cancellable });
                    if (stopped || request !== cancellable) return;
                    apply(decodeExtensionImage(bytes));
                } catch (_error) {
                    if (!stopped && request === cancellable && path === result.screenshot)
                        status.label = 'The screenshot could not be loaded.';
                }
            }
            if (!stopped && request === cancellable) await reviews.load(result.pk);
        } catch (_error) {
            if (!stopped && request === cancellable) {
                started = false;
                status.label = 'Additional details could not be loaded. Installed information is still available.';
                retry.visible = true;
                reviews.load(null);
            }
        } finally { if (request === cancellable) request = null; }
    }
    retry.connect('clicked', start);
    update(item);
    return { widget, information, title, author, installed, installedBadge, description, metrics, links, reviews, downloads, version, installedVersion, preview, retry,
        start, update, stop() { stopped = true; request?.cancel(); request = null; reviews.stop(); } };
}
