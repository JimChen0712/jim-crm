import { defineConfig } from 'vite';

const buildId = new Date().toISOString();

export default defineConfig({
  define: {
    __CRM_BUILD_ID__: JSON.stringify(buildId)
  },
  build: {
    lib: {
      entry: 'src/main.js',
      name: 'EtalkingCRM',
      formats: ['iife'],
      fileName: () => 'crm.js'
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',
    terserOptions: {
      format: {
        comments: false
      }
    }
  }
});
