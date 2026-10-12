import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import { firstGifFrame } from './gif-preview.js';

export function decodeExtensionImage(bytes, maximumSize = 1200) {
    if (!bytes?.length || bytes.length > 8 * 1024 * 1024) throw new Error('Invalid preview size');
    const kind = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'png' :
        bytes[0] === 255 && bytes[1] === 216 ? 'jpeg' :
        String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
        String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? 'webp' :
        /^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6))) ? 'gif' : null;
    if (!kind) throw new Error('Unsupported preview format');
    if (kind === 'gif') bytes = firstGifFrame(bytes);
    const loader = GdkPixbuf.PixbufLoader.new_with_type(kind);
    let oversized = false;
    loader.connect('size-prepared', (_loader, width, height) => {
        oversized = width > 16384 || height > 16384;
        const scale = Math.min(1, maximumSize / Math.max(width, height));
        loader.set_size(oversized ? 1 : Math.max(1, Math.round(width * scale)),
            oversized ? 1 : Math.max(1, Math.round(height * scale)));
    });
    try { loader.write(bytes); } finally { loader.close(); }
    if (oversized) throw new Error('Preview dimensions are too large');
    const pixbuf = kind === 'gif' ? loader.get_animation()?.get_static_image() : loader.get_pixbuf();
    if (!pixbuf) throw new Error('Preview image could not be decoded');
    return Gdk.Texture.new_for_pixbuf(pixbuf);
}
