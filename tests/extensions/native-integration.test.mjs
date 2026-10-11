import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Settings retains a real preferences-window root for native extension preferences', () => {
    assert.match(read('shell/cc-window.h'), /G_DECLARE_FINAL_TYPE \(CcWindow, cc_window, CC, WINDOW, AdwPreferencesWindow\)/);
    assert.match(read('shell/cc-window.c'), /G_DEFINE_TYPE_WITH_CODE \(CcWindow, cc_window, ADW_TYPE_PREFERENCES_WINDOW,/);
    assert.match(read('shell/cc-window.blp'), /template \$CcWindow: Adw.PreferencesWindow/);
    assert.match(read('shell/cc-window.c'), /monge-preferences-content/);
    assert.doesNotMatch(read('shell/cc-window.c'), /"show-menubar", FALSE/);
});

test('Extensions is registered as an actual Settings panel', () => {
    assert.match(read('panels/meson.build'), /'extensions',/);
    assert.match(read('shell/cc-panel-loader.c'), /PANEL_TYPE\("extensions",\s+cc_extensions_panel_get_type,/);
    assert.ok(existsSync(new URL('../../panels/extensions/meson.build', import.meta.url)));
    assert.match(read('panels/extensions/gnome-extensions-panel.desktop.in'), /^Name=Extensions$/m);
    assert.match(read('shell/cc-panel-list.c'), /"background",\s*"extensions",/);
});

test('native navigation is deferred until asynchronous preferences retirement is accepted', () => {
    assert.match(read('shell/cc-window.c'), /monge-request-panel/);
    assert.match(read('shell/cc-window.c'), /monge-continue-panel/);
    assert.match(read('shell/cc-window.c'), /monge-emitting-close/);
    assert.match(read('shell/cc-window.c'), /monge-close-accepted/);
    assert.match(read('shell/cc-application.c'), /if \(self->window\)\s+gtk_window_close \(GTK_WINDOW \(self->window\)\);/);
});
