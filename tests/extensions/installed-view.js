import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import { createFixtureBackend, extension } from './fixtures-backend.js';

Adw.init();
function assert(value, message) {
    if (!value) throw new Error(message);
}
function descendants(widget) {
    const result = [widget];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        result.push(...descendants(child));
    return result;
}
function groupRows(group) { return descendants(group).filter(child => child instanceof Adw.ActionRow); }
function equal(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
}
async function tick() {
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        resolve(); return GLib.SOURCE_REMOVE;
    }));
}
const implementation = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_child('panels/extensions/js/installed-view.js');
assert(implementation.query_exists(null), 'Installed view implementation is missing');
const { createInstalledView, createExtensionInfo } = await import('../../panels/extensions/js/installed-view.js');
const tests = [];
function test(name, run) { tests.push([name, run]); }

test('extension rows have an Apps-sized presentation icon on the left', async () => {
    const view = createInstalledView({ backend: createFixtureBackend([extension()]) });
    try {
        const row = view.rows.get('example@test');
        const icon = descendants(row).find(child => child instanceof Gtk.Image && child.icon_name === 'application-x-addon-symbolic');
        assert(icon?.icon_size === Gtk.IconSize.LARGE && icon.has_css_class('lowres-icon'), 'The prefix matches Apps icon sizing and styling');
        assert(icon.accessible_role === Gtk.AccessibleRole.PRESENTATION, 'The icon does not duplicate the row label for accessibility');
    } finally { view.stop(); }
});

test('extension rows load their custom catalog icons and cache them across refreshes', async () => {
    const backend = createFixtureBackend([extension()]);
    const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 32, 32); image.fill(0x335577ff);
    const bytes = image.save_to_bufferv('png', [], [])[1];
    let calls = 0;
    const catalog = { details: async ({ uuid }) => {
        equal(uuid, 'example@test', 'Icon lookup uses the extension UUID'); calls++;
        return { icon: '/extension-data/icons/example.png' };
    }, media: async ({ path }) => {
        equal(path, '/extension-data/icons/example.png', 'Icon fetch uses the catalog media path'); return bytes;
    } };
    const iconCache = new Map();
    const view = createInstalledView({ backend, catalog, iconCache });
    try {
        await view.whenIconsReady();
        const icon = view.rows.get('example@test')._icon;
        assert(icon.paintable?.get_width() === 32 && icon.pixel_size === 32, 'The real custom image replaces the generic icon at Apps size');
        await backend.setEnabled('example@test', false); await view.whenIconsReady();
        equal(calls, 1, 'Changing extension state does not refetch the icon');
    } finally { view.stop(); }
    const reopened = createInstalledView({ backend, catalog, iconCache });
    try { await reopened.whenIconsReady(); equal(calls, 1, 'Reopening the section reuses the decoded icon'); }
    finally { reopened.stop(); }
});

test('missing or failed custom icons keep the puzzle fallback', async () => {
    for (const result of [null, '/static/images/plugin.png', 'failure']) {
        const view = createInstalledView({ backend: createFixtureBackend([extension()]), catalog: {
            details: async () => { if (result === 'failure') throw new Error('offline'); return { icon: result }; },
            media: async () => { throw new Error('A default icon should not be downloaded'); },
        } });
        try {
            await view.whenIconsReady();
            assert(view.rows.get('example@test')._icon.icon_name === 'application-x-addon-symbolic', 'Missing custom icon retains the fallback');
        } finally { view.stop(); }
    }
});

test('retired icon loads are cancelled and cannot overwrite the fallback', async () => {
    let finish; let cancellation;
    const view = createInstalledView({ backend: createFixtureBackend([extension()]), catalog: {
        details: ({ cancellable }) => { cancellation = cancellable; return new Promise(resolve => { finish = resolve; }); },
        media: async () => { throw new Error('Retired loads must not fetch media'); },
    } });
    const done = view.whenIconsReady(); view.stop(); finish({ icon: '/extension-data/icons/example.png' }); await done;
    assert(cancellation.is_cancelled() && view.rows.get('example@test')._icon.icon_name === 'application-x-addon-symbolic',
        'Stopping the view cancels requests and ignores escaped replies');
});

test('switch and arrow positions match Color Management', async () => {
    const view = createInstalledView({ backend: createFixtureBackend([extension()]) });
    const reference = new Adw.ActionRow({ title: 'Color Management reference' });
    const referenceSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    const referenceButton = new Gtk.Button({ icon_name: 'pan-end-symbolic', valign: Gtk.Align.CENTER });
    referenceButton.add_css_class('flat');
    reference.add_suffix(referenceSwitch);
    reference.add_suffix(referenceButton);
    view.userGroup.add(reference);
    const window = new Adw.PreferencesWindow({ default_width: 900, default_height: 700 });
    window.add(view.widget); window.present(); await tick();
    try {
        const row = view.rows.get('example@test');
        const geometry = (owner, toggle, arrow) => {
            const [toggleMapped, toggleBounds] = toggle.compute_bounds(owner);
            const [arrowMapped, arrowBounds] = arrow.compute_bounds(owner);
            assert(toggleMapped && arrowMapped, 'Suffixes have allocated bounds');
            return {
                switchEnd: toggleBounds.get_x() + toggleBounds.get_width(),
                arrowCenter: arrowBounds.get_x() + arrowBounds.get_width() / 2,
            };
        };
        const actual = geometry(row, row._toggle, row._preferences);
        const expected = geometry(reference, referenceSwitch, referenceButton.get_child());
        equal(actual, expected, `Color Management positions: expected ${JSON.stringify(expected)}`);
    } finally { view.stop(); window.destroy(); }
});

test('whole extension row opens preferences while its switch remains independent', async () => {
    const backend = createFixtureBackend([extension()]);
    const opened = [];
    const view = createInstalledView({ backend, onPreferences: uuid => opened.push(uuid) });
    try {
        const row = view.rows.get('example@test');
        assert(row.activatable, 'The complete row is activatable');
        row.emit('activated');
        equal(opened, ['example@test'], 'Activating the row opens preferences once');
        equal(backend.calls, [], 'Row navigation does not change enabled state');
        switchFor(row).active = false;
        await tick();
        equal(opened, ['example@test'], 'Toggling the switch does not navigate');
        equal(backend.calls, [['extension', 'example@test', false]], 'The switch only changes enabled state');
        assert(row._preferences instanceof Gtk.Image, 'The arrow remains a presentation-only navigation image');
    } finally { view.stop(); }
});

test('installed rows end with switch then navigation arrow and no expander', async () => {
    const backend = createFixtureBackend([extension()]);
    const view = createInstalledView({ backend });
    try {
        const row = view.rows.get('example@test');
        const controls = descendants(row).filter(child =>
            (child instanceof Gtk.Image && child.icon_name === 'go-next-symbolic') ||
            child.get_name() === 'installed-enable' ||
            (child instanceof Gtk.Image && child.icon_name === 'adw-expander-arrow-symbolic'));
        equal(controls.map(child => child.get_name() === 'installed-enable' ? 'switch' : child.icon_name),
            ['switch', 'go-next-symbolic'], 'Switch precedes the sole right navigation arrow');
        assert(row instanceof Adw.ActionRow && !(row instanceof Adw.ExpanderRow), 'Installed row is not expandable');
    } finally { view.stop(); }
});

test('extension information is available separately from the installed row', async () => {
    assert(typeof createExtensionInfo === 'function', 'Extension information has a separate view');
    const info = createExtensionInfo(extension({ description: '<b>Literal description</b>', state: 3, error: 'Failure', version: 42 }));
    const labels = descendants(info.widget).filter(child => child instanceof Gtk.Label);
    for (const text of ['<b>Literal description</b>', 'example@test', 'Error', 'Failure', '42'])
        assert(labels.some(label => label.label === text && !label.use_markup), `Information text remains literal: ${text}`);
});

test('grouping and deterministic name/UUID order', async () => {
    const backend = createFixtureBackend([
        extension({ uuid: 'z@test', name: 'Alpha' }),
        extension({ uuid: 'system@test', name: 'System', type: 1 }),
        extension({ uuid: 'b@test', name: 'Beta' }),
        extension({ uuid: 'a@test', name: 'Alpha' }),
    ]);
    const view = createInstalledView({ backend });
    try {
        assert(view.widget instanceof Adw.PreferencesPage, 'Installed is a native preferences page');
        assert(view.rows instanceof Map && view.rows.size === 4, 'Expose rows keyed by UUID');
        assert(view.userGroup.title === 'User-Installed Extensions', 'User group title');
        assert(view.systemGroup.title === 'System Extensions', 'System group title');
        equal(groupRows(view.userGroup).map(row => row.subtitle), ['a@test', 'z@test', 'b@test'], 'Alphabetic user order');
        equal(groupRows(view.systemGroup).map(row => row.subtitle), ['system@test'], 'System grouping');
        equal(backend.calls, [], 'Startup never writes state or refreshes');
        assert(backend.listeners.size === 1, 'One subscription per view');
    } finally { view.stop(); }
});

test('global warning, independent preferences arrow/switch and literal metadata', async () => {
    const backend = createFixtureBackend([
        extension({ name: '<b>Not markup</b>', description: '<i>Literal description</i>' }),
        extension({ uuid: 'no-prefs@test', hasPrefs: false }),
    ]);
    const opened = [];
    const view = createInstalledView({ backend, onPreferences: uuid => opened.push(uuid) });
    const window = new Adw.PreferencesWindow({ default_width: 900, default_height: 700 });
    window.add(view.widget);
    window.present();
    await tick();
    try {
        assert(view.globalSwitch instanceof Adw.SwitchRow, 'Native global switch row');
        assert(view.globalSwitch.subtitle === 'Extensions can cause performance and stability issues', 'Global stability warning');
        assert(descendants(view.globalSwitch).some(child => child instanceof Gtk.Image && child.icon_name === 'application-x-addon-symbolic'), 'Extension puzzle prefix');
        assert(view.globalSwitch.get_parent() !== view.userGroup, 'Global switch is separate from extension groups');
        const row = view.rows.get('example@test');
        const arrow = descendants(row).find(child => child instanceof Gtk.Image && child.icon_name === 'go-next-symbolic');
        const toggle = switchFor(row);
        assert(arrow?.visible, 'Preferences use the native right arrow image');
        assert(toggle, 'Enabled state uses its own suffix switch');
        assert(view.rows.get('no-prefs@test').activatable && view.rows.get('no-prefs@test').tooltip_text === 'Extension Information', 'Information remains accessible without preferences');
        assert(!descendants(row).some(child => child instanceof Gtk.Button && child.icon_name === 'emblem-system-symbolic'), 'No preferences cog');
        assert(!descendants(row).some(child => child instanceof Gtk.Image && child.icon_name === 'adw-expander-arrow-symbolic'), 'No downward details chevron');
        row.emit('activated');
        equal(opened, ['example@test'], 'Arrow invokes preferences only');
        assert(toggle.active, 'Preferences click does not toggle');
        equal(backend.calls, [], 'Preferences click causes no backend writes');
        for (const text of ['<b>Not markup</b>', 'example@test']) {
            const label = descendants(row).find(child => child instanceof Gtk.Label && child.label === text);
            assert(label && !label.use_markup, `Untrusted text remains literal: ${text}`);
        }
    } finally { view.stop(); window.destroy(); }
});

function switchFor(row) { return descendants(row).find(child => child instanceof Gtk.Switch && child.get_name() === 'installed-enable'); }

test('global async requests preserve saved per-extension state and rollback', async () => {
    const backend = createFixtureBackend([extension()]);
    const errors = [];
    const view = createInstalledView({ backend, onError: error => errors.push(error.message) });
    let finish;
    backend.setUserExtensionsEnabled = enabled => {
        backend.calls.push(['global', enabled]);
        return new Promise(resolve => { finish = () => { backend.userExtensionsEnabled = enabled; backend.notify(); resolve(); }; });
    };
    try {
        view.globalSwitch.active = false;
        equal(backend.calls, [['global', false]], 'Global toggle issues exactly one request');
        assert(!view.globalSwitch.sensitive, 'Global control disables during request');
        assert(switchFor(view.rows.get('example@test')).active && !switchFor(view.rows.get('example@test')).sensitive, 'Global off preserves saved active flag and locks individual switch');
        assert(view.rows.get('example@test').activatable, 'Preferences remain accessible globally off');
        finish();
        await tick();
        assert(view.globalSwitch.sensitive && !view.globalSwitch.active, 'Global off settles to backend state');
        backend.setUserExtensionsEnabled = async enabled => { backend.calls.push(['global', enabled]); throw new Error('global denied'); };
        view.globalSwitch.active = true;
        await tick();
        assert(!view.globalSwitch.active && view.globalSwitch.sensitive, 'Failed global request rolls back and unlocks');
        equal(errors, ['global denied'], 'Global failure reports error');
        equal(backend.calls, [['global', false], ['global', true]], 'Notifications and rollback never recursively write');
        backend.writable = false;
        backend.notify();
        assert(!view.globalSwitch.sensitive, 'Locked backend disables global control');
    } finally { view.stop(); }
});

test('individual async requests disable only the switch and roll back failures', async () => {
    const backend = createFixtureBackend([extension()]);
    const errors = [];
    const view = createInstalledView({ backend, onError: error => errors.push(error.message) });
    let finish;
    backend.setEnabled = (uuid, enabled) => {
        backend.calls.push(['extension', uuid, enabled]);
        return new Promise(resolve => { finish = () => { backend.extensions[0].enabled = enabled; backend.notify(); resolve(); }; });
    };
    try {
        const row = view.rows.get('example@test');
        const toggle = switchFor(row);
        toggle.active = false;
        equal(backend.calls, [['extension', 'example@test', false]], 'One individual request');
        assert(!toggle.sensitive && !(row instanceof Adw.ExpanderRow), 'Switch locks without exposing details');
        assert(row.activatable, 'Busy switch preserves preferences access');
        backend.notify();
        assert(!toggle.active && !toggle.sensitive, 'Live event cannot undo pending switch request');
        finish();
        await tick();
        assert(view.rows.get('example@test') === row && !toggle.active && toggle.sensitive, 'Successful update preserves control and unlocks');
        backend.setEnabled = async (uuid, enabled) => { backend.calls.push(['extension', uuid, enabled]); throw new Error('extension denied'); };
        toggle.active = true;
        await tick();
        assert(!toggle.active && toggle.sensitive, 'Individual failure restores saved flag and sensitivity');
        equal(errors, ['extension denied'], 'Individual errors reported once');
        equal(backend.calls, [['extension', 'example@test', false], ['extension', 'example@test', true]], 'No feedback loop writes');
    } finally { view.stop(); }
});

test('locked extensions honor canChange without removing preferences', async () => {
    const backend = createFixtureBackend([
        extension({ canChange: false, state: 3 }),
        extension({ uuid: 'old@test', canChange: false, state: 4 }),
        extension({ uuid: 'authoritative@test', canChange: true, state: 3 }),
    ]);
    const opened = [];
    const view = createInstalledView({ backend, onPreferences: uuid => opened.push(uuid) });
    try {
        for (const uuid of ['example@test', 'old@test']) {
            const row = view.rows.get(uuid);
            assert(!switchFor(row).sensitive && switchFor(row).active, 'Locked extension retains saved active flag');
            row.emit('activated');
        }
        equal(opened, ['example@test', 'old@test'], 'Locked extension still opens preferences');
        assert(switchFor(view.rows.get('authoritative@test')).sensitive, 'canChange is authoritative over state');
        equal(backend.calls, [], 'Locked rendering and preferences never write');
        backend.extensions[0].canChange = true;
        backend.notify();
        assert(switchFor(view.rows.get('example@test')).sensitive, 'Live canChange update unlocks extension');
    } finally { view.stop(); }
});

test('separate information shows literal errors/version and only safe HTTPS links', async () => {
    const urls = ['http://example.org/', 'javascript:alert(1)', 'file:///etc/passwd', 'https://',
        'https://user:secret@example.org/', 'https://example.org/\nother', 'https://example.org\\evil'];
    const backend = createFixtureBackend([
        extension({ state: 3, error: '<b>Failure & details</b>', version: 42 }),
        ...urls.map((url, index) => extension({ uuid: `unsafe-${index}@test`, url })),
    ]);
    const info = createExtensionInfo(backend.extensions[0]);
    {
        const row = info.widget;
        const labels = descendants(row).filter(child => child instanceof Gtk.Label);
        for (const text of ['Error', '<b>Failure & details</b>', '42'])
            assert(labels.some(label => label.label === text && !label.use_markup), `Literal detail: ${text}`);
        const link = descendants(row).find(child => child instanceof Gtk.LinkButton);
        assert(link?.uri === 'https://example.org/', 'HTTPS website detail');
        for (const [index] of urls.entries())
            assert(!descendants(createExtensionInfo(backend.extensions[index + 1]).widget).some(child => child instanceof Gtk.LinkButton && child.visible), 'Unsafe website has no visible link');
        backend.extensions[0] = { ...backend.extensions[0], state: 4, error: '', version: 43, url: '' };
        info.update(backend.extensions[0]);
        assert(descendants(row).some(child => child instanceof Gtk.Label && child.label === 'Out of Date'), 'State details update live');
        assert(!descendants(row).some(child => child instanceof Gtk.Label && child.label === '<b>Failure & details</b>'), 'Stale error removed');
        assert(descendants(row).some(child => child instanceof Gtk.Label && child.label === '43'), 'Version detail updates live');
    }
});

test('live metadata/add/remove/regroup preserve rows and empty groups', async () => {
    const backend = createFixtureBackend([extension(), extension({ uuid: 'system@test', type: 1 })]);
    const opened = [];
    const view = createInstalledView({ backend, onPreferences: uuid => opened.push(uuid) });
    try {
        const row = view.rows.get('example@test');
        backend.extensions = [extension({ uuid: 'added@test', name: 'Alpha' }),
            extension({ name: 'Changed', description: 'New description', type: 1, hasPrefs: false, enabled: false })];
        backend.notify();
        assert(view.rows.size === 2 && !view.rows.has('system@test'), 'Deletion removes UUID from map');
        assert(view.rows.get('example@test') === row, 'UUID retains native row');
        equal(groupRows(view.userGroup).map(item => item.subtitle), ['added@test'], 'Added user row');
        equal(groupRows(view.systemGroup).map(item => item.subtitle), ['example@test'], 'Changed type moves row');
        assert(row.title === 'Changed' && !switchFor(row).active, 'Metadata and saved enabled state update');
        assert(!descendants(row).some(child => child instanceof Gtk.Label && child.label === 'New description'), 'Description lives on the extension subpage');
        assert(row.tooltip_text === 'Extension Information' && row.activatable, 'hasPrefs changes retain information access');
        backend.extensions[1].hasPrefs = true;
        for (let i = 0; i < 4; i++) backend.notify();
        row.emit('activated');
        equal(opened, ['example@test'], 'Live events never duplicate preferences callbacks');
        equal(backend.calls, [], 'Live events never write backend state');
        backend.extensions = [];
        backend.notify();
        assert(view.rows.size === 0 && groupRows(view.userGroup).length === 0 && groupRows(view.systemGroup).length === 0, 'All deleted widgets leave their groups');
        assert(view.userGroup.visible && view.userGroup.description === 'No user-installed extensions', 'Empty user group explains absence');
        assert(!view.systemGroup.visible, 'Empty system group hidden');
        view.stop();
        view.stop();
        assert(backend.listeners.size === 0, 'Stop is idempotent and unsubscribes');
        backend.extensions = [extension()];
        backend.notify();
        assert(view.rows.size === 0, 'Stopped view ignores future events');
    } finally { view.stop(); }
});

test('suffix controls end with enabled switch then navigation arrow', async () => {
    const backend = createFixtureBackend([extension()]);
    const view = createInstalledView({ backend });
    try {
        const controls = descendants(view.rows.get('example@test')).filter(child =>
            (child instanceof Gtk.Image && child.icon_name === 'go-next-symbolic') ||
            child.get_name() === 'installed-enable' ||
            (child instanceof Gtk.Image && child.icon_name === 'adw-expander-arrow-symbolic'));
        equal(controls.map(child => child.get_name() === 'installed-enable' ? 'switch' : child.icon_name),
            ['switch', 'go-next-symbolic'], 'Screenshot suffix order');
    } finally { view.stop(); }
});

test('stop locks controls and ignores pending completions', async () => {
    const backend = createFixtureBackend([extension(), extension({ uuid: 'second@test' })]);
    const errors = [];
    const opened = [];
    let rejectRequest;
    backend.setEnabled = (uuid, enabled) => {
        backend.calls.push(['extension', uuid, enabled]);
        return new Promise((_resolve, reject) => { rejectRequest = reject; });
    };
    const view = createInstalledView({ backend, onError: error => errors.push(error), onPreferences: uuid => opened.push(uuid) });
    const row = view.rows.get('example@test');
    switchFor(row).active = false;
    view.stop();
    assert(backend.listeners.size === 0, 'Stop removes subscription during request');
    assert(!view.globalSwitch.sensitive && !switchFor(view.rows.get('second@test')).sensitive, 'Stop locks non-busy controls too');
    row.emit('activated');
    view.globalSwitch.active = false;
    rejectRequest(new Error('late error'));
    await tick();
    equal(errors, [], 'Stopped view suppresses late error presentation');
    equal(opened, [], 'Stopped arrows cannot navigate');
    equal(backend.calls, [['extension', 'example@test', false]], 'Stopped controls cannot write');
    assert(!switchFor(row).sensitive, 'Late completion cannot unlock stopped control');
});

test('global-off startup and backend-only updates never request state writes', async () => {
    const backend = createFixtureBackend([extension({ state: 2 })]);
    backend.userExtensionsEnabled = false;
    const view = createInstalledView({ backend });
    try {
        const toggle = switchFor(view.rows.get('example@test'));
        assert(!view.globalSwitch.active && toggle.active && !toggle.sensitive, 'Startup global off preserves requested flag rather than runtime state');
        backend.userExtensionsEnabled = true;
        backend.notify();
        assert(view.globalSwitch.active && toggle.active && toggle.sensitive, 'Backend global enable restores individual sensitivity');
        view.globalSwitch.active = false;
        await tick();
        view.globalSwitch.active = true;
        await tick();
        equal(backend.calls, [['global', false], ['global', true]], 'Successful global requests write once each');
        assert(view.globalSwitch.active && toggle.active && toggle.sensitive, 'Successful global enable retains saved enabled state');
        backend.calls.length = 0;
        backend.extensions[0].enabled = false;
        backend.notify();
        assert(!toggle.active, 'External requested flag updates visible switch');
        equal(backend.calls, [], 'Programmatic synchronization never writes');
    } finally { view.stop(); }
});

for (const [name, run] of tests) {
    await run();
    print(`PASS ${name}`);
}
print(`PASS installed-view: ${tests.length} tests`);
