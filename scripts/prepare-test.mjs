import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
const scratch = process.argv[2];
for (const name of ['runtime', 'config', 'cache', 'state', 'schemas'])
    mkdirSync(`${scratch}/${name}`, { mode: 0o700 });
copyFileSync(new URL('../shell/org.gnome.Settings.gschema.xml', import.meta.url), `${scratch}/schemas/org.gnome.Settings.gschema.xml`);
const escaped = `${scratch}/runtime`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
writeFileSync(`${scratch}/session.conf`, `<busconfig>
<type>session</type><listen>unix:tmpdir=${escaped}</listen>
<policy context="default"><allow send_destination="*"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>`);
