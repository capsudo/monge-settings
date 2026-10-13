import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { resourceBase } from './bootstrap.js';
import { attachPreferencesHost } from './preferences-host.js';
import { createInstalledView } from './installed-view.js';
import { createBrowseView } from './browse-view.js';
import { createExtensionPageLayout } from './extension-page.js';
import { createExtensionDetails } from './extension-details.js';
import { createCatalog } from './catalog.js';
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
    constructor({ window, backend, catalog, viewState }) {
        this.window = window; this.backend = backend;
        this.catalog = catalog ?? createCatalog({ shellVersion: backend.shellVersion });
        this.iconCache = new Map();
        let rememberedView = 'preferences';
        this.viewState = viewState ?? { get: () => rememberedView, set: value => { rememberedView = value; } };
        this.current = null; this.closed = false; this.closing = false;
        const native = window.monge_preferences_content;
        attachPreferencesHost(window, native);
        this.ready = window.ready;
        this.pageLayout = createExtensionPageLayout(native);
        this.pageLayout.viewStack.connect('notify::visible-child-name', () => {
            const view = this.pageLayout.viewStack.visible_child_name;
            if (!this._configuringPage && this.current?.informationItem?.hasPrefs) this.viewState.set(view);
            if (view === 'details') this.current?.detailsView?.start();
        });
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
            this.pageLayout.stop();
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
        const installed = createInstalledView({ backend: this.backend, catalog: this.catalog, iconCache: this.iconCache,
            onPreferences: uuid => this.select(uuid).catch(error => this.report(error)), onError: error => this.report(error) });
        viewStack.add_titled_with_icon(installed.widget, 'installed', 'Installed', 'application-x-addon-symbolic');
        const browse = createBrowseView({ shellVersion: this.backend.shellVersion,
            installedUuids: this.backend.extensions.map(item => item.uuid),
            ...(this.catalog ? { catalog: this.catalog } : {}),
            onInstall: uuid => this.backend.install(uuid), onError: error => this.report(error),
            canInstall: () => this.backend.canInstall === true,
            onDetails: item => this.showDetails(item) });
        viewStack.add_titled_with_icon(browse.widget, 'browse', 'Browse', 'globe-alt2-symbolic');
        const header = new Adw.HeaderBar({ title_widget: new Adw.ViewSwitcher({ stack: viewStack, policy: Adw.ViewSwitcherPolicy.WIDE }) });
        const toolbar = new Adw.ToolbarView({ content: viewStack }); toolbar.add_top_bar(header);
        landing.set_child(toolbar);
        const preferencesPage = new Adw.NavigationPage({ title: 'Extension Preferences', tag: 'extension-preferences', can_pop: false,
            child: this.window.monge_preferences_content });
        navigation.add(preferencesPage);
        this.current = { panel, navigation, landing, preferencesPage, viewStack, installed, browse, details: null };
        navigation.connect('popped', (_navigation, page) => {
            if (this.current?.navigation === navigation && page === this.current.details) this.clearCatalogDetails();
        });
        this.current.unsubscribeInformation = this.backend.subscribe(() => {
            const current = this.current;
            if (!current) return;
            current.browse.updateInstalled(this.backend.extensions.map(value => value.uuid));
            if (current.informationItem) {
                const item = this.backend.extensions.find(value => value.uuid === current.informationItem.uuid);
                if (item) { current.informationItem = item; current.detailsView.update(item); }
            }
            if (current.catalogItem) {
                const item = this.backend.extensions.find(value => value.uuid === current.catalogItem.uuid);
                current.catalogDetailsView?.update(item ?? current.catalogItem, Boolean(item));
            }
        });
        viewStack.connect('notify::visible-child-name', () => {
            if (this.current?.viewStack !== viewStack) return;
            if (viewStack.visible_child_name === 'browse') browse.start(); else browse.stop();
        });
        this.window.title = 'Settings';
    }

    showDetails(item) {
        if (!this.current || this.closing) return;
        const current = this.current;
        this.clearCatalogDetails();
        if (current.details?.get_parent() === current.navigation) current.navigation.remove(current.details);
        const installed = this.backend.extensions.find(value => value.uuid === item.uuid);
        const view = createExtensionDetails({ item: installed ?? item, catalog: this.catalog, installed: Boolean(installed),
            onInstall: async uuid => {
                try { return await this.backend.install(uuid); }
                catch (error) { this.report(error); throw error; }
            }, canInstall: () => this.backend.canInstall === true });
        const toolbar = new Adw.ToolbarView({ content: view.widget }); toolbar.add_top_bar(new Adw.HeaderBar());
        const details = new Adw.NavigationPage({ title: item.name, child: toolbar });
        current.catalogItem = item; current.catalogDetailsView = view;
        current.details = details; current.navigation.push(details); view.start();
    }

    clearCatalogDetails() {
        if (!this.current) return;
        this.current.catalogDetailsView?.stop();
        this.current.catalogDetailsView = null; this.current.catalogItem = null;
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
                    const item = this.backend.extensions.find(value => value.uuid === request.uuid);
                    if (!item) throw new Error('This extension is no longer installed');
                    const info = item.hasPrefs ? await this.backend.getExtension(request.uuid) : null;
                    if (request !== this._latest || this.closing) { request.resolve(false); continue; }
                    const extension = info ? extensionManager.createExtensionObject(info) : null;
                    if (!await this.window.switchTo(extension)) { request.resolve(false); continue; }
                    if (request !== this._latest || this.closing) { request.resolve(false); continue; }
                    this.showPreferences(item); request.resolve(true);
                } else {
                    if (request.kind === 'back' && this.pageLayout.viewStack.visible_child_name === 'preferences' &&
                        this.window._extension.uuid && this.window.popPreferencesSubpage()) {
                        request.resolve(true); continue;
                    }
                    if (!await this.window.switchTo(null)) { request.resolve(false); continue; }
                    if (request !== this._latest || this.closing) { request.resolve(false); continue; }
                    this.clearInformation();
                    this.clearCatalogDetails();
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

    showPreferences(item = null) {
        const current = this.current;
        if (!current) return;
        item ??= this.backend.extensions.find(value => value.uuid === this.window._extension.uuid);
        if (!item) return;
        this.clearInformation();
        current.detailsView = createExtensionDetails({ item, catalog: this.catalog });
        this.pageLayout.details.append(current.detailsView.widget);
        current.information = current.detailsView.information;
        current.informationItem = item;
        const view = item.hasPrefs ? this.viewState.get() : 'details';
        this._configuringPage = true;
        try {
            this.pageLayout.setHasPreferences(item.hasPrefs);
            this.pageLayout.viewStack.visible_child_name = view;
        } finally { this._configuringPage = false; }
        if (this.pageLayout.viewStack.visible_child_name === 'details') current.detailsView.start();
        current.preferencesPage.title = item.name;
        this.window.title = item.name;
        this.backButton.visible = true;
        if (current.navigation.get_visible_page() !== current.preferencesPage)
            current.navigation.push(current.preferencesPage);
    }

    clearInformation() {
        const current = this.current;
        if (!current) return;
        current.detailsView?.stop();
        if (current.detailsView?.widget.get_parent()) this.pageLayout.details.remove(current.detailsView.widget);
        current.detailsView = null;
        current.information = null;
        current.informationItem = null;
    }

    stopPanel() {
        if (!this.current) return;
        this.current.unsubscribeInformation();
        this.clearCatalogDetails();
        this.clearInformation();
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
