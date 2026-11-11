// Vigila, mientras la app está abierta, lo que merece un aviso (src/lib/notify.ts): las apuestas que el servidor resuelve
// solas y las bajas de jugadores en apuestas pendientes. Las recomendaciones muy buenas las avisa predictions.ts al verlas.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp, useCurrency } from '@/lib/app-context';
import { STATUS_LABEL, betProfit, money } from '@/lib/format';
import { alert, alertPrefs, firstTime, setAlertFallback } from '@/lib/notify';
import type { BetRef } from '@/lib/types';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '').replace(/[^a-z]/g, '');

export function Notifier() {
  const { toast } = useApp();
  const cur = useCurrency();
  const [prefs, setPrefs] = useState(alertPrefs);
  useEffect(() => {
    const re = () => setPrefs(alertPrefs());
    window.addEventListener('avisos', re); window.addEventListener('storage', re);
    return () => { window.removeEventListener('avisos', re); window.removeEventListener('storage', re); };
  }, []);
  useEffect(() => { setAlertFallback(toast); return () => setAlertFallback(null); }, [toast]);

  // Resueltas solas: las que estaban pendientes y dejan de estarlo justo después de que el servidor avise de que ha
  // resuelto algo (si las cambias tú a mano no se avisa)
  const { data: bets } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  const pending = useRef<Set<string> | null>(null);
  const settledAt = useRef(0);
  useEffect(() => window.api.onBetsSettled(() => { settledAt.current = Date.now(); }), []);
  useEffect(() => {
    if (!bets) return;
    const prev = pending.current;
    pending.current = new Set(bets.filter(b => b.status === 'pending').map(b => b.id));
    if (!prev || !prefs.settled || Date.now() - settledAt.current > 120e3) return;
    for (const b of bets) {
      if (!prev.has(b.id) || b.status === 'pending' || !firstTime(`bet:${b.id}:${b.status}`)) continue;
      const pl = betProfit(b);
      alert('settled', `Apuesta ${STATUS_LABEL[b.status].toLowerCase()}`, `${b.market} · ${b.selection} (${money(pl, cur, true)})`, `bet-${b.id}`);
    }
  }, [bets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bajas: jugadores de apuestas pendientes de baloncesto cuyo partido no ha empezado y salen de baja o en duda
  const watch = (bets ?? []).filter(b => b.status === 'pending').flatMap(b => {
    const refs: BetRef[] = b.legs?.length ? b.legs.filter(l => l.status === 'pending').flatMap(l => (l.ref ? [l.ref] : [])) : b.ref ? [b.ref] : [];
    return refs.filter(r => r.sport === 'basket' && r.key.startsWith('player|') && (!r.start || +new Date(r.start) > Date.now())).map(r => ({ bet: b, name: r.key.split('|')[2] }));
  });
  const inj = useQuery({
    queryKey: ['basket', 'injuries'], queryFn: () => window.api.basket.injuries(), enabled: prefs.injuries && watch.length > 0,
    refetchInterval: 10 * 60e3, staleTime: 5 * 60e3
  });
  useEffect(() => {
    if (!prefs.injuries || !inj.data) return;
    for (const { bet, name } of watch) {
      const i = inj.data.find(x => norm(x.name) === norm(name));
      if (!i || !/out|doubt|question/i.test(i.status) || !firstTime(`inj:${bet.id}:${norm(name)}:${i.status}`)) continue;
      alert('injuries', `${i.name}: ${i.status}`, `${i.detail ? `${i.detail}. ` : ''}Tu apuesta: ${bet.market} · ${bet.selection}`, `inj-${bet.id}`);
    }
  }, [inj.data, prefs.injuries]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

