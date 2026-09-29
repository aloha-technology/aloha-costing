// Collections data access. Same methods in both modes:
//   local  -> the dev-server API over data/collections (scripts/collections-api.js)
//   cloud  -> Supabase tables col_* and the private "collections" storage bucket (supabase/collections.sql)
const KIND_TABLE = { customers: 'col_customers', invoices: 'col_invoices', payments: 'col_payments', contracts: 'col_contracts', outbox: 'col_outbox', taxInvoices: 'col_tax_invoices' };

export function localColApi(previewRole = null) {
  const headers = { 'Content-Type': 'application/json', ...(previewRole ? { 'x-preview-role': previewRole } : {}) };
  const call = async (url, opts = {}) => {
    const r = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
    return body;
  };
  return {
    mode: previewRole ? 'preview' : 'local',
    readOnly: previewRole === 'leadership',
    load: () => call('/api/col', { cache: 'no-store' }),
    put: (kind, docs) => call(`/api/col/${kind}`, { method: 'PUT', body: JSON.stringify(docs) }),
    remove: (kind, id) => call(`/api/col/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    saveSettings: (s) => call('/api/col/settings', { method: 'PUT', body: JSON.stringify(s) }),
    directory: () => call('/api/col/directory'),
    async uploadFile(folder, file) {
      const r = await fetch(`/api/col/files?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
        headers: previewRole ? { 'x-preview-role': previewRole } : {},
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Upload failed');
      return body;
    },
    fileUrl: async (fileId) => `/api/col/files/${fileId.split('/').map(encodeURIComponent).join('/')}`,
    sendNow: () => call('/api/col/send', { method: 'POST' }),
    canSendNow: true,
  };
}

export async function cloudColApi(me) {
  const { supabase } = await import('../../data/api.cloud.js');
  const by = me.name || me.email;
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const audit = (kind, ids) => supabase.from('col_audit').insert({ by, kind, doc_ids: ids.slice(0, 1000) });
  return {
    mode: 'cloud',
    readOnly: me.role === 'leadership',
    async load() {
      const kinds = me.role === 'accounts' ? ['taxInvoices'] : Object.keys(KIND_TABLE);
      const out = { customers: [], invoices: [], payments: [], contracts: [], outbox: [], taxInvoices: [], settings: null };
      await Promise.all(
        kinds.map(async (k) => {
          // PostgREST returns at most 1000 rows per request; page through.
          const rows = [];
          for (let from = 0; ; from += 1000) {
            const page = must(await supabase.from(KIND_TABLE[k]).select('data').range(from, from + 999));
            rows.push(...page);
            if (page.length < 1000) break;
          }
          out[k] = rows.map((r) => r.data);
        })
      );
      if (me.role !== 'accounts') out.settings = must(await supabase.from('col_settings').select('data').eq('id', 'settings'))[0]?.data || null;
      return out;
    },
    async put(kind, docs) {
      const at = new Date().toISOString();
      const saved = docs.map((d) => ({ ...d, updatedAt: at, updatedBy: by }));
      for (let i = 0; i < saved.length; i += 500) {
        must(await supabase.from(KIND_TABLE[kind]).upsert(saved.slice(i, i + 500).map((d) => ({ id: d.id, data: d, updated_by: by, updated_at: at }))));
      }
      if (me.role === 'admin') await audit(kind, saved.map((d) => d.id));
      return saved;
    },
    async remove(kind, id) {
      must(await supabase.from(KIND_TABLE[kind]).delete().eq('id', id));
      await audit(kind, [id]);
      return { ok: true };
    },
    async saveSettings(s) {
      must(await supabase.from('col_settings').upsert({ id: 'settings', data: s, updated_by: by, updated_at: new Date().toISOString() }));
      await audit('settings', ['settings']);
      return s;
    },
    async directory() {
      return must(await supabase.rpc('col_invoice_directory')).map((r) => ({ id: r.id, number: r.number, customerId: r.customer_id, customerName: r.customer_name, date: r.date, amount: Number(r.amount), currency: r.currency, status: r.status, paidAt: r.paid_at }));
    },
    async uploadFile(folder, file) {
      const safe = file.name.replace(/[^\w.\- ()]+/g, '_');
      const fileId = `${folder}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}__${safe}`;
      must(await supabase.storage.from('collections').upload(fileId, file, { contentType: file.type || 'application/octet-stream' }));
      return { fileId, name: file.name, size: file.size };
    },
    async fileUrl(fileId) {
      return must(await supabase.storage.from('collections').createSignedUrl(fileId, 600)).signedUrl;
    },
    // In the cloud, queued emails go out with the scheduled sender (GitHub Action, every 30 minutes on weekdays).
    sendNow: async () => {
      throw new Error('Queued emails go out automatically within 30 minutes.');
    },
    canSendNow: false,
  };
}
