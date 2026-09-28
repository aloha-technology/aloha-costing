import { useCallback, useEffect, useState } from 'react';

// PM contacts (WhatsApp number / group link) and the log of messages marked as sent.
export function useComms(api) {
  const [contacts, setContacts] = useState({});
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!api) return;
    Promise.all([api.listContacts(), api.listComms()])
      .then(([c, l]) => {
        setContacts(c);
        setLog(l);
      })
      .catch((e) => setError(e.message));
  }, [api]);

  const saveContact = useCallback(
    async (pmId, contact) => {
      const saved = await api.saveContact(pmId, contact);
      setContacts((c) => ({ ...c, [pmId]: saved }));
    },
    [api]
  );

  const markSent = useCallback(
    async (entry) => {
      const saved = await api.markSent(entry);
      setLog((l) => [...l, saved]);
      return saved;
    },
    [api]
  );

  const lastSent = useCallback(
    (pmId, type) => log.filter((e) => e.pmId === pmId && e.type === type).sort((a, b) => b.at.localeCompare(a.at))[0] || null,
    [log]
  );

  return { contacts, log, error, saveContact, markSent, lastSent };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}
