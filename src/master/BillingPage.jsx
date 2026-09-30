// The billing register as a page of the Invoices area. It needs the shared data (Costing model,
// customers, billing records), so it loads them itself; customer links open the customer in Directory.
import React from 'react';
import Billing from './Billing.jsx';
import { useFoundation, useDerived } from './useFoundation.js';

export default function BillingPage({ viewer, api, me, can, focus, setFocus }) {
  const f = useFoundation(viewer, api);
  const { derived, on } = useDerived(f);
  if (f.error) return <div className="empty">{f.error}</div>;
  if (!derived) return <div className="empty">Loading…</div>;
  const go = (t, id = '') => {
    if (t === 'customers') location.hash = `#m-customers${id ? '/' + encodeURIComponent(id) : ''}`;
  };
  return <Billing {...f} {...derived} on={on} me={me} can={can} go={go} focus={focus} setFocus={setFocus} />;
}
