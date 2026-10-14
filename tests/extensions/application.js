import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function stable(window) {
    let last = ''; let same = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
        await delay(20);
        const size = `${window.get_width()},${window.get_height()}`;
        same = size === last && window.get_width() > 0 ? same + 1 : 0; last = size;
        if (same >= 5) return;
    }
    throw new Error('Native Settings allocation did not stabilize');
}
function snapshot(window, name) {
    const output = GLib.getenv('MONGE_SCREENSHOT_DIR'); if (!output) return;
    const paintable = new Gtk.WidgetPaintable({ widget: window }); const shot = new Gtk.Snapshot();
    paintable.snapshot(shot, window.get_width(), window.get_height());
    if (!window.get_renderer().render_texture(shot.to_node(), null).save_to_png(`${output}/${name}.png`))
        throw new Error('Could not capture the actual Settings window');
}
export async function run(controller) {
    const window = controller.window;
    Gtk.Settings.get_default().gtk_enable_animations = false;
    const checks = [];
    const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
    const file = Gio.File.new_for_path(GLib.getenv('MONGE_SETTINGS_RESULT'));
    try {
        const schemas = Gio.SettingsSchemaSource.get_default();
        for (const id of ['org.freedesktop.ColorHelper', 'org.gnome.settings-daemon.plugins.color'])
            check(Boolean(schemas.lookup(id, true)), `Color Management runtime schema is available: ${id}`);
        await stable(window);
        check(GObject.type_name_from_instance(window) === 'CcWindow', 'actual native GNOME Settings CcWindow');
        check(window instanceof Adw.PreferencesWindow, 'real native preferences-window root');
        check(window.get_application().get_application_id() === 'org.monge.Settings.Development', 'isolated development application identity');
        check(controller.current?.panel.get_name() === 'monge-extensions-panel', 'registered Extensions section');
        const iconTheme = Gtk.IconTheme.get_for_display(window.get_display());
        for (const name of ['globe-alt2-symbolic', 'monge-extensions-outline-symbolic', 'pip-out-symbolic', 'monge-hash-symbolic']) {
            check(iconTheme.has_icon(name), `bundled extension icon is available: ${name}`);
            const icon = iconTheme.lookup_icon(name, null, 16, 1, Gtk.TextDirection.NONE, Gtk.IconLookupFlags.FORCE_SYMBOLIC);
            check(icon.get_file().get_uri().startsWith('resource:///org/gnome/Settings/icons/'), `extension icon is bundled independently of the host theme: ${name}`);
        }
        check(controller.current.viewStack.get_page(controller.current.browse.widget).icon_name === 'globe-alt2-symbolic',
            'Browse uses the requested globe icon');
        check(controller.current.viewStack.get_pages().get_n_items() === 2, 'Installed and Browse tabs');
        check(controller.backend.calls.length === 0 && !window._extension.uuid, 'startup loads no preferences or settings writes');
        check(controller.current.installed.globalSwitch.active, 'global Use Extensions switch');
        check(controller.current.installed.rows.size === 3, 'user and system extension rows');
        const installedRow = controller.current.installed.rows.get('modern@monge.test');
        await controller.current.installed.whenIconsReady();
        check(controller.current.installed.updateCounts.pending === 1 && controller.current.installed.updateCounts.available === 1,
            'pending updates and newer available versions are counted separately');
        check(controller.current.updatesBanner.revealed && controller.current.updatesBanner.title === '1 extension will be updated on next login' &&
            controller.current.viewStack.get_page(controller.current.installed.widget).badge_number === 2,
            'Installed badge and next-login banner reflect real staged-update state');
        controller.current.updatesBanner.emit('button-clicked'); await delay(10);
        check(controller.backend.calls.some(([method, mode]) => method === 'logout' && mode === 0) && window.get_visible(),
            'banner logout requests native confirmation only after explicit interaction');
        check(installedRow._icon.paintable?.get_width() === 32 && installedRow._icon.get_width() === 32,
            'installed extension custom icon is decoded and displayed at Apps size');
        check(controller.current.installed.rows.get('information@monge.test')._icon.icon_name === 'application-x-addon-symbolic',
            'extensions without custom artwork retain the puzzle fallback');
        check(installedRow._icon.icon_size === Gtk.IconSize.LARGE && installedRow._icon.has_css_class('lowres-icon'),
            'installed extension prefix uses the Apps icon geometry');
        check(installedRow instanceof Adw.ActionRow && !(installedRow instanceof Adw.ExpanderRow), 'installed rows have no down-arrow expander');
        check(installedRow._preferences.get_allocation().x > installedRow._toggle.get_allocation().x,
            'preferences arrow is visually after the switch');
        check(installedRow._preferences instanceof Gtk.Image && installedRow.activatable,
            'whole installed row is activatable with a presentation-only arrow');
        installedRow._toggle.active = false;
        await delay(20);
        check(!window._extension.uuid && controller.current.navigation.get_visible_page() === controller.current.landing,
            'individual switch interaction does not enter preferences');
        installedRow._toggle.active = true;
        await delay(20);
        installedRow.emit('activated');
        await controller.idle;
        check(window._extension.uuid === 'modern@monge.test', 'row activation opens the extension preferences');
        check(controller.pageLayout.viewStack.visible_child_name === 'preferences', 'row activation restores Preferences by default');
        check(await controller.back(), 'Back after whole-row activation');
        await stable(window);
        snapshot(window, 'installed');
        const modernUpdate = controller.backend.extensions.find(item => item.uuid === 'modern@monge.test');
        const informationUpdate = controller.backend.extensions.find(item => item.uuid === 'information@monge.test');
        const updateStyle = Adw.StyleManager.get_default(); const updateScheme = updateStyle.color_scheme;
        updateStyle.color_scheme = Adw.ColorScheme.FORCE_DARK; await stable(window); snapshot(window, 'updates-next-login');
        modernUpdate.hasUpdate = false; await controller.backend.refresh();
        check(controller.current.updatesBanner.revealed && controller.current.updatesBanner.title === '2 extension updates available' &&
            controller.current.updatesBanner.button_label === '', 'available-only banner does not claim updates are staged or offer logout');
        const writesBeforeHiddenLogout = controller.backend.calls.length;
        controller.current.updatesBanner.emit('button-clicked'); await delay(10);
        check(controller.backend.calls.length === writesBeforeHiddenLogout, 'unstaged updates never request logout');
        await stable(window); snapshot(window, 'updates-available');
        modernUpdate.version = 31; informationUpdate.version = 31; await controller.backend.refresh();
        check(!controller.current.updatesBanner.revealed && controller.current.viewStack.get_page(controller.current.installed.widget).badge_number === 0 &&
            !controller.current.installed.rows.get('modern@monge.test')._update.visible, 'applied updates clear banner, badge and row indicators');
        modernUpdate.version = 1; informationUpdate.version = 1; modernUpdate.hasUpdate = true; await controller.backend.refresh();
        updateStyle.color_scheme = updateScheme; await stable(window);
        controller.current.viewStack.visible_child_name = 'browse';
        check(!controller.current.updatesBanner.revealed, 'update banner is scoped to the Installed view');
        for (let attempt = 0; attempt < 100 && !controller.current.browse.widget.get_mapped(); attempt++) await delay(20);
        await delay(100);
        const findList = widget => {
            if (widget instanceof Gtk.ListBox && widget.get_name() === 'browse-results') return widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) { const found = findList(child); if (found) return found; }
            return null;
        };
        const catalogList = findList(controller.current.browse.widget);
        check(Boolean(catalogList?.get_row_at_index(0)), 'Browse renders catalog rows');
        const originalSize = window.get_default_size();
        window.set_default_size(1500, originalSize[1]); await stable(window);
        check(catalogList.get_width() <= 720, 'Browse remains clamped in a wide Settings window');
        snapshot(window, 'browse-wide');
        window.set_default_size(...originalSize); await stable(window);
        snapshot(window, 'browse');
        const style = Adw.StyleManager.get_default(); const originalScheme = style.color_scheme;
        style.color_scheme = Adw.ColorScheme.FORCE_DARK; await stable(window); snapshot(window, 'browse-dark');
        const browseAdjustment = controller.current.browse.widget.get_vadjustment();
        browseAdjustment.value = browseAdjustment.upper - browseAdjustment.page_size;
        await delay(100); snapshot(window, 'browse-more-dark');
        browseAdjustment.value = 0; style.color_scheme = originalScheme; await stable(window);
        const rowInstall = catalogList.get_row_at_index(1)._install;
        rowInstall.emit('clicked');
        for (let attempt = 0; attempt < 100 && rowInstall.label !== 'Installed'; attempt++) await delay(10);
        check(rowInstall.label === 'Installed' && controller.backend.extensions.some(item => item.uuid === 'catalog-row@monge.test'),
            'Browse row installation updates verified installed state');
        check(controller.current.navigation.get_visible_page() === controller.current.landing, 'row Install remains independent of Details navigation');
        const findMore = widget => {
            if (widget.get_name() === 'browse-more') return widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) { const found = findMore(child); if (found) return found; }
            return null;
        };
        const firstCatalogRow = catalogList.get_row_at_index(0);
        const moreResults = findMore(controller.current.browse.widget);
        const findSearch = widget => {
            if (widget.get_name() === 'browse-search') return widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) { const found = findSearch(child); if (found) return found; }
            return null;
        };
        check(catalogList.get_width() === findSearch(controller.current.browse.widget).get_parent().get_width() &&
            moreResults.get_parent().get_width() === catalogList.get_width(), 'search, catalog cards and Load More have the same allocated width');
        moreResults.emit('activated');
        for (let attempt = 0; attempt < 100 && moreResults.get_parent().visible; attempt++) await delay(10);
        check(catalogList.get_row_at_index(0) === firstCatalogRow && catalogList.get_row_at_index(8)?._catalogItem.uuid === 'catalog-more@monge.test',
            'Load More appends unique results while retaining existing rows');
        check(controller.current.browse.widget instanceof Gtk.ScrolledWindow &&
            controller.current.browse.widget.get_vadjustment().upper > controller.current.browse.widget.get_vadjustment().page_size,
            'catalog scrollbar belongs to the main Browse view');
        catalogList.emit('row-activated', catalogList.get_row_at_index(0));
        await controller.current.catalogDetailsView.start();
        check(controller.current.catalogDetailsView.preview.visible && controller.current.catalogDetailsView.reviews.cards.length === 2,
            'Browse reuses the rich Details component with screenshot and reviews');
        check(controller.current.catalogDetailsView.action.label === 'Install…' && controller.current.catalogDetailsView.action.sensitive,
            'uninstalled compatible catalog details expose Install');
        const findHeader = widget => {
            if (widget instanceof Adw.HeaderBar) return widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) { const found = findHeader(child); if (found) return found; }
            return null;
        };
        const catalogHeader = findHeader(controller.current.details);
        check(catalogHeader?.title_widget instanceof Adw.WindowTitle &&
            catalogHeader.title_widget.subtitle === 'catalog@monge.test', 'catalog Details header includes the extension UUID');
        await stable(window); snapshot(window, 'catalog-details');
        const screenshotDetails = controller.current.catalogDetailsView;
        const inlinePreview = screenshotDetails.preview;
        const [hasExpandBounds, expandBounds] = screenshotDetails.expand.compute_bounds(inlinePreview);
        const previewScale = Math.min(inlinePreview.get_width() / inlinePreview.paintable.get_width(),
            inlinePreview.get_height() / inlinePreview.paintable.get_height());
        check(hasExpandBounds && expandBounds.get_x() + expandBounds.get_width() <=
            (inlinePreview.get_width() + inlinePreview.paintable.get_width() * previewScale) / 2,
            'expand control stays inside the painted screenshot rather than its letterbox');
        screenshotDetails.expand.emit('clicked'); await delay(100);
        check(screenshotDetails.imagePage instanceof Adw.NavigationPage &&
            controller.current.navigation.get_visible_page() === screenshotDetails.imagePage && !window.get_visible_dialog(),
            'screenshot expansion uses an in-pane navigation page instead of a whole-window dialog');
        const screenshotSize = window.get_default_size();
        window.set_default_size(1886, 1028); await stable(window);
        const enlargedPicture = screenshotDetails.imagePage.child.content;
        check(enlargedPicture.get_width() === controller.current.navigation.get_width(),
            'enlarged screenshot fills the available main-pane width without a fixed dialog limit');
        for (const [width, height] of [[320, 160], [160, 320], [320, 213]]) {
            const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, width, height);
            image.fill(0x7799bbff); enlargedPicture.paintable = Gdk.Texture.new_for_pixbuf(image);
            await delay(50);
            const rendered = new Gtk.Snapshot();
            new Gtk.WidgetPaintable({ widget: enlargedPicture }).snapshot(rendered, enlargedPicture.get_width(), enlargedPicture.get_height());
            const painted = rendered.to_node().get_bounds();
            const scale = Math.min(enlargedPicture.get_width() / width, enlargedPicture.get_height() / height);
            check(Math.abs(painted.get_width() - width * scale) <= 1 && Math.abs(painted.get_height() - height * scale) <= 1,
                `enlarged ${width}×${height} screenshot fits the pane without stretching or cropping`);
            check(Math.abs(painted.get_x() + painted.get_width() / 2 - enlargedPicture.get_width() / 2) <= 1 &&
                Math.abs(painted.get_y() + painted.get_height() / 2 - enlargedPicture.get_height() / 2) <= 1,
                `painted ${width}×${height} screenshot is centered on both axes`);
        }
        enlargedPicture.paintable = inlinePreview.paintable; await delay(50);
        snapshot(window, 'screenshot-expanded');
        check(await controller.back(), 'Back closes only the enlarged screenshot'); await delay(100);
        check(!enlargedPicture.paintable, 'closing the viewer releases its screenshot paintable');
        window.set_default_size(...screenshotSize); await stable(window);
        check(!screenshotDetails.imagePage && screenshotDetails.preview.get_root() === window &&
            controller.current.catalogDetailsView === screenshotDetails && controller.current.navigation.get_visible_page() === controller.current.details,
            'closing screenshot enlargement retains the inline preview and Settings root');
        controller.current.catalogDetailsView.action.emit('clicked');
        for (let attempt = 0; attempt < 100 && controller.current.catalogDetailsView.action.label !== 'Remove…'; attempt++) await delay(10);
        check(controller.backend.extensions.some(item => item.uuid === 'catalog@monge.test') &&
            controller.current.catalogDetailsView.version.subtitle === '31', 'matching installed and available catalog versions share one value');
        check(controller.current.installed.rows.has('catalog@monge.test'), 'installation refreshes the Installed rows without reopening Settings');
        check(!controller.current.catalogPendingBanner.revealed, 'catalog page does not show a pending banner for an ordinary installation');
        const installedCatalog = controller.backend.extensions.find(item => item.uuid === 'catalog@monge.test');
        installedCatalog.hasUpdate = true; await controller.backend.refresh();
        check(controller.current.catalogPendingBanner.revealed, 'catalog Details shows the banner when the installed extension gains a pending update');
        installedCatalog.hasUpdate = false; await controller.backend.refresh();
        check(!controller.current.catalogPendingBanner.revealed, 'catalog pending banner follows live installed state');
        check(controller.current.navigation.get_visible_page() === controller.current.details && !window._extension.uuid,
            'Browse details use in-window navigation without loading preferences');
        check(await controller.back() && controller.current.viewStack.visible_child_name === 'browse', 'Back from catalog details restores Browse');
        catalogList.emit('row-activated', catalogList.get_row_at_index(0));
        check(controller.current.navigation.get_visible_page() === controller.current.details, 'same catalog item can be reopened after Back');
        check(controller.current.catalogDetailsView.action.label === 'Remove…', 'reopened Browse details reflect an installed catalog extension');
        const retiringCatalogDetails = controller.current.catalogDetailsView;
        let catalogStops = 0; const originalStop = retiringCatalogDetails.stop;
        retiringCatalogDetails.stop = () => { catalogStops++; originalStop(); };
        const findNativeBack = widget => {
            if (widget instanceof Gtk.Button && widget.get_action_name() === 'navigation.pop') return widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
                const found = findNativeBack(child); if (found) return found;
            }
            return null;
        };
        const nativeBack = findNativeBack(controller.current.details);
        check(Boolean(nativeBack), 'catalog Details exposes its native header Back button');
        await retiringCatalogDetails.start(); await stable(window);
        retiringCatalogDetails.expand.emit('clicked'); await delay(100);
        const reopenedImage = retiringCatalogDetails.imagePage.child.content;
        const imageBack = findNativeBack(retiringCatalogDetails.imagePage);
        check(Boolean(imageBack), 'screenshot viewer exposes the native header Back button');
        imageBack.emit('clicked'); await delay(100);
        check(!retiringCatalogDetails.imagePage && !reopenedImage.paintable && catalogStops === 0 &&
            controller.current.navigation.get_visible_page() === controller.current.details,
            'native screenshot Back preserves catalog Details and releases only the viewer');
        nativeBack.emit('clicked'); await delay(20);
        check(controller.current.navigation.get_visible_page() === controller.current.landing &&
            controller.current.catalogDetailsView === null && catalogStops === 1, 'native catalog Back retires the Details resources');
        controller.current.viewStack.visible_child_name = 'installed';
        const surface = window.get_surface(); const size = window.get_default_size().join(',');
        check(await controller.select('information@monge.test'), 'extension without preferences opens information');
        check(controller.pageLayout.viewStack.visible_child_name === 'details' && !window._extension.uuid,
            'information-only extension loads no preferences code');
        check(!controller.pageLayout.pendingBanner.revealed, 'available-only extension has no pending-update page banner');
        check(window.title === 'Information Only', 'information-only header shows the extension name');
        check(controller.current.information.widget.get_root() === window, 'information-only page uses native Settings root');
        check(controller.viewState.get() === 'preferences', 'Details-only extensions do not overwrite the remembered Preferences view');
        await stable(window); snapshot(window, 'information');
        check(await controller.back() && !window.visible_page, 'Back removes information-only page');
        check(await controller.select('modern@monge.test'), 'modern native preferences loaded');
        check(controller.pageLayout.pendingBanner.revealed && controller.pageLayout.pendingBanner.get_root() === window &&
            controller.pageLayout.pendingBanner.get_parent() === controller.pageLayout.viewStack.get_parent(),
            'pending update banner is above the shared Details/Preferences content');
        const pageLogoutCount = controller.backend.calls.filter(([method]) => method === 'logout').length;
        controller.pageLayout.pendingBanner.emit('button-clicked'); await delay(10);
        check(controller.backend.calls.filter(([method]) => method === 'logout').length === pageLogoutCount + 1,
            'extension page logout uses the same explicit native confirmation request');
        const preferences = window._extension.stateObj;
        check(window.visible_page.get_root() === window, 'native preferences rooted in actual Settings');
        check(controller.current.navigation.get_visible_page() === controller.current.preferencesPage, 'preferences are an in-window navigation page');
        check(!window.modal && window.get_surface() === surface, 'no separate modal or replacement surface');
        const information = controller.current.information.widget;
        check(information.get_root() === window && information.is_ancestor(controller.pageLayout.details),
            'extension information belongs to Details, separate from native settings');
        check(controller.pageLayout.inlineSwitcher instanceof Adw.InlineViewSwitcher &&
            controller.pageLayout.inlineSwitcher.stack.get_pages().get_n_items() === 3,
            'Layout, Colors and Profiles use the native inline switcher');
        await stable(window);
        const extensionHeader = controller.pageLayout.header.title_widget;
        check(extensionHeader instanceof Adw.WindowTitle && extensionHeader.title === 'Example Extension' &&
            extensionHeader.subtitle === 'modern@monge.test', 'extension header displays name above UUID');
        const headerBounds = widget => {
            const [valid, bounds] = widget.compute_bounds(window);
            check(valid, 'extension header widget has native bounds'); return bounds;
        };
        const identityBounds = headerBounds(extensionHeader);
        const outerBounds = headerBounds(controller.pageLayout.switcher);
        const inlineBounds = headerBounds(controller.pageLayout.inlineSwitcher);
        check(identityBounds.get_y() + identityBounds.get_height() <= outerBounds.get_y() &&
            outerBounds.get_y() + outerBounds.get_height() <= inlineBounds.get_y(),
            'fixed extension header orders identity, Details/Preferences and native preferences tabs');
        check(controller.pageLayout.preferences.get_first_child() === controller.pageLayout.originalContent,
            'preferences body is unchanged without the extra Preferences heading');
        snapshot(window, 'preferences-header');
        controller.pageLayout.inlineSwitcher.stack.visible_child_name = 'colors';
        const selectedPage = window.visible_page;
        controller.pageLayout.viewStack.visible_child_name = 'details';
        await controller.current.detailsView.start();
        check(controller.pageLayout.pendingBanner.revealed, 'pending update banner remains visible on Details');
        await delay(50);
        check(!preferences.closed && window._extension.stateObj === preferences && window.visible_page === selectedPage,
            'Details selection retains the loaded extension and its current preferences page');
        await stable(window);
        check(controller.current.detailsView.preview.get_allocated_height() > 0,
            'the decoded screenshot occupies visible space instead of collapsing in the scrolling page');
        snapshot(window, 'details');
        const installedScreenshot = controller.current.detailsView;
        installedScreenshot.expand.emit('clicked'); await delay(100);
        check(installedScreenshot.imagePage.child.content.get_width() === controller.current.navigation.get_width() &&
            !preferences.closed && window._extension.stateObj === preferences,
            'installed screenshot fills the main pane without retiring native preferences');
        check(await controller.back() && !installedScreenshot.imagePage && !preferences.closed && window.visible_page === selectedPage &&
            controller.pageLayout.viewStack.visible_child_name === 'details',
            'Back from the installed screenshot restores Details with its native session intact');
        const headerBeforeScroll = headerBounds(extensionHeader).get_y();
        const tabsBeforeScroll = headerBounds(controller.pageLayout.switcher).get_y();
        const detailsAdjustment = controller.current.detailsView.widget.get_vadjustment();
        detailsAdjustment.value = detailsAdjustment.upper - detailsAdjustment.page_size;
        await delay(100);
        check(detailsAdjustment.value > 0 && extensionHeader.get_mapped() &&
            headerBounds(extensionHeader).get_y() === headerBeforeScroll &&
            headerBounds(controller.pageLayout.switcher).get_y() === tabsBeforeScroll,
            'extension identity and view switcher remain visible while Details scrolls');
        check(!controller.pageLayout.inlineSwitcher.visible, 'Details hides the native preferences sub-switcher');
        snapshot(window, 'details-header-scrolled');
        detailsAdjustment.value = 0;
        controller.pageLayout.viewStack.visible_child_name = 'preferences';
        check(window.visible_page === selectedPage && window.get_surface() === surface,
            'Preferences selection returns to the same native page and surface');
        check(controller.pageLayout.pendingBanner.revealed, 'pending update banner remains visible on Preferences');
        const selectedUpdate = controller.backend.extensions.find(item => item.uuid === 'modern@monge.test');
        selectedUpdate.hasUpdate = false; await controller.backend.refresh();
        check(!controller.pageLayout.pendingBanner.revealed && !preferences.closed, 'live pending-update removal hides the banner without retiring preferences');
        selectedUpdate.hasUpdate = true; await controller.backend.refresh();
        check(controller.pageLayout.pendingBanner.revealed, 'live pending-update addition reveals the extension banner');
        check(controller.current.detailsView.author.label === 'By Example Author' &&
            controller.current.detailsView.downloads.subtitle === '1,234', 'Details shows catalog author and downloads');
        const modern = controller.backend.extensions.find(item => item.uuid === 'modern@monge.test');
        modern.version = 42;
        await controller.backend.refresh();

        check(controller.current.detailsView.version.subtitle === '42 (newer available: 31)',
            'different catalog and installed versions share one explicitly labelled value');
        const detailsView = controller.current.detailsView;
        check(detailsView.action instanceof Gtk.Button && detailsView.action.sensitive && detailsView.action.label === 'Remove…' &&
            detailsView.action.has_css_class('destructive-action'), 'installed user extensions have a red Remove action');
        check(detailsView.information.widget === detailsView.metrics && detailsView.metrics.has_css_class('card') &&
            !('localMetrics' in detailsView) && !('state' in detailsView) && !('installedVersion' in detailsView),
            'one statistics card has no Information heading or separate local-state/version rows');
        check(detailsView.version.title === 'Version', 'the combined version column is labelled Version');
        check(detailsView.sessionModes.title === 'Session Modes' && detailsView.sessionModes.subtitle === 'Unlock Dialog' &&
            detailsView.sessionModes.visible, 'Details shows the installed extension extra session modes');
        const versionImages = [];
        const collectImages = widget => {
            if (widget instanceof Gtk.Image) versionImages.push(widget);
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) collectImages(child);
        };
        collectImages(detailsView.version);
        check(versionImages.some(image => image.icon_name === 'monge-hash-symbolic'), 'Version uses the custom hash icon without an exclamation mark');
        controller.pageLayout.viewStack.visible_child_name = 'details'; await stable(window);
        check(detailsView.sessionModes.get_mapped() && detailsView.sessionModes.get_width() > 0 &&
            detailsView.version.get_parent().has_css_class('metric-separator') &&
            detailsView.sessionModes.get_parent().has_css_class('metric-separator'),
            'three allocated statistics cells have separators before Version and Session Modes');
        const versionImage = versionImages.find(image => image.icon_name === 'monge-hash-symbolic');
        const iconSnapshot = new Gtk.Snapshot();
        new Gtk.WidgetPaintable({ widget: versionImage }).snapshot(iconSnapshot, 16, 16);
        const iconNode = iconSnapshot.to_node();
        check(Boolean(iconNode), 'the themed Version hash icon produces rendered content');
        const iconCapture = `${GLib.getenv('MONGE_SCREENSHOT_DIR')}/version-icon.png`;
        check(window.get_renderer().render_texture(iconNode, null).save_to_png(iconCapture), 'capture the actual themed Version icon');
        const iconPixels = GdkPixbuf.Pixbuf.new_from_file(iconCapture);
        const pixels = iconPixels.get_pixels(); let visiblePixels = 0;
        for (let y = 0; y < iconPixels.get_height(); y++) for (let x = 0; x < iconPixels.get_width(); x++)
            if (pixels[y * iconPixels.get_rowstride() + x * iconPixels.get_n_channels() + 3] > 0) visiblePixels++;
        check(visiblePixels > 0, 'the Version hash icon is not fully transparent after symbolic recoloring');
        check(detailsView.metrics.orientation === Gtk.Orientation.HORIZONTAL &&
            detailsView.downloads.has_css_class('property') && detailsView.version.has_css_class('property'),
            'split statistics emphasize the values');
        check(detailsView.preview.visible && detailsView.preview.paintable.get_width() === 320,
            'Details has a decoded extension screenshot');
        check(detailsView.reviews.cards.length === 2 && detailsView.reviews.cards[0].rating.label === '★★★★★',
            'Details contains read-only reviews, ratings and dates');
        controller.pageLayout.viewStack.visible_child_name = 'details';
        await stable(window); snapshot(window, 'details-version-different');
        modern.version = 31; await controller.backend.refresh();
        check(detailsView.version.subtitle === '31', 'live matching versions collapse to a single value');
        await stable(window); snapshot(window, 'details-version-matched');
        modern.version = 42; await controller.backend.refresh();
        controller.pageLayout.viewStack.visible_child_name = 'preferences';
        await stable(window); snapshot(window, 'preferences');
        check(window.get_default_size().join(',') === size, 'preferences preserve Settings geometry');
        check(!window.search_enabled, 'preferences retain the Settings-style header without a search button');
        window.push_subpage(new Adw.NavigationPage({ title: 'Native Subpage', child: new Gtk.Label({ label: 'Subpage' }) }));
        check(await controller.back() && window._extension.uuid === 'modern@monge.test' && !preferences.closed,
            'Back from a native preferences subpage keeps its extension session');
        const legacySubpage = new Gtk.Label({ label: 'Legacy Subpage' });
        window.present_subpage(legacySubpage);
        check(await controller.back() && window._extension.uuid === 'modern@monge.test' && !preferences.closed,
            'Back from a legacy preferences subpage keeps its extension session');
        check(await controller.back() && preferences.closed, 'Back delivers native close-request cleanup');
        check(!controller.pageLayout.pendingBanner.revealed, 'Back clears the extension-specific pending banner');
        check(controller.current.navigation.get_visible_page() === controller.current.landing, 'Back restores Installed');
        check(await controller.select('legacy@monge.test'), 'legacy native preferences loaded');
        check(!controller.current.detailsView.action.sensitive && controller.current.detailsView.action.label === 'Remove…',
            'system-packaged extensions keep a disabled Remove action');
        check(!controller.pageLayout.pendingBanner.revealed, 'switching to a non-pending extension does not retain the banner');
        check(window.visible_page.get_root() === window && window.get_surface() === surface, 'legacy preferences use same actual window');
        check(controller.current.information.widget.is_ancestor(controller.pageLayout.details) &&
            !controller.pageLayout.inlineSwitcher.visible, 'legacy details are separate and single-page preferences hide the inline switcher');
        check(await controller.back(), 'legacy Back retirement');
        const removalFixture = controller.backend.extensions.find(item => item.uuid === 'modern@monge.test');
        check(await controller.select(removalFixture.uuid), 'open a disposable native preferences fixture for removal');
        const removalPreferences = window._extension.stateObj;
        controller.pageLayout.viewStack.visible_child_name = 'details'; await controller.current.detailsView.start();
        const removalDetails = controller.current.detailsView;
        const findResponse = (widget, label) => {
            if (widget instanceof Gtk.Button && widget.label === label) return widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) { const found = findResponse(child, label); if (found) return found; }
            return null;
        };
        removalDetails.action.emit('clicked'); await delay(30);
        check(removalDetails.removalDialog instanceof Adw.AlertDialog && !removalPreferences.closed,
            'Remove asks for confirmation while keeping native preferences alive');
        await stable(window);
        snapshot(window, 'remove-confirmation');
        findResponse(removalDetails.removalDialog, 'Cancel').emit('clicked'); await delay(30);
        check(controller.backend.extensions.some(item => item.uuid === removalFixture.uuid) && !removalPreferences.closed,
            'cancelling removal preserves the installed extension and preferences');
        const originalRemove = controller.backend.remove;
        controller.backend.remove = async uuid => {
            check(uuid === removalFixture.uuid && removalPreferences.closed && !window._extension.uuid,
                'native close-request cleanup finishes before the removal request');
            return originalRemove.call(controller.backend, uuid);
        };
        removalDetails.action.emit('clicked'); await delay(30);
        findResponse(removalDetails.removalDialog, 'Remove').emit('clicked');
        for (let attempt = 0; attempt < 100 && controller.backend.extensions.some(item => item.uuid === removalFixture.uuid); attempt++) await delay(10);
        await controller.idle; controller.backend.remove = originalRemove;
        check(!controller.backend.extensions.some(item => item.uuid === removalFixture.uuid) &&
            !controller.current.installed.rows.has(removalFixture.uuid) && controller.current.navigation.get_visible_page() === controller.current.landing,
            'confirmed removal returns to Installed and updates the installed rows');
        controller.backend.extensions.push(removalFixture); await controller.backend.refresh();
        check(await controller.select('modern@monge.test'), 'open extension to remember Details');
        controller.pageLayout.viewStack.visible_child_name = 'details';
        check(await controller.back() && await controller.select('modern@monge.test'), 'reopen after selecting Details');
        check(controller.pageLayout.viewStack.visible_child_name === 'details', 'row reopening restores Details when it was last selected');
        controller.pageLayout.viewStack.visible_child_name = 'preferences';
        check(await controller.back() && await controller.select('legacy@monge.test'), 'reopen a different extension after selecting Preferences');
        check(controller.pageLayout.viewStack.visible_child_name === 'preferences', 'row reopening restores Preferences across extensions');
        check(await controller.back(), 'retire remembered-view fixture');
        check(await controller.select('modern@monge.test'), 'modern round trip');
        const veto = window.connect_after('close-request', () => true);
        const removesBeforeVeto = controller.backend.calls.filter(([method]) => method === 'remove').length;
        let removalVetoed = false; try { await controller.remove('modern@monge.test'); } catch { removalVetoed = true; }
        check(removalVetoed && controller.backend.calls.filter(([method]) => method === 'remove').length === removesBeforeVeto &&
            window._extension.uuid === 'modern@monge.test', 'preferences close veto prevents any removal request');
        check(!await controller.back(), 'Back respects native close veto');
        const retainedInformation = controller.current.information.widget;
        check(!await controller.select('legacy@monge.test') && controller.current.information.widget === retainedInformation,
            'veto keeps the previous extension information');
        check(controller.current.navigation.get_visible_page() === controller.current.preferencesPage, 'veto preserves displayed preferences');
        const retainedPanel = controller.current.panel;
        window.get_application().activate_action('launch-panel', new GLib.Variant('(sav)', ['background', []]));
        await controller.idle;
        check(window.active_panel === retainedPanel && window._extension.uuid === 'modern@monge.test',
            'sidebar navigation respects the same native close veto');
        check(!await controller.close() && !controller.closed && window.get_surface() === surface,
            'application close veto keeps the persistent Settings window');
        window.disconnect(veto);
        check(await controller.back(), 'Back after veto removed');
        check(await controller.select('modern@monge.test'), 'section navigation starts with native session');
        const leaving = window._extension.stateObj;
        controller.pageLayout.viewStack.visible_child_name = 'details'; await controller.current.detailsView.start();
        const leavingDetails = controller.current.detailsView;
        leavingDetails.expand.emit('clicked'); await delay(100);
        const leavingPicture = leavingDetails.imagePage.child.content;
        window.get_application().activate_action('launch-panel', new GLib.Variant('(sav)', ['background', []]));
        await controller.idle; await stable(window);
        check(!controller.current && leaving.closed && !window._extension.uuid, 'another actual Settings section retires preferences first');
        check(!leavingDetails.imagePage && !leavingPicture.paintable, 'section navigation retires the enlarged screenshot and its paintable');
        check(window.get_surface() === surface, 'normal Settings navigation keeps same root and surface');
        for (const [section, type] of [['applications', 'CcApplicationsPanel'], ['keyboard', 'CcKeyboardPanel']]) {
            window.get_application().activate_action('launch-panel', new GLib.Variant('(sav)', [section, []]));
            await stable(window);
            check(GObject.type_name_from_instance(window.active_panel) === type && !controller.current && window.active_panel.get_root() === window && window.get_surface() === surface,
                `existing ${section} section retains native Settings root and surface`);
        }
        const descendants = widget => {
            const widgets = [widget];
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
                widgets.push(...descendants(child));
            return widgets;
        };
        const keyboardWidgets = descendants(window.active_panel);
        const keyboardStack = keyboardWidgets.find(widget => widget instanceof Adw.ViewStack);
        const keyboardSwitcher = keyboardWidgets.find(widget => widget instanceof Adw.ViewSwitcher);
        check(Boolean(keyboardStack && keyboardSwitcher?.stack === keyboardStack), 'Keyboard uses a native view switcher');
        check(keyboardStack.get_pages().get_n_items() === 2, 'Keyboard has exactly Input Sources and Keyboard Shortcuts views');
        const inputPage = keyboardStack.get_page(keyboardStack.get_child_by_name('input-sources'));
        const shortcutsPage = keyboardStack.get_page(keyboardStack.get_child_by_name('shortcuts'));
        check(inputPage.title === 'Input Sources' && inputPage.icon_name === 'keyboard-retract-symbolic' &&
            shortcutsPage.title === 'Keyboard Shortcuts' && shortcutsPage.icon_name === 'keyboard-shortcuts-symbolic',
            'Keyboard views use the requested titles and icons');
        for (const name of [inputPage.icon_name, shortcutsPage.icon_name]) {
            const icon = iconTheme.lookup_icon(name, null, 16, 1, Gtk.TextDirection.NONE, Gtk.IconLookupFlags.FORCE_SYMBOLIC);
            check(iconTheme.has_icon(name) && icon.get_file().get_uri().startsWith('resource:///org/gnome/Settings/icons/'),
                `Keyboard icon is bundled independently of the host theme: ${name}`);
        }
        check(keyboardStack.visible_child_name === 'input-sources', 'Keyboard opens on Input Sources');
        check(descendants(inputPage.child).some(widget => widget instanceof Adw.PreferencesGroup && widget.title === 'Special Character Entry'),
            'Special Character Entry stays inside Input Sources');
        check(!keyboardWidgets.some(widget => widget instanceof Adw.PreferencesRow && widget.title.includes('View and Customize')),
            'Keyboard no longer has the modal shortcuts launcher');
        snapshot(window, 'keyboard-input-sources');
        keyboardStack.visible_child_name = 'shortcuts'; await stable(window);
        check(!window.get_visible_dialog() && shortcutsPage.child.get_root() === window, 'Keyboard Shortcuts is an embedded view, not a modal');
        const shortcutsWidgets = descendants(shortcutsPage.child);
        const shortcutsNavigation = shortcutsWidgets.find(widget => widget instanceof Adw.NavigationView);
        const shortcutsSearch = shortcutsWidgets.find(widget => widget instanceof Gtk.SearchEntry);
        const sectionsList = shortcutsWidgets.find(widget => widget instanceof Gtk.ListBox && widget.get_row_at_index(0)?.title === 'Accessibility');
        check(Boolean(shortcutsSearch && sectionsList), 'Embedded shortcuts view exposes search and categories');
        snapshot(window, 'keyboard-shortcuts-view');
        shortcutsSearch.text = 'screenshot'; await delay(300);
        check(descendants(shortcutsPage.child).some(widget => widget instanceof Adw.PreferencesRow && widget.get_mapped() && widget.title.includes('screenshot')),
            'Embedded shortcuts search shows matching actions');
        keyboardStack.visible_child_name = 'input-sources'; await stable(window);
        keyboardStack.visible_child_name = 'shortcuts'; await stable(window);
        check(shortcutsSearch.text === 'screenshot' && !window.get_visible_dialog(), 'Switching Keyboard views preserves shortcut search');
        shortcutsSearch.emit('stop-search'); await delay(300);
        check(shortcutsSearch.text === '', 'Escape clears shortcut search');
        shortcutsSearch.emit('stop-search');
        check(keyboardStack.visible_child_name === 'shortcuts' && !window.get_visible_dialog(), 'Escape on empty search does not close the embedded view');
        const shortcutsMain = shortcutsNavigation.get_visible_page();
        sectionsList.emit('row-activated', sectionsList.get_row_at_index(0)); await stable(window);
        check(shortcutsNavigation.get_visible_page().title === 'Accessibility' && !window.get_visible_dialog(), 'Shortcut categories navigate in the embedded view');
        snapshot(window, 'keyboard-shortcuts-category');
        shortcutsNavigation.pop(); await stable(window);
        check(shortcutsNavigation.get_visible_page() === shortcutsMain, 'Back restores shortcut categories');
        const customRow = descendants(sectionsList).find(widget => widget instanceof Adw.PreferencesRow && widget.title === 'Custom Shortcuts');
        sectionsList.emit('row-activated', customRow); await stable(window);
        const addShortcut = descendants(shortcutsPage.child).find(widget => widget instanceof Gtk.Button && widget.label === '_Add Shortcut…');
        check(addShortcut.get_mapped(), 'Embedded Custom Shortcuts shows the empty-state add action');
        addShortcut.emit('clicked'); await stable(window);
        check(GObject.type_name_from_instance(window.get_visible_dialog()) === 'CcKeyboardShortcutEditor', 'Custom shortcut editing still opens the binding editor');
        window.get_visible_dialog().close(); await delay(100);
        shortcutsNavigation.pop(); await stable(window);
        const keyboardSize = window.get_default_size();
        window.set_default_size(480, keyboardSize[1]); await stable(window);
        const keyboardSwitcherBar = keyboardWidgets.find(widget => widget instanceof Adw.ViewSwitcherBar);
        check(keyboardSwitcherBar.reveal && keyboardSwitcherBar.get_mapped(), 'Narrow Keyboard view exposes the bottom switcher');
        snapshot(window, 'keyboard-shortcuts-narrow');
        window.set_default_size(...keyboardSize); await stable(window);
        window.get_application().activate_action('launch-panel', new GLib.Variant('(sav)', ['extensions', []]));
        await stable(window);
        check(Boolean(controller.current) && window.monge_preferences_content.get_root() === window, 'Extensions can be reopened after native panel destruction');
        check(await controller.select('modern@monge.test'), 'preferences load after reentering Extensions');
        const closing = window._extension.stateObj;
        window.get_application().activate_action('quit', null);
        for (let attempt = 0; attempt < 50 && !controller.closed; attempt++) await delay(20);
        check(controller.closed && closing.closed, 'actual application quit action retires native preferences');
        file.replace_contents(JSON.stringify({ passed: true, checks }, null, 2), null, false, Gio.FileCreateFlags.NONE, null);
        print(`PASS actual GNOME Settings application: ${checks.length} assertions`);
    } catch (error) {
        file.replace_contents(JSON.stringify({ passed: false, checks, error: error.stack ?? error.message }, null, 2), null, false, Gio.FileCreateFlags.NONE, null);
        logError(error); window.get_application().quit();
    }
}
