import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import { NativeRoot, createExtensionsPanel } from './native-root.js';
Adw.init();
const loop = new GLib.MainLoop(null, false);
(async () => {
    try {
        const application = new Adw.Application({ application_id: 'org.monge.Settings.Development', flags: Gio.ApplicationFlags.NON_UNIQUE });
        application.register(null);
        const window = new NativeRoot({ application, default_width: 980, default_height: 640 });
        window.active_panel = createExtensionsPanel(); window.present();
        GLib.setenv('MONGE_SETTINGS_TEST_BACKEND', Gio.File.new_for_uri(import.meta.url).get_parent().get_child('application-backend.js').get_uri(), true);
        await import('../../panels/extensions/js/main.js');
        const controller = globalThis.mongeSettings;
        if (!controller?.current || controller.backend.calls.length) throw new Error('Startup must create the native panel without writing settings');
        if (window.get_content() !== window._shell) throw new Error('Startup must retain the actual Settings shell');
        await controller.close();
        print('PASS application bootstrap: isolated development backend and native Settings root');
    } catch (error) { logError(error); globalThis.failed = true; }
    finally { loop.quit(); }
})();
loop.run();
if (globalThis.failed) imports.system.exit(1);
