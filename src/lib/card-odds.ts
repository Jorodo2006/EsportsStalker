// Cuota pulsada en una tarjeta de partido o en una fila de tenis: va directa al cupón, sin abrir el partido.
// La tarjeta sólo conoce la mejor cuota de ganador; la casa y el mercado salen de las cuotas completas del partido,
// que se piden (o se sacan de la caché) al pulsar. Es la misma selección que se haría desde la pestaña Cuotas.
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/app-context';
import { oddsMeta } from '@/lib/odds-live';
import type { OddsTarget } from '@/components/BasketOdds';

export type CardSide = 'a' | 'x' | 'b';

// Misma clave de caché que la pestaña Cuotas de cada deporte (la de LoL es ['odds', id])
export function useCardOdd() {
  const qc = useQueryClient();
  const { addToSlip, toast } = useApp();
  return async (t: OddsTarget, side: CardSide) => {
    try {
      const data = await qc.fetchQuery({
        queryKey: t.sport === 'lol' ? ['odds', t.id] : ['odds', t.sport, t.id], queryFn: () => window.api.odds.match(t.match), staleTime: 60_000, meta: oddsMeta(t.match)
      });
      const line = data.markets.find(l => l.key === 'moneyline|0||');
      const out = line?.outcomes.find(o => o.id === side);
      const best = Object.entries(out?.prices ?? {}).sort((x, y) => y[1] - x[1])[0];
      if (!line || !out || !best) { toast('Todavía no hay cuotas de este partido'); return; }
      const [bookmaker, odds] = best;
      addToSlip({
        sport: t.sport, league: t.league, event: t.event, market: line.group, selection: out.label, bookmaker, odds, status: 'pending',
        // Con su ref, para que el servidor la resuelva sola
        ref: { sport: t.sport, match: t.id, key: line.key, out: out.id, ...(t.match.start ? { start: t.match.start } : {}) }
      });
    } catch (e) { toast((e as Error).message || 'No se han podido leer las cuotas'); }
  };
}
