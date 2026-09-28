import { defaultDue } from './logic.js';

// Default owner: the single owner if there is one; on shared findings the account PM.
export function defaultOwner(f, c) {
  if (f.ownerPmIds.length === 1) return f.ownerPmIds[0];
  if (c.accountPm && (f.ownerPmIds.includes(c.accountPm) || !f.ownerPmIds.length)) return c.accountPm;
  return f.ownerPmIds[0] || c.accountPm;
}

export function actionFromFinding(f, c, model, ownerPmId) {
  return {
    customerCode: c.code,
    customerName: c.name,
    findingId: f.id,
    kind: f.kind,
    severity: f.severity,
    title: f.title,
    ask: f.ask || '',
    description: [f.pmText, f.action].filter(Boolean).join(' '),
    ownerPmId: ownerPmId || defaultOwner(f, c),
    dueDate: defaultDue(f.severity),
    savingINR: f.savingINR,
    period: model.period,
  };
}
