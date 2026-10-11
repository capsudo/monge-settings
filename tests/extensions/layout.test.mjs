import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('custom integration files use responsibility-based directories', () => {
    for (const path of ['panels/extensions/js/main.js', 'panels/extensions/vendor/upstream.json',
        'scripts/dev-build.sh', 'scripts/check.sh', 'nix/package.nix', 'nix/nixos-module.nix'])
        assert.ok(existsSync(new URL(path, root)), path);
    assert.doesNotMatch(readFileSync(new URL('flake.nix', root), 'utf8'), /monge\/(package\.nix|nixos-module\.nix|tests\/)/);
});
