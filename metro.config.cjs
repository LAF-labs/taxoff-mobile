/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const root = __dirname;
const VENDOR = { '@sax/remote': 'sax-remote', '@sax/redaction': 'sax-redaction', '@sax/chat-core': 'sax-chat-core' };
const vendorRoot = path.resolve(root, 'vendor');
const config = getDefaultConfig(root);

config.watchFolders = Object.values(VENDOR).map((d) => path.join(vendorRoot, d));
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];
const base = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (name in VENDOR) return { type: 'sourceFile', filePath: path.join(vendorRoot, VENDOR[name], 'src/index.ts') };
  if (name.startsWith('@noble/') && ctx.originModulePath.startsWith(vendorRoot + path.sep)) {
    return (base ?? ctx.resolveRequest)({ ...ctx, originModulePath: path.join(root, 'index.ts') }, name, platform);
  }
  return (base ?? ctx.resolveRequest)(ctx, name, platform);
};

module.exports = config;
