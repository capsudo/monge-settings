import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
Adw.init();
const assert = (value, message) => { if (!value) throw new Error(message); };
const tick = () => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const { createExtensionPageLayout } = await import('../../panels/extensions/js/extension-page.js');
const window = new Adw.PreferencesWindow({ default_width: 760, default_height: 640 });
const native = window.get_content();
const layout = createExtensionPageLayout(native);
const pages = ['Layout', 'Colors', 'Profiles'].map(title => new Adw.PreferencesPage({ title, name: title.toLowerCase() }));
for (const page of pages) {
    const group = new Adw.PreferencesGroup();
    group.add(new Adw.SwitchRow({ title: `${page.title} option` }));
    page.add(group); window.add(page);
}
window.present(); await tick();
try {
    assert(layout.switcher instanceof Adw.ViewSwitcher, 'Details/Preferences use the header view switcher');
    assert(layout.pendingBanner instanceof Adw.Banner && !layout.pendingBanner.revealed,
        'Extension page owns an initially hidden pending-update banner');
    layout.setPendingUpdate(true);
    assert(layout.pendingBanner.revealed && layout.pendingBanner.button_label === 'Log Out…' &&
        layout.pendingBanner.get_parent() === layout.viewStack.get_parent(), 'Pending banner sits above both tabs, outside their content');
    assert(layout.inlineSwitcher instanceof Adw.InlineViewSwitcher, 'Native page tabs use an inline switcher');
    assert(layout.inlineSwitcher.stack.get_pages().get_n_items() === 3, 'Inline switcher retains all native pages');
    assert(layout.inlineSwitcher.visible, 'Multiple preferences pages show the inline switcher');
    layout.viewStack.visible_child_name = 'preferences';
    layout.inlineSwitcher.stack.visible_child = pages[1];
    assert(window.visible_page === pages[1], 'Inline selection updates native visible_page');
    layout.viewStack.visible_child_name = 'details';
    assert(layout.pendingBanner.revealed && layout.pendingBanner.get_root() === window, 'Pending banner remains visible on Details');
    assert(window.visible_page === pages[1], 'Details does not discard the selected preferences page');
    layout.viewStack.visible_child_name = 'preferences';
    assert(window.visible_page === pages[1] && pages[1].get_root() === window, 'Preferences returns to the same native page and root');
    assert(layout.pendingBanner.revealed, 'Pending banner remains visible on Preferences');
    layout.setPendingUpdate(false);
    assert(!layout.pendingBanner.revealed, 'Non-pending extensions hide the banner');
    for (const page of pages.slice(1)) window.remove(page);
    assert(!layout.inlineSwitcher.visible, 'A single preferences page hides the redundant inline switcher');
    window.push_subpage(new Adw.NavigationPage({ title: 'Native Subpage', child: new Gtk.Label({ label: 'Subpage' }) }));
    assert(window.pop_subpage(), 'Native preferences subpages still work');
    layout.setHasPreferences(false);
    assert(layout.viewStack.visible_child_name === 'details', 'No-preferences extensions show Details');
    assert(!layout.viewStack.get_page(layout.preferences).visible, 'No-preferences extensions hide the Preferences tab');
    print('PASS extension page: two-level navigation, native pages, single-page hiding and subpages');
} finally { layout.stop(); window.destroy(); }
