import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const config = {
    plugins: [react()],
    optimizeDeps: {
      include: ['microsoft-cognitiveservices-speech-sdk', 'react', 'react-dom']
    },
    build: {
      commonjsOptions: {
        include: [/microsoft-cognitiveservices-speech-sdk/, /node_modules/]
      }
    },
    server: {
      port: 38220,
      host: true,
      proxy: {
        '/api': 'http://127.0.0.1:8787',
      },
    }
  };

  // Add HTTPS configuration only in development mode
  if (mode === 'development' && fs.existsSync('certs/key.pem') && fs.existsSync('certs/cert.pem')) {
    config.server.https = {
      key: fs.readFileSync('certs/key.pem'),
      cert: fs.readFileSync('certs/cert.pem'),
    };
  }

  return config;
});
