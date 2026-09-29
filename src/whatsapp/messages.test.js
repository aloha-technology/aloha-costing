import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { weeklyDigest, overdueAlert, newActionMessage, waChatLink, isGroupLink } from './messages.js';
import { newAction } from '../actions/logic.js';
import { actionFromFinding } from '../actions/fromFinding.js';

const pm = { id: 'pm@x', name: 'Priya Nair' };
const model = {
  period: 'September 2026',
  target: 0.7,
  customers: [
    { code: 'C1', name: 'Acme', pmIds: ['pm@x'], belowTarget: true, margin: 0.6, gapINR: 250000, findings: [] },
    { code: 'C2', name: 'Beta', pmIds: ['pm@x'], belowTarget: false, margin: 0.8, gapINR: 0, findings: [] },
  ],
};
const mk = (title, dueDate) => newAction({ customerCode: 'C1', customerName: 'Acme', ownerPmId: 'pm@x', title, dueDate }, { now: new Date('2026-09-20') });

test('digest groups actions by urgency and asks for a reply', () => {
  const actions = [mk('Release 1 QA', '2026-09-25'), mk('Rate review', '2026-10-02'), mk('Consolidate', '2026-10-20')];
  const d = weeklyDigest(pm, model, actions, { on: '2026-09-28' });
  assert.match(d.text, /Weekly cost review · Priya Nair/);
  assert.match(d.text, /Acme: COST 60\.0%, cost off by ₹2\.50 L\/month/);
  assert.doesNotMatch(d.text, /Beta/);
  assert.match(d.text, /Overdue \(1\)\*\n1\. Acme: Release 1 QA \(due 25 Sep, 3 days late\)/);
  assert.match(d.text, /Due this week \(1\)/);
  assert.match(d.text, /Other open actions \(1\)/);
  assert.match(d.text, /reply here by \*30 Sep\*/);
  assert.equal(d.actionIds.length, 3);
});

test('overdue alert only when something is late', () => {
  assert.equal(overdueAlert(pm, [mk('x', '2026-10-05')], { on: '2026-09-28' }), null);
  const a = overdueAlert(pm, [mk('x', '2026-09-26')], { on: '2026-09-28' });
  assert.match(a.text, /this action is past the agreed date/);
});

test('new action message and links', () => {
  const m = newActionMessage(pm, { ...mk('Release 1 QA', '2026-10-01'), description: 'Please release one QA.' });
  assert.match(m.text, /\*Due:\* 1 Oct/);
  assert.equal(waChatLink('+91 98765 43210', 'hi there'), 'https://wa.me/919876543210?text=hi%20there');
  assert.equal(waChatLink('', 'x'), null);
  assert.equal(isGroupLink('https://chat.whatsapp.com/AbC123'), true);
  assert.equal(isGroupLink('https://example.com'), false);
});

// Guard rail on real data: track every finding as an action, then check no message
// contains any individual's CTC or per-account cost.
const modelPath = new URL('../../data/model.json', import.meta.url);
test('no salary or individual cost leaks into any PM message (real data)', { skip: !fs.existsSync(modelPath) && 'no local model' }, () => {
  const real = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const actions = real.customers.flatMap((c) =>
    c.findings.filter((f) => f.pmText).map((f) => newAction(actionFromFinding(f, c, real)))
  );
  const secrets = new Set();
  for (const c of real.customers)
    for (const p of c.people) {
      for (const v of [p.ctcMonthlyINR, p.costINR]) {
        if (!v || v < 1000) continue;
        secrets.add(Math.round(v).toLocaleString('en-IN'));
        secrets.add(`${(v / 1e5).toFixed(2)} L`);
      }
    }
  const soloCustomerGaps = new Set(real.customers.flatMap((c) => [`${(c.gapINR / 1e5).toFixed(2)} L`, Math.round(c.gapINR).toLocaleString('en-IN')]));
  for (const pmx of real.pms) {
    const texts = [weeklyDigest(pmx, real, actions).text, overdueAlert(pmx, actions, { on: '2099-01-01' })?.text || ''];
    for (const a of actions.filter((x) => x.ownerPmId === pmx.id)) texts.push(newActionMessage(pmx, a).text);
    for (const t of texts)
      for (const s of secrets) {
        if (soloCustomerGaps.has(s)) continue; // a customer-level gap can coincide with a person's cost
        assert.ok(!t.includes('₹' + s), `Message for ${pmx.name} contains ₹${s}`);
      }
  }
});
