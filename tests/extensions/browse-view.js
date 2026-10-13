import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Soup from 'gi://Soup?version=3.0';

Adw.init();
function assert(value, message) {
    if (!value)
        throw new Error(message);
}
function descendants(widget) {
    const result = [widget];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        result.push(...descendants(child));
    return result;
}
function named(widget, name) {
    return descendants(widget).find(child => child.get_name() === name);
}
async function waitFor(predicate, message) {
    const deadline = GLib.get_monotonic_time() + 3000000;
    while (!predicate()) {
        assert(GLib.get_monotonic_time() < deadline, message);
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
    }
}
const implementation = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_child('panels/extensions/js/browse-view.js');
assert(implementation.query_exists(null), 'Browse view implementation is missing');
const { createBrowseView } = await import('../../panels/extensions/js/browse-view.js');
const { createCatalog } = await import('../../panels/extensions/js/catalog.js');
const { createExtensionDetails } = await import('../../panels/extensions/js/extension-details.js');
const requests = [];
const item = { uuid: 'example@test', name: '<b>Example</b>', description: '<b>Plain description</b> & text',
    creator: 'Author & Co', pk: 123, link: '/extension/123/example/', shell_version_map: { '49': {} } };
let responder = query => ({ status: 200, data: { extensions: [query.page === '2'
    ? { ...item, uuid: 'second@test', name: 'Second page' } : item], numpages: 2 } });
const server = new Soup.Server();
server.add_handler('/extension-query/', (_server, message, _path, query) => {
    requests.push({ ...query });
    const response = responder(query);
    message.set_status(response.status, null);
    message.set_response('application/json', Soup.MemoryUse.COPY,
        new TextEncoder().encode(JSON.stringify(response.data)));
    if (response.delay) {
        message.pause();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, response.delay, () => {
            message.unpause();
            return GLib.SOURCE_REMOVE;
        });
    }
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const catalog = createCatalog({ shellVersion: '49.4', endpoint: `${server.get_uris()[0].to_string()}extension-query/` });
const requestState = [];
const observedCatalog = {
    query(options) {
        const record = { cancellable: options.cancellable };
        requestState.push(record);
        // keep real HTTP for the race regression but simulate a completion that escaped cancellation.
        const transportOptions = options.search.startsWith('uncancellable') ? { ...options, cancellable: null } : options;
        return catalog.query(transportOptions).then(result => {
            record.done = true;
            return result;
        }, error => {
            record.done = true;
            record.error = error;
            throw error;
        });
    },
};
const details = [];
const detailViews = [];
const installCalls = []; const installErrors = []; let finishInstall; let installMode = 'pending'; let installAllowed = true;
let view;
const window = new Adw.PreferencesWindow({ default_width: 960, default_height: 640, search_enabled: false });
try {
    view = createBrowseView({ shellVersion: '49.4', installedUuids: new Set([item.uuid]), catalog: observedCatalog,
        canInstall: () => installAllowed, onError: error => installErrors.push(error),
        onInstall: async uuid => {
            installCalls.push(uuid);
            if (installMode === 'failed') throw new Error('Installation rejected');
            if (installMode === 'successful') return { uuid };
            return new Promise(resolve => { finishInstall = resolve; });
        },
        onDetails: selected => {
            const detail = createExtensionDetails({ item: selected, catalog: observedCatalog, installed: selected.uuid === item.uuid });
            detailViews.push(detail); details.push(detail.widget);
        } });
    assert(view.widget instanceof Gtk.Widget, 'Browse sidebar must be a GTK widget');
    assert(view.widget instanceof Gtk.ScrolledWindow && descendants(view.widget).some(child => child instanceof Adw.Clamp && child.maximum_size === 720),
        'Browse scrolls at main view level and retains the Details content width');
    const scrollAncestors = [];
    for (let parent = named(view.widget, 'browse-results').get_parent(); parent; parent = parent.get_parent())
        if (parent instanceof Gtk.ScrolledWindow) scrollAncestors.push(parent);
    assert(scrollAncestors.length === 1 && scrollAncestors[0] === view.widget, 'Browse results use only the main view scrollbar');
    assert(named(view.widget, 'browse-sort-icon')?.icon_name === 'view-sort-descending-symbolic', 'Sort uses the reference icon instead of a text prefix');
    assert(Object.keys(view).sort().join(',') === 'start,stop,updateInstalled,widget', 'Parent-facing API must stay small');
    const nativeContent = window.get_content();
    window.set_content(null);
    const layout = new Adw.OverlaySplitView({ sidebar: view.widget, content: nativeContent });
    window.set_content(layout);
    window.present();
    await waitFor(() => view.widget.get_width() > 0, 'Sidebar must receive a real allocation');
    assert(requests.length === 0, 'Constructing the Browse view must not start network requests');
    view.start();
    const state = named(view.widget, 'browse-state');
    assert(state instanceof Gtk.Stack && state.visible_child_name === 'loading', 'Loading must be visible before the response arrives');
    const list = named(view.widget, 'browse-results');
    await waitFor(() => list?.get_row_at_index(0), 'Starting Browse must load catalog rows');
    assert(requests.length === 1 && requests[0].shell_version === '49.4', 'Start must use proxy ShellVersion');
    assert(details.length === 0 && !list.get_selected_row(), 'Initial catalog must leave the right default to the parent');
    assert(nativeContent.get_root() === window && view.widget.get_root() === window, 'Both panes share the original preferences root');
    assert(!window.search_enabled, 'Browse must not enable a search header button');
    assert(named(view.widget, 'browse-search') instanceof Gtk.SearchEntry, 'Search belongs inside Browse, not the header');
    const labels = descendants(list.get_row_at_index(0)).filter(child => child instanceof Gtk.Label);
    for (const text of [item.name, item.description, item.creator, 'Installed'])
        assert(labels.some(label => label.label === text && !label.use_markup), `Plain row text missing: ${text}`);
    assert(!descendants(view.widget).some(child => child instanceof Gtk.Switch), 'Browse must not expose enable controls');
    view.start();
    assert(requests.length === 1, 'Start is idempotent while active');
    print('PASS browse: lazy read-only catalog, in-page search, installed marker and persistent preferences root');
    list.emit('row-activated', list.get_row_at_index(0));
    assert(details.length === 1 && details[0] instanceof Gtk.Widget, 'Selection must deliver a real detail widget to the parent');
    const detailLabels = descendants(details[0]).filter(child => child instanceof Gtk.Label);
    for (const text of [item.name, item.description, `By ${item.creator}`, 'Remove…'])
        assert(detailLabels.some(label => label.label === text && !label.use_markup), `Plain details text missing: ${text}`);
    const actions = descendants(details[0]).filter(child => child instanceof Gtk.LinkButton);
    assert(actions.length === 1 && actions[0] instanceof Gtk.LinkButton &&
        actions[0].uri === 'https://extensions.gnome.org/extension/123/example/', 'The sole detail action must be the validated GNOME website');
    assert(nativeContent.get_root() === window, 'Selection callback must not mutate native preferences');
    layout.content = details[0];
    assert(details[0].get_root() === window && view.widget.get_root() === window, 'Parent can show details in the same preferences root');
    print('PASS browse: selected item details are plain text with a GNOME-only external website action');
    const more = named(view.widget, 'browse-more');
    assert(more instanceof Adw.ButtonRow && more.sensitive && more.get_parent().visible && list.has_css_class('boxed-list'),
        'Boxed catalog rows have a full-width Load More Results button');
    assert(!named(view.widget, 'browse-next') && !named(view.widget, 'browse-previous'), 'Page navigation is removed');
    const firstRow = list.get_row_at_index(0);
    responder = () => ({ status: 503, data: {} });
    more.emit('activated');
    await waitFor(() => requests.at(-1)?.page === '2' && more.sensitive, 'Failed Load More request settles');
    assert(list.get_row_at_index(0) === firstRow && more.get_parent().visible,
        'Failed Load More preserves existing results and offers retry');
    responder = query => ({ status: 200, data: { extensions: [item, { ...item, uuid: 'second@test', name: 'Second page' }], numpages: 2 } });
    more.emit('activated');
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.page === '2' && more.sensitive && !more.get_parent().visible,
        'Retry appends page two after a failed Load More request');
    assert(!more.get_parent().visible && list.get_row_at_index(1)?._catalogItem.uuid === 'second@test' &&
        list.get_row_at_index(0)?._catalogItem.uuid === item.uuid, 'Load More appends results and hides at the last page');
    const installButton = list.get_row_at_index(1)._install;
    const beforeInstallDetails = details.length;
    installButton.emit('clicked'); installButton.emit('clicked');
    assert(installCalls.join(',') === 'second@test' && !installButton.sensitive && installButton.label === 'Installing…',
        'Row installation uses the exact UUID and prevents duplicate requests');
    assert(details.length === beforeInstallDetails, 'Install button does not open Details');
    finishInstall(null);
    await waitFor(() => installButton.sensitive, 'Cancelled row installation restores Install');
    installMode = 'failed'; installButton.emit('clicked');
    await waitFor(() => installErrors.length === 1 && installButton.sensitive, 'Failed row installation reports an error and restores Install');
    installAllowed = false; view.updateInstalled([item.uuid]);
    assert(!installButton.sensitive, 'Row installation respects Shell policy');
    installAllowed = true; view.updateInstalled([item.uuid]);
    installMode = 'successful'; installButton.emit('clicked');
    await waitFor(() => installButton.label === 'Installed' && !installButton.sensitive, 'Confirmed row installation transitions to Installed');
    print('PASS browse: Load More retains previous rows and follows the known final page');
    responder = query => ({ status: 200, data: { extensions: [{ ...item, name: `Result ${query.search}` }], numpages: 1 } });
    const beforeSearch = requests.length;
    const search = named(view.widget, 'browse-search');
    search.text = 'discard intermediate';
    search.text = 'clock & café/?';
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.search === 'clock & café/?', 'In-page search must reach the catalog');
    assert(requests.length === beforeSearch + 1 && requests.at(-1).page === '1', 'Search must debounce rapid edits and reset pagination');
    assert(descendants(list).some(child => child instanceof Gtk.Label && child.label === 'Result clock & café/?'), 'Search result must replace the old page');
    print('PASS browse: in-page search debounces edits, preserves encoded text and resets to page one');
    responder = () => ({ status: 200, data: { extensions: [], numpages: 0 } });
    search.text = 'no matches';
    await waitFor(() => state.visible_child_name === 'empty', 'No matching catalog rows must show an empty state');
    assert(!list.get_row_at_index(0) && !more.get_parent().visible,
        'Empty state must have no stale rows or misleading pagination');
    assert(descendants(state.visible_child).some(child => child instanceof Gtk.Label && child.label === 'No Extensions Found'), 'Empty state must explain the result');
    print('PASS browse: empty catalog is explicit and clears stale rows and pagination');
    responder = () => ({ status: 503, data: { extensions: [], numpages: 0 } });
    search.text = 'offline';
    await waitFor(() => state.visible_child_name === 'error', 'Failed request must show an error rather than an empty catalog');
    const retry = named(view.widget, 'browse-retry');
    assert(retry instanceof Gtk.Button && retry.sensitive && !more.get_parent().visible, 'Error state must offer retry only');
    responder = () => ({ status: 200, data: { extensions: [{ ...item, link: 'https://attacker.test/' }], numpages: 1 } });
    retry.emit('clicked');
    await waitFor(() => state.visible_child_name === 'results', 'Retry must recover without reconstructing the view');
    assert(requests.at(-1).search === 'offline' && requests.at(-1).page === '1', 'Retry must preserve the failed query');
    list.emit('row-activated', list.get_row_at_index(0));
    assert(!descendants(details.at(-1)).some(child => child instanceof Gtk.LinkButton), 'Unsafe catalog website must not create any link action');
    print('PASS browse: error retry preserves query and invalid websites expose no action');
    responder = () => ({ status: 200, delay: 250, data: { extensions: [item], numpages: 1 } });
    search.text = 'slow stopped';
    await waitFor(() => requests.at(-1)?.search === 'slow stopped', 'Delayed request must reach the real Soup server');
    const pending = requestState.at(-1);
    const detailCount = details.length;
    view.stop();
    assert(pending.cancellable?.is_cancelled(), 'Stop must cancel the current request immediately');
    await waitFor(() => pending.done, 'Cancelled request must settle');
    assert(pending.error?.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED), 'Real Soup transport must report cancellation');
    assert(state.visible_child_name !== 'error' && !list.get_row_at_index(0) && details.length === detailCount,
        'Stopped callbacks must not repaint errors, rows or details');
    responder = () => ({ status: 200, data: { extensions: [item], numpages: 1 } });
    const sameWidget = view.widget;
    view.start();
    await waitFor(() => state.visible_child_name === 'results', 'Browse must restart on the same sidebar');
    assert(view.widget === sameWidget && details.length === detailCount, 'Restart must preserve the widget and leave right-pane defaults to the parent');
    const countBeforeStop = requests.length;
    search.text = 'debounce must not send';
    view.stop();
    view.stop();
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
    assert(requests.length === countBeforeStop, 'Stop must remove the pending search debounce');
    print('PASS browse: stop cancels real transport, discards callbacks and debounce, and restart reuses the widget');
    view.start();
    await waitFor(() => state.visible_child_name === 'results', 'Restart before supersession regression');
    responder = query => ({ status: 200, delay: query.search.startsWith('uncancellable') ? 70 : 0,
        data: { extensions: [{ ...item, name: `Result ${query.search}` }], numpages: 1 } });
    search.text = 'uncancellable old';
    await waitFor(() => requests.at(-1)?.search === 'uncancellable old', 'Old request must reach the real server');
    const oldRequest = requestState.at(-1);
    search.text = 'latest';
    assert(oldRequest.cancellable.is_cancelled(), 'Typing must invalidate and cancel immediately, not after the debounce');
    await waitFor(() => oldRequest.done, 'Escaped old completion must arrive');
    assert(!list.get_row_at_index(0) && state.visible_child_name === 'loading', 'An escaped old success must not render while the new search is debouncing');
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.search === 'latest', 'Latest search must replace the old request');
    assert(descendants(list).some(child => child instanceof Gtk.Label && child.label === 'Result latest'), 'Only latest results may render');
    responder = query => ({ status: query.search.startsWith('uncancellable') ? 503 : 200,
        delay: query.search.startsWith('uncancellable') ? 350 : 0,
        data: { extensions: [{ ...item, name: `Result ${query.search}` }], numpages: 1 } });
    search.text = 'uncancellable error';
    await waitFor(() => requests.at(-1)?.search === 'uncancellable error', 'Old error must reach the server');
    const oldError = requestState.at(-1);
    search.text = 'new success';
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.search === 'new success', 'Latest request must complete before the old error');
    await waitFor(() => oldError.done, 'Escaped stale HTTP failure must settle');
    assert(oldError.error && state.visible_child_name === 'results' &&
        descendants(list).some(child => child instanceof Gtk.Label && child.label === 'Result new success'), 'A stale error must not replace newer results');
    print('PASS browse: immediate supersession discards escaped stale successes and errors');
    responder = query => ({ status: 200, delay: query.search.startsWith('uncancellable') ? 300 : 0,
        data: { extensions: [{ ...item, name: `Result ${query.search}` }], numpages: 1 } });
    search.text = 'uncancellable stopped';
    await waitFor(() => requests.at(-1)?.search === 'uncancellable stopped', 'Escaped request must reach the server before stopping');
    const stoppedRequest = requestState.at(-1);
    view.stop();
    search.text = 'fresh after stop';
    view.start();
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.search === 'fresh after stop', 'Fresh request must complete after restart');
    await waitFor(() => stoppedRequest.done, 'Old completion must arrive after restart');
    assert(state.visible_child_name === 'results' &&
        descendants(list).some(child => child instanceof Gtk.Label && child.label === 'Result fresh after stop'),
    'A completion from the stopped session must not repaint the restarted sidebar');
    print('PASS browse: escaped completion from a stopped session cannot overwrite a restart');
    const multiline = 'First paragraph.\n\nSecond paragraph.\n'.repeat(12);
    responder = () => ({ status: 200, data: { extensions: [{ ...item, description: multiline }], numpages: 1 } });
    search.text = 'multiline preview';
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.search === 'multiline preview',
        'Multiline description must reach the sidebar');
    assert(descendants(list).some(child => child instanceof Gtk.Label &&
        child.label === multiline.replace(/\s+/g, ' ').trim()),
    'Sidebar previews must collapse paragraph breaks so the two-line limit bounds the whole summary');
    list.emit('row-activated', list.get_row_at_index(0));
    assert(descendants(details.at(-1)).some(child => child instanceof Gtk.Label && child.label === multiline),
        'Full details must preserve the original multiline description');
    print('PASS browse: compact multiline sidebar previews preserve full descriptions in details');
    responder = query => ({ status: 200, data: { extensions: query.page === '2'
        ? [{ ...item, uuid: '' }, { ...item, shell_version_map: { '48': {} } }]
        : [{ ...item, uuid: `page-${query.page}@test`, name: `Catalog page ${query.page}` }], numpages: 3 } });
    const beforeFilteredPages = requests.length;
    search.text = 'filtered middle page';
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.search === 'filtered middle page',
        'Three-page catalog must load its first page');
    assert(more.sensitive && more.get_parent().visible, 'First catalog page exposes Load More');
    more.emit('activated');
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.page === '2' && more.sensitive,
        'Actual catalog filtering must remove malformed and incompatible middle-page items');
    assert(list.get_row_at_index(0)?._catalogItem.uuid === 'page-1@test', 'Filtered middle page preserves existing results');
    assert(more.sensitive && more.get_parent().visible, 'Filtered middle page still allows Load More');
    more.emit('activated');
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.page === '3' && more.sensitive,
        'Next from a filtered empty page must reach the third page');
    assert(!more.get_parent().visible && list.get_row_at_index(1)?._catalogItem.uuid === 'page-3@test',
        'Last catalog page appends its row and hides Load More');
    assert(requests.slice(beforeFilteredPages).map(query => query.page).join(',') === '1,2,3', 'Load More advances through filtered empty pages');
    const sort = named(view.widget, 'browse-sort');
    assert(sort instanceof Gtk.DropDown && sort.get_parent().has_css_class('linked'), 'Sorting is labelled in the split search input');
    sort.selected = 3;
    await waitFor(() => state.visible_child_name === 'results' && requests.at(-1)?.sort === 'name', 'Name sorting reaches the API');
    assert(requests.at(-1).page === '1', 'Changing sort starts on the first page');
    more.emit('activated');
    await waitFor(() => requests.at(-1)?.page === '2', 'Sort is retained on subsequent pages');
    assert(requests.at(-1).sort === 'name', 'Pagination preserves the selected sorting');
} finally {
    view?.stop();
    for (const detail of detailViews) detail.stop();
    window.destroy();
    server.disconnect();
}
