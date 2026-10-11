// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const sha256 = path => createHash('sha256').update(read(path)).digest('hex');

test('fork licensing uses unmodified GPLv3 text and preserves the original upstream GPLv2 document', () => {
    assert.equal(sha256('LICENSE'), '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986');
    assert.equal(sha256('LICENSES/GPL-2.0-or-later.txt'), '640d90f6ee401241ff62834d0d1b33f83049e99b8bfdfa04ed1b0a1635dde3e7');
    assert.match(read('meson.build'), /license\s*:\s*'GPL-3\.0-or-later'/);
    assert.match(read('nix/package.nix'), /license = lib\.licenses\.gpl3Plus;/);
    const metadata = read('shell/appdata/org.gnome.Settings.metainfo.xml.in.in');
    assert.match(metadata, /<project_license>GPL-3\.0-or-later<\/project_license>/);
    assert.match(metadata, /<metadata_license>CC0-1\.0<\/metadata_license>/);
    assert.match(read('README.md'), /GPL-3\.0-or-later/);
    for (const path of ['flake.nix', 'nix/package.nix', 'nix/nixos-module.nix', 'scripts/dev-build.sh', 'scripts/run.sh'])
        assert.match(read(path), /SPDX-License-Identifier: GPL-3\.0-or-later/);
});
