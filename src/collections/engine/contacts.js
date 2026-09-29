// Customer contacts and what each one is for. A contact can have several roles, and several
// contacts can share a role (e.g. three people receive invoices). Shared by Collections and Master data.
//
// Older records have a single `role`; they are read as roles here and saved as `roles` from then on.

export const CONTACT_ROLES = [
  { key: 'billing', label: 'Payment follow-up', short: 'Follow-up', hint: 'To: on payment reminders' },
  { key: 'invoice', label: 'Receives invoices', short: 'Invoices', hint: 'Send each monthly invoice to them' },
  { key: 'tax_invoice', label: 'Receives tax invoices', short: 'Tax invoices', hint: 'Sent after payment is received' },
  { key: 'escalation', label: 'Escalation', short: 'Escalation', hint: 'Copied on reminders from Day 30' },
  { key: 'am', label: 'Account-management calls', short: 'AM calls', hint: 'Invite to account calls' },
  { key: 'signer', label: 'Contract signed by', short: 'Signer', hint: 'Signed the contract for the customer' },
  { key: 'cc', label: 'Cc on reminders', short: 'Cc', hint: 'Copied on every reminder' },
];
export const ROLE_LABEL = Object.fromEntries(CONTACT_ROLES.map((r) => [r.key, r.short]));

// A contact from before roles existed: "billing" meant the person who gets invoices and follow-ups.
const LEGACY = { billing: ['billing', 'invoice', 'tax_invoice'], escalation: ['escalation'], cc: ['cc'], other: [] };

export function rolesOf(c) {
  if (Array.isArray(c?.roles)) return c.roles;
  if (c?.role) return LEGACY[c.role] || [c.role];
  return LEGACY.billing;
}
export const hasRole = (c, role) => rolesOf(c).includes(role);

// Contacts with an email for a role. Tax invoices fall back to the invoice, then follow-up contacts.
export function contactsFor(customer, role) {
  const list = (customer?.contacts || []).filter((c) => c.email);
  const pick = (r) => list.filter((c) => hasRole(c, r));
  if (role === 'tax_invoice') return pick('tax_invoice').length ? pick('tax_invoice') : pick('invoice').length ? pick('invoice') : pick('billing');
  if (role === 'invoice') return pick('invoice').length ? pick('invoice') : pick('billing');
  return pick(role);
}
export const emailsFor = (customer, role) => [...new Set(contactsFor(customer, role).map((c) => c.email.trim().toLowerCase()))];

// Save shape: roles array, no legacy field.
export function normalizeContact(c) {
  const { role, ...rest } = c;
  return { ...rest, name: (c.name || '').trim(), email: (c.email || '').trim().toLowerCase(), phone: (c.phone || '').trim(), title: (c.title || '').trim(), roles: rolesOf(c) };
}
