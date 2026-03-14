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
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
