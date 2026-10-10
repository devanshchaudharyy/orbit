import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4000' },
  },
  preview: { port: 4173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4000' } },
});
