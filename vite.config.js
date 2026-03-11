import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: '/camera/',
  plugins: [basicSsl()],
  server: {
    host: true,   // expose on network
    https: true,  // enable HTTPS
    proxy: {
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
});
