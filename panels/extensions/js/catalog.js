// read the GNOME catalog without loading extension code or changing installed extensions.
// API contract: GNOME/extensions-web, sweettooth/extensions/views.py (ajax_query_view and ajax_details).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

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
    return {
        async query({ search = '', page = 1, cancellable = null } = {}) {
            if (typeof search !== 'string' || search.length > 512 ||
                !Number.isSafeInteger(page) || page < 1 || page > 100000)
                throw new Error('Invalid catalog query');
            const uri = `${endpoint}?shell_version=${encodeURIComponent(shellVersion)}` +
                `&search=${encodeURIComponent(search)}&page=${page}&sort=popularity&n_per_page=10`;
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
                    if (length > maxBytes)
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
    };
}
