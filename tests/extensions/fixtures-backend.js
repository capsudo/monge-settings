// provide observable installed-extension state without connecting to the live Shell.
export function extension(overrides = {}) {
    return { uuid: 'example@test', name: 'Example', description: 'Example description',
        type: 2, hasPrefs: true, enabled: true, canChange: true, state: 1, error: '', version: 1,
        url: 'https://example.org/', ...overrides };
}

export function createFixtureBackend(extensions = []) {
    const listeners = new Set();
    return {
        extensions, userExtensionsEnabled: true, writable: true,
        calls: [], listeners,
        notify() { for (const callback of [...listeners]) callback(); },
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        async setUserExtensionsEnabled(enabled) {
            this.calls.push(['global', enabled]);
            this.userExtensionsEnabled = enabled;
            this.notify();
        },
        async setEnabled(uuid, enabled) {
            this.calls.push(['extension', uuid, enabled]);
            this.extensions = this.extensions.map(item => item.uuid === uuid ? { ...item, enabled } : item);
            this.notify();
        },
        async refresh() { this.calls.push(['refresh']); this.notify(); },
    };
}
