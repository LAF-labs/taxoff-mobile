/* eslint-disable @typescript-eslint/no-require-imports */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];
const excludeAll = (indent) => DOMAINS.map((d) => `${indent}<exclude domain="${d}" path="." />`).join('\n');

const EXTRACTION = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup disableIfNoEncryptionCapabilities="true">
${excludeAll('    ')}
  </cloud-backup>
  <device-transfer>
${excludeAll('    ')}
  </device-transfer>
</data-extraction-rules>
`;
const FULL_BACKUP = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludeAll('  ')}
</full-backup-content>
`;

module.exports = function withNoBackup(config) {
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    app.$['android:allowBackup'] = 'false';
    app.$['android:fullBackupContent'] = '@xml/sax_no_backup';
    app.$['android:dataExtractionRules'] = '@xml/sax_no_extraction';
    return c;
  });
  return withDangerousMod(config, ['android', (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sax_no_extraction.xml'), EXTRACTION);
    fs.writeFileSync(path.join(dir, 'sax_no_backup.xml'), FULL_BACKUP);
    return c;
  }]);
};
