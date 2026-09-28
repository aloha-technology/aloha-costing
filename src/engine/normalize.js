// Small parsers for the messy values in the portal exports.

// "INR 1,96,722.83", "$3,100.00", "9,99,999.99", "100%", 42 -> number (NaN-safe: returns 0)
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export const text = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

// Billing / project codes sometimes carry stray whitespace or CRLF.
export const code = (v) => (v == null ? '' : String(v).replace(/\s+/g, ''));

// Employee IDs appear as "004" in one file and "4" in another.
export const empId = (v) => text(v).replace(/^0+(?=\d)/, '');

export const email = (v) => text(v).toLowerCase();

export const yes = (v) => /^y(es)?$/i.test(text(v));

const ROLE_ALIASES = {
  accountmanager: 'Account Manager',
  projectmanager: 'Project Manager',
  developer: 'Developer',
  seniordeveloper: 'Senior Developer',
  juniorlead: 'Junior Lead',
  technicallead: 'Technical Lead',
  manualqa: 'Manual QA',
  automationqa: 'Automation QA',
  qa: 'QA',
  qalead: 'QA Lead',
  qamanager: 'QA Manager',
  devops: 'DevOps',
  businessanalyst: 'Business Analyst',
  researchanalyst: 'Research Analyst',
  architect: 'Architect',
  graphicdesigner: 'Graphic Designer',
  scrummaster: 'Scrum Master',
  technicalsupport: 'Technical Support',
  datamining: 'Data Mining',
  dba: 'DBA',
  admin: 'Admin',
  accounts: 'Accounts',
  hr: 'HR',
  mis: 'MIS',
  grouplead: 'Group Lead',
};

export function role(v) {
  const key = text(v).toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return 'Unspecified';
  return ROLE_ALIASES[key] || text(v);
}

// "Northwind- Priya" -> "Priya"; "Global Bench- Priya - From Others" -> "Priya"; "Contoso" -> ''
export function projectSuffix(name) {
  const parts = text(name).split('-').map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !/^from others$/i.test(p));
  return kept.length > 1 ? kept[kept.length - 1] : '';
}

export const isBenchProject = (name) => /^global bench/i.test(text(name));
