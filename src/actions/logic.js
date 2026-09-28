// Pure action-item rules, shared by the local API (vite.config.js), the UI, and tests.

export const STATUSES = ['open', 'in_progress', 'closure_requested', 'done', 'dropped'];
export const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', closure_requested: 'Closure requested', done: 'Closed', dropped: 'Dropped' };
export const isClosed = (a) => a.status === 'done' || a.status === 'dropped';

// Default TAT (calendar days) by finding severity.
export const TAT_DAYS = { critical: 3, high: 7, medium: 14, low: 30 };

export const today = (now = new Date()) => toISODate(now);

export function toISODate(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

export const defaultDue = (severity, from = today()) => addDays(from, TAT_DAYS[severity] ?? 14);

export const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

export const isOverdue = (a, on = today()) => !isClosed(a) && a.dueDate < on;
export const daysLate = (a, on = today()) => (isOverdue(a, on) ? daysBetween(a.dueDate, on) : 0);

// Build a new action from a finding (or free-form fields). Validates required fields.
export function newAction(input, { by = 'Matt', now = new Date(), id } = {}) {
  const required = ['customerCode', 'ownerPmId', 'title', 'dueDate'];
  const missing = required.filter((k) => !input[k]);
  if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error('dueDate must be YYYY-MM-DD');
  const at = now.toISOString();
  return {
    id: id || `A-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    customerCode: input.customerCode,
    customerName: input.customerName || '',
    findingId: input.findingId || null,
    kind: input.kind || 'MANUAL',
    severity: input.severity || 'medium',
    title: input.title,
    ask: input.ask || '',
    description: input.description || '',
    ownerPmId: input.ownerPmId,
    savingINR: Number(input.savingINR) || 0,
    period: input.period || null,
    status: 'open',
    createdAt: at,
    createdBy: by,
    dueDate: input.dueDate,
    originalDueDate: input.dueDate,
    closedAt: null,
    closureNote: null,
    history: [{ at, by, type: 'created', text: `Created, due ${input.dueDate}` }],
  };
}

// Apply a change to an action and log it. change: {status?, dueDate?, ownerPmId?, note?, closureNote?}
export function applyChange(action, change, { by = 'Matt', now = new Date() } = {}) {
  const at = now.toISOString();
  const a = { ...action, history: [...action.history] };
  const log = (type, text, extra = {}) => a.history.push({ at, by, type, text, ...extra });

  if (change.status && change.status !== a.status) {
    if (!STATUSES.includes(change.status)) throw new Error(`Unknown status ${change.status}`);
    const closing = change.status === 'done' || change.status === 'dropped';
    if (closing && !text(change.closureNote)) throw new Error('A closure note is required to close or drop an action.');
    log('status', `${STATUS_LABEL[a.status]} → ${STATUS_LABEL[change.status]}${closing ? `: ${text(change.closureNote)}` : ''}`, {
      from: a.status,
      to: change.status,
    });
    a.status = change.status;
    a.closedAt = closing ? at : null;
    a.closureNote = closing ? text(change.closureNote) : null;
  }
  if (change.dueDate && change.dueDate !== a.dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.dueDate)) throw new Error('dueDate must be YYYY-MM-DD');
    log('due', `Due date ${a.dueDate} → ${change.dueDate}`, { from: a.dueDate, to: change.dueDate });
    a.dueDate = change.dueDate;
  }
  if (change.ownerPmId && change.ownerPmId !== a.ownerPmId) {
    log('owner', `Owner changed`, { from: a.ownerPmId, to: change.ownerPmId });
    a.ownerPmId = change.ownerPmId;
  }
  if (text(change.note)) log('note', text(change.note));
  return a;
}

const text = (v) => (v == null ? '' : String(v).trim());

// Is the issue behind this action still flagged in the latest imported data?
export function stillFlagged(action, model) {
  if (!action.findingId) return null;
  const c = model.customers.find((x) => x.code === action.customerCode);
  if (!c) return false;
  return c.findings.some((f) => f.id === action.findingId);
}

export function summarize(actions, on = today()) {
  const open = actions.filter((a) => !isClosed(a));
  const weekAhead = addDays(on, 7);
  const monthStart = on.slice(0, 8) + '01';
  return {
    open: open.length,
    overdue: open.filter((a) => isOverdue(a, on)).length,
    dueThisWeek: open.filter((a) => a.dueDate >= on && a.dueDate <= weekAhead).length,
    closedThisMonth: actions.filter((a) => a.status === 'done' && a.closedAt && toISODate(a.closedAt) >= monthStart).length,
    openSavingINR: open.reduce((s, a) => s + (a.savingINR || 0), 0),
  };
}
