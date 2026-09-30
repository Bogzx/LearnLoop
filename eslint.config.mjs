// Flat ESLint config for the whole monorepo (`npm run lint` at the root).
//
// - @eslint/js + typescript-eslint recommended for every TS/JS source.
// - eslint-config-next (core-web-vitals) for apps/dashboard only.
// - Browser / webextension globals for the Chrome extension and the VS Code
//   webview script; Node globals everywhere else.
//
// Deliberate relaxations, so the baseline is honest rather than silenced:
//   * no-explicit-any: off — `(chrome as any)` for untyped chrome.* access
//     and the Gemini SDK's loose response shapes are an established idiom
//     here; typing them is a separate project.
//   * unused vars prefixed with _ are allowed.
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DASHBOARD = 'apps/dashboard/**/*.{js,jsx,mjs,ts,tsx}';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'archive/**',
      // Static marketing page: JSX compiled in the browser by Babel
      // standalone against a global React — not part of any build.
      'apps/landing-page/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/browser-ext/src/**/*.ts', 'packages/score-card/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  ...nextVitals.map((config) => ({ ...config, files: [DASHBOARD] })),
  {
    files: [DASHBOARD],
    settings: { next: { rootDir: 'apps/dashboard' } },
  },
);
