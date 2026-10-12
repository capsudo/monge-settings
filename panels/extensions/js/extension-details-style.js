import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
const displays = new WeakSet();

export function ensureDetailsStyle() {
    const display = Gdk.Display.get_default();
    if (!display || displays.has(display)) return;
    const provider = new Gtk.CssProvider();
    provider.load_from_string(`
        .monge-details-metrics > list {
            background: transparent;
            border-radius: 0;
        }
        .monge-details-metrics.split > list:last-child {
            border-left: 1px solid var(--border-color);
        }
        .monge-details-link, .monge-details-link:visited {
            color: var(--window-fg-color);
        }
        .monge-review-rating { color: var(--yellow-4); }
        .monge-review-author {
            background: var(--accent-bg-color);
            color: var(--accent-fg-color);
            border-radius: 999px;
            padding: 2px 6px;
        }
    `);
    Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    displays.add(display);
}
