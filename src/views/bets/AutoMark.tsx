import { Zap } from 'lucide-react';
import type { Bet } from '@/lib/types';

// Si la apuesta se resuelve sola (sabe su partido y mercado) o ya se resolvió, con lo que pasó en el partido al pasar el ratón.
// En una combinada puede que sólo algunas selecciones lo sean: las demás se marcan a mano
export function AutoMark({ bet: b }: { bet: Bet }) {
  const items = b.legs?.length ? b.legs : [b];
  const auto = items.filter(i => i.ref);
  if (!auto.length) return null;
  const texts = items.map(i => i.ref?.settled?.text).filter(Boolean) as string[];
  const settled = texts.length > 0 && b.status !== 'pending';
  const title = [
    settled ? 'Resuelta sola con el resultado del partido' : 'Se resolverá sola cuando acabe el partido',
    ...texts,
    auto.length < items.length ? `${items.length - auto.length} selección(es) hay que marcarla(s) a mano` : ''
  ].filter(Boolean).join('\n');
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-1 text-[11px] text-zinc-500">
      <Zap size={11} className={settled ? 'text-amber-400' : ''} />
      {settled ? 'resuelta sola' : auto.length < items.length ? `${auto.length} de ${items.length} automáticas` : 'se resuelve sola'}
    </span>
  );
}
