import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { resourceBase } from './bootstrap.js';

const { ExtensionPrefsDialog } = await import(`${resourceBase}/extensionPrefsDialog.js`);
const connect = (window, signal, callback) =>
    GObject.Object.prototype.connect.call(window, signal, callback);
const state = Symbol('preferencesHostState');
const resetProperties = [
    'search_enabled', 'resizable', 'modal', 'hide_on_close',
    'deletable', 'decorated', 'icon_name', 'sensitive', 'opacity',
    'default_width', 'default_height', 'width_request', 'height_request',
];

// keep the real preferences root while ending each extension's session through its native close handlers.
export class PreferencesHost extends ExtensionPrefsDialog {
    static [GObject.GTypeName] = 'MongePreferencesHost';

    static {
        GObject.registerClass(this);
    }

    constructor(extension = { uuid: null, metadata: { name: 'Extensions' } }) {
        super(extension);
        connect(this, 'loaded', () => {
            this[state].loading = false;
            this[state].resolveLoaded();
        });
        // preserve the manager size while cleanup and asynchronous preferences loading request different sizes.
        for (const property of ['default-width', 'default-height']) {
            connect(this, `notify::${property}`, () => {
                const geometry = this[state].geometry;
                if (geometry && this.get_default_size().some((size, index) => size !== geometry[index]))
                    this.set_default_size(...geometry);
            });
        }
        connect(this, 'close-request', () => {
            if (this[state].emittingClose)
                return false;
            this._closeManager();
            return true;
        });
    }

    _loadPrefs() {
        this[state] ??= {
            baseline: new Map(resetProperties.map(name => [name, this[name]])),
            canNavigateBack: this.get_can_navigate_back(),
            signals: new Set(),
            toasts: new Set(),
            groups: new Set(),
            pages: new Set(),
            subpages: new Set(),
            headerWidgets: new Map(),
            keys: Object.getOwnPropertyDescriptors(this),
        };
        this._watchHeaders(this._mongePreferencesContent ?? this.get_content());
        this[state].active = Boolean(this._extension.uuid);
        this[state].loading = true;
        this[state].ready = new Promise(resolve => { this[state].resolveLoaded = resolve; });
        if (!this._extension.uuid)
            return Promise.resolve();
        return super._loadPrefs();
    }

    _watchHeaders(widget) {
        if ((widget instanceof Adw.HeaderBar || widget instanceof Gtk.HeaderBar) && !widget._mongeTracked) {
            widget._mongeTracked = true;
            for (const method of ['pack_start', 'pack_end']) {
                const original = widget[method];
                widget[method] = child => {
                    this[state].headerWidgets.set(child, widget);
                    original.call(widget, child);
                };
            }
        }
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
            this._watchHeaders(child);
    }

    get ready() {
        return this[state].ready;
    }

    get closing() {
        return Boolean(this[state].closing || this[state].closed);
    }

    set onCloseRequested(callback) {
        this[state].onCloseRequested = callback;
    }

    _requestClose() {
        if (this[state].onCloseRequested)
            this[state].onCloseRequested();
        else
            this._closeManager();
    }

    set onClosed(callback) {
        this[state].onClosed = callback;
    }

    connect(signal, callback) {
        const id = super.connect(signal, callback);
        this[state].signals.add(id);
        return id;
    }

    connect_after(signal, callback) {
        const id = super.connect_after(signal, callback);
        this[state].signals.add(id);
        return id;
    }

    disconnect(id) {
        this[state].signals.delete(id);
        super.disconnect(id);
    }

    add_toast(toast) {
        this[state].toasts.add(toast);
        toast.connect('dismissed', () => this[state].toasts.delete(toast));
        super.add_toast(toast);
    }

    add(page) {
        this[state].pages.add(page);
        super.add(page);
    }

    remove(page) {
        this[state].pages.delete(page);
        super.remove(page);
    }

    insert_action_group(name, group) {
        this[state].groups.add(name);
        super.insert_action_group(name, group);
    }

    push_subpage(page) {
        this[state].subpages.add(page);
        super.push_subpage(page);
    }

    present_subpage(widget) {
        this[state].subpages.add(widget);
        super.present_subpage(widget);
    }

    popPreferencesSubpage() {
        if (super.pop_subpage())
            return true;
        if ([...this[state].subpages].some(page => !(page instanceof Adw.NavigationPage) && page.get_parent())) {
            super.close_subpage();
            return true;
        }
        return false;
    }

    set_titlebar() {
        const session = this[state];
        if (session.titlebarError)
            return;
        session.titlebarError = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            session.titlebarError = 0;
            this._showErrorPage(new Error('set_titlebar() is not supported for Adw.Window'));
            return GLib.SOURCE_REMOVE;
        });
    }

    vfunc_close_request() {
        this[state].acceptedClose = true;
        return false;
    }

    close() {
        if (this[state].emittingClose)
            return;
        if (this.get_realized() && !this[state].ending)
            super.close();
        else
            this._requestClose();
    }

    destroy() {
        if (!this[state]?.emittingClose)
            super.destroy();
    }

    switchTo(extension) {
        const previous = this[state].operation ?? Promise.resolve();
        const operation = previous.then(() => this._switchTo(extension));
        this[state].operation = operation.catch(() => {});
        return operation;
    }

    async _switchTo(extension) {
        await this.ready;
        if (this[state].closed || this[state].closing || this[state].ending)
            return false;
        if ((extension?.uuid ?? null) === this._extension.uuid)
            return true;
        this[state].geometry = this.get_default_size();
        try {
            if (!await this._finishSession())
                return false;
            if (this.closing)
                return false;
            this._extension = extension ?? { uuid: null, metadata: { name: 'Extensions' } };
            this.title = this._extension.metadata.name;
            this._loadPrefs().catch(error => {
                this._showErrorPage(error);
                logError(error, 'Failed to open preferences');
            }).finally(() => this.emit('monge-preferences-loaded'));
            await this.ready;
            return true;
        } finally {
            this[state].geometry = null;
        }
    }

    async _finishSession() {
        const session = this[state];
        if (!session.active)
            return true;
        session.ending = true;
        session.acceptedClose = false;
        try {
            // emitting the signal delivers cleanup without Gtk.Window.close() destroying the persistent manager.
            session.emittingClose = true;
            this.monge_emitting_close = true;
            const vetoed = this.emit('close-request');
            session.acceptedClose = this.monge_close_accepted;
            this.monge_emitting_close = false;
            session.emittingClose = false;
            if (vetoed || !session.acceptedClose)
                return false;
            if (session.titlebarError) {
                GLib.source_remove(session.titlebarError);
                session.titlebarError = 0;
            }
            while (super.pop_subpage())
                continue;
            super.close_subpage();
            while ([...session.subpages].some(page => page.get_parent())) {
                await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                }));
            }
            session.subpages.clear();
            for (const toast of session.toasts)
                toast.dismiss();
            session.toasts.clear();
            for (const name of session.groups)
                super.insert_action_group(name, null);
            session.groups.clear();
            for (const [widget, header] of session.headerWidgets) {
                if (widget.is_ancestor(header))
                    header.remove(widget);
            }
            session.headerWidgets.clear();
            for (const page of session.pages)
                super.remove(page);
            session.pages.clear();
            for (const id of session.signals) {
                if (GObject.signal_handler_is_connected(this, id))
                    super.disconnect(id);
            }
            session.signals.clear();
            for (const [name, value] of session.baseline)
                this[name] = value;
            this.set_can_navigate_back(session.canNavigateBack);
            for (const name of Object.getOwnPropertyNames(this)) {
                if (name !== '_extension' && !Object.hasOwn(session.keys, name))
                    delete this[name];
            }
            for (const [name, descriptor] of Object.entries(session.keys)) {
                if (name !== '_extension')
                    Object.defineProperty(this, name, descriptor);
            }
            delete this._extension.stateObj;
            session.active = false;
            return true;
        } finally {
            this.monge_emitting_close = false;
            session.emittingClose = false;
            session.ending = false;
        }
    }

    async _closeManager() {
        if (this[state].closing || this[state].closed)
            return;
        this[state].closing = true;
        await this[state].operation;
        await this.ready;
        try {
            if (!await this._finishSession())
                return;
            this[state].closed = true;
            Gtk.Window.prototype.destroy.call(this);
            this[state].onClosed?.();
        } finally {
            this[state].closing = false;
        }
    }
}

// attach the tested host methods to Settings' existing native preferences-window root, not a second window.
export function attachPreferencesHost(window, preferencesContent) {
    if (window[state])
        return window;
    if (!(window instanceof Adw.PreferencesWindow))
        throw new Error('Settings must retain an Adw.PreferencesWindow root');
    for (const name of Object.getOwnPropertyNames(PreferencesHost.prototype)) {
        if (name !== 'constructor' && name !== 'vfunc_close_request')
            Object.defineProperty(window, name, Object.getOwnPropertyDescriptor(PreferencesHost.prototype, name));
    }
    window._mongePreferencesContent = preferencesContent;
    window._extension = { uuid: null, metadata: { name: 'Extensions' } };
    window._loadPrefs().finally(() => window.emit('monge-preferences-loaded'));
    connect(window, 'monge-preferences-loaded', () => {
        window.search_enabled = false;
        window[state].loading = false;
        window[state].resolveLoaded();
    });
    // preserve the manager size while cleanup and asynchronous preferences loading request different sizes.
    for (const property of ['default-width', 'default-height']) {
        connect(window, `notify::${property}`, () => {
            const geometry = window[state].geometry;
            if (geometry && window.get_default_size().some((size, index) => size !== geometry[index]))
                window.set_default_size(...geometry);
        });
    }
    connect(window, 'close-request', () => {
        if (window[state].emittingClose)
            return false;
        window._requestClose();
        return true;
    });
    return window;
}
