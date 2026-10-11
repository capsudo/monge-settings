import { mkdirSync, writeFileSync } from 'node:fs';
const scratch = process.argv[2];
for (const name of ['runtime', 'config', 'cache', 'state'])
    mkdirSync(`${scratch}/${name}`, { mode: 0o700 });
const escaped = `${scratch}/runtime`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
writeFileSync(`${scratch}/session.conf`, `<busconfig>
<type>session</type><listen>unix:tmpdir=${escaped}</listen>
<policy context="default"><allow send_destination="*"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>`);
