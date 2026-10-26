import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '**/dist/**',
      '**/node_modules/**',
      'packages/client/public/**',
      'blender/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['packages/client/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['packages/client/src/terrain/chunkWorker.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ['*.js', 'packages/client/vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.ts'] })),
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['packages/{server,tools}/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    files: ['**/*.ts'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
);
