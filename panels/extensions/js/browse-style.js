import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
const displays = new WeakSet();

export function ensureBrowseStyle() {
    const display = Gdk.Display.get_default();
    if (!display || displays.has(display)) return;
    const provider = new Gtk.CssProvider();
    provider.load_from_string(`
        .monge-browse .browse-search-controls {
            background: var(--card-bg-color);
            border-radius: 9px;
        }
        .monge-browse .browse-search-controls .browse-search,
        .monge-browse .browse-search-controls dropdown > button {
            background: transparent;
        }
        .monge-browse .browse-sort-icon {
            padding: 0 8px;
            border-left: 1px solid var(--border-color);
            border-right: 1px solid var(--border-color);
        }
        .monge-browse list.boxed-list { background: var(--card-bg-color); }
        .monge-browse list.boxed-list > row:not(:hover):not(:active) { background: transparent; }
    `);
    Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    displays.add(display);
}
