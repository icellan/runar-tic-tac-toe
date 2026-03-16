import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      // runar-sdk exports Node-only codegen modules that reference node:fs,
      // node:path, node:url. The frontend never uses them, so stub them out.
      external: (id) => /runar-sdk\/dist\/codegen/.test(id),
    },
  },
})
