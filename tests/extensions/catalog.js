import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}

async function expectFailure(operation, text) {
    let failure;
    try {
        await operation();
    } catch (error) {
        failure = error;
    }
    assert(failure?.message.includes(text), `Expected failure containing "${text}", got ${failure?.message}`);
}

const implementation = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_child('panels/extensions/js/catalog.js');
assert(implementation.query_exists(null), 'Catalog implementation is missing');
const { createCatalog } = await import('../../panels/extensions/js/catalog.js');
const requests = [];
const item = {
    uuid: 'example@test', name: 'Example <b>name</b>', description: '<b>Plain description</b> & text',
    creator: 'Author', pk: 123, link: '/extension/123/example/', shell_version_map: { '49': {} },
};
let response = { extensions: [item], numpages: 3, total: 1 };
let status = 200;
let delay = 0;
const server = new Soup.Server();
server.add_handler('/extension-query/', (_server, message, _path, query) => {
    requests.push({ ...query });
    message.set_status(status, null);
    if (status === 302)
        message.get_response_headers().replace('Location', '/redirected');
    message.set_response('application/json', Soup.MemoryUse.COPY,
        new TextEncoder().encode(JSON.stringify(response)));
    if (delay) {
        message.pause();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            message.unpause();
            return GLib.SOURCE_REMOVE;
        });
    }
});
let redirectHits = 0;
let commentsResponse = [{ author: { username: '<b>Reviewer</b>' }, rating: 5,
    comment: '<p>Plain &amp; safe <strong>text</strong></p>', is_extension_creator: false,
    date: { timestamp: '2026-09-14T13:01:01', standard: 'September 14, 2026' } }];
server.add_handler('/comments/all/', (_server, message, _path, query) => {
    requests.push({ ...query });
    message.set_status(status, null);
    message.set_response('application/json', Soup.MemoryUse.COPY,
        new TextEncoder().encode(JSON.stringify(commentsResponse)));
});
let detailsResponse = { ...item, downloads: 1234, url: 'https://example.org/',
    shell_version_map: { '49': { version: 31 }, '50': { version: 99 } },
    icon: '/extension-data/icons/example.png', screenshot: '/extension-data/screenshots/example.png' };
let modesResponse = { extension: item.uuid, version: 31, session_modes: ['user', 'unlock-dialog'] };
server.add_handler('/api/v1/extensions/', (_server, message, path) => {
    requests.push({ path });
    message.set_status(status, null);
    message.set_response('application/json', Soup.MemoryUse.COPY,
        new TextEncoder().encode(JSON.stringify(modesResponse)));
});
server.add_handler('/extension-info/', (_server, message, _path, query) => {
    requests.push({ ...query });
    message.set_status(status, null);
    message.set_response('application/json', Soup.MemoryUse.COPY,
        new TextEncoder().encode(JSON.stringify(detailsResponse)));
});
server.add_handler('/redirected', (_server, message) => {
    redirectHits++;
    message.set_status(200, null);
    message.set_response('application/json', Soup.MemoryUse.COPY,
        new TextEncoder().encode(JSON.stringify(response)));
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const endpoint = `${server.get_uris()[0].to_string()}extension-query/`;
try {
    const catalog = createCatalog({ shellVersion: '49.4', endpoint });
    const result = await catalog.query({ search: 'clock & café/?', page: 2 });
    assert(requests.length === 1, 'Exactly one catalog request is expected');
    assert(requests[0].shell_version === '49.4', 'Filter must use the proxy ShellVersion');
    assert(requests[0].search === 'clock & café/?', 'Search must survive URI encoding');
    assert(requests[0].page === '2', 'Page must be sent to GNOME');
    assert(result.page === 2 && result.pages === 3, 'GNOME numpages must drive pagination');
    assert(result.items.length === 1 && result.items[0].uuid === item.uuid, 'Compatible item must be returned');
    assert(result.items[0].website === 'https://extensions.gnome.org/extension/123/example/',
        'Only the GNOME catalog item website is exposed');
    print('PASS catalog: real Soup request filters ShellVersion, encodes search and paginates');
    response = { extensions: [
        item,
        { ...item, uuid: 'old@test', shell_version_map: { '48': {} } },
        { ...item, uuid: 'unsafe@test', link: '//attacker.test/extension/123/example/' },
        { ...item, uuid: 'traversal@test', link: '/extension/123/../evil/' },
        { ...item, uuid: 'mismatch@test', link: '/extension/456/example/' },
        { ...item, uuid: 'javascript@test', link: 'javascript:alert(1)' },
    ], numpages: 1 };
    const filtered = await catalog.query();
    assert(!filtered.items.some(entry => entry.uuid === 'old@test'), 'Unsupported Shell versions must not be shown');
    assert(filtered.items.filter(entry => entry.uuid !== item.uuid).every(entry => entry.website === null),
        'Only a validated extension path matching its catalog ID may become an external action');
    assert(filtered.items[0].description === item.description, 'Catalog descriptions are plain text, not interpreted markup');
    print('PASS catalog: incompatible versions filtered and untrusted links cannot become actions');
    status = 503;
    let failure;
    try {
        await catalog.query();
    } catch (error) {
        failure = error;
    }
    assert(failure?.message.includes('HTTP 503'), 'HTTP failure must reject instead of displaying error-body items');
    print('PASS catalog: HTTP errors are explicit failures');
    status = 200;
    delay = 200;
    const bounded = createCatalog({ shellVersion: '49.4', endpoint, timeoutMs: 30 });
    await expectFailure(() => bounded.query(), 'timed out');
    print('PASS catalog: total request deadline cancels a slow Soup response');
    const cancellable = new Gio.Cancellable();
    const pending = catalog.query({ cancellable });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });
    await expectFailure(() => pending, 'cancel');
    print('PASS catalog: caller cancellation rejects the outstanding request');
    delay = 0;
    response = { extensions: [{ ...item, description: 'x'.repeat(2048) }], numpages: 1 };
    const small = createCatalog({ shellVersion: '49.4', endpoint, maxBytes: 1024 });
    await expectFailure(() => small.query(), 'too large');
    print('PASS catalog: response body is bounded during reading');
    response = { extensions: [item], numpages: -2 };
    await expectFailure(() => catalog.query(), 'Invalid catalog response');
    response = { extensions: null, numpages: 1 };
    await expectFailure(() => catalog.query(), 'Invalid catalog response');
    response = { extensions: [null, { ...item, name: {} }, item], numpages: 1 };
    assert((await catalog.query()).items.length === 1, 'Malformed catalog rows must be skipped');
    print('PASS catalog: invalid envelopes rejected and malformed rows skipped');
    status = 302;
    await expectFailure(() => catalog.query(), 'HTTP 302');
    assert(redirectHits === 0, 'Catalog redirects must never reach another path or host');
    await expectFailure(() => createCatalog({ shellVersion: '49.4', endpoint: 'https://attacker.test/extension-query/' }), 'endpoint');
    await expectFailure(() => createCatalog({ shellVersion: '' }), 'ShellVersion');
    await expectFailure(() => createCatalog({ shellVersion: '49.4', timeoutMs: Infinity }), 'bounds');
    await expectFailure(() => catalog.query({ page: 0 }), 'query');
    await expectFailure(() => catalog.query({ search: 'x'.repeat(513) }), 'query');
    print('PASS catalog: redirects, arbitrary endpoints and invalid request bounds rejected');
    status = 200;
    response = { extensions: [
        { ...item, uuid: 'exact@test', shell_version_map: { '49.4': {} } },
        { ...item, uuid: 'future@test', shell_version_map: { '49.5': {} } },
        item,
    ], numpages: 1 };
    const versions = await catalog.query();
    assert(versions.items.some(entry => entry.uuid === 'exact@test') &&
        versions.items.some(entry => entry.uuid === item.uuid) &&
        !versions.items.some(entry => entry.uuid === 'future@test'),
    'Both the exact proxy version and its supported base version are compatible, not a different minor release');
    print('PASS catalog: exact and base Shell versions follow GNOME API compatibility');
    const details = await catalog.details({ uuid: item.uuid });
    assert(details.creator === item.creator && details.downloads === 1234, 'Details include author and downloads');
    assert(details.version === 31, 'Version is the compatible catalog release, not an incompatible newer release');
    assert(details.screenshot === '/extension-data/screenshots/example.png', 'Details include the GNOME-hosted preview');
    assert(requests.at(-1).uuid === item.uuid, 'Details query matches the exact requested UUID');
    assert((await catalog.sessionModes({ uuid: item.uuid, version: details.version })).join(',') === 'user,unlock-dialog',
        'Catalog session modes come from the exact compatible release');
    assert(requests.at(-1).path === '/api/v1/extensions/example@test/versions/31/', 'Session-mode lookup targets the exact UUID and version');
    modesResponse = { ...modesResponse, extension: 'other@test' };
    await expectFailure(() => catalog.sessionModes({ uuid: item.uuid, version: 31 }), 'Invalid extension session modes');
    modesResponse = { ...modesResponse, extension: item.uuid, version: 99 };
    await expectFailure(() => catalog.sessionModes({ uuid: item.uuid, version: 31 }), 'Invalid extension session modes');
    modesResponse = { ...modesResponse, version: 31, session_modes: ['user', {}] };
    await expectFailure(() => catalog.sessionModes({ uuid: item.uuid, version: 31 }), 'Invalid extension session modes');
    await expectFailure(() => catalog.sessionModes({ uuid: '..', version: 31 }), 'query');
    await expectFailure(() => catalog.sessionModes({ uuid: item.uuid, version: 0 }), 'query');
    detailsResponse = { ...detailsResponse, screenshot: '/extension-data/screenshots/example.gif' };
    assert((await catalog.details({ uuid: item.uuid })).screenshot === detailsResponse.screenshot,
        'GNOME-hosted GIF screenshots are retained instead of silently discarded');
    detailsResponse = { ...detailsResponse, screenshot: 'https://attacker.test/preview.png', url: 'javascript:alert(1)' };
    const unsafe = await catalog.details({ uuid: item.uuid });
    assert(!unsafe.screenshot && !unsafe.homepage, 'Unsafe details links and media are discarded');
    detailsResponse = { ...detailsResponse, uuid: 'other@test' };
    await expectFailure(() => catalog.details({ uuid: item.uuid }), 'Invalid extension details');
    await expectFailure(() => catalog.details({ uuid: '' }), 'UUID');
    print('PASS catalog: exact UUID details, rich metadata and restricted media URLs');
    const comments = await catalog.comments({ pk: 123 });
    assert(comments.length === 1 && comments[0].text === 'Plain & safe text', 'Review markup is converted to plain text');
    assert(comments[0].author === '<b>Reviewer</b>' && comments[0].rating === 5, 'Review identity and rating are retained literally');
    assert(requests.at(-1).pk === '123' && requests.at(-1).all === 'false', 'Initial reviews use the bounded preview endpoint');
    await catalog.comments({ pk: 123, all: true });
    assert(requests.at(-1).all === 'true', 'Show All uses the same restricted GNOME endpoint');
    await expectFailure(() => catalog.comments({ pk: 0 }), 'comments query');
    commentsResponse = { items: [] };
    await expectFailure(() => catalog.comments({ pk: 123 }), 'Invalid extension comments');
    commentsResponse = [null, { author: { username: 'Bad' }, comment: {} }];
    assert((await catalog.comments({ pk: 123 })).length === 0, 'Malformed comments are skipped');
    print('PASS catalog: read-only comment previews, Show All, plain text and response validation');
} finally {
    server.disconnect();
}
