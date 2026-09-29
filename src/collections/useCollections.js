// Loads Collections data and exposes every change as a named operation. Business rules live in
// the engine (src/collections/engine); this file only turns them into saved documents.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { withDefaults } from './engine/settings.js';
import { recordStage, fillTemplate } from './engine/reminders.js';
import { applyAllocations, settledAmount } from './engine/payments.js';
import { newInvoice } from './engine/importer.js';
import { allSummaries } from './engine/suggest.js';
import { today } from './engine/dates.js';

const EMPTY = { customers: [], invoices: [], payments: [], contracts: [], outbox: [], taxInvoices: [], settings: null };
export const newId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useCollections(api, me) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [on, setOn] = useState(today());
  const by = me?.name || me?.email || 'Matt';

  const reload = useCallback(() => api.load().then((d) => setData({ ...EMPTY, ...d }), (e) => setError(e.message)), [api]);
  useEffect(() => {
    reload();
  }, [reload]);

  // Save documents and merge them into state.
  const save = useCallback(
    async (kind, docs) => {
      if (!docs.length) return [];
      const saved = await api.put(kind, docs);
      setData((d) => {
        const byId = new Map(d[kind].map((x) => [x.id, x]));
        for (const s of saved) byId.set(s.id, s);
        return { ...d, [kind]: [...byId.values()] };
      });
      return saved;
    },
    [api]
  );
  const remove = useCallback(
    async (kind, id) => {
      await api.remove(kind, id);
      setData((d) => ({ ...d, [kind]: d[kind].filter((x) => x.id !== id) }));
    },
    [api]
  );

  const settings = useMemo(() => withDefaults(data?.settings), [data?.settings]);
  const summaries = useMemo(() => (data && me?.role !== 'accounts' ? allSummaries(data, settings, on) : []), [data, settings, on, me]);
  const byId = useMemo(() => {
    if (!data) return { customers: {}, invoices: {} };
    return { customers: Object.fromEntries(data.customers.map((c) => [c.id, c])), invoices: Object.fromEntries(data.invoices.map((i) => [i.id, i])) };
  }, [data]);

  const note = (text) => ({ at: new Date().toISOString(), by, text });
  const at = () => new Date().toISOString();

  const ops = {
    saveCustomer: (c) => save('customers', [c]),
    saveCustomers: (cs) => save('customers', cs),
    confirmCustomer: (c) => save('customers', [{ ...c, confirmed: true, confirmedAt: at(), confirmedBy: by }]),
    confirmInvoices: (invs) => save('invoices', invs.map((i) => ({ ...i, confirmed: true, confirmedAt: at(), confirmedBy: by }))),
    addCustomerNote: (c, text) => save('customers', [{ ...c, notes: [...(c.notes || []), note(text)] }]),
    setPromise: (c, promise, text) =>
      save('customers', [{ ...c, promise, notes: [...(c.notes || []), note(promise ? `Promise to pay${promise.amount ? ` $${promise.amount}` : ''} by ${promise.date}${text ? `: ${text}` : ''}` : `Promise cleared${text ? `: ${text}` : ''}`)] }]),

    // Invoice controls
    addInvoiceNote: (inv, text) => save('invoices', [{ ...inv, notes: [...(inv.notes || []), note(text)] }]),
    setDoNotSend: (inv, flag, reason) =>
      save('invoices', [{ ...inv, doNotSend: flag, doNotSendReason: flag ? reason || '' : '', notes: [...(inv.notes || []), note(flag ? `Do not send${reason ? `: ${reason}` : ''}` : 'Reminders switched back on')] }]),
    snooze: (inv, until, reason) =>
      save('invoices', [{ ...inv, snoozeUntil: until || null, notes: [...(inv.notes || []), note(until ? `Reminders rescheduled to ${until}${reason ? `: ${reason}` : ''}` : 'Reschedule cleared')] }]),
    skipStage: (invs, stages, reason) => save('invoices', recordStage(invs, { stages, action: 'skipped', at: at(), by, note: reason })),
    setStatus: (inv, status, reason) => save('invoices', [{ ...inv, status, balance: status === 'open' ? inv.balance : status === 'paid' ? 0 : inv.balance, notes: [...(inv.notes || []), note(`Status → ${status}${reason ? `: ${reason}` : ''}`)] }]),

    // Reminders: queue for the sender (SMTP), or record that Matt sent it from his own mailbox.
    async queueEmail(customer, invoices, draft, { manual = false } = {}) {
      const entry = {
        id: newId('E'),
        kind: 'reminder',
        customerId: customer.id,
        invoiceIds: invoices.map((i) => i.id),
        stage: draft.stage,
        stages: draft.stages,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        body: draft.body,
        status: manual ? 'sent' : 'queued',
        sentVia: manual ? 'manual' : null,
        sentAt: manual ? at() : null,
        createdAt: at(),
        createdBy: by,
      };
      await save('outbox', [entry]);
      await save('invoices', recordStage(invoices, { stage: draft.stage, stages: draft.stages, action: manual ? 'sent' : 'queued', at: at(), by, outboxId: entry.id }));
      return entry;
    },
    async cancelEmail(entry) {
      await save('outbox', [{ ...entry, status: 'cancelled', cancelledAt: at(), cancelledBy: by }]);
      const invs = (entry.invoiceIds || []).map((id) => byId.invoices[id]).filter(Boolean);
      // The stage goes back to the Reminders queue.
      await save('invoices', invs.map((i) => ({ ...i, reminders: (i.reminders || []).filter((r) => r.outboxId !== entry.id) })));
      if (entry.kind === 'tax_invoice' && entry.taxInvoiceId) {
        const t = data.taxInvoices.find((x) => x.id === entry.taxInvoiceId);
        if (t) await save('taxInvoices', [{ ...t, status: 'checked', outboxId: null }]);
      }
    },
    retryEmail: (entry) => save('outbox', [{ ...entry, status: 'queued', error: '' }]),
    async markEmailSent(entry) {
      await save('outbox', [{ ...entry, status: 'sent', sentVia: 'manual', sentAt: at() }]);
      const invs = (entry.invoiceIds || []).map((id) => byId.invoices[id]).filter(Boolean);
      await save('invoices', invs.map((i) => ({ ...i, reminders: (i.reminders || []).map((r) => (r.outboxId === entry.id ? { ...r, action: 'sent', at: at() } : r)) })));
      if (entry.kind === 'tax_invoice' && entry.taxInvoiceId) {
        const t = data.taxInvoices.find((x) => x.id === entry.taxInvoiceId);
        if (t) await save('taxInvoices', [{ ...t, status: 'sent', sentAt: at(), sentBy: by }]);
      }
    },
    async sendNow() {
      const r = await api.sendNow();
      await reload();
      return r;
    },

    // Payments
    async recordPayment(p) {
      const payment = { ...p, id: p.id || newId('P'), settled: settledAmount(p), recordedAt: at(), recordedBy: by };
      const invs = data.invoices.filter((i) => (payment.allocations || []).some((a) => a.invoiceId === i.id));
      const updated = applyAllocations(invs, payment, { at: payment.date });
      await save('payments', [payment]);
      await save('invoices', updated);
      // Learn the payer name for next time when Matt accepted it.
      const c = byId.customers[payment.customerId];
      if (c && payment.payerName && payment.rememberPayer && !(c.payerAliases || []).includes(payment.payerName))
        await save('customers', [{ ...c, payerAliases: [...(c.payerAliases || []), payment.payerName] }]);
      return payment;
    },
    async deletePayment(p) {
      const invs = data.invoices.filter((i) => (p.allocations || []).some((a) => a.invoiceId === i.id));
      await save('invoices', applyAllocations(invs, p, { sign: -1 }));
      await remove('payments', p.id);
    },

    // Zoho / QuickBooks import (Setup page) after Matt reviews the diff.
    async applyImport(diff, { addIds, closeIds, changeIds, newCustomers = [] }, meta) {
      if (newCustomers.length) await save('customers', newCustomers);
      const nowIso = at();
      const add = diff.added.filter((x) => addIds.has(x.number)).map((x) => newInvoice(x, { customerId: x.customerId, staleDays: settings.staleDays, on, by }));
      const close = diff.closed
        .filter((x) => closeIds.has(x.current.id))
        .map(({ current, incoming }) => ({ ...current, status: incoming.status, balance: incoming.status === 'paid' ? 0 : current.balance, paidAt: incoming.status === 'paid' ? current.paidAt || on : null, notes: [...(current.notes || []), note(`Import: ${incoming.status} in ${incoming.source}`)] }));
      const change = diff.changed
        .filter((x) => changeIds.has(x.current.id))
        .map(({ current, incoming }) => ({ ...current, balance: incoming.balance, notes: [...(current.notes || []), note(`Import: balance ${current.balance} → ${incoming.balance}`)] }));
      await save('invoices', [...add, ...close, ...change]);
      await api.saveSettings({ ...(data.settings || {}), lastImport: { at: nowIso, by, ...meta } });
      setData((d) => ({ ...d, settings: { ...(d.settings || {}), lastImport: { at: nowIso, by, ...meta } } }));
      return { added: add.length, closed: close.length, changed: change.length };
    },
    async addInvoice(inv) {
      return save('invoices', [newInvoice(inv, { customerId: inv.customerId, staleDays: 0, on, by })].map((i) => ({ ...i, source: 'manual', confirmed: true })));
    },

    // Contracts
    saveContract: (k) => save('contracts', [{ ...k, id: k.id || newId('K') }]),
    deleteContract: (k) => remove('contracts', k.id),

    // Tax invoices
    async uploadTaxInvoice(file, { invoiceId, customerId, taxInvoiceNo, replaceId }) {
      const f = await api.uploadFile('tax-invoices', file);
      const doc = {
        id: replaceId || newId('T'),
        invoiceId: invoiceId || null,
        customerId: customerId || null,
        taxInvoiceNo: taxInvoiceNo || '',
        fileId: f.fileId,
        fileName: f.name,
        size: f.size,
        status: 'uploaded',
        uploadedAt: at(),
        uploadedByName: by,
        rejectNote: '',
      };
      return (await save('taxInvoices', [doc]))[0];
    },
    saveTaxInvoice: (t) => save('taxInvoices', [t]),
    checkTaxInvoice: (t) => save('taxInvoices', [{ ...t, status: 'checked', checkedAt: at(), checkedBy: by }]),
    rejectTaxInvoice: (t, reason) => save('taxInvoices', [{ ...t, status: 'rejected', rejectNote: reason, rejectedAt: at(), rejectedBy: by }]),
    async sendTaxInvoice(t, draft, { manual = false } = {}) {
      const entry = {
        id: newId('E'),
        kind: 'tax_invoice',
        taxInvoiceId: t.id,
        customerId: t.customerId,
        invoiceIds: t.invoiceId ? [t.invoiceId] : [],
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        body: draft.body,
        attachments: [{ fileId: t.fileId, name: t.fileName }],
        status: manual ? 'sent' : 'queued',
        sentVia: manual ? 'manual' : null,
        sentAt: manual ? at() : null,
        createdAt: at(),
        createdBy: by,
      };
      await save('outbox', [entry]);
      await save('taxInvoices', [{ ...t, status: manual ? 'sent' : 'queued', outboxId: entry.id, sentAt: manual ? at() : null, sentBy: manual ? by : null }]);
      return entry;
    },
    taxDraft(t) {
      const c = byId.customers[t.customerId] || { name: '', contacts: [] };
      const inv = byId.invoices[t.invoiceId];
      const { subject, body } = fillTemplate(settings.taxInvoice, { customer: c, invoices: inv ? [inv] : [], settings, extra: { taxInvoiceNo: t.taxInvoiceNo || t.fileName.replace(/\.[^.]+$/, '') } });
      const to = (c.contacts || []).filter((x) => (x.role || 'billing') === 'billing' && x.email).map((x) => x.email);
      return { to, cc: (settings.alwaysCc || []).map((x) => (typeof x === 'string' ? x : x.email)).filter(Boolean), subject, body: inv ? body : body.replace(/ against invoice .*? for .*?\./, '.') };
    },

    saveSettings: async (s) => {
      const saved = await api.saveSettings(s);
      setData((d) => ({ ...d, settings: saved }));
    },
  };

  return { data, error, settings, summaries, byId, on, setOn, ops, reload, api };
}
