// WhatsApp message builders. Everything here goes to PMs, so it must only use
// PM-safe fields: customer-level margin/gap, finding pmText, and action title/description.
// Never read people[].ctcMonthlyINR / costINR or finding.detail here.
import { isClosed, isOverdue, daysLate, addDays, today } from '../actions/logic.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

const lakh = (n) => (n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`);
const pct = (m) => (m == null ? 'no revenue' : `${(m * 100).toFixed(1)}%`);
const firstName = (pm) => pm.name.split(' ')[0];
const ask = (a) => a.ask || a.title;

export function pmActions(pm, actions) {
  return actions.filter((a) => a.ownerPmId === pm.id && !isClosed(a)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function weeklyDigest(pm, model, actions, { on = today(), maxCustomers = 8 } = {}) {
  const target = model.target;
  const mine = model.customers.filter((c) => c.pmIds.includes(pm.id));
  const below = mine.filter((c) => c.belowTarget).sort((a, b) => b.gapINR - a.gapINR);
  const open = pmActions(pm, actions);
  const overdue = open.filter((a) => isOverdue(a, on));
  const weekEnd = addDays(on, 7);
  const dueSoon = open.filter((a) => !isOverdue(a, on) && a.dueDate <= weekEnd);
  const later = open.filter((a) => a.dueDate > weekEnd);
  const replyBy = addDays(on, 2);

  const L = [];
  L.push(`*Weekly cost review · ${pm.name}*`);
  L.push(`_${model.period} data · target margin ${Math.round(target * 100)}%_`);
  L.push('');
  L.push(`Hi ${firstName(pm)}, here is where your accounts stand this week.`);
  L.push('');
  L.push(`*Customers:* ${mine.length} · *Below ${Math.round(target * 100)}%:* ${below.length}`);

  if (below.length) {
    L.push('');
    L.push('*Below target* (biggest gap first)');
    for (const c of below.slice(0, maxCustomers)) {
      L.push(`• ${c.name}: ${pct(c.margin)}${c.gapINR > 0 ? `, gap ${lakh(c.gapINR)}/month` : ''}`);
    }
    if (below.length > maxCustomers) L.push(`• +${below.length - maxCustomers} more`);
  }

  const list = (title, items, fmt) => {
    if (!items.length) return;
    L.push('');
    L.push(title);
    items.forEach((a, i) => L.push(`${i + 1}. ${fmt(a)}`));
  };
  list(`*🔴 Overdue (${overdue.length})*`, overdue, (a) => `${a.customerName}: ${ask(a)} (due ${shortDate(a.dueDate)}, ${daysLate(a, on)} days late)`);
  list(`*🟠 Due this week (${dueSoon.length})*`, dueSoon, (a) => `${a.customerName}: ${ask(a)} (due ${shortDate(a.dueDate)})`);
  list(`*Other open actions (${later.length})*`, later, (a) => `${a.customerName}: ${ask(a)} (due ${shortDate(a.dueDate)})`);

  L.push('');
  if (open.length) {
    L.push(`Please reply here by *${shortDate(replyBy)}* with an update on each action: done, in progress (with a date), or blocked (and why).`);
  } else if (below.length) {
    L.push('No open actions yet. We will share specific actions for the accounts above shortly.');
  } else {
    L.push('All your accounts are at or above target. Thank you! 👏');
  }

  return { text: L.join('\n'), actionIds: open.map((a) => a.id), counts: { customers: mine.length, below: below.length, open: open.length, overdue: overdue.length, dueSoon: dueSoon.length } };
}

export function overdueAlert(pm, actions, { on = today() } = {}) {
  const overdue = pmActions(pm, actions).filter((a) => isOverdue(a, on));
  if (!overdue.length) return null;
  const L = [];
  L.push(`*🔴 Overdue actions · ${pm.name}*`);
  L.push('');
  L.push(`Hi ${firstName(pm)}, ${overdue.length === 1 ? 'this action is' : `these ${overdue.length} actions are`} past the agreed date:`);
  L.push('');
  overdue.forEach((a, i) => L.push(`${i + 1}. ${a.customerName}: ${ask(a)} (due ${shortDate(a.dueDate)}, ${daysLate(a, on)} days late)`));
  L.push('');
  L.push('Please share today: is it done, or what new date can you commit to and what is blocking it?');
  return { text: L.join('\n'), actionIds: overdue.map((a) => a.id), counts: { overdue: overdue.length } };
}

export function newActionMessage(pm, action) {
  const L = [];
  L.push(`*New action · ${action.customerName}*`);
  L.push('');
  L.push(`Hi ${firstName(pm)}, a cost action has been assigned to you:`);
  L.push('');
  L.push(`*${action.title}*`);
  if (action.description) L.push(action.description);
  L.push('');
  L.push(`*Due:* ${shortDate(action.dueDate)}`);
  L.push('Please confirm here that you have picked it up, and reply with the outcome by the due date.');
  return { text: L.join('\n'), actionIds: [action.id], counts: {} };
}

// WhatsApp click-to-chat link for a personal number (digits only, with country code).
export function waChatLink(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const isGroupLink = (url) => /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/.test(String(url || '').trim());
