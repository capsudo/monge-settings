import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gtk from 'gi://Gtk?version=4.0';
Adw.init();
const assert = (value, message) => { if (!value) throw new Error(message); };
const { createExtensionDetails } = await import('../../panels/extensions/js/extension-details.js');
const item = { uuid: 'example@test', name: '<b>Local name</b>', description: 'Local description', state: 1, version: 3, url: 'https://example.org/' };
let calls = 0;
const view = createExtensionDetails({ item, catalog: { details: async ({ uuid }) => {
    calls++; assert(uuid === item.uuid, 'Fetch details for the exact extension UUID');
    return { uuid, creator: '<b>Author</b>', description: 'Online description', downloads: 1234, version: 31,
        homepage: 'https://example.org/', website: 'https://extensions.gnome.org/extension/123/example/' };
} } });
try {
    assert(calls === 0, 'Details fetch is lazy');
    assert(view.title.label === item.name && !view.title.use_markup, 'Extension identity is literal');
    assert(view.installed instanceof Gtk.Button && !view.installed.sensitive,
        'Installed is the same insensitive button badge as Extension Manager');
    assert(view.metrics instanceof Gtk.Box && view.metrics.orientation === Gtk.Orientation.HORIZONTAL && view.metrics.homogeneous,
        'Downloads and Version share a horizontal split card');
    assert(view.downloads.has_css_class('property') && view.version.has_css_class('property'),
        'Property rows emphasize values rather than their captions');
    await view.start();
    assert(view.author.label === 'By <b>Author</b>' && !view.author.use_markup, 'Online author remains literal');
    assert(view.description.label === 'Online description', 'Catalog supplies the full description');
    assert(view.downloads.subtitle === '1,234', 'Downloads are shown when supplied');
    assert(view.version.subtitle === '31' && view.version.title === 'Version', 'Version matches the compatible catalog release');
    assert(view.installedVersion.label === 'Installed version: 3', 'The different installed version is still identified explicitly');
    await view.start(); assert(calls === 1, 'Returning to Details reuses its loaded content');
    view.update({ ...item, version: 42 });
    assert(view.version.subtitle === '31' && view.installedVersion.label === 'Installed version: 42',
        'Installed metadata updates independently of catalog content');
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
const gif = createExtensionDetails({ item, catalog: {
    details: async () => ({ creator: 'Author', screenshot: '/extension-data/screenshots/example.gif' }),
    media: async () => GLib.base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
} });
try {
    await gif.start();
    assert(gif.preview.visible && gif.preview.paintable.get_width() === 1, 'GIF screenshots have a visible decoded preview');
} finally { gif.stop(); }
const gifFailures = [];
let gifChecks = 0;
function checkGif(value, message) {
    gifChecks++;
    if (!value) gifFailures.push(message);
}
function joinGif(...parts) {
    const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
}
const simpleGif = GLib.base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
const descriptor = simpleGif.indexOf(0x2c);
const paletteEnd = 13 + 3 * (1 << ((simpleGif[10] & 7) + 1));
const frame = simpleGif.slice(paletteEnd, -1);
const animatedGif = joinGif(simpleGif.slice(0, -1), ...Array.from({ length: 64 }, () => frame), [0x3b]);
const originalLoader = GdkPixbuf.PixbufLoader.new_with_type;
let nativeInputs = [];
GdkPixbuf.PixbufLoader.new_with_type = kind => {
    const loader = originalLoader.call(GdkPixbuf.PixbufLoader, kind);
    return {
        connect: (...args) => loader.connect(...args),
        set_size: (...args) => loader.set_size(...args),
        write(value) { nativeInputs.push(value.slice()); return loader.write(value); },
        close: () => loader.close(),
        get_animation: () => loader.get_animation(),
        get_pixbuf: () => loader.get_pixbuf(),
    };
};
async function gifPreview(value) {
    const preview = createExtensionDetails({ item, catalog: {
        details: async () => ({ screenshot: '/extension-data/screenshots/regression.gif' }),
        media: async () => value,
    } });
    try { await preview.start(); return preview.preview.visible; }
    finally { preview.stop(); }
}
try {
    checkGif(await gifPreview(animatedGif), 'Animated GIFs still produce a real static preview');
    checkGif(nativeInputs.length === 1 && nativeInputs[0].length === simpleGif.length &&
        nativeInputs[0].every((value, index) => value === simpleGif[index]),
    'The native decoder receives exactly the first frame, not the animation');
} finally { GdkPixbuf.PixbufLoader.new_with_type = originalLoader; }
GdkPixbuf.PixbufLoader.new_with_type = () => ({
    connect() {}, set_size() {}, close() {},
    write(value) { nativeInputs.push(value.slice()); },
    get_animation: () => ({ get_static_image: () => pixbuf }),
});
const malformedGifs = [];
for (let length = 6; length < simpleGif.length; length++)
    malformedGifs.push([`truncated at byte ${length}`, simpleGif.slice(0, length)]);
const mutateGif = (offset, values) => {
    const result = simpleGif.slice(); result.set(values, offset); return result;
};
malformedGifs.push(
    ['zero logical width', mutateGif(6, [0, 0])],
    ['zero first-image height', mutateGif(descriptor + 7, [0, 0])],
    ['excessive logical-screen pixels', mutateGif(6, [0, 64, 0, 64])],
    ['excessive first-image pixels', mutateGif(descriptor + 5, [0, 64, 0, 64])],
    ['first image outside logical screen', mutateGif(descriptor + 1, [1, 0])],
    ['unknown container block', mutateGif(paletteEnd, [0x7f])],
    ['wrong graphic-control size', mutateGif(paletteEnd + 2, [3])],
    ['missing graphic-control terminator', mutateGif(descriptor - 1, [1])],
    ['truncated local palette', mutateGif(descriptor + 9, [0x87])],
    ['invalid LZW code size', mutateGif(descriptor + 10, [12])],
    ['empty compressed image', joinGif(simpleGif.slice(0, descriptor + 11), [0, 0x3b])],
    ['missing image', joinGif(simpleGif.slice(0, descriptor), [0x3b])],
    ['truncated later frame', animatedGif.slice(0, -2)],
    ['trailing container garbage', joinGif(simpleGif, [0])],
    ['truncated application header', joinGif(simpleGif.slice(0, paletteEnd), [0x21, 0xff, 11, 1, 0x3b])],
    ['wrong plain-text header size', joinGif(simpleGif.slice(0, paletteEnd), [0x21, 0x01, 1, 0, 0], frame, [0x3b])],
);
const comment = [0x21, 0xfe, 3, 0x2c, 0x3b, 0x21, 0];
const application = [0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', value => value.charCodeAt(0)), 3, 1, 0, 0, 0];
const localDescriptor = simpleGif.slice(descriptor, descriptor + 10); localDescriptor[9] = 0x80;
const withLocalPalette = joinGif(simpleGif.slice(0, paletteEnd), comment, application,
    simpleGif.slice(paletteEnd, descriptor), localDescriptor, simpleGif.slice(13, paletteEnd),
    simpleGif.slice(descriptor + 10, -1));
try {
    nativeInputs = [];
    checkGif(await gifPreview(joinGif(withLocalPalette, frame, [0x3b])), 'Local-palette GIFs remain accepted');
    const expected = joinGif(withLocalPalette, [0x3b]);
    checkGif(nativeInputs.length === 1 && nativeInputs[0].length === expected.length &&
        nativeInputs[0].every((value, index) => value === expected[index]),
    'Palettes and preceding extensions survive structural first-frame extraction');
    for (const [name, bytes] of malformedGifs) {
        nativeInputs = [];
        const visible = await gifPreview(bytes);
        checkGif(!visible && nativeInputs.length === 0, `${name} must be rejected before native decoding`);
    }
} finally { GdkPixbuf.PixbufLoader.new_with_type = originalLoader; }
assert(!gifFailures.length, gifFailures.join('\n'));
print(`PASS GIF first-frame regressions: ${gifChecks} assertions`);
print('PASS extension details: lazy catalog, literal metadata, installed version, offline fallback and cancellation');
