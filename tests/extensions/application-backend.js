import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
export function createCatalog() {
    return { query: async () => ({ page: 1, pages: 1, items: [
        { uuid: 'catalog@monge.test', name: 'Catalog Example', creator: 'Example Author',
            description: 'Read-only catalog fixture. No extension installation is performed.' },
    ] }), details: async ({ uuid }) => ({ uuid, creator: 'Example Author',
        description: 'Full extension details from the isolated catalog fixture.', downloads: 1234,
        website: 'https://extensions.gnome.org/extension/123/example/', homepage: 'https://example.org/' }) };
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
