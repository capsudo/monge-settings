export function firstGifFrame(bytes) {
    let offset = 0;
    const invalid = () => { throw new Error('Invalid GIF preview'); };
    function take(length) {
        if (offset + length > bytes.length) invalid();
        const start = offset; offset += length; return start;
    }
    function subBlocks() {
        let total = 0;
        for (;;) {
            const length = bytes[take(1)];
            if (!length) return total;
            take(length); total += length;
        }
    }
    const word = at => bytes[at] | bytes[at + 1] << 8;
    const budget = (width, height) => {
        if (!width || !height || width * height > 16 * 1024 * 1024) invalid();
    };
    take(13);
    if (!/^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6)))) invalid();
    const width = word(6); const height = word(8); budget(width, height);
    if (bytes[10] & 0x80) take(3 * (1 << ((bytes[10] & 7) + 1)));
    let end = null;
    for (;;) {
        const marker = bytes[take(1)];
        if (marker === 0x3b) {
            if (end == null || offset !== bytes.length) invalid();
            const frame = new Uint8Array(end + 1);
            frame.set(bytes.subarray(0, end)); frame[end] = 0x3b;
            return frame;
        }
        if (marker === 0x21) {
            const label = bytes[take(1)];
            if (label === 0xf9) {
                if (bytes[take(1)] !== 4) invalid();
                take(4);
                if (bytes[take(1)] !== 0) invalid();
            } else {
                if (label === 0xff || label === 0x01) {
                    const length = label === 0xff ? 11 : 12;
                    if (bytes[take(1)] !== length) invalid();
                    take(length);
                } else if (label !== 0xfe) invalid();
                subBlocks();
            }
        } else if (marker === 0x2c) {
            const image = take(9);
            if (end == null) {
                const imageWidth = word(image + 4); const imageHeight = word(image + 6);
                budget(imageWidth, imageHeight);
                if (word(image) + imageWidth > width || word(image + 2) + imageHeight > height) invalid();
            }
            if (bytes[image + 8] & 0x80) take(3 * (1 << ((bytes[image + 8] & 7) + 1)));
            const codeSize = bytes[take(1)];
            if (codeSize < 2 || codeSize > 8 || !subBlocks()) invalid();
            if (end == null) end = offset;
        } else invalid();
    }
}
