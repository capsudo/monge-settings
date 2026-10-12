// read the GNOME catalog without loading extension code or changing installed extensions.
// API contract: GNOME/extensions-web, sweettooth/extensions/views.py (ajax_query_view and ajax_details).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

function mediaPath(value) {
    return typeof value === 'string' && value.length <= 512 &&
        /^\/(?:extension-data\/(?:icons|screenshots)|static\/images)\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(value)
        ? value : null;
}

function homepage(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
        const uri = GLib.Uri.parse(value, GLib.UriFlags.NONE);
        return uri.get_scheme() === 'https' && uri.get_host() && !uri.get_userinfo() ? value : null;
    } catch (_error) { return null; }
}

function commentText(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li)>/gi, '\n\n')
        .replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,8}|amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => {
            if (name[0] !== '#') return entities[name.toLowerCase()] ?? match;
            const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
        }).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
}

export function createCatalog({ shellVersion, endpoint = 'https://extensions.gnome.org/extension-query/',
    timeoutMs = 15000, maxBytes = 1024 * 1024 }) {
    if (typeof shellVersion !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(shellVersion))
        throw new Error('Invalid proxy ShellVersion');
    // the loopback endpoint is a test seam; production traffic is confined to GNOME's HTTPS API.
    if (endpoint !== 'https://extensions.gnome.org/extension-query/' &&
        !/^http:\/\/127\.0\.0\.1:\d+\/extension-query\/$/.test(endpoint))
        throw new Error('Invalid catalog endpoint');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 ||
        !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024)
        throw new Error('Invalid catalog request bounds');
    const session = new Soup.Session();
    const base = endpoint.replace(/extension-query\/$/, '');
    async function fetchBytes(uri, cancellable, limit = maxBytes) {
            const message = Soup.Message.new('GET', uri);
            message.set_flags(Soup.MessageFlags.NO_REDIRECT);
            const requestCancellation = new Gio.Cancellable();
            const cancelledId = cancellable?.connect(() => requestCancellation.cancel());
            if (cancellable?.is_cancelled())
                requestCancellation.cancel();
            let timedOut = false;
            let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                timer = 0;
                timedOut = true;
                requestCancellation.cancel();
                return GLib.SOURCE_REMOVE;
            });
            let bytes;
            let stream;
            try {
                stream = await new Promise((resolve, reject) => {
                    session.send_async(message, GLib.PRIORITY_DEFAULT, requestCancellation, (_session, result) => {
                        try {
                            resolve(session.send_finish(result));
                        } catch (error) {
                            reject(error);
                        }
                    });
                });
                if (message.get_status() !== 200)
                    throw new Error(`HTTP ${message.get_status()}`);
                const chunks = [];
                let length = 0;
                while (true) {
                    const chunk = await new Promise((resolve, reject) => {
                        stream.read_bytes_async(16384, GLib.PRIORITY_DEFAULT, requestCancellation, (_stream, result) => {
                            try {
                                resolve(stream.read_bytes_finish(result).get_data());
                            } catch (error) {
                                reject(error);
                            }
                        });
                    });
                    if (!chunk.length)
                        break;
                    length += chunk.length;
                    if (length > limit)
                        throw new Error('Catalog response is too large');
                    chunks.push(chunk);
                }
                bytes = new Uint8Array(length);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.length;
                }
            } catch (error) {
                if (timedOut)
                    throw new Error('Catalog request timed out');
                throw error;
            } finally {
                stream?.close(null);
                if (timer)
                    GLib.source_remove(timer);
                if (cancelledId)
                    cancellable.disconnect(cancelledId);
            }
            return bytes;
    }
    return {
        async query({ search = '', page = 1, cancellable = null } = {}) {
            if (typeof search !== 'string' || search.length > 512 ||
                !Number.isSafeInteger(page) || page < 1 || page > 100000)
                throw new Error('Invalid catalog query');
            const uri = `${endpoint}?shell_version=${encodeURIComponent(shellVersion)}` +
                `&search=${encodeURIComponent(search)}&page=${page}&sort=popularity&n_per_page=10`;
            const bytes = await fetchBytes(uri, cancellable);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (!data || !Array.isArray(data.extensions) || data.extensions.length > 25 ||
                !Number.isSafeInteger(data.numpages) || data.numpages < 0 || data.numpages > 100000)
                throw new Error('Invalid catalog response');
            const parts = shellVersion.split('.');
            const compatibleVersions = [shellVersion, parts.slice(0, 2).join('.')];
            if (Number.parseInt(parts[0], 10) >= 40)
                compatibleVersions.push(parts[0]);
            return {
                page, pages: data.numpages,
                items: data.extensions.filter(item => item &&
                    typeof item.uuid === 'string' && item.uuid.length > 0 && item.uuid.length <= 256 &&
                    typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 256 &&
                    typeof item.description === 'string' && item.description.length <= 16384 &&
                    typeof item.creator === 'string' && item.creator.length <= 256 &&
                    item.shell_version_map && compatibleVersions.some(version => Object.hasOwn(item.shell_version_map, version)))
                    .map(item => ({
                        uuid: item.uuid, name: item.name, description: item.description, creator: item.creator,
                        website: Number.isSafeInteger(item.pk) && item.pk > 0 &&
                            typeof item.link === 'string' &&
                            new RegExp(`^/extension/${item.pk}/[a-z0-9-]+/$`).test(item.link)
                            ? `https://extensions.gnome.org${item.link}` : null,
                    })),
            };
        },
        async details({ uuid, cancellable = null } = {}) {
            if (typeof uuid !== 'string' || !uuid.length || uuid.length > 256 || /[\x00-\x1f]/.test(uuid))
                throw new Error('Invalid extension UUID');
            const bytes = await fetchBytes(`${base}extension-info/?uuid=${encodeURIComponent(uuid)}`, cancellable);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (!data || data.uuid !== uuid || typeof data.name !== 'string' || data.name.length > 256 ||
                typeof data.description !== 'string' || data.description.length > 16384 ||
                typeof data.creator !== 'string' || data.creator.length > 256)
                throw new Error('Invalid extension details');
            const parts = shellVersion.split('.');
            const compatibleVersions = [shellVersion, parts.slice(0, 2).join('.')];
            if (Number.parseInt(parts[0], 10) >= 40) compatibleVersions.push(parts[0]);
            const versions = compatibleVersions.map(key => Object.hasOwn(data.shell_version_map ?? {}, key)
                ? data.shell_version_map[key]?.version : null)
                .filter(value => Number.isSafeInteger(value) && value > 0);
            return {
                uuid, name: data.name, description: data.description, creator: data.creator,
                pk: Number.isSafeInteger(data.pk) && data.pk > 0 ? data.pk : null,
                version: versions.length ? Math.max(...versions) : null,
                downloads: Number.isSafeInteger(data.downloads) && data.downloads >= 0 ? data.downloads : null,
                homepage: homepage(data.url), icon: mediaPath(data.icon), screenshot: mediaPath(data.screenshot),
                website: Number.isSafeInteger(data.pk) && data.pk > 0 && typeof data.link === 'string' &&
                    new RegExp(`^/extension/${data.pk}/[a-z0-9-]+/$`).test(data.link)
                    ? `https://extensions.gnome.org${data.link}` : null,
            };
        },
        async media({ path, cancellable = null } = {}) {
            if (!mediaPath(path)) throw new Error('Invalid catalog media path');
            return fetchBytes(`${base.slice(0, -1)}${path}`, cancellable, 8 * 1024 * 1024);
        },
        async comments({ pk, all = false, cancellable = null } = {}) {
            if (!Number.isSafeInteger(pk) || pk < 1 || typeof all !== 'boolean')
                throw new Error('Invalid extension comments query');
            const bytes = await fetchBytes(`${base}comments/all/?pk=${pk}&all=${all}`, cancellable);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (!Array.isArray(data) || data.length > 1000) throw new Error('Invalid extension comments');
            return data.filter(entry => entry && typeof entry.author?.username === 'string' &&
                entry.author.username.length <= 256 && typeof entry.comment === 'string' && entry.comment.length <= 16384)
                .map(entry => ({
                    author: entry.author.username, text: commentText(entry.comment),
                    rating: Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5 ? entry.rating : null,
                    creator: entry.is_extension_creator === true,
                    date: typeof entry.date?.timestamp === 'string' && entry.date.timestamp.length <= 128 ? entry.date.timestamp : null,
                    dateLabel: typeof entry.date?.standard === 'string' && entry.date.standard.length <= 128 ? entry.date.standard : '',
                }));
        },
    };
}
