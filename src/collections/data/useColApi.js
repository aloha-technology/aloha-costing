import { useEffect, useState } from 'react';
import { CLOUD } from '../../data/useViewer.js';
import { localColApi, cloudColApi } from './api.js';

// The Collections API for whoever is signed in (or being previewed locally).
export function useColApi(viewer) {
  const [api, setApi] = useState(null);
  const me = viewer.me;
  useEffect(() => {
    if (!me) return;
    if (!CLOUD) {
      setApi(localColApi(me.role === 'admin' ? null : me.role));
      return;
    }
    let live = true;
    cloudColApi(me).then((a) => live && setApi(a));
    return () => {
      live = false;
    };
  }, [me?.email, me?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  return api;
}
