// Local-only Master data API on the Vite dev server (Supabase table people_profiles in the cloud).
//   GET /api/people-profiles   { [emp_id]: profile }
//   PUT /api/people-profiles   upsert a list of profiles
// Stored in data/people-profiles.json (git-ignored).
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
