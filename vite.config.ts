import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5188, strictPort: true },
  build: {
    rollupOptions: {
      // hub (index.html) and the desktop Flow Bar panel (flowbar.html)
      input: { main: 'index.html', flowbar: 'flowbar.html' },
    },
  },
});
