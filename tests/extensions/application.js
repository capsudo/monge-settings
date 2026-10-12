import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
        check(controller.current.viewStack.get_pages().get_n_items() === 2, 'Installed and Browse tabs');
        check(controller.backend.calls.length === 0 && !window._extension.uuid, 'startup loads no preferences or settings writes');
        check(controller.current.installed.globalSwitch.active, 'global Use Extensions switch');
        check(controller.current.installed.rows.size === 3, 'user and system extension rows');
        const installedRow = controller.current.installed.rows.get('modern@monge.test');
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
        controller.current.viewStack.visible_child_name = 'browse';
        for (let attempt = 0; attempt < 100 && !controller.current.browse.widget.get_mapped(); attempt++) await delay(20);
        await delay(100);
        const findList = widget => {
            if (widget instanceof Gtk.ListBox && widget.get_name() === 'browse-results') return widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) { const found = findList(child); if (found) return found; }
            return null;
        };
        const catalogList = findList(controller.current.browse.widget);
        check(Boolean(catalogList?.get_row_at_index(0)), 'Browse renders catalog rows');
        snapshot(window, 'browse');
        catalogList.select_row(catalogList.get_row_at_index(0));
        check(controller.current.navigation.get_visible_page() === controller.current.details && !window._extension.uuid,
            'Browse details use in-window navigation without loading preferences');
        check(await controller.back() && controller.current.viewStack.visible_child_name === 'browse', 'Back from catalog details restores Browse');
        catalogList.select_row(catalogList.get_row_at_index(0));
        check(controller.current.navigation.get_visible_page() === controller.current.details, 'same catalog item can be reopened after Back');
        check(await controller.back(), 'catalog details second Back');
        controller.current.viewStack.visible_child_name = 'installed';
        const surface = window.get_surface(); const size = window.get_default_size().join(',');
        check(await controller.select('information@monge.test'), 'extension without preferences opens information');
        check(controller.pageLayout.viewStack.visible_child_name === 'details' && !window._extension.uuid,
            'information-only extension loads no preferences code');
        check(window.title === 'Information Only', 'information-only header shows the extension name');
        check(controller.current.information.widget.get_root() === window, 'information-only page uses native Settings root');
        check(controller.viewState.get() === 'preferences', 'Details-only extensions do not overwrite the remembered Preferences view');
        await stable(window); snapshot(window, 'information');
        check(await controller.back() && !window.visible_page, 'Back removes information-only page');
        check(await controller.select('modern@monge.test'), 'modern native preferences loaded');
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
        controller.pageLayout.inlineSwitcher.stack.visible_child_name = 'colors';
        const selectedPage = window.visible_page;
        controller.pageLayout.viewStack.visible_child_name = 'details';
        await controller.current.detailsView.start();
        await delay(50);
        check(!preferences.closed && window._extension.stateObj === preferences && window.visible_page === selectedPage,
            'Details selection retains the loaded extension and its current preferences page');
        await stable(window); snapshot(window, 'details');
        controller.pageLayout.viewStack.visible_child_name = 'preferences';
        check(window.visible_page === selectedPage && window.get_surface() === surface,
            'Preferences selection returns to the same native page and surface');
        check(controller.current.detailsView.author.label === 'By Example Author' &&
            controller.current.detailsView.downloads.subtitle === '1,234', 'Details shows catalog author and downloads');
        const modern = controller.backend.extensions.find(item => item.uuid === 'modern@monge.test');
        modern.version = 42;
        await controller.backend.refresh();

        check(controller.current.detailsView.version.subtitle === '42', 'open extension details update from backend events');
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
        check(controller.current.navigation.get_visible_page() === controller.current.landing, 'Back restores Installed');
        check(await controller.select('legacy@monge.test'), 'legacy native preferences loaded');
        check(window.visible_page.get_root() === window && window.get_surface() === surface, 'legacy preferences use same actual window');
        check(controller.current.information.widget.is_ancestor(controller.pageLayout.details) &&
            !controller.pageLayout.inlineSwitcher.visible, 'legacy details are separate and single-page preferences hide the inline switcher');
        check(await controller.back(), 'legacy Back retirement');
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
        window.get_application().activate_action('launch-panel', new GLib.Variant('(sav)', ['background', []]));
        await controller.idle; await stable(window);
        check(!controller.current && leaving.closed && !window._extension.uuid, 'another actual Settings section retires preferences first');
        check(window.get_surface() === surface, 'normal Settings navigation keeps same root and surface');
        for (const [section, type] of [['applications', 'CcApplicationsPanel'], ['keyboard', 'CcKeyboardPanel']]) {
            window.get_application().activate_action('launch-panel', new GLib.Variant('(sav)', [section, []]));
            await stable(window);
            check(GObject.type_name_from_instance(window.active_panel) === type && !controller.current && window.active_panel.get_root() === window && window.get_surface() === surface,
                `existing ${section} section retains native Settings root and surface`);
        }
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
