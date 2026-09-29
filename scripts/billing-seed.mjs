// First fill of the monthly billing register (Master data → Billing) from Matt's sheets.
//   npm run billing:seed                    preview
//   npm run billing:seed -- --apply         write data/billing.json (local mode)
//   npm run billing:seed -- --apply --cloud write to Supabase billing_records (service-role key in .env)
//
// What goes in (only what the sheets actually say; nothing is reconstructed):
//   line   every invoicing line for the invoicing sheet's month (seats, amount, change vs last month)
//   change every row of "Delta every Month" (seat count, count/amount change, remarks) per month
//   month  company totals: "Billing Count Reporting Format" (long/short term, initially reported / final)
//          and the summary rows at the bottom of each delta sheet (seats, billed amount, targets)
// Paths can be overridden in data/billing-sources.json.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { root, adminClient } from './supabase-admin.mjs';
import { linesFromInvoicing, changeRecord, monthRecord, lineKey, isShort, companyMonths } from '../src/master/billing.js';
import { nameTokens } from '../src/collections/engine/payments.js';

XLSX.set_fs(fs);
const apply = process.argv.includes('--apply');
const cloud = process.argv.includes('--cloud');
const DESK = 'C:/Users/Mat/OneDrive/Desktop';
const inbox = path.join(root, 'data', 'inbox');
const latestInvoicing = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => /^Aloha Invoicing.*\.xlsx$/i.test(f)).sort().pop() : null;
const src = {
  invoicing: latestInvoicing ? path.join(inbox, latestInvoicing) : '',
  delta: `${DESK}/Delta in Billing/Delta every Month.xlsx`,
  billingCount: `${DESK}/Delta in Billing/BIlling Count Reporting Format.xlsx`,
  ...(fs.existsSync(path.join(root, 'data', 'billing-sources.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'data', 'billing-sources.json'), 'utf8')) : {}),
};

// "(0.64)" -> -0.64, " -   " -> 0, "1,008,026" -> 1008026, "(-) 9.53" -> -9.53, "(+) 5.83" -> 5.83
function num(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/,/g, '');
  if (!s || /^-+$/.test(s.replace(/\s/g, ''))) return 0;
  const neg = /^\(.*\)$/.test(s) || /^\(-\)/.test(s);
  s = s.replace(/^\([+-]\)\s*/, '').replace(/[()$\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sheetPeriod = (name) => {
  const m = String(name).match(/^([A-Za-z]{3})-(\d{2})$/);
  return m ? `20${m[2]}-${String(MON.indexOf(m[1]) + 1).padStart(2, '0')}` : null;
};
const read = (file) => (file && fs.existsSync(file) ? XLSX.readFile(file) : (console.warn(`  (skipped: ${file || 'no file'} not found)`), null));
const rowsOf = (wb, sheet) => XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '', raw: false });

const records = [];

// 1) Invoicing sheet: all lines for its month.
const invWb = read(src.invoicing);
let invLines = [];
let invPeriod = null;
if (invWb) {
  const rows = rowsOf(invWb, invWb.SheetNames[0]);
  const keys = Object.keys(rows[0] || {});
  const amountKey = keys.find((k) => / Amount$/.test(k) && !/^Diff/i.test(k));
  const countKey = amountKey.replace(/ Amount$/, '');
  invPeriod = sheetPeriod(countKey);
  const diffC = keys.find((k) => /^Diff\. of Count/i.test(k));
  const diffA = keys.find((k) => /^Diff\. of Amount/i.test(k));
  invLines = rows
    .filter((r) => String(r['Customer Name']).trim())
    .map((r) => ({ name: String(r['Customer Name']).trim(), code: String(r['Project Code'] || '').trim(), pmEmail: String(r.PM || '').trim().toLowerCase(), seats: num(r[countKey]), amountUSD: num(r[amountKey]), diffSeats: num(r[diffC]), diffAmountUSD: num(r[diffA]) }));
  records.push(...linesFromInvoicing(invLines, invPeriod, [], 'setup'));
}

// Match a delta-sheet name to an invoicing line: exact, without bracket notes, then unique token match.
const NOISE = new Set(['new', 'customer', 'project', 'short', 'term']);
const toks = (n) => nameTokens(n).filter((w) => !NOISE.has(w));
const bare = (n) => toks(String(n).replace(/\(.*?\)/g, '')).join(' ');
function resolve(name) {
  const exact = invLines.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const byBare = invLines.filter((l) => bare(l.name) === bare(name));
  if (byBare.length === 1) return byBare[0];
  const t = toks(name);
  const c = invLines.filter((l) => {
    const u = toks(l.name);
    const common = t.filter((w) => u.includes(w)).length;
    return common > 0 && common === Math.min(t.length, u.length);
  });
  return c.length === 1 ? c[0] : null;
}

// 2) Delta every Month: changes with reasons, and the summary block under TOTAL.
const deltaWb = read(src.delta);
let matched = 0;
let unmatched = 0;
if (deltaWb) {
  for (const sheet of deltaWb.SheetNames) {
    const period = sheetPeriod(sheet);
    if (!period) continue;
    let ended = false;
    const foot = {};
    const used = new Set();
    for (const r of rowsOf(deltaWb, sheet)) {
      const name = String(r['Customer Name'] || '').replace(/\s+/g, ' ').trim();
      if (!name) continue;
      if (/^(grand )?total$/i.test(name)) {
        ended = true;
        continue;
      }
      const vals = Object.values(r);
      if (ended) {
        if (/res(ource)? count/i.test(name)) Object.assign(foot, { seats: num(vals[1]), targetSeats: num(vals[2]) });
        if (/bi+led amt/i.test(name)) Object.assign(foot, { revenue: num(vals[1]), targetRevenue: num(vals[2]) });
        continue;
      }
      const k = Object.keys(r);
      const pick = (re) => k.find((x) => re.test(x));
      const seatsK = pick(/^seat count/i);
      const dK = pick(/diff\. of count|count delta/i);
      const aK = pick(/amount this month/i);
      const adK = pick(/amount delta/i);
      const line = resolve(name);
      line ? matched++ : unmatched++;
      let key = line ? lineKey(line.code, line.name) : undefined;
      // Two rows for one line in a month (e.g. separate kick-offs): keep both.
      if (key && used.has(key)) key = `${key}#${used.size}`;
      if (key) used.add(key);
      records.push(
        changeRecord(period, {
          name,
          key,
          code: line?.code,
          seats: seatsK && String(r[seatsK]).trim() !== '' ? num(r[seatsK]) : null,
          seatDelta: dK && String(r[dK]).trim() !== '' ? num(r[dK]) : null,
          amountUSD: aK && String(r[aK]).trim() !== '' ? num(r[aK]) : null,
          amountDelta: adK && String(r[adK]).trim() !== '' ? num(r[adK]) : null,
          remarks: String(r.Remarks || '').trim(),
          notes: String(r.Notes || '').trim(),
        })
      );
    }
    if (foot.seats || foot.revenue) records.push(monthRecord(period, foot, 'Delta sheet summary'));
  }
}

// 3) Billing Count Reporting Format: long/short term per month, initially reported and final.
const countWb = read(src.billingCount);
if (countWb) {
  for (const sheet of countWb.SheetNames) {
    const period = sheetPeriod(sheet);
    if (!period) continue;
    const a = XLSX.utils.sheet_to_json(countWb.Sheets[sheet], { header: 1, defval: '', raw: false });
    const block = (title) => {
      const i = a.findIndex((r) => new RegExp(title, 'i').test(String(r[0])));
      const v = i >= 0 ? a[i + 3] : null;
      if (!v || String(v[0]).trim() === '') return null;
      return { longSeats: num(v[0]), longRevenue: num(v[1]), shortSeats: num(v[2]), shortRevenue: num(v[3]), revenue: num(v[4]), seatDeltaReported: num(v[5]), revenueDeltaReported: num(v[6]) };
    };
    const initial = block('^Initially Reported');
    const final = block('^Final Billing');
    const use = final || initial;
    if (!use) continue;
    const existing = records.find((x) => x.id === `month|${period}`);
    const fields = { ...use, seats: Math.round(((use.longSeats || 0) + (use.shortSeats || 0)) * 100) / 100, stage: final ? 'final' : 'initially reported', initial, final };
    if (existing) Object.assign(existing, { ...fields, targetSeats: existing.targetSeats, targetRevenue: existing.targetRevenue, source: 'Billing Count' });
    else records.push(monthRecord(period, fields, 'Billing Count'));
  }
}

// Short-term lines: named or described as short term in the delta sheets.
const shortKeys = new Set(records.filter((x) => x.kind === 'change' && isShort(`${x.name} ${x.remarks}`) && x.key).map((x) => x.key.split('#')[0]));
for (const l of records.filter((x) => x.kind === 'line')) if (shortKeys.has(l.key)) l.term = 'short';

const kinds = records.reduce((m, x) => ((m[x.kind] = (m[x.kind] || 0) + 1), m), {});
console.log(`Invoicing: ${path.basename(src.invoicing || '')} → ${invPeriod}`);
console.log(`Records: ${JSON.stringify(kinds)}; delta rows matched to a billing line: ${matched}, not matched (closed or one-off rows): ${unmatched}`);
console.table(companyMonths(records).map((m) => ({ month: m.period, seats: m.seats, revenue: Math.round(m.revenue), long: m.longSeats, short: m.shortSeats, source: m.source })));

if (!apply) {
  console.log('\nPreview only. Add --apply (and --cloud for Supabase).');
  process.exit(0);
}
if (cloud) {
  const supabase = adminClient();
  const at = new Date().toISOString();
  for (let i = 0; i < records.length; i += 500) {
    const { error } = await supabase.from('billing_records').upsert(records.slice(i, i + 500).map((d) => ({ id: d.id, data: { ...d, updatedAt: at, updatedBy: 'setup' }, updated_by: 'setup', updated_at: at })));
    if (error) throw new Error(error.message);
  }
  console.log(`Uploaded ${records.length} billing records to Supabase.`);
} else {
  const file = path.join(root, 'data', 'billing.json');
  fs.writeFileSync(file, JSON.stringify(records, null, 1));
  console.log(`Wrote ${path.relative(root, file)}.`);
}
