// Local-only API mounted on the Vite dev server. Supabase replaces this later.
//   /api/model     the imported model     <- data/model.json (read-only)
//   /api/actions   action items           -> data/actions.json
//   /api/contacts  PM WhatsApp numbers    -> data/pm-contacts.json
//   /api/comms     log of messages sent   -> data/comms.json
//   /api/master    customer profiles, rate cards, settings -> data/master.json
// All files live in data/ (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { newAction, applyChange, isClosed } from '../src/actions/logic.js';
import { readInbox } from '../src/engine/read.js';
import { periodKey } from '../src/engine/kinds.js';
import { applyChanges } from '../src/engine/live.js';

// Replace a file atomically; on Windows a reader can briefly lock the target (EPERM), so
// retry a few times and finally fall back to writing it in place.
function replaceFile(tmp, dest) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, dest);
      return;
    } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e;
      const until = Date.now() + 40;
      while (Date.now() < until); // brief wait (dev server only)
    }
  }
  fs.copyFileSync(tmp, dest);
  fs.rmSync(tmp, { force: true });
}

export function actionsApi({ dir }) {
  const store = (name, empty) => {
    const file = path.join(dir, name);
    return {
      load: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : empty()),
      save: (data) => {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        replaceFile(tmp, file); // atomic swap so a crash never leaves half a file
      },
    };
  };
  const actions = store('actions.json', () => []);
  const contacts = store('pm-contacts.json', () => ({}));
  const comms = store('comms.json', () => []);
  const master = store('master.json', () => ({ profiles: {}, rates: {}, settings: null }));
  const live = store('live.json', () => ({ source: 'export', since: null, people: [], salaries: {}, allocations: [], revenue: [], profiles: {}, target: 0.7, history: [] }));
  const imports = store('imports.json', () => ({ period: null, files: {}, validations: {}, customerValidations: {}, categories: {}, revenueOverrides: {}, salaryOverrides: {} }));

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => {
        try {
          resolve(s ? JSON.parse(s) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
    });

  const send = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  const route = (handler) => async (req, res) => {
    try {
      const id = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\//, ''));
      await handler(req, res, id);
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  };

  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/model', (req, res) => {
        const file = path.join(dir, 'model.json');
        if (!fs.existsSync(file)) return send(res, 404, { error: 'No data yet. Run "npm run import" first.' });
        res.setHeader('Content-Type', 'application/json');
        fs.createReadStream(file).pipe(res);
      });

      server.middlewares.use(
        '/api/actions',
        route(async (req, res, id) => {
          const all = actions.load();
          if (req.method === 'GET' && !id) return send(res, 200, all);
          if (req.method === 'POST' && !id) {
            const body = await readBody(req);
            const items = (Array.isArray(body) ? body : [body]).map((x) => newAction(x));
            // One open action per finding: skip duplicates instead of creating twins.
            const openFindings = new Set(all.filter((a) => a.findingId && !isClosed(a)).map((a) => a.findingId));
            const created = items.filter((a) => !a.findingId || !openFindings.has(a.findingId));
            actions.save([...all, ...created]);
            return send(res, 201, created);
          }
          if (req.method === 'PATCH' && id) {
            const i = all.findIndex((a) => a.id === id);
            if (i < 0) return send(res, 404, { error: 'Not found' });
            all[i] = applyChange(all[i], await readBody(req));
            actions.save(all);
            return send(res, 200, all[i]);
          }
          send(res, 405, { error: 'Method not allowed' });
        })
      );

      server.middlewares.use(
        '/api/contacts',
        route(async (req, res, id) => {
          const all = contacts.load();
          if (req.method === 'GET' && !id) return send(res, 200, all);
          if (req.method === 'PUT' && id) {
            const { whatsapp = '', groupLink = '' } = await readBody(req);
            all[id] = { whatsapp: String(whatsapp).trim(), groupLink: String(groupLink).trim(), updatedAt: new Date().toISOString() };
            contacts.save(all);
            return send(res, 200, all[id]);
          }
          send(res, 405, { error: 'Method not allowed' });
        })
      );

      server.middlewares.use(
        '/api/master',
        route(async (req, res, id) => {
          const m = master.load();
          if (req.method === 'GET' && !id) return send(res, 200, m);
          const [kind, code] = id.split('/');
          if (req.method === 'PUT' && kind === 'settings') {
            m.settings = await readBody(req);
            master.save(m);
            return send(res, 200, m.settings);
          }
          if (req.method === 'PUT' && (kind === 'profiles' || kind === 'rates') && code) {
            m[kind][code] = { ...(await readBody(req)), updatedBy: 'Matt', updatedAt: new Date().toISOString() };
            master.save(m);
            return send(res, 200, m[kind][code]);
          }
          send(res, 405, { error: 'Method not allowed' });
        })
      );

      // Imports: files + validation stamps + classifications + corrections (one period at a time locally).
      server.middlewares.use(
        '/api/imports',
        route(async (req, res, id) => {
          const st = imports.load();
          const [kind, key] = id.split('/');
          const stamp = { by: 'Matt', at: new Date().toISOString() };
          if (req.method === 'GET' && !id) return send(res, 200, st);
          if (req.method === 'POST' && kind === 'from-inbox') {
            // Local convenience: load the newest exports from data/inbox as if uploaded.
            const raw = readInbox(path.join(dir, 'inbox'));
            for (const [k, v] of Object.entries(raw)) st.files[k] = { ...v, uploadedBy: 'Matt', uploadedAt: stamp.at };
            if (raw.summary) st.period = periodKey(raw.summary.sheetName);
            imports.save(st);
            return send(res, 200, st);
          }
          if (req.method === 'PUT' && kind === 'file') {
            const body = await readBody(req);
            st.files[key] = { ...body.file, uploadedBy: 'Matt', uploadedAt: stamp.at };
            if (body.period) st.period = body.period;
            imports.save(st);
            return send(res, 200, st.files[key]);
          }
          const maps = { validation: 'validations', customer: 'customerValidations', category: 'categories', revenue: 'revenueOverrides', salary: 'salaryOverrides' };
          if (maps[kind] && key) {
            if (req.method === 'PUT') st[maps[kind]][key] = { ...(await readBody(req)), ...stamp };
            else if (req.method === 'DELETE') delete st[maps[kind]][key];
            else return send(res, 405, { error: 'Method not allowed' });
            imports.save(st);
            return send(res, 200, st[maps[kind]][key] || {});
          }
          if (req.method === 'POST' && kind === 'publish') {
            const { model } = await readBody(req);
            const mfile = path.join(dir, 'model.json');
            fs.writeFileSync(mfile + '.tmp', JSON.stringify(model));
            replaceFile(mfile + '.tmp', mfile);
            return send(res, 200, { ok: true });
          }
          send(res, 405, { error: 'Method not allowed' });
        })
      );

      // Live allocations (local mode mirrors the Supabase functions with src/engine/live.js).
      server.middlewares.use(
        '/api/live',
        route(async (req, res, id) => {
          const st = live.load();
          if (req.method === 'GET' && !id) return send(res, 200, st);
          if (req.method === 'POST' && id === 'apply') {
            const { changes, note, viewer } = await readBody(req);
            const who = viewer?.role === 'pm' ? viewer.name || viewer.pmId : 'Matt';
            const out = applyChanges(st, viewer || { role: 'admin' }, changes || [], note || '', who);
            live.save({ ...out.state, history: [...st.history, ...out.history] });
            return send(res, 200, { n: out.history.length });
          }
          if (req.method === 'POST' && id === 'sync') {
            const p = await readBody(req);
            const next = { ...st };
            const people = new Map(st.people.map((x) => [x.emp_id, x]));
            for (const x of p.people || []) people.set(x.emp_id, x);
            next.people = [...people.values()];
            for (const x of p.salaries || []) next.salaries[x.emp_id] = x.ctc_monthly_inr;
            if (p.revenue) next.revenue = p.revenue;
            if (p.profiles) next.profiles = p.profiles;
            if (p.settings) next.target = p.settings.target ?? next.target;
            if (p.allocations) {
              next.allocations = p.allocations;
              next.source = 'app';
              next.since = new Date().toISOString();
              next.history = [...st.history, { at: next.since, by: 'Matt', action: 'seed', note: p.note || 'Allocations loaded', after: { allocations: p.allocations.length } }];
            }
            live.save(next);
            return send(res, 200, { people: (p.people || []).length, allocations: p.allocations ? p.allocations.length : null });
          }
          send(res, 405, { error: 'Method not allowed' });
        })
      );

      server.middlewares.use(
        '/api/comms',
        route(async (req, res, id) => {
          const log = comms.load();
          if (req.method === 'GET' && !id) return send(res, 200, log);
          if (req.method === 'POST' && !id) {
            const { pmId, type, text, actionIds = [] } = await readBody(req);
            if (!pmId || !type || !text) throw new Error('pmId, type and text are required');
            const entry = { id: `M-${Date.now().toString(36)}`, at: new Date().toISOString(), by: 'Matt', pmId, type, text, actionIds };
            comms.save([...log, entry]);
            // Record the send on every action it covered, so each action's history shows the follow-up.
            const label = { digest: 'weekly digest', overdue: 'overdue alert', action: 'new-action message' }[type] || type;
            const all = actions.load().map((a) =>
              actionIds.includes(a.id) ? applyChange(a, { note: `Sent to PM on WhatsApp (${label})` }) : a
            );
            actions.save(all);
            return send(res, 201, { entry, actions: all.filter((a) => actionIds.includes(a.id)) });
          }
          send(res, 405, { error: 'Method not allowed' });
        })
      );
    },
  };
}
