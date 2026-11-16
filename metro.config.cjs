/* eslint-disable @typescript-eslint/no-require-imports */
// @sax/remote(tex poc/packages/remote 고정 사본, vendor/sax-remote)를 소스 그대로 묶는다. 별칭으로 잇고,
// remote가 부르는 @noble/*는 앱의 같은 버전으로 풀어 사본이 둘 생기지 않게 한다.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const root = __dirname;
const remote = path.resolve(root, 'vendor/sax-remote');
const config = getDefaultConfig(root);

config.watchFolders = [remote];
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];
const base = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (name === '@sax/remote') return { type: 'sourceFile', filePath: path.join(remote, 'src/index.ts') };
  if (name.startsWith('@noble/') && ctx.originModulePath.startsWith(remote)) {
    return (base ?? ctx.resolveRequest)({ ...ctx, originModulePath: path.join(root, 'index.ts') }, name, platform);
  }
  return (base ?? ctx.resolveRequest)(ctx, name, platform);
};

module.exports = config;
