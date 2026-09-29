import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionsApi } from './scripts/actions-api.js';
import { collectionsApi } from './scripts/collections-api.js';
import { masterDataApi } from './scripts/masterdata-api.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './', // relative asset paths so it works under any GitHub Pages repo path
  plugins: [react(), actionsApi({ dir: path.join(root, 'data') }), collectionsApi({ dir: path.join(root, 'data', 'collections'), env: process.env }), masterDataApi({ dir: path.join(root, 'data') })],
  server: { port: 5180, strictPort: true },
});
