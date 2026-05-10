// Flat config for ESLint v10.
// Mirrors the previous .eslintrc.json:
//   - eslint:recommended
//   - typescript-eslint recommended (strict subset dropped — matches prior behavior)
//   - import-x recommended + typescript resolver
//   - Electron's built-in modules treated as core modules
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'out/**',
      '.vite/**',
      'dist/**',
      'apps/*/dist/**',
      'packages/*/dist/**',
      'coverage/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'import-x': importX,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['./tsconfig.json', './apps/*/tsconfig.json', './packages/*/tsconfig.json'],
        },
      },
      'import-x/core-modules': ['electron'],
    },
    rules: {
      ...importX.flatConfigs.recommended.rules,
      ...importX.flatConfigs.typescript.rules,
      // Rules newly added to eslint:recommended in v9/v10. Prior lint baseline
      // did not enforce these and the existing codebase has intentional patterns
      // that conflict (e.g. falsy test inputs, TS-strict variable inits that
      // are redundantly re-assigned). Re-enable in a follow-up pass if desired.
      'no-useless-assignment': 'off',
      'no-constant-binary-expression': 'off',
    },
  },
];
