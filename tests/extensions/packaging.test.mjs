// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../../', import.meta.url));

test('the replacement module defaults to the standard Settings identity and a portable local source', () => {
    const module = readFileSync(join(repo, 'nix/nixos-module.nix'), 'utf8');
    assert.match(module, /development = lib\.mkOption \{[\s\S]*?default = false;/);
    assert.match(module, /source = lib\.mkOption \{[\s\S]*?default = \.\.\/\.;/);
    assert.doesNotMatch(module, /\/home\/cap/);
});

test('package installation copies the runtime and complete helper from an out-of-source build directory', t => {
    const f = fixture(t);
    const build = join(f.root, 'build/work');
    const out = join(f.root, 'output');
    mkdirSync(build);
    mkdirSync(join(f.root, 'build/helper/current/misc'), { recursive: true });
    writeFileSync(join(f.root, 'panels/extensions/js/main.js'), 'runtime fixture');
    writeFileSync(join(f.root, 'build/helper/current/misc/config.js'), 'helper configuration fixture');
    const source = readFileSync(join(repo, 'nix/package.nix'), 'utf8');
    const hook = source.match(/postInstall = \(old\.postInstall or ""\) \+ ''([\s\S]*?)\n  '';/)[1];
    const result = spawnSync('bash', ['-euc', hook], { cwd: build,
        env: { ...process.env, out, MONGE_SOURCE_DIR: f.root }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(out, 'share/monge-settings/js/main.js'), 'utf8'), 'runtime fixture');
    assert.equal(readFileSync(join(out, 'share/monge-settings/helper/misc/config.js'), 'utf8'), 'helper configuration fixture');
    assert.match(source, /export MONGE_SOURCE_DIR="\$PWD"/);
});

function fixture(t) {
    const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'monge-packaging-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const scripts = join(root, 'scripts');
    const bin = join(root, 'tools');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(bin);
    mkdirSync(join(root, 'panels/extensions/js'), { recursive: true });
    mkdirSync(join(root, 'build/helper'), { recursive: true });
    const subprojects = join(root, 'subproject-sources');
    const gvc = join(subprojects, 'gvc');
    mkdirSync(gvc, { recursive: true });
    writeFileSync(join(gvc, 'meson.build'), 'volume-control fixture\n');
    mkdirSync(join(subprojects, 'libgxdp'));
    writeFileSync(join(subprojects, 'libgxdp/meson.build'), 'portal fixture\n');
    for (const name of ['dev-build.sh', 'run.sh']) {
        const source = join(repo, 'scripts', name);
        if (existsSync(source))
            copyFileSync(source, join(scripts, name));
    }
    writeFileSync(join(scripts, 'build-helper.mjs'), '');
    const log = join(root, 'commands.jsonl');
    const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ command, args, cwd: process.cwd(), env: { GSETTINGS_SCHEMA_DIR: process.env.GSETTINGS_SCHEMA_DIR, XDG_DATA_DIRS: process.env.XDG_DATA_DIRS, MONGE_HELPER_DIR: process.env.MONGE_HELPER_DIR } }) + '\\n');
if (command === 'meson' && args[0] === 'setup') {
    const build = args.find(a => a.endsWith('/build/dev'));
    fs.mkdirSync(path.join(build, 'meson-private'), { recursive: true });
    fs.writeFileSync(path.join(build, 'meson-private/coredata.dat'), 'configured');
}
`;
    for (const name of ['node', 'meson', 'ninja', 'glib-compile-schemas'])
        writeFileSync(join(bin, name), stub, { mode: 0o755 });
    const patch = join(root, 'paths.patch');
    writeFileSync(join(root, 'path-fixture.txt'), 'upstream\n');
    writeFileSync(patch, '--- a/path-fixture.txt\n+++ b/path-fixture.txt\n@@ -1 +1 @@\n-upstream\n+store-path\n');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: log, MONGE_SHELL_PREFIX: '/nix/store/test-shell', MONGE_NIX_PATHS_PATCH: patch, MONGE_SUBPROJECT_SOURCES: subprojects };
    return {
        root, scripts, bin, env, patch,
        run(name, args = [], overrides = {}) {
            return spawnSync('bash', [join(scripts, name), ...args], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
        },
        commands() {
            return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
        },
    };
}

test('packaging the development foundation does not require the later runtime modules', t => {
    const f = fixture(t);
    rmSync(join(f.root, 'panels/extensions/js'), { recursive: true });
    mkdirSync(join(f.root, 'build/helper/current/misc'), { recursive: true });
    writeFileSync(join(f.root, 'build/helper/current/misc/config.js'), 'helper fixture');
    const source = readFileSync(join(repo, 'nix/package.nix'), 'utf8');
    const hook = source.match(/postInstall = \(old\.postInstall or ""\) \+ ''([\s\S]*?)\n  '';/)[1];
    const out = join(f.root, 'output');
    const result = spawnSync('bash', ['-euc', hook], {
        cwd: f.root, env: { ...process.env, out, MONGE_SOURCE_DIR: f.root }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(out, 'share/monge-settings/helper/misc/config.js'), 'utf8'), 'helper fixture');
});

test('local build generates the helper before configuring the dedicated development identity', t => {
    const f = fixture(t);
    const result = f.run('dev-build.sh', ['-j2']);
    assert.equal(result.status, 0, result.stderr);
    const commands = f.commands();
    assert.deepEqual(commands.map(c => c.command), ['node', 'meson', 'ninja', 'meson', 'glib-compile-schemas']);
    assert.deepEqual(commands[0].args, [join(f.scripts, 'build-helper.mjs')]);
    assert.ok(commands[1].args.includes('-Dmonge-development=true'));
    assert.ok(commands[1].args.includes('-Dprofile=default'));
    assert.ok(commands[1].args.includes(`-Dmonge-js-dir=${f.root}/panels/extensions/js`));
    assert.ok(commands[1].args.includes(`--prefix=${f.root}/build/dev/install`));
    assert.deepEqual(commands[2].args, ['-C', `${f.root}/build/dev`, '-j2']);
    assert.deepEqual(commands[3].args, ['install', '-C', `${f.root}/build/dev`, '--no-rebuild', '--only-changed']);
    assert.equal(readFileSync(join(f.root, 'path-fixture.txt'), 'utf8'), 'upstream\n');
    assert.equal(readFileSync(join(f.root, 'build/dev-source/path-fixture.txt'), 'utf8'), 'store-path\n');
    assert.equal(readFileSync(join(f.root, 'build/dev-source/subprojects/gvc/meson.build'), 'utf8'), 'volume-control fixture\n');
    assert.ok(commands[1].args.includes(`${f.root}/build/dev-source`));
});

test('repeat builds reconfigure and do not apply the upstream path patch twice', t => {
    const f = fixture(t);
    assert.equal(f.run('dev-build.sh').status, 0);
    const result = f.run('dev-build.sh');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(f.root, 'path-fixture.txt'), 'utf8'), 'upstream\n');
    assert.equal(readFileSync(join(f.root, 'build/dev-source/path-fixture.txt'), 'utf8'), 'store-path\n');
    const setups = f.commands().filter(c => c.command === 'meson' && c.args[0] === 'setup');
    assert.equal(setups.length, 2);
    assert.ok(!setups[0].args.includes('--reconfigure'));
    assert.ok(setups[1].args.includes('--reconfigure'));
});

test('repeat builds leave immutable subproject sources untouched and keep the build snapshot writable', t => {
    const f = fixture(t);
    const original = join(f.env.MONGE_SUBPROJECT_SOURCES, 'gvc');
    const copied = join(f.root, 'build/dev-source/subprojects/gvc');
    const repositoryCopy = join(f.root, 'build/dev-source/subproject-sources/gvc');
    chmodSync(join(original, 'meson.build'), 0o444);
    chmodSync(original, 0o555);
    try {
        const first = f.run('dev-build.sh');
        assert.equal(first.status, 0, first.stderr);
        const second = f.run('dev-build.sh');
        assert.equal(second.status, 0, second.stderr);
        assert.equal(statSync(join(original, 'meson.build')).mode & 0o222, 0);
        assert.ok(statSync(join(copied, 'meson.build')).mode & 0o200);
        assert.ok(statSync(join(repositoryCopy, 'meson.build')).mode & 0o200);
    } finally {
        chmodSync(original, 0o755);
        if (existsSync(copied)) chmodSync(copied, 0o755);
        if (existsSync(repositoryCopy)) chmodSync(repositoryCopy, 0o755);
    }
});

test('Git checkouts receive every bundled release subproject without replacing their tracked wraps', t => {
    const f = fixture(t);
    mkdirSync(join(f.root, 'subprojects'));
    writeFileSync(join(f.root, 'subprojects/libgxdp.wrap'), 'tracked wrap fixture');
    const result = f.run('dev-build.sh');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(f.root, 'build/dev-source/subprojects/libgxdp/meson.build')));
    assert.equal(readFileSync(join(f.root, 'build/dev-source/subprojects/libgxdp.wrap'), 'utf8'), 'tracked wrap fixture');
});

test('local build refuses a missing shell or an incompatible upstream path patch', t => {
    const f = fixture(t);
    const outside = f.run('dev-build.sh', [], { MONGE_SHELL_PREFIX: '' });
    assert.notEqual(outside.status, 0);
    assert.match(outside.stderr, /nix develop path:\./);
    assert.deepEqual(f.commands(), []);
    writeFileSync(join(f.root, 'path-fixture.txt'), 'edited differently\n');
    const incompatible = f.run('dev-build.sh');
    assert.notEqual(incompatible.status, 0);
    assert.match(incompatible.stderr, /neither applicable nor already applied/);
    assert.deepEqual(f.commands(), []);
});

test('local build rejects partially applied upstream patches instead of treating them as complete', t => {
    const f = fixture(t);
    writeFileSync(join(f.root, 'path-fixture.txt'), 'store-path\n');
    writeFileSync(join(f.root, 'second.txt'), 'upstream\n');
    writeFileSync(f.patch, readFileSync(f.patch, 'utf8') + '--- a/second.txt\n+++ b/second.txt\n@@ -1 +1 @@\n-upstream\n+store-path\n');
    const result = f.run('dev-build.sh');
    assert.notEqual(result.status, 0, 'a mixed patched/unpatched checkout must not configure');
    assert.match(result.stderr, /neither applicable nor already applied/);
    assert.deepEqual(f.commands(), []);
});

test('runner uses the installed local binary and prepends local data without losing shell search paths', t => {
    const f = fixture(t);
    const prefix = join(f.root, 'build/dev/install');
    mkdirSync(join(prefix, 'bin'), { recursive: true });
    copyFileSync(join(f.bin, 'ninja'), join(prefix, 'bin/gnome-control-center'));
    const result = f.run('run.sh', ['--no-build', 'extensions', '--verbose'], { XDG_DATA_DIRS: '/store/schema-data:/store/icon-data' });
    assert.equal(result.status, 0, result.stderr);
    const [command] = f.commands();
    assert.equal(command.command, 'gnome-control-center');
    assert.deepEqual(command.args, ['extensions', '--verbose']);
    assert.equal(command.env.GSETTINGS_SCHEMA_DIR, `${prefix}/share/glib-2.0/schemas`);
    assert.equal(command.env.XDG_DATA_DIRS, `${prefix}/share:/store/schema-data:/store/icon-data`);
    assert.equal(command.env.MONGE_HELPER_DIR, `${f.root}/build/helper/current`);
});

test('runner keeps the exact helper snapshot so another build cannot replace lazily loaded resources', t => {
    const f = fixture(t);
    const prefix = join(f.root, 'build/dev/install');
    mkdirSync(join(prefix, 'bin'), { recursive: true });
    copyFileSync(join(f.bin, 'ninja'), join(prefix, 'bin/gnome-control-center'));
    const snapshot = join(f.root, 'build/helper/snapshots/ready');
    mkdirSync(snapshot, { recursive: true });
    symlinkSync('snapshots/ready', join(f.root, 'build/helper/current'));
    const result = f.run('run.sh', ['--no-build']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.commands()[0].env.MONGE_HELPER_DIR, snapshot);
});
