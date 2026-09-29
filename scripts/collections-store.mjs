// Storage for Collections used by the dev server and the scripts (seed, push, send).
//   localStore(dir)       JSON files in data/collections/ (+ files/ for uploads)
//   supabaseStore(client) the Supabase tables and "collections" bucket, with the service-role key
// Both have the same methods, so the email sender works against either.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { withDefaults } from '../src/collections/engine/settings.js';
import { buildQueue, draftFor, recordStage } from '../src/collections/engine/reminders.js';
import { today } from '../src/collections/engine/dates.js';

const FILES = { customers: 'customers.json', invoices: 'invoices.json', payments: 'payments.json', contracts: 'contracts.json', outbox: 'outbox.json', taxInvoices: 'tax-invoices.json' };
const TABLES = { customers: 'col_customers', invoices: 'col_invoices', payments: 'col_payments', contracts: 'col_contracts', outbox: 'col_outbox', taxInvoices: 'col_tax_invoices' };
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const safeName = (s) => String(s).replace(/[^\w.\- ()]+/g, '_').slice(0, 120);

export function localStore(dir) {
  const file = (n) => path.join(dir, n);
  const read = (n, empty) => (fs.existsSync(file(n)) ? JSON.parse(fs.readFileSync(file(n), 'utf8')) : empty);
  const write = (n, data) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file(n) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file(n));
  };
  const audit = (by, kind, ids, summary = '') => {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file('audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), by, kind, ids, summary }) + '\n');
  };

  const api = {
    loadAll() {
      const out = { settings: read('settings.json', null) };
      for (const [k, f] of Object.entries(FILES)) out[k] = read(f, []);
      return out;
    },
    put(kind, docs, by) {
      const all = read(FILES[kind], []);
      const idx = new Map(all.map((d, i) => [d.id, i]));
      const at = new Date().toISOString();
      const saved = docs.map((d) => ({ ...d, updatedAt: at, updatedBy: by }));
      for (const d of saved) {
        if (!d.id) throw new Error(`${kind}: document without id`);
        if (idx.has(d.id)) all[idx.get(d.id)] = d;
        else idx.set(d.id, all.push(d) - 1);
      }
      write(FILES[kind], all);
      audit(by, kind, saved.map((d) => d.id));
      return saved;
    },
    remove(kind, id, by) {
      write(FILES[kind], read(FILES[kind], []).filter((d) => d.id !== id));
      audit(by, kind, [id], 'deleted');
      return { ok: true };
    },
    saveSettings(s, by) {
      write('settings.json', s);
      audit(by, 'settings', ['settings']);
      return s;
    },
    saveFile(folder, name, buf) {
      const fileId = `${safeName(folder)}/${crypto.randomBytes(6).toString('hex')}__${safeName(name)}`;
      const p = path.join(dir, 'files', fileId);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, buf);
      return { fileId, name, size: buf.length };
    },
    filePath(fileId) {
      const p = path.resolve(dir, 'files', fileId);
      return p.startsWith(path.resolve(dir, 'files')) && fs.existsSync(p) ? p : null;
    },
    async readFile(fileId) {
      const p = api.filePath(fileId);
      if (!p) throw new Error(`File not found: ${fileId}`);
      return fs.readFileSync(p);
    },
    directory() {
      const { customers, invoices } = api.loadAll();
      const names = Object.fromEntries(customers.map((c) => [c.id, c.name]));
      return invoices
        .filter((i) => i.status !== 'void')
        .map((i) => ({ id: i.id, number: i.number, customerId: i.customerId, customerName: names[i.customerId] || i.customerId, date: i.date, amount: i.amount, currency: i.currency, status: i.status, paidAt: i.paidAt || null }));
    },
  };
  return api;
}

export function supabaseStore(client, by = 'scheduler') {
  const must = ({ data, error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };
  const api = {
    async loadAll() {
      const out = {};
      for (const [k, t] of Object.entries(TABLES)) out[k] = must(await client.from(t).select('data'), t).map((r) => r.data);
      out.settings = must(await client.from('col_settings').select('data').eq('id', 'settings'), 'settings')[0]?.data || null;
      return out;
    },
    async put(kind, docs, who = by) {
      const at = new Date().toISOString();
      const saved = docs.map((d) => ({ ...d, updatedAt: at, updatedBy: who }));
      for (let i = 0; i < saved.length; i += 500) {
        must(await client.from(TABLES[kind]).upsert(saved.slice(i, i + 500).map((d) => ({ id: d.id, data: d, updated_by: who, updated_at: at }))), `save ${kind}`);
      }
      must(await client.from('col_audit').insert({ by: who, kind, doc_ids: saved.map((d) => d.id).slice(0, 1000) }), 'audit');
      return saved;
    },
    async saveSettings(s, who = by) {
      must(await client.from('col_settings').upsert({ id: 'settings', data: s, updated_by: who, updated_at: new Date().toISOString() }), 'settings');
      return s;
    },
    async readFile(fileId) {
      const blob = must(await client.storage.from('collections').download(fileId), `download ${fileId}`);
      return Buffer.from(await blob.arrayBuffer());
    },
  };
  return api;
}

// Queue reminders for stages Matt switched to automatic (Settings -> Auto-send). Used by the
// scheduled sender; stages that need approval are left for Matt on the Reminders page.
export async function queueAutomatic(store, { on = today(), by = 'scheduler' } = {}) {
  const data = await store.loadAll();
  const settings = withDefaults(data.settings);
  if (!settings.autoSend?.length) return [];
  const queued = [];
  for (const q of buildQueue(data.customers, data.invoices, settings, on)) {
    if (q.blocked || !settings.autoSend.includes(q.stage.key)) continue;
    const d = draftFor(q, settings);
    const entry = { id: newId('E'), kind: 'reminder', customerId: q.customer.id, ...d, status: 'queued', createdAt: new Date().toISOString(), createdBy: by, auto: true };
    const invs = recordStage(q.due.map((r) => r.inv), { stage: d.stage, stages: d.stages, action: 'queued', at: entry.createdAt, by, outboxId: entry.id });
    await store.put('outbox', [entry], by);
    await store.put('invoices', invs, by);
    queued.push(entry);
  }
  return queued;
}

// Send every queued email over SMTP. SMTP settings come from the environment:
//   SMTP_HOST (default smtp.bizmail.yahoo.com), SMTP_PORT (465), SMTP_USER, SMTP_PASS, SMTP_FROM (optional)
export async function sendQueued(store, env, { by = 'scheduler', dryRun = false } = {}) {
  const data = await store.loadAll();
  const settings = withDefaults(data.settings);
  const queued = data.outbox.filter((e) => e.status === 'queued');
  if (!queued.length) return { sent: 0, failed: 0, results: [] };
  if (!dryRun && !(env.SMTP_USER && env.SMTP_PASS)) throw new Error('Email sending is not set up yet: add SMTP_USER and SMTP_PASS (Yahoo app password) to .env. Until then use "Open in email" and "Mark as sent".');

  let transport = null;
  if (!dryRun) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.bizmail.yahoo.com',
      port: Number(env.SMTP_PORT || 465),
      secure: Number(env.SMTP_PORT || 465) === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  const from = `${settings.senderName} <${env.SMTP_FROM || settings.senderEmail || env.SMTP_USER}>`;
  const invById = Object.fromEntries(data.invoices.map((i) => [i.id, i]));
  const taxById = Object.fromEntries(data.taxInvoices.map((t) => [t.id, t]));
  const results = [];
  for (const e of queued) {
    const at = new Date().toISOString();
    try {
      if (!e.to?.length) throw new Error('No recipient');
      const attachments = [];
      for (const a of e.attachments || []) attachments.push({ filename: a.name, content: await store.readFile(a.fileId) });
      if (dryRun) {
        results.push({ id: e.id, ok: true, to: e.to, subject: e.subject });
        continue;
      }
      await transport.sendMail({ from, to: e.to.join(', '), cc: (e.cc || []).join(', ') || undefined, bcc: settings.senderEmail || undefined, subject: e.subject, text: e.body, attachments });
      await store.put('outbox', [{ ...e, status: 'sent', sentAt: at, sentVia: 'smtp', error: '' }], by);
      await markDelivered(store, e, invById, taxById, at, by, 'sent');
      results.push({ id: e.id, ok: true });
    } catch (err) {
      if (dryRun) {
        results.push({ id: e.id, ok: false, error: err.message });
        continue;
      }
      await store.put('outbox', [{ ...e, status: 'failed', error: err.message, failedAt: at }], by);
      results.push({ id: e.id, ok: false, error: err.message });
    }
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

// After an email goes: the invoice reminder entries flip from queued to sent; tax invoices become sent.
async function markDelivered(store, e, invById, taxById, at, by) {
  if (e.kind === 'reminder') {
    const invs = (e.invoiceIds || [])
      .map((id) => invById[id])
      .filter(Boolean)
      .map((inv) => ({ ...inv, reminders: (inv.reminders || []).map((r) => (r.outboxId === e.id ? { ...r, action: 'sent', at } : r)) }));
    if (invs.length) await store.put('invoices', invs, by);
  }
  if (e.kind === 'tax_invoice' && e.taxInvoiceId && taxById[e.taxInvoiceId]) {
    await store.put('taxInvoices', [{ ...taxById[e.taxInvoiceId], status: 'sent', sentAt: at, sentBy: by, outboxId: e.id }], by);
  }
}
