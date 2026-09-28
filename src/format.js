// Indian-style compact amounts: ₹4.25 L, ₹3.18 Cr.
export function inr(n, { compact = true } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (compact && a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (compact && a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}

export function usd(n, { compact = true } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (compact && a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (compact && a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
}

export const pct = (n, d = 1) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`);

export const marginClass = (m, target) =>
  m == null ? 'bad' : m >= target ? 'good' : m >= target - 0.1 ? 'warn' : 'bad';
