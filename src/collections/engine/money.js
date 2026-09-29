const SYMBOL = { USD: '$', SGD: 'S$', INR: '₹', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$' };
export const CURRENCIES = ['USD', 'INR', 'SGD', 'EUR', 'GBP', 'AUD', 'CAD'];

// Full amount with cents, for emails and payment records: $12,000.00
export function money(n, cur = 'USD') {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}${SYMBOL[cur] ?? `${cur} `}${s}`;
}

// Whole units for tables: $12,000
export function amt(n, cur = 'USD') {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '−' : ''}${SYMBOL[cur] ?? `${cur} `}${Math.abs(v).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US')}`;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
