/* eslint-disable @typescript-eslint/no-require-imports */
const { withInfoPlist, withStringsXml, AndroidConfig } = require('expo/config-plugins');

module.exports = function withDisplayName(config, { name }) {
  if (!name) throw new Error('with-display-name: name is required');
  config = withInfoPlist(config, (c) => {
    c.modResults.CFBundleDisplayName = name;
    return c;
  });
  config = withStringsXml(config, (c) => {
    c.modResults = AndroidConfig.Strings.setStringItem([{ $: { name: 'app_name', translatable: 'false' }, _: name }], c.modResults);
    return c;
  });
  return config;
};
