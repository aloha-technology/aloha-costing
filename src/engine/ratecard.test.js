import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateCard, standardRate, addMonths, DEFAULT_SETTINGS } from './ratecard.js';

const customer = {
  seats: [
    { role: 'Developer', count: 2, rateUSD: 2700, subproject: 'A' },
    { role: 'Developer', count: 1, rateUSD: 3000, subproject: 'B' },
    { role: 'AI Engineer', count: 1, rateUSD: 3600, subproject: 'A' },
    { role: 'Account Manager', count: 1, rateUSD: 0, subproject: 'A' },
  ],
};

test('standard rates: $3,000 default, $4,000 for AI Engineer', () => {
  assert.equal(standardRate(DEFAULT_SETTINGS, 'Developer'), 3000);
  assert.equal(standardRate(DEFAULT_SETTINGS, 'AI Engineer'), 4000);
});

test('bill rate per role from seats, discount against standard', () => {
  const rc = rateCard(customer, {}, DEFAULT_SETTINGS, '2026-09-29');
  const dev = rc.rows.find((r) => r.role === 'Developer');
  assert.equal(dev.seats, 3);
  assert.equal(dev.billRateUSD, 2800); // (2 x 2700 + 3000) / 3
  assert.ok(Math.abs(dev.discountPct - 0.0667) < 0.001);
  const ai = rc.rows.find((r) => r.role === 'AI Engineer');
  assert.equal(ai.discountPct, 0.1);
  const am = rc.rows.find((r) => r.role === 'Account Manager');
  assert.equal(am.billed, false);
  assert.equal(am.discountPct, null);
  assert.equal(rc.billedValueUSD, 12000); // 3 x 2800 + 3600
  assert.equal(rc.standardValueUSD, 13000); // 3 x 3000 + 4000
  assert.equal(rc.upliftAtStandardUSD, 1000);
  assert.equal(rc.status, 'unknown');
});

test('overrides, reasons and revision status', () => {
  const rec = { roles: { Developer: { billRateUSD: 2500, reason: 'Volume (10+ seats)' } }, reason: 'Long-term contract', lastRevised: '2025-08-01' };
  const rc = rateCard(customer, rec, DEFAULT_SETTINGS, '2026-09-29');
  const dev = rc.rows.find((r) => r.role === 'Developer');
  assert.equal(dev.billRateUSD, 2500);
  assert.equal(dev.overridden, true);
  assert.equal(dev.reason, 'Volume (10+ seats)');
  assert.equal(rc.rows.find((r) => r.role === 'AI Engineer').reason, 'Long-term contract');
  assert.equal(rc.dueDate, '2026-08-01');
  assert.equal(rc.status, 'due');
  assert.equal(rateCard(customer, { lastRevised: '2025-11-01' }, DEFAULT_SETTINGS, '2026-09-29').status, 'soon');
  assert.equal(rateCard(customer, { lastRevised: '2026-06-01' }, DEFAULT_SETTINGS, '2026-09-29').status, 'ok');
  assert.equal(addMonths('2026-01-31', 1), '2026-03-03'); // JS month overflow, acceptable for a reminder
});
