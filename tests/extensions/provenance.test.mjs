import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const vendor = new URL('../../panels/extensions/vendor/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('upstream.json', vendor), 'utf8'));

test('retained GNOME helper files and license match their provenance manifest', () => {
    for (const file of manifest.files) {
        const actual = createHash('sha256').update(readFileSync(new URL(file.path, vendor))).digest('hex');
        assert.equal(actual, file.sha256, file.path);
    }
});
