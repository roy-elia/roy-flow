import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5188, strictPort: true },
  build: {
    rollupOptions: {
      // hub (index.html) and the desktop Flow Bar panel (flowbar.html)
      input: { main: 'index.html', flowbar: 'flowbar.html' },
    },
  },
});
