// First-time setup of Collections from Matt's existing spreadsheets. Everything it creates is
// marked "not confirmed" so Matt can check each customer and invoice in the app (Setup page).
//   npm run col:seed              preview counts
//   npm run col:seed -- --apply   write data/collections/*.json (refuses to overwrite unless --force)
//
// Sources (override any path in data/collections-sources.json):
//   arDump      Zoho invoice dump ("Dump" sheet: invoice_number, customer_name, date, due_date, bcy_total, bcy_balance, status)
//   customers   "Customer Info" sheet: Customer Name, Source, Active/Closed?
//   invoicing   monthly invoicing sheet: Customer Name, Project Code, PM (email)
//   pending     Matt's "Pending Invoices" sheet: Project Name, Billing Code, Matt's Comment
//   details     "Details" sheet: Customer Name, BM, Priority
//   payments    bank credits: Customer Name per Bank, Zoho Customer Name (payer aliases)
//   model       costing model (only the PM names are read)
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
XLSX.set_fs(fs);
import { root } from './supabase-admin.mjs';
import { parseInvoiceRows, newInvoice, slug, norm } from '../src/collections/engine/importer.js';
import { nameTokens } from '../src/collections/engine/payments.js';
import { today } from '../src/collections/engine/dates.js';

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const outDir = path.join(root, 'data', 'collections');
const DESK = 'C:/Users/Mat/OneDrive/Desktop';
const sources = {
  arDump: `${DESK}/Sid Reports/New_File_AR_FY 22 - 26.xlsx`,
  customers: `${DESK}/Sid Reports/Aloha Billing Report_22 - 26.xlsx`,
  invoicing: 'D:/Aloha App/data/inbox/Aloha Invoicing_Sep 26.xlsx',
  pending: `${DESK}/Pending_Invoices_27th July 2026.xlsx`,
  details: `${DESK}/Files to use/Pending Payment_Apr-26.xlsx`,
  payments: `${DESK}/Payments in 25-26.xlsx`,
  model: 'D:/Aloha App/data/model.json',
  since: '2022-04-01', // invoice history kept from this date (FY22, as in Sid's AR report; older only if still open)
  ...readJson(path.join(root, 'data', 'collections-sources.json')),
};

function readJson(f) {
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function sheet(file, name) {
  if (!file || !fs.existsSync(file)) return console.warn(`  (skipped: ${file} not found)`), [];
  const wb = XLSX.readFile(file, { cellDates: true });
  const ws = wb.Sheets[name] || null;
  if (!ws) return console.warn(`  (skipped: no sheet "${name}" in ${path.basename(file)})`), [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
}
const cleanName = (s) => String(s || '').replace(/\(.*?\)/g, ' ').replace(/_\w+$/, '').trim();

// Best customer for a free-text name (token overlap), or null.
function matcher(customers) {
  const list = customers.map((c) => ({ c, t: nameTokens(c.name) }));
  return (name) => {
    const t = nameTokens(cleanName(name));
    if (!t.length) return null;
    let best = null;
    for (const x of list) {
      if (!x.t.length) continue;
      const joinedA = t.join('');
      const joinedB = x.t.join('');
      const common = t.filter((w) => x.t.includes(w)).length;
      const score = joinedA === joinedB ? 1 : joinedB.startsWith(joinedA) || joinedA.startsWith(joinedB) ? 0.9 : common / Math.max(t.length, x.t.length);
      if (!best || score > best.score) best = { c: x.c, score };
    }
    return best && best.score >= 0.6 ? best.c : null;
  };
}

const on = today();
console.log('Reading sources…');
const dump = sheet(sources.arDump, 'Dump');
const { invoices: parsed, errors } = parseInvoiceRows(dump, { source: 'zoho' });
if (errors.length) console.warn(`  ${errors.length} rows skipped, e.g. ${errors[0]}`);
const asOf = parsed.reduce((m, i) => (i.date > m ? i.date : m), '');
// Voids are kept (never chased) so Sid's report shows them as the Zoho dump does.
const keep = parsed.filter((i) => i.date >= sources.since || i.status === 'open' || i.status === 'bad_debt');

// Customers from the invoice history.
const custMap = new Map();
for (const i of keep) {
  const id = slug(i.customerName);
  if (!custMap.has(id))
    custMap.set(id, {
      id,
      name: i.customerName,
      zohoNames: [i.customerName],
      legalName: '',
      billingCode: '',
      entity: i.entity || '',
      currency: 'USD',
      paymentTermsDays: 15,
      active: true,
      salesSource: '',
      pm: null,
      otherPms: [],
      priority: '',
      comment: '',
      contacts: [],
      payerAliases: [],
      promise: null,
      doNotSend: false,
      notes: [],
      confirmed: false,
      seededFrom: ['Zoho invoice dump'],
      createdAt: new Date().toISOString(),
    });
}
const customers = [...custMap.values()];
const match = matcher(customers);
const byName = new Map(customers.map((c) => [norm(c.name), c]));
const find = (n) => byName.get(norm(n)) || match(n);

// Active / closed and sales source.
for (const r of sheet(sources.customers, 'Customer Info')) {
  const c = find(r['Customer Name']);
  if (!c) continue;
  c.active = !/closed/i.test(r['Active/Closed?']);
  c.salesSource = r.Source || '';
  c.seededFrom.push('Customer Info');
}

// PM and billing code from the monthly invoicing sheet (a billed customer can have several projects).
const pmNames = Object.fromEntries((readJson(sources.model).pms || []).map((p) => [norm(p.email || p.id), p.name]));
const pmOf = (email) => (email ? { name: pmNames[norm(email)] || email.split('@')[0], email: norm(email) } : null);
const lines = {};
for (const r of sheet(sources.invoicing, 'Running')) {
  const c = find(r['Customer Name']);
  if (!c || !r.PM) continue;
  (lines[c.id] ||= []).push({ pm: norm(r.PM), code: r['Project Code'], amount: parseFloat(String(r[Object.keys(r).find((k) => /amount/i.test(k)) || ''] || '0').replace(/[, ]/g, '')) || 0, line: r['Customer Name'] });
}
for (const [id, ls] of Object.entries(lines)) {
  const c = custMap.get(id);
  const byPm = {};
  for (const l of ls) byPm[l.pm] = (byPm[l.pm] || 0) + l.amount;
  const ranked = Object.entries(byPm).sort((a, b) => b[1] - a[1]).map(([e]) => e);
  c.pm = pmOf(ranked[0]);
  c.otherPms = ranked.slice(1).map(pmOf);
  c.billingCode = [...new Set(ls.map((l) => String(l.code || '').trim()).filter(Boolean))].join(', ');
  c.active = true;
  c.seededFrom.push('Invoicing Sep 26');
}

// BM (PM username) and priority from the older follow-up sheet, where the invoicing sheet had no PM.
for (const r of sheet(sources.details, 'Details')) {
  const c = find(r['Customer Name']);
  if (!c) continue;
  if (!c.pm && r.BM) c.pm = pmOf(`${r.BM}@alohatechnology.com`);
  if (r.Priority && r.Priority !== 'NA') c.priority = r.Priority;
}

// Matt's latest comments.
for (const r of sheet(sources.pending, 'Pending Invoices')) {
  const code = String(r['Billing Code'] || '').trim();
  const c = (code && customers.find((x) => x.billingCode.split(', ').includes(code))) || find(r['Project Name']);
  if (!c || !r["Matt's Comment"]) continue;
  const text = String(r["Matt's Comment"]).trim();
  if (c.notes.some((n) => n.text.endsWith(text))) continue; // one billed customer can have several project rows
  c.comment = c.comment ? `${c.comment} | ${text}` : text;
  c.notes.push({ at: '2026-07-27T00:00:00.000Z', by: 'Matt', text: `27 Jul 2026 sheet (${r['Project Name']}): ${text}` });
}

// Payer names the bank showed for a customer (helps the payer check).
for (const r of sheet(sources.payments, 'Jul 24-Jul 26')) {
  const bankName = String(r['Customer Name per Bank'] || '').trim();
  if (!bankName || /^stripe$/i.test(bankName) || !r['Zoho Customer Name']) continue;
  const c = find(r['Zoho Customer Name']);
  if (c && !c.payerAliases.includes(bankName)) c.payerAliases.push(bankName);
}

// Invoices. History (paid) is confirmed as-is; open ones need Matt's check.
const invoices = keep.map((i) => {
  const doc = newInvoice(i, { customerId: slug(i.customerName), staleDays: 365, on, by: 'setup' });
  if (i.status !== 'open') doc.confirmed = true;
  return doc;
});
// Per-invoice comments and true-void amounts from the dump (shown again in Sid's report).
const dumpByNo = new Map(dump.map((r) => [String(r.invoice_number || '').trim(), r]));
for (const inv of invoices) {
  const r = dumpByNo.get(inv.number);
  if (!r) continue;
  const comment = String(r["Matt's comment"] || '').trim();
  if (comment) inv.notes.push({ at: `${inv.date}T00:00:00.000Z`, by: 'Matt', text: comment });
  const voidAmt = parseFloat(String(r['Invoice Amt(True Void)'] || '').replace(/[, ]/g, ''));
  if (inv.status === 'void' && voidAmt) inv.voidAmount = voidAmt;
}
const openInv = invoices.filter((i) => i.status === 'open' && i.balance > 0);

console.log(`\nZoho data as of ${asOf} (today ${on})`);
console.log(`Customers: ${customers.length} (${customers.filter((c) => c.active).length} active, ${customers.filter((c) => c.pm).length} with a PM, ${customers.filter((c) => c.comment).length} with your comment)`);
console.log(`Invoices:  ${invoices.length} kept since ${sources.since}; open ${openInv.length} = $${Math.round(openInv.reduce((s, i) => s + i.balance, 0)).toLocaleString('en-US')}`);
console.log(`           ${openInv.filter((i) => i.doNotSend).length} open invoices older than a year set to "Do not send" until reviewed`);
const noPm = customers.filter((c) => !c.pm && openInv.some((i) => i.customerId === c.id)).map((c) => c.name);
if (noPm.length) console.log(`Customers with dues but no PM found: ${noPm.join('; ')}`);

if (!apply) {
  console.log('\nPreview only. Run with --apply to write data/collections/.');
  process.exit(0);
}
if (fs.existsSync(path.join(outDir, 'customers.json')) && !force) {
  console.error('data/collections/ already has data. Use --force to replace it (this discards changes made in the app).');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const write = (f, d) => fs.writeFileSync(path.join(outDir, f), JSON.stringify(d, null, 2));
write('customers.json', customers.sort((a, b) => a.name.localeCompare(b.name)));
write('invoices.json', invoices);
for (const f of ['payments.json', 'contracts.json', 'outbox.json', 'tax-invoices.json']) if (!fs.existsSync(path.join(outDir, f)) || force) write(f, []);
const settingsFile = path.join(outDir, 'settings.json');
const settings = readJson(settingsFile);
settings.lastImport = { at: new Date().toISOString(), source: path.basename(sources.arDump), asOf, by: 'setup' };
write('settings.json', settings);
console.log(`\nWrote ${path.relative(root, outDir)}/. Open the app → Collections → Setup to check each entry.`);
