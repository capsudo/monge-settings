import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { resourceBase } from './bootstrap.js';
import { attachPreferencesHost } from './preferences-host.js';
import { createInstalledView } from './installed-view.js';
import { createBrowseView } from './browse-view.js';
const { extensionManager } = await import(`${resourceBase}/extensionsService.js`);
const connect = (object, signal, callback) => GObject.Object.prototype.connect.call(object, signal, callback);
function findHeader(widget) {
    if (widget instanceof Adw.HeaderBar) return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const header = findHeader(child); if (header) return header;
    }
    return null;
}

export class ExtensionsController {
    constructor({ window, backend, catalog }) {
        this.window = window; this.backend = backend; this.catalog = catalog;
        this.current = null; this.closed = false; this.closing = false;
        const native = window.monge_preferences_content;
        attachPreferencesHost(window, native);
        this.ready = window.ready;
        this.backButton = new Gtk.Button({ icon_name: 'go-previous-symbolic', tooltip_text: 'Back', visible: false });
        this.backButton.add_css_class('flat');
        this.backButton.connect('clicked', () => this.back().catch(error => this.report(error)));
        const header = findHeader(native);
        if (header) {
            // this is permanent navigation wiring, not a header widget owned by the currently loaded extension.
            Adw.HeaderBar.prototype.pack_start.call(header, this.backButton);
            header.show_back_button = false;
        }
        window.onCloseRequested = () => this.close().catch(error => this.report(error));
        window.onClosed = () => {
            this.closed = true; this.stopPanel(); backend.stop();
            this._pending?.resolve(false); this._pending = null;
        };
        connect(window, 'notify::active-panel', () => this.panelChanged());
        connect(window, 'monge-back', () => {
            if (!this.current || this.current.navigation.get_visible_page() === this.current.landing)
                return false;
            this.back().catch(error => this.report(error)); return true;
        });
        connect(window, 'monge-request-panel', () => {
            if (!this.current) return false;
            if (this._draining || window._extension.uuid) {
                this.request('section').catch(error => this.report(error)); return true;
            }
            this.stopPanel(); window.title = 'Settings'; return false;
        });
        this.panelChanged();
    }

    report(error) {
        if (!this.closed) this.window.add_toast(new Adw.Toast({ title: error.message }));
    }

    panelChanged() {
        if (this.closed) return;
        const panel = this.window.active_panel;
        if (panel === this.current?.panel) return;
        if (this.current) this.stopPanel();
        if (!panel || panel.get_name() !== 'monge-extensions-panel') return;
        const navigation = panel.get_child();
        const landing = navigation.get_visible_page();
        const viewStack = new Adw.ViewStack({ vexpand: true });
        const installed = createInstalledView({ backend: this.backend,
            onPreferences: uuid => this.select(uuid).catch(error => this.report(error)), onError: error => this.report(error) });
        viewStack.add_titled_with_icon(installed.widget, 'installed', 'Installed', 'application-x-addon-symbolic');
        const browse = createBrowseView({ shellVersion: this.backend.shellVersion,
            installedUuids: this.backend.extensions.map(item => item.uuid),
            ...(this.catalog ? { catalog: this.catalog } : {}),
            onDetails: widget => this.showDetails(widget) });
        viewStack.add_titled_with_icon(browse.widget, 'browse', 'Browse', 'web-browser-symbolic');
        const header = new Adw.HeaderBar({ title_widget: new Adw.ViewSwitcher({ stack: viewStack, policy: Adw.ViewSwitcherPolicy.WIDE }) });
        const toolbar = new Adw.ToolbarView({ content: viewStack }); toolbar.add_top_bar(header);
        landing.set_child(toolbar);
        const preferencesPage = new Adw.NavigationPage({ title: 'Extension Preferences', tag: 'extension-preferences', can_pop: false,
            child: this.window.monge_preferences_content });
        navigation.add(preferencesPage);
        this.current = { panel, navigation, landing, preferencesPage, viewStack, installed, browse, details: null };
        viewStack.connect('notify::visible-child-name', () => {
            if (this.current?.viewStack !== viewStack) return;
            if (viewStack.visible_child_name === 'browse') browse.start(); else browse.stop();
        });
        this.window.title = 'Settings';
    }

    showDetails(widget) {
        if (!this.current || this.closing) return;
        const toolbar = new Adw.ToolbarView({ content: widget }); toolbar.add_top_bar(new Adw.HeaderBar());
        const details = new Adw.NavigationPage({ title: 'Extension Details', child: toolbar });
        this.current.details = details; this.current.navigation.push(details);
    }

    select(uuid) { return this.request('select', uuid); }
    back() { return this.request('back'); }
    request(kind, uuid = null) {
        if (this.closed || this.closing || !this.current) return Promise.resolve(false);
        const result = new Promise((resolve, reject) => {
            this._pending?.resolve(false);
            this._pending = { kind, uuid, resolve, reject };
            this._latest = this._pending;
        });
        this.startDrain();
        return result;
    }
    startDrain() {
        if (this._draining) return;
        this._draining = Promise.resolve().then(() => this.drain()).finally(() => {
            this._draining = null;
            if (this._pending && !this.closing && !this.closed) this.startDrain();
        });
    }
    get idle() { return this.waitIdle(); }
    async waitIdle() { while (this._draining) await this._draining; }

    async drain() {
        await this.ready;
        while (this._pending && !this.closed && !this.closing) {
            const request = this._pending; this._pending = null;
            const current = this.current;
            try {
                if (request.kind === 'select') {
                    const info = await this.backend.getExtension(request.uuid);
                    if (request !== this._latest || this.closing) { request.resolve(false); continue; }
                    const extension = extensionManager.createExtensionObject(info);
                    if (!extension.hasPrefs) throw new Error('This extension has no preferences');
                    current.preferencesPage.set_title(extension.metadata.name);
                    if (!await this.window.switchTo(extension)) { request.resolve(false); continue; }
                    if (request !== this._latest || this.closing) { request.resolve(false); continue; }
                    this.showPreferences(); request.resolve(true);
                } else {
                    if (request.kind === 'back' && this.window._extension.uuid && this.window.popPreferencesSubpage()) {
                        request.resolve(true); continue;
                    }
                    if (!await this.window.switchTo(null)) { request.resolve(false); continue; }
                    if (request !== this._latest || this.closing) { request.resolve(false); continue; }
                    this.window.title = 'Settings'; this.backButton.visible = false;
                    if (request.kind === 'section') {
                        this.stopPanel(); this.window.emit('monge-continue-panel');
                    } else {
                        current.navigation.pop_to_page(current.landing);
                    }
                    request.resolve(true);
                }
            } catch (error) {
                // a failed latest lookup must display the session actually loaded by an earlier request, not an empty hidden host.
                if (request === this._latest && this.window._extension.uuid && !this.closing)
                    this.showPreferences();
                request.reject(error);
            }
        }
    }

    showPreferences() {
        const current = this.current;
        if (!current) return;
        current.preferencesPage.title = this.window._extension.metadata.name;
        this.backButton.visible = true;
        if (current.navigation.get_visible_page() !== current.preferencesPage)
            current.navigation.push(current.preferencesPage);
    }

    stopPanel() {
        if (!this.current) return;
        this.current.installed.stop(); this.current.browse.stop();
        this.current.preferencesPage.set_child(null);
        this.backButton.visible = false;
        this.current = null;
    }

    async close() {
        if (this.closing || this.closed) return false;
        this.closing = true;
        this._pending?.resolve(false); this._pending = null;
        await this.idle;
        try {
            await this.window._closeManager();
            return this.closed;
        } finally { if (!this.closed) this.closing = false; }
    }
}
