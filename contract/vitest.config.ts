import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const runarRoot = resolve(__dirname, '../../runar');

export default defineConfig({
  resolve: {
    alias: {
      'runar-testing': resolve(runarRoot, 'packages/runar-testing/src/index.ts'),
      'runar-compiler': resolve(runarRoot, 'packages/runar-compiler/src/index.ts'),
      'runar-ir-schema': resolve(runarRoot, 'packages/runar-ir-schema/src/index.ts'),
      'runar-lang': resolve(runarRoot, 'packages/runar-lang/src/index.ts'),
      'runar-sdk': resolve(runarRoot, 'packages/runar-sdk/src/index.ts'),
    },
  },
});
