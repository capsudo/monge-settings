import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
Adw.init();
const assert = (value, message) => { if (!value) throw new Error(message); };
const { createExtensionDetails } = await import('../../panels/extensions/js/extension-details.js');
const item = { uuid: 'example@test', name: '<b>Local name</b>', description: 'Local description', state: 1, version: 3, url: 'https://example.org/' };
let calls = 0;
const view = createExtensionDetails({ item, catalog: { details: async ({ uuid }) => {
    calls++; assert(uuid === item.uuid, 'Fetch details for the exact extension UUID');
    return { uuid, creator: '<b>Author</b>', description: 'Online description', downloads: 1234,
        homepage: 'https://example.org/', website: 'https://extensions.gnome.org/extension/123/example/' };
} } });
try {
    assert(calls === 0, 'Details fetch is lazy');
    assert(view.title.label === item.name && !view.title.use_markup, 'Extension identity is literal');
    await view.start();
    assert(view.author.label === 'By <b>Author</b>' && !view.author.use_markup, 'Online author remains literal');
    assert(view.description.label === 'Online description', 'Catalog supplies the full description');
    assert(view.downloads.subtitle === '1,234', 'Downloads are shown when supplied');
    assert(view.version.subtitle === '3', 'Version describes the installed extension');
    await view.start(); assert(calls === 1, 'Returning to Details reuses its loaded content');
    view.update({ ...item, version: 42 });
    assert(view.version.subtitle === '42', 'Installed metadata updates independently of catalog content');
} finally { view.stop(); }
const offline = createExtensionDetails({ item, catalog: { details: async () => { throw new Error('offline'); } } });
try {
    await offline.start();
    assert(offline.description.label === item.description, 'Offline details retain local information');
    assert(offline.retry.visible && !offline.downloads.visible, 'Offline mode offers retry without inventing download counts');
} finally { offline.stop(); }
let finish; let cancelled = false;
const pending = createExtensionDetails({ item, catalog: { details: ({ cancellable }) => {
    cancellable.connect(() => { cancelled = true; });
    return new Promise(resolve => { finish = resolve; });
} } });
const operation = pending.start(); pending.stop();
finish({ creator: 'Late author', description: 'Stale details', downloads: 999 }); await operation;
assert(cancelled && pending.description.label === item.description, 'Leaving cancels requests and discards escaped stale replies');
const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 32, 16);
pixbuf.fill(0x224466ff);
const [encoded, bytes] = pixbuf.save_to_bufferv('png', [], []);
assert(encoded, 'A real PNG fixture is encoded');
const image = createExtensionDetails({ item, catalog: {
    details: async () => ({ creator: 'Author', screenshot: '/extension-data/screenshots/example.png' }),
    media: async () => bytes,
} });
try {
    const first = image.start();
    assert(image.start() === first, 'Concurrent callers share the same details load');
    await first;
    assert(image.preview.visible && image.preview.paintable.get_width() === 32, 'A real PNG is decoded into the preview');
} finally { image.stop(); }
print('PASS extension details: lazy catalog, literal metadata, installed version, offline fallback and cancellation');
