// Which export is which (by column headers), their labels, and the period key. No
// dependencies, so the app can use these without loading the Excel reader.
export const KINDS = {
  summary: (h) => h.includes('Billing Code') && h.includes('Cost INR'),
  employees: (h) => h.includes('Allocated Projects') && h.includes('Project Utilization(%)'),
  projects: (h) => h.includes('Resource Type') && h.includes('Rate'),
  paysheet: (h) => h.includes('CTC') && h.includes('Base Salary'),
  bench: (h) => h.includes('Utilized salary'),
  invoicing: (h) => h.includes('Project Code') && h.includes('PM'),
};

export const KIND_LABEL = {
  summary: 'Costing sheet (monthly summary)',
  employees: 'Employees & allocations',
  projects: 'Project seats & rates',
  paysheet: 'Payroll (paysheet)',
  invoicing: 'Invoicing',
  bench: 'Bench',
};
export const REQUIRED_KINDS = ['summary', 'employees', 'projects', 'paysheet', 'invoicing'];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// "September 2026" -> "2026-09"; anything else is used as-is.
export function periodKey(label) {
  const m = String(label || '').trim().toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}` : String(label || '').trim();
}
