// Loads the common data (customers, teams, employees, contracts, billing register) from the existing
// Costing and Collections stores, and derives the views Directory and the Billing page use.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMaster } from '../views/Master.jsx';
import { masterDataApi } from './api.js';
import { employeeView, accountView, pmViews, unlinkedProjects, completeness } from './engine.js';
import { today } from '../collections/engine/dates.js';

export function useFoundation(viewer, colApi) {
  const { api, me } = viewer;
  const master = useMaster(api);
  const [state, setState] = useState({ loading: true });
  const [md, setMd] = useState(null);
  const load = useCallback(async () => {
    try {
      const mdApi = await masterDataApi(me);
      setMd(mdApi);
      const [model, col, profiles, contacts, billing] = await Promise.all([
        api.loadModel(),
        colApi.load(),
        mdApi.listPeopleProfiles().catch(() => ({})),
        me.role === 'admin' ? api.listContacts().catch(() => ({})) : Promise.resolve({}),
        mdApi.listBilling().catch(() => []),
      ]);
      setState({ loading: false, model, accounts: col.customers || [], invoices: col.invoices || [], contracts: col.contracts || [], profiles, contacts, billing });
    } catch (e) {
      setState({ loading: false, error: e.message });
    }
  }, [api, colApi, me]);
  useEffect(() => {
    load();
  }, [load]);

  const replace = (list, saved) => {
    const byId = Object.fromEntries(saved.map((x) => [x.id, x]));
    return [...list.filter((x) => !byId[x.id]), ...saved];
  };
  const ops = {
    async saveAccount(a) {
      const [saved] = await colApi.put('customers', [a]);
      setState((s) => ({ ...s, accounts: replace(s.accounts, [saved]) }));
      return saved;
    },
    async saveAccounts(list) {
      const saved = await colApi.put('customers', list);
      setState((s) => ({ ...s, accounts: replace(s.accounts, saved) }));
    },
    // Same name as in Collections, so shared screens (contracts) work in both areas.
    saveCustomer: (c) => ops.saveAccount(c),
    async saveContract(k) {
      const saved = await colApi.put('contracts', [{ ...k, id: k.id || `K-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }]);
      setState((s) => ({ ...s, contracts: replace(s.contracts, saved) }));
    },
    async deleteContract(k) {
      await colApi.remove('contracts', k.id);
      setState((s) => ({ ...s, contracts: s.contracts.filter((x) => x.id !== k.id) }));
    },
    async saveProfiles(rows) {
      const saved = await md.savePeopleProfiles(rows);
      setState((s) => ({ ...s, profiles: { ...s.profiles, ...Object.fromEntries(saved.map((r) => [r.emp_id, r])) } }));
    },
    async saveBilling(docs) {
      const saved = await md.saveBilling(docs);
      setState((s) => ({ ...s, billing: replace(s.billing, saved) }));
    },
    async saveContact(pmId, c) {
      const saved = await api.saveContact(pmId, c);
      setState((s) => ({ ...s, contacts: { ...s.contacts, [pmId]: saved } }));
    },
  };
  return { ...state, master, ops, reload: load };
}

export function useDerived(f) {
  const on = today();
  const derived = useMemo(() => {
    if (!f.model) return null;
    const model = f.model;
    const projectsByCode = Object.fromEntries((model.customers || []).map((c) => [c.code, c]));
    const pmsById = Object.fromEntries((model.pms || []).map((p) => [p.id, p]));
    const employeesById = Object.fromEntries((model.employees || []).map((e) => [e.empId, e]));
    const employees = (model.employees || []).map((e) => employeeView(e, f.profiles[e.empId], { on }));
    const accounts = f.accounts.map((a) => accountView(a, { projectsByCode, master: f.master, settings: f.master.settings, on, pmsById }));
    const pms = pmViews(model, employeesById, f.profiles, f.contacts, { on });
    const unlinked = unlinkedProjects(f.accounts, model.customers || []);
    // Resource types for the billing split: Aloha standard roles plus the ones on project rate cards.
    const roleOptions = [...new Set([...Object.keys(f.master.settings?.standardRates?.roles || {}), ...(model.customers || []).flatMap((c) => (c.seats || []).map((s) => s.role))])].filter(Boolean).sort();
    return { projectsByCode, pmsById, employees, accounts, pms, unlinked, roleOptions, completeness: completeness(accounts, employees) };
  }, [f.model, f.accounts, f.profiles, f.contacts, f.master, on]);
  return { derived, on };
}
