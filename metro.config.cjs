/* eslint-disable @typescript-eslint/no-require-imports */
// tex 고정 사본(vendor/sax-remote·sax-redaction·sax-chat-core, scripts/sync-remote.mjs)을 소스 그대로 묶는다. 별칭으로 잇고,
// 사본이 부르는 @noble/*는 앱의 같은 버전으로 풀어 사본이 둘 생기지 않게 한다.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const root = __dirname;
const VENDOR = { '@sax/remote': 'sax-remote', '@sax/redaction': 'sax-redaction', '@sax/chat-core': 'sax-chat-core' };
const vendorRoot = path.resolve(root, 'vendor');
const config = getDefaultConfig(root);

config.watchFolders = Object.values(VENDOR).map((d) => path.join(vendorRoot, d));
// 서류 보기 견본(assets/sample/tax-invoice.pdf)을 묶는다. 실제 서류는 PC가 보낸 암호 파일을 풀어 쓴다(다음 PR).
config.resolver.assetExts = [...config.resolver.assetExts, 'pdf'];
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];
const base = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  // 웹은 화면 갤러리만 그린다(디자인 점검용, gallery/). 앱(iOS·Android) 번들에는 들어가지 않는다.
  if (platform === 'web' && name === './App' && ctx.originModulePath === path.join(root, 'index.ts')) {
    return { type: 'sourceFile', filePath: path.join(root, 'gallery/Gallery.tsx') };
  }
  if (platform === 'web' && name === 'expo-file-system') return { type: 'sourceFile', filePath: path.join(root, 'gallery/stubs/expo-file-system.ts') };
  if (name in VENDOR) return { type: 'sourceFile', filePath: path.join(vendorRoot, VENDOR[name], 'src/index.ts') };
  if (name.startsWith('@noble/') && ctx.originModulePath.startsWith(vendorRoot + path.sep)) {
    return (base ?? ctx.resolveRequest)({ ...ctx, originModulePath: path.join(root, 'index.ts') }, name, platform);
  }
  return (base ?? ctx.resolveRequest)(ctx, name, platform);
};

module.exports = config;
