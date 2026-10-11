import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.MONGE_HELPER_OUTPUT ?? `${root}/build/helper`;
const prefix = process.env.MONGE_SHELL_PREFIX;
if (!prefix)
    throw new Error('Run the build inside nix develop.');

mkdirSync(`${output}/snapshots`, { recursive: true });
const build = mkdtempSync(`${output}/.staging-`);
const name = basename(build).replace('.staging-', 'snapshot-');
const snapshot = `${output}/snapshots/${name}`;
try {
    mkdirSync(`${build}/misc`);
    const substitutions = {
        PACKAGE_NAME: 'gnome-shell',
        PACKAGE_VERSION: '49.4',
        HAVE_NETWORKMANAGER: '0',
        HAVE_PORTAL_HELPER: '0',
        GETTEXT_PACKAGE: 'gnome-shell',
        datadir: `${prefix}/share`,
        libexecdir: `${prefix}/libexec`,
        LIBMUTTER_API_VERSION: '17',
        UTILS_FOLDER_APPS: '[]',
        SYSTEM_FOLDER_APPS: '[]',
    };
    const config = readFileSync(`${root}/panels/extensions/vendor/js/misc/config.js.in`, 'utf8')
        .replace(/@([A-Za-z0-9_]+)@/g, (_, key) => {
            if (!(key in substitutions))
                throw new Error(`Unknown config substitution: ${key}`);
            return substitutions[key];
        });
    writeFileSync(`${build}/misc/config.js`, config);
    execFileSync('glib-compile-resources', [
        `${root}/panels/extensions/vendor/js/dbusServices/org.gnome.Shell.Extensions.src.gresource.xml`,
        `--target=${build}/org.gnome.Shell.Extensions.src.gresource`,
        `--sourcedir=${root}/panels/extensions/vendor/js/dbusServices/extensions`,
        `--sourcedir=${root}/panels/extensions/vendor/js/dbusServices`,
        `--sourcedir=${root}/panels/extensions/vendor/js`,
        `--sourcedir=${build}`,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    execFileSync('glib-compile-resources', [
        `${root}/panels/extensions/vendor/data/interfaces.gresource.xml`,
        `--target=${build}/gnome-shell-dbus-interfaces.gresource`,
        `--sourcedir=${root}/panels/extensions/vendor/data/dbus-interfaces`,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });

    const executable = `${root.replace(/\/$/, '')}/run`
        .replace(/[\\"`$]/g, '\\$&').replaceAll('%', '%%');
    writeFileSync(`${build}/org.monge.ExtensionManager.Development.desktop`, `[Desktop Entry]
Type=Application
Name=Extension Preferences (Development)
Comment=Open installed extension preferences using the local development copy
Exec="${executable}"
Icon=application-x-addon
Terminal=false
Categories=GNOME;GTK;Settings;
StartupNotify=false
`);
    // publish only complete bundles; retain older snapshots because running preferences load resources lazily.
    renameSync(build, snapshot);
    mkdirSync(`${output}/misc`, { recursive: true });
    for (const [file, target] of [
        ['current', `snapshots/${name}`],
        ['org.gnome.Shell.Extensions.src.gresource', 'current/org.gnome.Shell.Extensions.src.gresource'],
        ['gnome-shell-dbus-interfaces.gresource', 'current/gnome-shell-dbus-interfaces.gresource'],
        ['org.monge.ExtensionManager.Development.desktop', 'current/org.monge.ExtensionManager.Development.desktop'],
        ['misc/config.js', '../current/misc/config.js'],
    ]) {
        const link = `${output}/.link-${name}`;
        symlinkSync(target, link);
        renameSync(link, `${output}/${file}`);
    }
    // the runner must use this exact snapshot, not a shared symlink another build can replace.
    console.log(snapshot);
} finally {
    rmSync(build, { recursive: true, force: true });
}
