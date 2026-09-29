// Monthly billing register: seats and revenue per invoicing line per month, with the change from last
// month and the reason, long/short-term split and billed seats by resource type. Pure JS.
//
// Records (one store, `kind` tells them apart):
//   line    one invoicing line in one month   id "line|YYYY-MM|<key>"
//   change  a change Matt logged (delta sheets) id "change|YYYY-MM|<key or name>"
//   month   company totals as reported          id "month|YYYY-MM"
// key = project (billing) code, or "n:<name>" for lines without one.
import { slug } from '../collections/engine/importer.js';
import { nameTokens } from '../collections/engine/payments.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const lineKey = (code, name) => (code ? String(code).trim() : `n:${slug(name)}`);
export const isShort = (text) => /short[\s-]*term/i.test(text || '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (p) => (p ? `${MONTHS[+p.slice(5, 7) - 1]}-${p.slice(2, 4)}` : '');
export const prevPeriod = (p) => {
  const [y, m] = p.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
// '2026-09' from the model's "September 2026".
export function periodOf(label) {
  const m = String(label || '').match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return String(label || '').slice(0, 7);
  const i = MONTHS.findIndex((x) => m[1].toLowerCase().startsWith(x.toLowerCase()));
  return i < 0 ? '' : `${m[2]}-${String(i + 1).padStart(2, '0')}`;
}

// Line records for a month from invoicing rows ({ name, code, pmEmail, seats, amountUSD, diffSeats, diffAmountUSD }).
// Deltas are against last month's recorded lines when there are any, else the sheet's own change columns.
// Term and resource types carry over from last month; remarks start empty.
export function linesFromInvoicing(rows, period, records = [], by = 'Matt') {
  const prev = new Map(records.filter((x) => x.kind === 'line' && x.period === prevPeriod(period)).map((x) => [x.key, x]));
  const hasPrev = prev.size > 0;
  const seen = new Map();
  for (const row of rows) {
    const key = lineKey(row.code, row.name);
    const cur = seen.get(key);
    if (cur) {
      // Two sheet rows on one code (e.g. two invoices): one line, names joined.
      cur.seats = r2(cur.seats + row.seats);
      cur.amountUSD = r2(cur.amountUSD + row.amountUSD);
      cur.sheetDiffSeats = r2(cur.sheetDiffSeats + (row.diffSeats || 0));
      cur.sheetDiffAmount = r2(cur.sheetDiffAmount + (row.diffAmountUSD || 0));
      cur.name = `${cur.name} + ${row.name}`;
      continue;
    }
    seen.set(key, { key, code: row.code || '', name: row.name, pmEmail: row.pmEmail || '', seats: r2(row.seats), amountUSD: r2(row.amountUSD), sheetDiffSeats: r2(row.diffSeats), sheetDiffAmount: r2(row.diffAmountUSD) });
  }
  const at = new Date().toISOString();
  const out = [...seen.values()].map((l) => {
    const p = prev.get(l.key);
    const seatDelta = hasPrev ? r2(l.seats - (p?.seats || 0)) : l.sheetDiffSeats;
    const amountDelta = hasPrev ? r2(l.amountUSD - (p?.amountUSD || 0)) : l.sheetDiffAmount;
    return {
      id: `line|${period}|${l.key}`,
      kind: 'line',
      period,
      key: l.key,
      code: l.code,
      name: l.name,
      pmEmail: l.pmEmail,
      seats: l.seats,
      amountUSD: l.amountUSD,
      seatDelta,
      amountDelta,
      term: p?.term || (isShort(l.name) ? 'short' : 'long'),
      byRole: p?.byRole && Math.abs(sumSeats(p.byRole) - l.seats) < 0.005 ? p.byRole : p?.byRole ? p.byRole.map((x) => ({ ...x })) : [],
      remarks: '',
      source: 'invoicing',
      recordedAt: at,
      recordedBy: by,
    };
  });
  // Lines billed last month but not this month: recorded at zero so the drop shows as a change.
  if (hasPrev)
    for (const p of prev.values())
      if (!seen.has(p.key) && (p.seats || p.amountUSD))
        out.push({ ...p, id: `line|${period}|${p.key}`, period, seats: 0, amountUSD: 0, seatDelta: r2(-p.seats), amountDelta: r2(-p.amountUSD), remarks: '', byRole: [], source: 'invoicing (not billed)', recordedAt: at, recordedBy: by });
  return out;
}

export const sumSeats = (byRole = []) => r2(byRole.reduce((s, x) => s + (Number(x.seats) || 0), 0));
export const roleValue = (byRole = []) => r2(byRole.reduce((s, x) => s + (Number(x.seats) || 0) * (Number(x.rateUSD) || 0), 0));
// Does the resource-type split add up to the line?
export function roleCheck(line) {
  if (!line.byRole?.length) return { state: 'none' };
  const seats = sumSeats(line.byRole);
  const value = roleValue(line.byRole);
  const seatsOk = Math.abs(seats - line.seats) < 0.01;
  const valueOk = Math.abs(value - line.amountUSD) <= Math.max(1, line.amountUSD * 0.01);
  return { state: seatsOk && valueOk ? 'ok' : 'mismatch', seats, value, seatsOk, valueOk };
}

export function summarize(lines) {
  const s = { lines: lines.length, seats: 0, revenue: 0, longSeats: 0, longRevenue: 0, shortSeats: 0, shortRevenue: 0, changed: 0, up: 0, down: 0 };
  for (const l of lines) {
    s.seats += l.seats;
    s.revenue += l.amountUSD;
    if (l.term === 'short') (s.shortSeats += l.seats), (s.shortRevenue += l.amountUSD);
    else (s.longSeats += l.seats), (s.longRevenue += l.amountUSD);
    if (Math.abs(l.seatDelta || 0) > 0.001 || Math.abs(l.amountDelta || 0) > 0.5) {
      s.changed++;
      if ((l.amountDelta || 0) > 0) s.up++;
      else s.down++;
    }
  }
  for (const k of ['seats', 'revenue', 'longSeats', 'longRevenue', 'shortSeats', 'shortRevenue']) s[k] = r2(s[k]);
  return s;
}

// One row per month: from recorded lines when the month has them, else the totals Matt reported,
// else just the changes logged that month (totals unknown).
export function companyMonths(records) {
  const periods = new Set(records.map((x) => x.period).filter(Boolean));
  const rows = [...periods].sort().map((p) => {
    const lines = records.filter((x) => x.kind === 'line' && x.period === p);
    const reported = records.find((x) => x.kind === 'month' && x.period === p);
    if (lines.length) return { period: p, source: 'recorded lines', ...summarize(lines), reported };
    const changed = records.filter((x) => x.kind === 'change' && x.period === p).length;
    if (!reported) return { period: p, source: 'changes only', seats: null, revenue: null, longSeats: null, longRevenue: null, shortSeats: null, shortRevenue: null, changed };
    return {
      period: p,
      source: reported.source || 'reported',
      seats: reported.seats ?? r2((reported.longSeats || 0) + (reported.shortSeats || 0)),
      revenue: reported.revenue ?? r2((reported.longRevenue || 0) + (reported.shortRevenue || 0)),
      longSeats: reported.longSeats ?? null,
      longRevenue: reported.longRevenue ?? null,
      shortSeats: reported.shortSeats ?? null,
      shortRevenue: reported.shortRevenue ?? null,
      changed,
      reported,
    };
  });
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const ok = prev && prev.period === prevPeriod(r.period) && prev.seats != null && r.seats != null;
    r.seatDelta = ok ? r2(r.seats - prev.seats) : null;
    r.revenueDelta = ok ? r2(r.revenue - prev.revenue) : null;
  });
  return rows;
}

// Everything the register knows about one paying customer: its lines by month, logged changes and
// revenue invoiced in Zoho per month.
export function accountBilling(records, { codes = [], names = [], invoices = [], accountId }) {
  const codeSet = new Set(codes);
  const nameToks = names.map(nameTokens).filter((t) => t.length);
  const matchesName = (n) => {
    const t = nameTokens(String(n).replace(/\(.*?\)/g, ''));
    return nameToks.some((a) => a.length && t.length && a.filter((w) => t.includes(w)).length >= Math.min(a.length, t.length));
  };
  const mine = (x) => (x.code && codeSet.has(x.code)) || (!x.code && x.name && matchesName(x.name));
  const lines = records.filter((x) => x.kind === 'line' && mine(x));
  const changes = records.filter((x) => x.kind === 'change' && mine(x)).sort((a, b) => b.period.localeCompare(a.period));
  const byPeriod = {};
  for (const l of lines) {
    const m = (byPeriod[l.period] ||= { period: l.period, seats: 0, amountUSD: 0, seatDelta: 0, amountDelta: 0, lines: [] });
    m.seats = r2(m.seats + l.seats);
    m.amountUSD = r2(m.amountUSD + l.amountUSD);
    m.seatDelta = r2(m.seatDelta + (l.seatDelta || 0));
    m.amountDelta = r2(m.amountDelta + (l.amountDelta || 0));
    m.lines.push(l);
  }
  const invoiced = {};
  for (const i of invoices) if (i.customerId === accountId && i.status !== 'void' && i.status !== 'draft') invoiced[i.period] = r2((invoiced[i.period] || 0) + i.amount);
  const months = [...new Set([...Object.keys(byPeriod), ...Object.keys(invoiced)])].sort().reverse();
  const latest = Object.values(byPeriod).sort((a, b) => b.period.localeCompare(a.period))[0] || null;
  return {
    months: months.map((p) => ({ period: p, ...(byPeriod[p] || { seats: null, amountUSD: null, lines: [] }), invoicedUSD: invoiced[p] ?? null })),
    changes,
    latest,
    ratePerSeat: latest && latest.seats > 0 ? Math.round(latest.amountUSD / latest.seats) : null,
  };
}

// Company totals from Matt's reports: the "Billing Count" sheets (long/short split) and the summary rows
// at the bottom of each "Delta every Month" sheet (seats, billed amount, targets).
export function monthRecord(period, fields, source) {
  return { id: `month|${period}`, kind: 'month', period, source, ...fields };
}

// A change row from a "Delta every Month" sheet.
export function changeRecord(period, { name, key, code, seats, seatDelta, amountUSD, amountDelta, remarks, notes }) {
  return {
    id: `change|${period}|${key || `n:${slug(name)}`}`,
    kind: 'change',
    period,
    key: key || `n:${slug(name)}`,
    code: code || '',
    name,
    seats: seats ?? null,
    seatDelta: seatDelta ?? null,
    amountUSD: amountUSD ?? null,
    amountDelta: amountDelta ?? null,
    remarks: [remarks, notes].filter(Boolean).join(' | '),
    source: 'delta sheet',
  };
}
