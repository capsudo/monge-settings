import Gtk from 'gi://Gtk?version=4.0';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Preferences extends ExtensionPreferences {
    getPreferencesWidget() {
        return new Gtk.Label({ label: 'Legacy preferences widget' });
    }
}
