import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.search_enabled = true;
        if (ExtensionPreferences.lookupByUUID(this.uuid) !== this)
            throw new Error('UUID lookup did not return the current preferences object');
        if (ExtensionPreferences.lookupByURL(import.meta.url) !== this)
            throw new Error('URL lookup did not return the current preferences object');
        this.getSettings().set_boolean('enabled', true);
        for (const title of ['Layout', 'Colors', 'Profiles']) {
            const page = new Adw.PreferencesPage({ title, name: title.toLowerCase() });
            const group = new Adw.PreferencesGroup();
            group.add(new Adw.SwitchRow({ title: this.gettext('Fixture setting') }));
            page.add(group);
            window.add(page);
        }
        window.add_toast(new Adw.Toast({ title: 'Fixture toast' }));
        this.closed = false;
        window.connect('close-request', () => {
            this.closed = true;
            window.destroy();
            return false;
        });
    }
}
