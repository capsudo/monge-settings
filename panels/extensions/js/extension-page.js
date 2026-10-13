import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

function find(widget, type) {
    if (widget instanceof type) return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const match = find(child, type);
        if (match) return match;
    }
    return null;
}

export function createPendingUpdateBanner() {
    return new Adw.Banner({ title: 'This extension will be updated on next login', button_label: 'Log Out…',
        button_style: Adw.BannerButtonStyle.SUGGESTED, revealed: false });
}

export function createExtensionPageLayout(native) {
    const nativeSwitcher = find(native, Adw.ViewSwitcher);
    const header = find(native, Adw.HeaderBar);
    const toolbar = header?.get_ancestor(Adw.ToolbarView.$gtype);
    if (!nativeSwitcher?.stack || !toolbar)
        throw new Error('The native preferences layout cannot provide inline page navigation');
    const originalTitle = header.title_widget;
    const originalContent = toolbar.content;
    const nativeBar = find(native, Adw.ViewSwitcherBar);
    if (nativeBar) nativeBar.visible = false;
    const viewStack = new Adw.ViewStack({ vexpand: true });
    const details = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, vexpand: true });
    const preferences = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, vexpand: true });
    const inlineSwitcher = new Adw.InlineViewSwitcher({ stack: nativeSwitcher.stack,
        display_mode: Adw.InlineViewSwitcherDisplayMode.LABELS, can_shrink: true,
        halign: Gtk.Align.CENTER, margin_start: 12, margin_end: 12, margin_bottom: 12 });
    toolbar.content = null;
    preferences.append(originalContent);
    viewStack.add_titled_with_icon(details, 'details', 'Details', 'dialog-information-symbolic');
    viewStack.add_titled_with_icon(preferences, 'preferences', 'Preferences', 'emblem-system-symbolic');
    const pendingBanner = createPendingUpdateBanner();
    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, vexpand: true });
    content.append(pendingBanner); content.append(viewStack);
    toolbar.content = content;
    const title = new Adw.WindowTitle();
    header.title_widget = title;
    const switcher = new Adw.ViewSwitcher({ stack: viewStack, policy: Adw.ViewSwitcherPolicy.WIDE,
        halign: Gtk.Align.CENTER, margin_top: 6, margin_bottom: 12 });
    const navigation = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    navigation.append(switcher); navigation.append(inlineSwitcher);
    toolbar.add_top_bar(navigation);
    const pages = nativeSwitcher.stack.get_pages();
    const watched = new Map();
    const sync = () => {
        const present = new Set();
        let visible = 0;
        for (let index = 0; index < pages.get_n_items(); index++) {
            const page = pages.get_item(index);
            present.add(page);
            if (!watched.has(page)) watched.set(page, page.connect('notify::visible', sync));
            if (page.visible) visible++;
        }
        for (const [page, signal] of watched) {
            if (!present.has(page)) { page.disconnect(signal); watched.delete(page); }
        }
        inlineSwitcher.visible = visible > 1 && viewStack.visible_child_name === 'preferences';
    };
    const pagesSignal = pages.connect('items-changed', sync);
    const viewSignal = viewStack.connect('notify::visible-child-name', sync);
    sync();
    return {
        header, viewStack, switcher, inlineSwitcher, details, preferences, pendingBanner,
        originalTitle, originalContent,
        stop() {
            pages.disconnect(pagesSignal);
            viewStack.disconnect(viewSignal);
            for (const [page, signal] of watched) page.disconnect(signal);
            watched.clear();
        },
        setExtension(item) { title.title = item?.name ?? ''; title.subtitle = item?.uuid ?? ''; },
        setPendingUpdate(value) { pendingBanner.revealed = value === true; },
        setHasPreferences(value) {
            viewStack.get_page(preferences).visible = value;
            switcher.visible = value;
            if (!value) viewStack.visible_child_name = 'details';
        },
    };
}
