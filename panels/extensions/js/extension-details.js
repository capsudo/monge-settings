import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
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

export function createExtensionDetails({ item, catalog, installed: initiallyInstalled = true, onInstall, canInstall = () => true,
    onRemove, canRemove = () => false, navigation = null }) {
    ensureDetailsStyle();
    const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 24,
        margin_start: 24, margin_end: 24, margin_top: 32, margin_bottom: 32 });
    const hero = new Gtk.Box({ spacing: 18 });
    const icon = new Gtk.Image({ icon_name: 'application-x-addon-symbolic', pixel_size: 64, valign: Gtk.Align.START });
    const identity = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, hexpand: true });
    const title = new Gtk.Label({ label: item.name, use_markup: false, xalign: 0, wrap: true, selectable: true });
    title.add_css_class('title-1');
    const author = new Gtk.Label({ label: item.creator ? `By ${item.creator}` : '',
        use_markup: false, xalign: 0, wrap: true, visible: Boolean(item.creator) });
    author.add_css_class('dim-label');
    identity.append(title); identity.append(author);
    const action = new Gtk.Button({ valign: Gtk.Align.CENTER });
    hero.append(icon); hero.append(identity); hero.append(action); body.append(hero);
    const preview = new Gtk.Picture({ visible: false, can_shrink: true, content_fit: Gtk.ContentFit.CONTAIN });
    const previewOverlay = new Gtk.Overlay({ child: preview, visible: false });
    const expand = new Gtk.Button({ icon_name: 'pip-out-symbolic', tooltip_text: 'Enlarge Screenshot', visible: false,
        halign: Gtk.Align.END, valign: Gtk.Align.END, margin_end: 12, margin_bottom: 12 });
    expand.add_css_class('osd'); expand.add_css_class('circular');
    previewOverlay.add_overlay(expand); body.append(previewOverlay);
    previewOverlay.connect('get-child-position', (_overlay, child, allocation) => {
        if (child !== expand || !preview.paintable) return false;
        const width = previewOverlay.get_width(); const height = previewOverlay.get_height();
        const imageWidth = preview.paintable.get_intrinsic_width(); const imageHeight = preview.paintable.get_intrinsic_height();
        if (imageWidth <= 0 || imageHeight <= 0) return false;
        const scale = Math.min(width / imageWidth, height / imageHeight);
        const buttonWidth = expand.measure(Gtk.Orientation.HORIZONTAL, -1)[1];
        const buttonHeight = expand.measure(Gtk.Orientation.VERTICAL, buttonWidth)[1];
        allocation.width = buttonWidth; allocation.height = buttonHeight;
        allocation.x = Math.max(0, Math.round((width + imageWidth * scale) / 2 - buttonWidth));
        allocation.y = Math.max(0, Math.round((height + imageHeight * scale) / 2 - buttonHeight));
        return true;
    });
    const descriptionHeading = new Gtk.Label({ label: 'Description', xalign: 0 });
    descriptionHeading.add_css_class('heading');
    const description = new Gtk.Label({ label: item.description ?? '', use_markup: false, xalign: 0,
        wrap: true, selectable: true });
    body.append(descriptionHeading); body.append(description);
    const metrics = new Gtk.Box({ homogeneous: true, overflow: Gtk.Overflow.HIDDEN });
    metrics.add_css_class('card'); metrics.add_css_class('monge-details-metrics');
    const downloads = new Adw.ActionRow({ title: 'Downloads', visible: false, use_markup: false });
    const version = new Adw.ActionRow({ title: 'Version', use_markup: false, subtitle_lines: 0 });
    const sessionModes = new Adw.ActionRow({ title: 'Session Modes', visible: false, use_markup: false, subtitle_lines: 0 });
    const metricRows = [downloads, version, sessionModes];
    const metricIcons = ['folder-download-symbolic', 'monge-hash-symbolic', 'video-display-symbolic'];
    const metricLists = metricRows.map((row, index) => {
        row.add_css_class('property');
        row.add_prefix(new Gtk.Image({ icon_name: metricIcons[index] }));
        const list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
        list.append(row); metrics.append(list); return list;
    });
    body.append(metrics);
    const information = { widget: metrics };

    const links = new Adw.PreferencesGroup({ title: 'Links' });
    body.append(links);
    const reviews = createExtensionReviews({ catalog }); body.append(reviews.widget);

    const status = new Gtk.Label({ xalign: 0, wrap: true }); status.add_css_class('dim-label');
    const retry = new Gtk.Button({ label: 'Retry', halign: Gtk.Align.START, visible: false });
    body.append(status); body.append(retry);
    const widget = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true,
        child: new Adw.Clamp({ maximum_size: 720, child: body }) });
    let stopped = false;
    let started = false;
    let request = null;
    let online = null;
    let isInstalled = initiallyInstalled;
    let installing = false;
    let removing = false;
    let removalDialog = null;
    let loading = Promise.resolve();
    let imagePage = null;
    let imagePicture = null;
    let imagePoppedSignal = 0;
    function clearImage() {
        const page = imagePage; imagePage = null;
        if (imagePoppedSignal) { navigation.disconnect(imagePoppedSignal); imagePoppedSignal = 0; }
        if (page?.get_parent() === navigation) navigation.remove(page);
        if (imagePicture) imagePicture.paintable = null;
        imagePicture = null;
    }
    function closeImage() {
        if (!imagePage) return false;
        if (navigation.get_visible_page() === imagePage) navigation.pop();
        clearImage();
        return true;
    }
    expand.connect('clicked', () => {
        if (stopped || !preview.paintable || !widget.get_root() || !navigation || imagePage) return;
        const picture = new Gtk.Picture({ paintable: preview.paintable, can_shrink: true,
            content_fit: Gtk.ContentFit.CONTAIN, hexpand: true, vexpand: true });
        const toolbar = new Adw.ToolbarView({ content: picture });
        toolbar.add_top_bar(new Adw.HeaderBar({ title_widget: new Adw.WindowTitle({ title: item.name }) }));
        imagePage = new Adw.NavigationPage({ title: item.name, child: toolbar });
        imagePicture = picture;
        imagePoppedSignal = navigation.connect('popped', (_navigation, page) => {
            if (page !== imagePage) return;
            clearImage(); expand.grab_focus();
        });
        navigation.push(imagePage);
    });
    const linkRows = [];
    function updateLinks() {
        for (const row of linkRows) links.remove(row);
        linkRows.length = 0;
        for (const [label, uri, iconName] of [['Homepage', online?.homepage ?? item.url, 'go-home-symbolic'],
            ['View on Extensions', online?.website ?? item.website, 'web-browser-symbolic']]) {
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
    function update(value, installedNow = isInstalled) {
        item = value;
        isInstalled = installedNow;
        title.label = item.name;
        description.label = online?.description ?? item.description ?? '';
        const available = Number.isSafeInteger(online?.version) && online.version > 0 ? online.version : null;
        const localVersion = isInstalled && item.version != null ? String(item.version) : null;
        version.subtitle = available != null && localVersion != null && String(available) !== localVersion ?
            `${localVersion} (newer available: ${available})` : String(available ?? localVersion ?? '');
        version.visible = Boolean(version.subtitle);
        version.tooltip_text = available == null ? 'Installed version' : localVersion == null ? 'Latest compatible version' :
            'Available is the latest version compatible with this GNOME Shell';
        const modes = isInstalled && Array.isArray(item.sessionModes) ? item.sessionModes : online?.sessionModes;
        const modeLabels = { 'unlock-dialog': 'Unlock Dialog', gdm: 'GDM' };
        sessionModes.subtitle = Array.isArray(modes) ? [...new Set(modes)]
            .filter(mode => Object.hasOwn(modeLabels, mode)).map(mode => modeLabels[mode]).join(', ') : '';
        sessionModes.visible = Boolean(sessionModes.subtitle);
        action.label = isInstalled ? 'Remove…' : installing ? 'Installing…' : 'Install…';
        action.sensitive = !installing && !removing && !stopped && (isInstalled ? Boolean(onRemove) && canRemove() :
            available != null && Boolean(onInstall) && canInstall());
        action.remove_css_class('destructive-action'); action.remove_css_class('suggested-action');
        action.add_css_class(isInstalled ? 'destructive-action' : 'suggested-action');
        action.tooltip_text = isInstalled && !canRemove() ? 'This extension cannot be removed from this account' : null;
        let visibleMetrics = 0;
        metricLists.forEach((list, index) => {
            list.visible = metricRows[index].visible;
            if (list.visible && visibleMetrics > 0) list.add_css_class('metric-separator'); else list.remove_css_class('metric-separator');
            if (list.visible) visibleMetrics++;
        });
        metrics.visible = visibleMetrics > 0;
        updateLinks();
    }
    action.connect('clicked', async () => {
        if (!action.sensitive || installing || removing || stopped) return;
        if (isInstalled) {
            if (!widget.get_root()) return;
            const uuid = item.uuid;
            removing = true; update(item);
            const dialog = new Adw.AlertDialog({ heading: `Remove “${item.name}”?`, heading_use_markup: false,
                body: 'This removes the extension from this account.', body_use_markup: false,
                default_response: 'cancel', close_response: 'cancel' });
            dialog.add_response('cancel', 'Cancel'); dialog.add_response('remove', 'Remove');
            dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
            removalDialog = dialog;
            const closed = new Promise(resolve => dialog.connect('closed', () => { if (removalDialog === dialog) removalDialog = null; resolve(); }));
            try {
                const response = await new Promise((resolve, reject) => dialog.choose(widget, null, (_dialog, result) => {
                    try { resolve(dialog.choose_finish(result)); } catch (error) { reject(error); }
                }));
                await closed;
                if (response === 'remove' && !stopped && isInstalled && item.uuid === uuid && canRemove() && await onRemove(uuid) && !stopped && item.uuid === uuid)
                    update(item, false);
            } catch (error) { if (!stopped) status.label = `Removal failed: ${error.message}`; }
            finally { removing = false; if (!stopped) update(item); }
            return;
        }
        installing = true; status.label = ''; update(item);
        try {
            const result = await onInstall(item.uuid);
            if (stopped) return;
            if (result) {
                if (result.uuid !== item.uuid) throw new Error('Installed extension identity does not match');
                update(result, true);
            }
        } catch (error) {
            if (!stopped) status.label = `Installation failed: ${error.message}`;
        } finally {
            installing = false;
            if (!stopped) update(item);
        }
    });
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
            if ((!isInstalled || !Array.isArray(item.sessionModes)) && result.version != null && catalog.sessionModes) {
                try {
                    const modes = await catalog.sessionModes({ uuid: item.uuid, version: result.version, cancellable });
                    if (stopped || request !== cancellable) return;
                    online.sessionModes = modes; update(item);
                } catch (_error) {
                    if (stopped || request !== cancellable) return;
                }
            }
            for (const [path, apply] of [[result.icon, value => { icon.paintable = value; }],
                [result.screenshot, value => {
                    preview.paintable = value;
                    preview.height_request = Math.min(420, value.get_height());
                    preview.visible = true;
                    previewOverlay.visible = true; expand.visible = true;
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
                status.label = isInstalled ? 'Additional details could not be loaded. Installed information is still available.' :
                    'Additional details could not be loaded. Try again to check compatibility.';
                retry.visible = true;
                reviews.load(null);
            }
        } finally { if (request === cancellable) request = null; }
    }
    retry.connect('clicked', start);
    update(item);
    return { widget, information, title, author, action, description, metrics, links, reviews, downloads, version, sessionModes, preview, expand, retry,
        get imagePage() { return imagePage; }, closeImage,
        get removalDialog() { return removalDialog; },
        start, update, stop() { stopped = true; removalDialog?.force_close(); removalDialog = null; closeImage();
            request?.cancel(); request = null; reviews.stop(); } };
}
