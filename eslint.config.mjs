import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['ios/**', 'android/**', '.expo/**', 'dev/out/**', 'node_modules/**', 'vendor/**'] },
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
