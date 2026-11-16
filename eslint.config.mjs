// 폰 앱 린트. tex poc 루트 규칙 중 폰에 해당하는 것만 옮겼다:
// - 앱 소스(src·App.tsx)에 console 호출 금지(로그에 비밀·사진·금액이 섞이지 않게, test/sp1-config.spec.ts도 막는다).
// - 계산된 동적 import 금지(ADR-028 결정 6).
// - vendor/(sax-remote·sax-redaction·sax-chat-core)는 tex 정본의 사본이라 여기서 고치지 않는다(scripts/sync-remote.mjs로만 바꾼다).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['ios/**', 'android/**', '.expo/**', 'dev/out/**', 'dist-gallery/**', 'node_modules/**', 'vendor/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts,tsx,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', { selector: "ImportExpression[source.type!='Literal']", message: '계산된 동적 import 금지(ADR-028 결정 6).' }],
    },
  },
  { files: ['src/**/*.{ts,tsx}', 'App.tsx', 'index.ts'], rules: { 'no-console': 'error' } },
];
