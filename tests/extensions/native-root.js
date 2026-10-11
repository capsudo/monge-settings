import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
export const NativeRoot = GObject.registerClass({
    Properties: {
        'active-panel': GObject.ParamSpec.object('active-panel', '', '', GObject.ParamFlags.READWRITE, Adw.NavigationPage.$gtype),
        'monge-preferences-content': GObject.ParamSpec.object('monge-preferences-content', '', '', GObject.ParamFlags.READABLE, Gtk.Widget.$gtype),
        'monge-emitting-close': GObject.ParamSpec.boolean('monge-emitting-close', '', '', GObject.ParamFlags.READWRITE, false),
        'monge-close-accepted': GObject.ParamSpec.boolean('monge-close-accepted', '', '', GObject.ParamFlags.READABLE, false),
    },
    Signals: { 'monge-preferences-loaded': {}, 'monge-request-panel': { return_type: GObject.TYPE_BOOLEAN, param_types: [GObject.TYPE_STRING] },
        'monge-continue-panel': {}, 'monge-back': { return_type: GObject.TYPE_BOOLEAN } },
}, class NativeRoot extends Adw.PreferencesWindow {
    _init(properties = {}) {
        super._init(properties);
        this._nativeContent = this.get_content(); this.set_content(null);
        this._shell = new Gtk.Box(); this.set_content(this._shell);
    }
    get active_panel() { return this._panel ?? null; }
    set active_panel(value) {
        if (this._panel) this._shell.remove(this._panel);
        this._panel = value; if (value) this._shell.append(value); this.notify('active-panel');
    }
    get monge_preferences_content() { return this._nativeContent; }
    get monge_emitting_close() { return this._emitting ?? false; }
    set monge_emitting_close(value) { this._emitting = value; if (value) this._accepted = false; }
    get monge_close_accepted() { return this._accepted ?? false; }
    vfunc_close_request() { this._accepted = true; return false; }
});
export function createExtensionsPanel() {
    const navigation = new Adw.NavigationView();
    navigation.add(new Adw.NavigationPage({ title: 'Extensions', tag: 'extensions-list' }));
    return new Adw.NavigationPage({ title: 'Extensions', name: 'monge-extensions-panel', child: navigation });
}
