import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// runar-sdk's main entry re-exports Node-only codegen modules (node:fs, etc).
// Replace them with empty stubs so the build succeeds in the browser.
function stubRunarCodegen(): Plugin {
  const CODEGEN_RE = /runar-sdk\/dist\/codegen/
  return {
    name: 'stub-runar-codegen',
    enforce: 'pre',
    resolveId(id, importer) {
      if (CODEGEN_RE.test(id) || (importer && CODEGEN_RE.test(importer))) {
        return '\0stub-codegen'
      }
    },
    load(id) {
      if (id === '\0stub-codegen') return 'export {}'
    },
  }
}

export default defineConfig({
  plugins: [stubRunarCodegen(), react()],
  resolve: {
    alias: {
      // Redirect runar-lang to its runtime subpath so contract source
      // can be imported directly for off-chain simulation.
      'runar-lang': 'runar-lang/runtime',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
