import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
Adw.init();
const assert = (value, message) => { if (!value) throw new Error(message); };
const { createExtensionReviews } = await import('../../panels/extensions/js/extension-reviews.js');
const calls = [];
const view = createExtensionReviews({ catalog: { comments: async ({ pk, all }) => {
    calls.push([pk, all]);
    return [{ author: '<b>Reviewer</b>', text: '<b>Literal text</b>', rating: 5, date: '2026-09-14T13:01:01', creator: true }];
} } });
try {
    await view.load(123);
    assert(view.cards.length === 1, 'Reviews render as cards');
    const card = view.cards[0];
    assert(card.author.label === '<b>Reviewer</b>' && !card.author.use_markup && !card.text.use_markup, 'Reviews remain literal');
    assert(card.rating.label === '★★★★★' && card.rating.has_css_class('monge-review-rating'), 'Ratings use gold star styling');
    assert(card.date.label && card.date.has_css_class('dim-label'), 'Dates are visible with secondary emphasis');
    assert(view.showAll.visible, 'Initial preview offers Show All');
    await view.load(123, true);
    assert(calls.length === 2 && calls[1][1] === true && !view.showAll.visible, 'Show All uses the full read-only API');
} finally { view.stop(); }
const empty = createExtensionReviews({ catalog: { comments: async () => [] } });
try { await empty.load(123); assert(empty.status.label === 'There are no reviews or comments', 'Empty reviews are explicit'); }
finally { empty.stop(); }
const offline = createExtensionReviews({ catalog: { comments: async () => { throw new Error('offline'); } } });
try { await offline.load(123); assert(offline.retry.visible, 'Review failures provide a retry'); }
finally { offline.stop(); }
let finish;
const pending = createExtensionReviews({ catalog: { comments: () => new Promise(resolve => { finish = resolve; }) } });
const operation = pending.load(123); pending.stop(); finish([{ author: 'Late', text: 'Stale', rating: 5 }]); await operation;
assert(!pending.cards.length, 'Retired requests cannot paint stale review cards');
const resetFailures = [];
let resetChecks = 0;
function checkReset(value, message) {
    resetChecks++;
    if (!value) resetFailures.push(message);
}
const lateCard = { author: 'Late', text: 'Stale', rating: 5 };
for (const missingMethod of [false, true]) {
    for (const rejectLate of [false, true]) {
        let resolve; let reject; let cancellable;
        const catalog = { comments: options => {
            cancellable = options.cancellable;
            return new Promise((resolveRequest, rejectRequest) => { resolve = resolveRequest; reject = rejectRequest; });
        } };
        const resetPending = createExtensionReviews({ catalog });
        try {
            const pendingLoad = resetPending.load(123);
            if (missingMethod) delete catalog.comments;
            await resetPending.load(missingMethod ? 123 : null);
            checkReset(cancellable.is_cancelled(), 'Unavailable reviews cancel the pending request');
            checkReset(!resetPending.cards.length && !resetPending.showAll.visible && resetPending.showAll.sensitive &&
                !resetPending.retry.visible && resetPending.status.label === 'Reviews are not available for this extension.',
            'Unavailable reviews immediately reset cards, status and controls');
            if (rejectLate) reject(new Error('late failure')); else resolve([lateCard]);
            await pendingLoad;
            checkReset(!resetPending.cards.length && !resetPending.showAll.visible && resetPending.showAll.sensitive &&
                !resetPending.retry.visible && resetPending.status.label === 'Reviews are not available for this extension.',
            'Escaped stale successes and failures cannot alter the unavailable state');
        } finally { resetPending.stop(); }
    }
    const catalog = { comments: async () => [lateCard] };
    const loaded = createExtensionReviews({ catalog });
    try {
        await loaded.load(123);
        checkReset(loaded.cards.length === 1 && loaded.showAll.visible, 'Reset fixture has loaded cards and Show All');
        const oldCard = loaded.cards[0].widget;
        catalog.comments = async () => { throw new Error('offline'); };
        await loaded.load(123);
        checkReset(loaded.retry.visible, 'Reset fixture also exposes Retry');
        if (missingMethod) delete catalog.comments;
        await loaded.load(missingMethod ? 123 : null);
        checkReset(!loaded.cards.length && !oldCard.get_parent(), 'Unavailable reviews remove already-loaded cards from the widget');
        checkReset(!loaded.showAll.visible && loaded.showAll.sensitive && !loaded.retry.visible &&
            loaded.status.label === 'Reviews are not available for this extension.',
        'Unavailable reviews clear Show All and Retry after loaded cards and errors');
    } finally { loaded.stop(); }
}
assert(!resetFailures.length, resetFailures.join('\n'));
print(`PASS review reset regressions: ${resetChecks} assertions`);
const narrow = createExtensionReviews({ catalog: { comments: async () => Array.from({ length: 5 }, () => ({
    author: 'Reviewer', rating: 5, text: 'A detailed comment with several paragraphs.\n\n'.repeat(40),
})) } });
const narrowWindow = new Adw.Window({ default_width: 460, default_height: 900,
    content: new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, child: narrow.widget }) });
try {
    await narrow.load(123); narrowWindow.present();
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => { resolve(); return GLib.SOURCE_REMOVE; }));
    assert(narrowWindow.get_width() <= 460, 'Long reviews wrap without forcing a narrow window to grow into several columns');
} finally { narrow.stop(); narrowWindow.destroy(); }
print('PASS extension reviews: cards, stars, dates, literal text, Show All, empty/error states and retirement');
