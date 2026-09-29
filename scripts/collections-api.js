// Local-only Collections API on the Vite dev server (Supabase replaces it in the cloud).
//   GET    /api/col                   everything: customers, invoices, payments, contracts, outbox, taxInvoices, settings
//   PUT    /api/col/<kind>            upsert a list of documents
//   DELETE /api/col/<kind>/<id>       remove one document
//   PUT    /api/col/settings          save settings
//   GET    /api/col/directory         invoice directory for the accounts portal
//   POST   /api/col/files?folder=&name=   upload a file (raw body) -> { fileId, name, size }
//   GET    /api/col/files/<fileId>    download a file
//   POST   /api/col/send              send queued emails now over SMTP (needs SMTP_* in .env)
// Data lives in data/collections/ (git-ignored, confidential).
import fs from 'node:fs';
import path from 'node:path';
import { localStore, sendQueued } from './collections-store.mjs';

export const KINDS = ['customers', 'invoices', 'payments', 'contracts', 'outbox', 'taxInvoices'];

export function collectionsApi({ dir, env = {} }) {
  const store = localStore(dir);

  const readRaw = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  const readBody = async (req) => {
    const b = await readRaw(req);
    if (!b.length) return {};
    try {
      return JSON.parse(b.toString('utf8'));
    } catch {
      throw new Error('Invalid JSON');
    }
  };
  const send = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  return {
    name: 'collections-api',
    configureServer(server) {
      server.middlewares.use('/api/col', async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://x');
          const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
          const [kind, id] = parts;
          // Previews (?as=leadership / ?as=accounts) are read-only; the page sends this header.
          const role = req.headers['x-preview-role'];
          const write = req.method !== 'GET';
          if (write && role === 'leadership') return send(res, 403, { error: 'Preview is read-only' });
          if (role === 'accounts' && !(kind === 'directory' || kind === 'files' || kind === 'taxInvoices' || (!kind && req.method === 'GET')))
            return send(res, 403, { error: 'Not available to the accounts team' });

          if (req.method === 'GET' && !kind) {
            const all = store.loadAll();
            if (role === 'accounts') return send(res, 200, { taxInvoices: all.taxInvoices, settings: {} });
            return send(res, 200, all);
          }
          if (req.method === 'GET' && kind === 'directory') return send(res, 200, store.directory());
          if (kind === 'settings' && req.method === 'PUT') return send(res, 200, store.saveSettings(await readBody(req), 'Matt'));
          if (kind === 'files' && req.method === 'POST') {
            const buf = await readRaw(req);
            return send(res, 201, store.saveFile(url.searchParams.get('folder') || 'misc', url.searchParams.get('name') || 'file', buf));
          }
          if (kind === 'files' && req.method === 'GET' && id) {
            const f = store.filePath(parts.slice(1).join('/'));
            if (!f) return send(res, 404, { error: 'File not found' });
            const name = path.basename(f).replace(/^[a-z0-9]+__/, '');
            res.setHeader('Content-Type', name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${name.replace(/"/g, '')}"`);
            return fs.createReadStream(f).pipe(res);
          }
          if (kind === 'send' && req.method === 'POST') return send(res, 200, await sendQueued(store, env, { by: 'Matt' }));
          if (KINDS.includes(kind) && req.method === 'PUT' && !id) {
            const docs = await readBody(req);
            const by = role === 'accounts' ? 'Accounts (preview)' : 'Matt';
            if (role === 'accounts' && docs.some((d) => d.status !== 'uploaded')) return send(res, 403, { error: 'Accounts can only upload' });
            return send(res, 200, store.put(kind, Array.isArray(docs) ? docs : [docs], by));
          }
          if (KINDS.includes(kind) && req.method === 'DELETE' && id) return send(res, 200, store.remove(kind, id, 'Matt'));
          send(res, 404, { error: 'Not found' });
        } catch (e) {
          send(res, 400, { error: e.message });
        }
      });
    },
  };
}
