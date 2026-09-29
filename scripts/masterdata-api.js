// Local-only Master data API on the Vite dev server (Supabase table people_profiles in the cloud).
//   GET /api/people-profiles   { [emp_id]: profile }
//   PUT /api/people-profiles   upsert a list of profiles
//   GET /api/billing           [billing records]
//   PUT /api/billing           upsert a list of billing records
// Stored in data/people-profiles.json and data/billing.json (git-ignored).
import fs from 'node:fs';
import path from 'node:path';

export function masterDataApi({ dir }) {
  const file = path.join(dir, 'people-profiles.json');
  const load = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  const save = (d) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(d, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  const send = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'masterdata-api',
    configureServer(server) {
      const billingFile = path.join(dir, 'billing.json');
      server.middlewares.use('/api/billing', (req, res) => {
        const role = req.headers['x-preview-role'];
        if (role && role !== 'leadership') return send(res, 403, { error: 'Not available' });
        const all = fs.existsSync(billingFile) ? JSON.parse(fs.readFileSync(billingFile, 'utf8')) : [];
        if (req.method === 'GET') return send(res, 200, all);
        if (req.method !== 'PUT') return send(res, 405, { error: 'Method not allowed' });
        if (role) return send(res, 403, { error: 'Preview is read-only' });
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const docs = JSON.parse(body || '[]');
            const idx = new Map(all.map((d, i) => [d.id, i]));
            const at = new Date().toISOString();
            const saved = docs.map((d) => ({ ...d, updatedAt: at, updatedBy: 'Matt' }));
            for (const d of saved) {
              if (!d.id) throw new Error('id is required');
              if (idx.has(d.id)) all[idx.get(d.id)] = d;
              else idx.set(d.id, all.push(d) - 1);
            }
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(billingFile + '.tmp', JSON.stringify(all, null, 1));
            fs.renameSync(billingFile + '.tmp', billingFile);
            send(res, 200, saved);
          } catch (e) {
            send(res, 400, { error: e.message });
          }
        });
      });

      server.middlewares.use('/api/people-profiles', (req, res) => {
        const role = req.headers['x-preview-role'];
        // Previews: leadership reads, other roles see nothing.
        if (role && role !== 'leadership') return send(res, 403, { error: 'Not available' });
        if (req.method === 'GET') return send(res, 200, load());
        if (req.method !== 'PUT') return send(res, 405, { error: 'Method not allowed' });
        if (role) return send(res, 403, { error: 'Preview is read-only' });
        let s = '';
        req.on('data', (c) => (s += c));
        req.on('end', () => {
          try {
            const rows = JSON.parse(s || '[]');
            const all = load();
            const at = new Date().toISOString();
            for (const r of rows) {
              if (!r.emp_id) throw new Error('emp_id is required');
              all[r.emp_id] = { ...r, updated_by: 'Matt', updated_at: at };
            }
            save(all);
            send(res, 200, rows.map((r) => all[r.emp_id]));
          } catch (e) {
            send(res, 400, { error: e.message });
          }
        });
      });
    },
  };
}
