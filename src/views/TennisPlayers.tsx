// Tenis · Jugadores: rankings de la ATP y la WTA con buscador, subida o bajada de cada jugador y sus puntos
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { cn } from '@/lib/format';
import type { Tour } from '@/lib/types';
import { ErrorBox, Input, Loading, PageHeader, Tabs, td, th } from '@/components/ui';

export default function TennisPlayers() {
  const [tour, setTour] = useState<Tour>('atp');
  const [q, setQ] = useState('');
  const ok = !!window.api.tennis;
  const r = useQuery({ queryKey: ['tennis', 'rankings', tour], queryFn: () => window.api.tennis.rankings(tour), staleTime: 6 * 3600e3, enabled: ok });
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = (r.data ?? []).filter(p => !q || norm(p.name).includes(norm(q)) || norm(p.country).includes(norm(q)));
  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el tenis hay que parar <code>npm run dev</code> y volver a lanzarlo.</ErrorBox>;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Rankings" subtitle="Clasificación individual de la ATP y la WTA">
        <Tabs value={tour} onChange={setTour} items={[{ value: 'atp', label: 'ATP' }, { value: 'wta', label: 'WTA' }]} />
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input className="w-64 pl-9" placeholder="Jugador o país" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </PageHeader>
      {r.isLoading ? <Loading /> : r.error ? <ErrorBox error={r.error} /> : (
        <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50">
          <table className="w-full">
            <thead className="bg-zinc-900/60"><tr><th className={th + ' w-16 text-right'}>Puesto</th><th className={th + ' w-14'} /><th className={th}>Jugador</th><th className={th}>País</th><th className={th + ' text-right'}>Puntos</th></tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {list.map(p => {
                const diff = p.previous && p.rank ? p.previous - p.rank : 0;
                return (
                  <tr key={p.id} className="hover:bg-zinc-800/30">
                    <td className={td + ' text-right font-score text-lg font-semibold tnum'}>{p.rank}</td>
                    <td className={cn(td, 'text-xs tnum', diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-rose-400' : 'text-zinc-600')} title={`Antes: ${p.previous}`}>{diff > 0 ? `▲${diff}` : diff < 0 ? `▼${-diff}` : '='}</td>
                    <td className={td}><span className="flex items-center gap-2">{p.flag && <img src={p.flag} alt="" className="h-4 w-6 rounded-sm object-cover" />}{p.name}</span></td>
                    <td className={td + ' text-zinc-400'}>{p.country}</td>
                    <td className={td + ' text-right tnum'}>{p.points.toLocaleString('es-ES')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
