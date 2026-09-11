import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  {
    ignores: [
      'apps/web/public/api-docs-assets/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/generated/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
