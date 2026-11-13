// Ficha de un luchador: récord, Elo del modelo, racha y sus últimos combates (los de UFC, PFL y WOW desde 2016). Los de ESPN no
// traen el método de cada victoria, así que ese dato sólo sale en los de WOW.
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/format';
import { Badge, Empty, ErrorBox, Loading, td, th } from './ui';
import { KpiStrip, Panel } from './viz';
import { METHOD_ES } from './mma';

const ORG: Record<string, string> = { ufc: 'UFC', pfl: 'PFL', wow: 'WOW' };
const day = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
const CHIP: Record<string, { tone: 'success' | 'danger' | 'neutral'; text: string; title: string }> = {
  G: { tone: 'success', text: 'G', title: 'Ganó' }, P: { tone: 'danger', text: 'P', title: 'Perdió' },
  E: { tone: 'neutral', text: 'E', title: 'Empate' }, N: { tone: 'neutral', text: 'NC', title: 'Sin resultado' }
};

export function MmaFighterSheet({ id, backLabel = 'Luchadores', onBack, onFighter }: { id: string; backLabel?: string; onBack: () => void; onFighter: (id: string) => void }) {
  const q = useQuery({ queryKey: ['mma', 'fighter', id], queryFn: () => window.api.mma.fighter(id), staleTime: 30 * 60e3, retry: false });
  const c = q.data;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <button onClick={onBack} className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={16} />Volver a {backLabel.toLowerCase()}</button>
      {q.isLoading ? <Loading label="Cargando la ficha…" /> : q.error ? <ErrorBox error={q.error}>Sin historial de este luchador: o es nuevo en estas organizaciones o aún no se ha cargado.</ErrorBox> : !c ? <Empty>No hay ficha.</Empty> : <>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{c.name || 'Luchador'}</h1>
          <p className="text-sm text-zinc-400">Récord {c.record || '–'}{c.stats.fights ? ` · ${c.stats.fights} combates en el historial` : ''}</p>
        </div>
        <KpiStrip items={[
          { label: 'Elo (modelo)', value: c.rating ? Math.round(c.rating.elo) : '–', sub: c.rating ? `${c.rating.fights} combates` : 'sin historial', title: 'Calculado con los combates de UFC, PFL y WOW desde 2016. 1500 es el punto de partida.' },
          { label: 'Ganados', value: c.stats.wins, sub: `${c.stats.losses} perdidos` },
          { label: 'Racha', value: c.stats.streak === 0 ? '–' : `${Math.abs(c.stats.streak)} ${c.stats.streak > 0 ? 'G' : 'P'}`, sub: c.stats.streak > 0 ? 'victorias seguidas' : c.stats.streak < 0 ? 'derrotas seguidas' : '' },
          { label: 'Victorias por', value: c.stats.methods ? `${c.stats.methods.ko} KO · ${c.stats.methods.sub} sum. · ${c.stats.methods.dec} dec.` : '–', sub: c.stats.methods ? '' : 'sin método en ESPN' }
        ]} />
        <Panel title="Últimos combates" aside={c.history.length ? `${c.history.length}` : undefined}>
          {!c.history.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">Sin combates en el historial.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className={th}>Fecha</th><th className={th} /><th className={th}>Rival</th><th className={cn(th, 'hidden sm:table-cell')}>Evento</th><th className={th}>Cómo</th></tr></thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {c.history.map(h => {
                    const chip = CHIP[h.result];
                    return (
                      <tr key={h.id}>
                        <td className={cn(td, 'whitespace-nowrap text-zinc-500 tnum')}>{day(h.date)}</td>
                        <td className={td}><span title={chip.title}><Badge tone={chip.tone}>{chip.text}</Badge></span></td>
                        <td className={td}><button onClick={() => onFighter(h.opponent.id)} className="cursor-pointer text-left hover:text-amber-400">{h.opponent.name}</button></td>
                        <td className={cn(td, 'hidden max-w-60 truncate text-zinc-400 sm:table-cell')}>{ORG[h.org] ?? h.org} · {h.event}</td>
                        <td className={cn(td, 'whitespace-nowrap text-zinc-400')}>{[METHOD_ES[h.method], h.round ? `asalto ${h.round}` : ''].filter(Boolean).join(' · ') || '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </>}
    </div>
  );
}
