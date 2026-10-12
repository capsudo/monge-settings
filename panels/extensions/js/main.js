import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import './bootstrap.js';
import { createBackend } from './backend.js';
import { ExtensionsController } from './extensions-controller.js';
import { createExtensionViewState } from './extension-view-state.js';

const windows = Gtk.Window.get_toplevels();
const window = Array.from({ length: windows.get_n_items() }, (_, index) => windows.get_item(index))
    .find(candidate => candidate instanceof Adw.PreferencesWindow);
if (!window)
    throw new Error('Settings did not create its native preferences root');
const application = window.get_application();
const development = application?.get_application_id() === 'org.monge.Settings.Development';
const backendModule = development ? GLib.getenv('MONGE_SETTINGS_TEST_BACKEND') : null;
const testModule = development ? GLib.getenv('MONGE_SETTINGS_TEST_MODULE') : null;
let backend;
let catalog;
let viewState;
try {
    const fixture = backendModule ? await import(backendModule) : null;
    backend = fixture ? await fixture.createBackend() : await createBackend();
    catalog = fixture?.createCatalog?.();
    viewState = createExtensionViewState({ applicationId: application.get_application_id() });
} catch (error) {
    const showFailure = () => {
        const panel = window.active_panel;
        if (panel?.get_name() === 'monge-extensions-panel') {
            const toolbar = new Adw.ToolbarView({ content: new Adw.StatusPage({ title: 'Extensions Unavailable',
                description: error.message, icon_name: 'dialog-error-symbolic' }) });
            toolbar.add_top_bar(new Adw.HeaderBar());
            panel.get_child().get_visible_page().set_child(toolbar);
        }
    };
    showFailure(); window.connect('notify::active-panel', showFailure);
    throw error;
}
export const controller = new ExtensionsController({ window, backend, catalog, viewState });
globalThis.mongeSettings = controller;
await controller.ready;
if (testModule) {
    application.hold();
    (await import(testModule)).run(controller)
        .catch(error => { logError(error); application.quit(); })
        .finally(() => application.release());
}
