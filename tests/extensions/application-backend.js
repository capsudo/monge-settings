import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
export function createCatalog() {
    const catalogItems = [
        { uuid: 'catalog@monge.test', name: 'Catalog Example', creator: 'Example Author',
            description: 'Read-only catalog fixture. No extension installation is performed.' },
        { uuid: 'catalog-row@monge.test', name: 'Row Installation Example', creator: 'Example Author', description: 'Independent row installation fixture.' },
        ...Array.from({ length: 6 }, (_value, index) => ({ uuid: `catalog-${index}@monge.test`, name: `Catalog Result ${index}`,
            creator: 'Example Author', description: 'A longer fixture summary for checking wrapping and the main view scrollbar.' })),
    ];
    return { query: async ({ page = 1 } = {}) => ({ page, pages: 2, items: page === 1 ? catalogItems : [catalogItems[0],
        { uuid: 'catalog-more@monge.test', name: 'Additional Catalog Result', creator: 'Example Author', description: 'Appended results fixture.' },
    ] }), details: async ({ uuid }) => ({ uuid, pk: 123, creator: 'Example Author',
        description: 'Full extension details from the isolated catalog fixture.', downloads: 1234, version: 31,
        icon: uuid === 'modern@monge.test' ? '/extension-data/icons/example.png' : '/static/images/plugin.png',
        screenshot: '/extension-data/screenshots/example.png',
        website: 'https://extensions.gnome.org/extension/123/example/', homepage: 'https://example.org/' }),
    media: async ({ path }) => {
        const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8,
            path.includes('/icons/') ? 32 : 320, path.includes('/icons/') ? 32 : 160);
        image.fill(0x7799bbff);
        return image.save_to_bufferv('png', [], [])[1];
    }, comments: async () => [
        { author: 'Example Reviewer', text: 'A read-only review fixture.', rating: 5, date: '2026-09-14T13:01:01' },
        { author: 'Another Reviewer', text: 'A second example comment, without a star rating.', rating: null, date: '2026-09-12T10:00:00' },
    ] };
}
export async function createBackend() {
    const fixtureRoot = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('fixtures').get_path();
    const listeners = new Set();
    let enabled = true;
    const extensions = [
        { uuid: 'modern@monge.test', name: 'Example Extension', description: 'Modern native preferences fixture.', type: 2,
            state: 1, enabled: true, canChange: true, hasPrefs: true, version: 1, url: 'https://example.org/', path: `${fixtureRoot}/modern@monge.test` },
        { uuid: 'legacy@monge.test', name: 'System Example', description: 'Legacy native preferences fixture.', type: 1,
            state: 2, enabled: false, canChange: true, hasPrefs: true, version: 1, path: `${fixtureRoot}/legacy@monge.test` },
        { uuid: 'information@monge.test', name: 'Information Only', description: 'An extension without preferences.', type: 2,
            state: 2, enabled: false, canChange: true, hasPrefs: false, version: 1 },
    ];
    const notify = () => { for (const listener of listeners) listener(); };
    return {
        extensions, shellVersion: '49.4', writable: true, calls: [],
        canInstall: true,
        async install(uuid) {
            this.calls.push(['install', uuid]);
            const item = { uuid, name: 'Catalog Example', description: 'Installed catalog fixture.', type: 2,
                state: 1, enabled: true, canChange: true, hasPrefs: false, version: 31 };
            extensions.push(item); notify(); return item;
        },
        get userExtensionsEnabled() { return enabled; },
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        async setUserExtensionsEnabled(value) { this.calls.push(['global', value]); enabled = value; notify(); },
        async setEnabled(uuid, value) { this.calls.push(['extension', uuid, value]); extensions.find(x => x.uuid === uuid).enabled = value; notify(); },
        async refresh() { notify(); },
        async getExtension(uuid) {
            const extension = extensions.find(x => x.uuid === uuid);
            if (!extension?.path) throw new Error(`Not installed: ${uuid}`);
            const properties = { ...extension, 'settings-schema': 'org.monge.test.preferences', 'gettext-domain': 'monge-fixture', 'shell-version': ['49'] };
            return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key,
                new GLib.Variant(Array.isArray(value) ? 'as' : typeof value === 'string' ? 's' : typeof value === 'boolean' ? 'b' : 'd', value)]));
        },
        stop() { listeners.clear(); },
    };
}
