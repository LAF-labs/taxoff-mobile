/* eslint-disable @typescript-eslint/no-require-imports */
// 홈 화면에 보이는 앱 이름만 택스오프로 둔다(src/config.ts BRAND와 같은 값).
// expo.name("tex")은 바꾸지 않는다: prebuild가 이 값으로 Xcode 프로젝트·스킴(tex.xcworkspace)을 만들고,
// 한글을 넣으면 이름이 "app"으로 바뀌어 빌드 명령·EAS 스킴이 달라진다. 번들 ID·패키지(com.lafco.tex)도 그대로다.
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
