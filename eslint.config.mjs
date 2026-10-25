import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**', 'out/**', 'build/**', 'node_modules/**',
    'test/ui-controls/.next/**', 'test/ui-controls/results/**', 'test-results/**',
    '.codex/**', '.agents/**',
  ]),
]);
