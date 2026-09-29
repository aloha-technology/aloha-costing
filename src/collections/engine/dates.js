// Dates are plain 'YYYY-MM-DD' strings everywhere in Collections (no time zones).
const DAY = 86400000;

export const toDate = (s) => new Date(`${s}T00:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date(Date.now() + 5.5 * 3600000)); // India time
export const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * DAY));
export const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / DAY);

// 'YYYY-MM' billing month from an invoice date.
export const monthOf = (s) => (s || '').slice(0, 7);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym) => (ym ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : '—');
export const fmtDate = (s) => (s ? `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : '—');

// Accepts Excel serials, Date objects, 'YYYY-MM-DD', 'DD-MMM-YYYY', 'DD/MM/YYYY'. Returns ISO or ''.
export function parseDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : iso(v);
  if (typeof v === 'number') return iso(new Date(Date.UTC(1899, 11, 30) + v * DAY));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    if (mo >= 0) return `${y}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // Indian day-first
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : iso(d);
}
