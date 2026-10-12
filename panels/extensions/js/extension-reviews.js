import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import { ensureDetailsStyle } from './extension-details-style.js';

function reviewCard(item) {
    const widget = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    widget.add_css_class('card');
    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6,
        margin_start: 16, margin_end: 16, margin_top: 16, margin_bottom: 16 });
    widget.append(content);
    const header = new Gtk.Box({ spacing: 6 });
    const author = new Gtk.Label({ label: item.author, use_markup: false, wrap: true,
        max_width_chars: 20, xalign: 0 }); author.add_css_class('heading');
    header.append(author);
    if (item.creator) {
        const badge = new Gtk.Label({ label: 'Author', valign: Gtk.Align.CENTER });
        badge.add_css_class('caption'); badge.add_css_class('monge-review-author'); header.append(badge);
    }
    const rating = new Gtk.Label({ label: item.rating ? '★'.repeat(item.rating) : '', visible: Boolean(item.rating),
        halign: Gtk.Align.END, hexpand: true, tooltip_text: item.rating ? `${item.rating} out of 5 stars` : null });
    rating.add_css_class('monge-review-rating'); header.append(rating); content.append(header);
    const text = new Gtk.Label({ label: item.text, use_markup: false, wrap: true, wrap_mode: Pango.WrapMode.WORD_CHAR,
        max_width_chars: 30, xalign: 0, selectable: true }); content.append(text);
    const timestamp = item.date ? GLib.DateTime.new_from_iso8601(item.date, GLib.TimeZone.new_utc()) : null;
    const date = new Gtk.Label({ label: timestamp?.to_local().format('%x') ?? item.dateLabel ?? '', xalign: 0 });
    date.add_css_class('dim-label'); content.append(date);
    return { widget, author, text, rating, date };
}

export function createExtensionReviews({ catalog }) {
    ensureDetailsStyle();
    const widget = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
    const heading = new Gtk.Label({ label: 'Reviews and Comments', xalign: 0 }); heading.add_css_class('heading'); widget.append(heading);
    const flow = new Gtk.FlowBox({ selection_mode: Gtk.SelectionMode.NONE, activate_on_single_click: false,
        min_children_per_line: 1, max_children_per_line: 2, column_spacing: 12, row_spacing: 12 }); widget.append(flow);
    const status = new Gtk.Label({ xalign: 0, wrap: true }); status.add_css_class('dim-label'); widget.append(status);
    const showAll = new Gtk.Button({ label: 'Show All', halign: Gtk.Align.CENTER, visible: false });
    showAll.add_css_class('pill'); widget.append(showAll);
    const retry = new Gtk.Button({ label: 'Retry', halign: Gtk.Align.START, visible: false }); widget.append(retry);
    const cards = [];
    let request = null;
    let stopped = false;
    let currentPk = null;
    let currentAll = false;
    let generation = 0;
    function clearCards() {
        for (const card of cards) {
            const child = card.widget.get_parent();
            child.set_child(null); flow.remove(child);
        }
        cards.length = 0;
    }
    async function load(pk, all = false) {
        if (stopped) return;
        currentPk = pk; currentAll = all;
        request?.cancel();
        request = null;
        const current = ++generation;
        if (!pk || !catalog?.comments) {
            clearCards();
            showAll.visible = false; showAll.sensitive = true; retry.visible = false;
            status.label = 'Reviews are not available for this extension.';
            return;
        }
        const cancellable = new Gio.Cancellable(); request = cancellable;
        status.label = 'Loading reviews…'; retry.visible = false; showAll.sensitive = false;
        try {
            const items = await catalog.comments({ pk, all, cancellable });
            if (stopped || current !== generation) return;
            clearCards();
            for (const item of items) {
                const card = reviewCard(item); cards.push(card); flow.append(card.widget);
            }
            status.label = cards.length ? '' : 'There are no reviews or comments';
            showAll.visible = !all && Boolean(cards.length);
        } catch (_error) {
            if (!stopped && current === generation) {
                status.label = 'Reviews could not be loaded.'; retry.visible = true;
            }
        } finally {
            if (current === generation) { request = null; showAll.sensitive = true; }
        }
    }
    showAll.connect('clicked', () => load(currentPk, true));
    retry.connect('clicked', () => load(currentPk, currentAll));
    return { widget, cards, status, showAll, retry, load,
        stop() { stopped = true; generation++; request?.cancel(); request = null; } };
}
