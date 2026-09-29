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

export function actionsApi({ dir }) {
  const store = (name, empty) => {
    const file = path.join(dir, name);
    return {
      load: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : empty()),
      save: (data) => {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file); // atomic swap so a crash never leaves half a file
      },
    };
  };
  const actions = store('actions.json', () => []);
  const contacts = store('pm-contacts.json', () => ({}));
  const comms = store('comms.json', () => []);
  const master = store('master.json', () => ({ profiles: {}, rates: {}, settings: null }));

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
