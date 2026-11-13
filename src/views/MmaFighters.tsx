// MMA · Luchadores: ranking por Elo del modelo (no es el oficial de ninguna organización) de los luchadores activos de UFC, PFL y
// WOW, con buscador. Al pulsar uno se abre su ficha.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { MmaFighterSheet } from '@/components/MmaFighterSheet';
import { Empty, ErrorBox, Input, Loading, PageHeader, Tabs, td, th } from '@/components/ui';
import type { MmaOrg } from '@/lib/types';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ORG: Record<MmaOrg, string> = { ufc: 'UFC', pfl: 'PFL', wow: 'WOW' };
type Filter = 'all' | MmaOrg;

export default function MmaFighters() {
  const [org, setOrg] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const ok = !!window.api.mma;
  const r = useQuery({ queryKey: ['mma', 'ranking'], queryFn: () => window.api.mma.ranking(), staleTime: 3600e3, enabled: ok, retry: false });
  const list = (r.data ?? []).filter(p => (org === 'all' || p.org === org) && (!q || norm(p.name).includes(norm(q))));
  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para MMA hay que parar <code>npm run dev</code> y volver a lanzarlo.</ErrorBox>;
  if (open) return <MmaFighterSheet key={open} id={open} onBack={() => setOpen(null)} onFighter={setOpen} />;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Luchadores" subtitle="Ranking por Elo del modelo: luchadores activos (han peleado en los últimos 18 meses) con al menos 5 combates">
        <Tabs value={org} onChange={setOrg} items={[{ value: 'all', label: 'Todos' }, { value: 'ufc', label: 'UFC' }, { value: 'pfl', label: 'PFL' }, { value: 'wow', label: 'WOW' }]} />
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input className="w-64 pl-9" placeholder="Luchador" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </PageHeader>
      {r.isLoading ? <Loading label="Calculando el ranking…" /> : r.error ? <ErrorBox error={r.error} />
        : !list.length ? <Empty>No hay luchadores con ese filtro.</Empty> : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-surface">
            <table className="w-full">
              <thead className="bg-zinc-900/60"><tr><th className={th + ' w-14 text-right'}>Puesto</th><th className={th}>Luchador</th><th className={th}>Org.</th><th className={th + ' text-right'}>Récord</th><th className={th + ' text-right'}>Elo</th><th className={th + ' hidden text-right sm:table-cell'}>Combates</th></tr></thead>
              <tbody className="divide-y divide-zinc-800/60">
                {list.slice(0, 200).map(p => (
                  <tr key={p.id} onClick={() => setOpen(p.id)} className="cursor-pointer hover:bg-zinc-800/30">
                    <td className={td + ' text-right font-score text-lg font-semibold tnum'}>{p.rank}</td>
                    <td className={td + ' font-medium'}>{p.name}</td>
                    <td className={td + ' text-zinc-400'}>{ORG[p.org]}</td>
                    <td className={td + ' text-right text-zinc-400 tnum'}>{p.record || '–'}</td>
                    <td className={td + ' text-right font-semibold tnum'}>{Math.round(p.elo)}</td>
                    <td className={td + ' hidden text-right text-zinc-400 tnum sm:table-cell'}>{p.fights}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
