import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useApp, useCurrency } from '@/lib/app-context';
import { ageMinutes, bestStakes } from '@/lib/surebets';
import { jobFailed, jobStage, waitJob } from '@/lib/odds-read';
import { cn, decEs, fmtTime, money, odd, pct } from '@/lib/format';
import { Badge, Button, chip, Empty, ErrorBox, Field, Input, Loading, panelCls, PlayNotice } from '@/components/ui';
import type { SurebetMatch, Surebet } from '@/lib/types';
import { filterSurebets, SUREBET_SPORTS, type SurebetSport } from '@/lib/surebets';

// Surebets entre Winamax y Betway (server/services/odds/surebets.js): apostar a cada selección en la casa que mejor la paga y
// ganar salga lo que salga. Con las cuotas ya leídas: no lanza lecturas solas (las casas pueden bloquear), sólo la del partido que
// se pida con «Volver a leer». El servidor las busca solo tras cada lectura y cada 15 minutos y avisa de las nuevas (campana y
// notificación); la pantalla se recarga con ese aviso. Va en Plan porque, como el plan, es una pantalla de cálculo.

const SPORT: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };
const KEY = 'surebets-total';
const SPORT_KEY = 'surebets-sport';
// Las ligas de baloncesto se guardan con su código
const LEAGUE: Record<string, string> = { EUROLEAGUE: 'Euroliga', EUROCUP: 'EuroCup' };
const OLD_MIN = 30; // una lectura de más de media hora puede haber cambiado
const dayTime = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const same = d.toDateString() === today.toDateString();
  return `${same ? 'Hoy' : d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })} ${fmtTime(iso)}`;
};

export function Surebets() {
  const cur = useCurrency();
  const [total, setTotal] = useState(() => { try { return localStorage.getItem(KEY) || '100'; } catch { return '100'; } });
  const amount = Number(total.replace(',', '.')) || 0;
  const [sport, setSportState] = useState<SurebetSport>(() => {
    try { const v = localStorage.getItem(SPORT_KEY); return (SUREBET_SPORTS as readonly string[]).includes(v ?? '') ? v as SurebetSport : 'all'; } catch { return 'all'; }
  });
  const setSport = (v: SurebetSport) => { setSportState(v); try { localStorage.setItem(SPORT_KEY, v); } catch { /* sin almacenamiento */ } };
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['surebets'], queryFn: () => window.api.odds.surebets(), staleTime: 2 * 60e3, refetchInterval: 5 * 60e3
  });
  // Un aviso nuevo puede ser una surebet: se vuelve a mirar
  useEffect(() => window.api.onAlert(() => qc.invalidateQueries({ queryKey: ['surebets'] })), [qc]);
  // Las del deporte elegido, de más a menos beneficio, y cuántas hay de cada uno para los filtros
  const { items, counts } = filterSurebets(data?.list ?? [], sport);

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(panelCls, 'flex flex-col gap-3 p-4')}>
        <p className="text-[13px] leading-5 text-zinc-300">
          Una surebet es un mercado en el que Winamax y Betway no están de acuerdo: apostando a cada opción en la casa que mejor la paga,
          con el reparto de abajo, se cobra más de lo apostado salga lo que salga. Salen pocas y duran poco.
          Se buscan solas tras cada lectura de cuotas y cada 15 minutos, y si sale una nueva te llega el aviso al momento
          (actívalo o quítalo en <b>Tu cuenta</b>).
        </p>
        <div className="fade-r -mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Deporte">
          {SUREBET_SPORTS.filter(k => k === 'all' || ['basket', 'tennis', 'football'].includes(k) || counts[k]).map(k => (
            <button key={k} type="button" className={chip(sport === k)} aria-pressed={sport === k} onClick={() => setSport(k)}>
              {k === 'all' ? 'Todos' : SPORT[k]}
              <span className="tnum text-zinc-500">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Dinero total">
              <Input inputMode="decimal" value={total} onChange={e => { setTotal(e.target.value); try { localStorage.setItem(KEY, e.target.value); } catch { /* sin almacenamiento */ } }} />
            </Field>
          </div>
          <Button variant="secondary" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw size={15} className={cn(isFetching && 'animate-spin')} />Buscar otra vez
          </Button>
          {data && <span className="pb-2 text-xs text-zinc-500">Revisados {data.matches} partidos con cuotas de las dos casas · {fmtTime(data.at)}</span>}
        </div>
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-zinc-500">
          <li>Antes de apostar, comprueba las cuotas en las dos casas: pueden haber cambiado desde la lectura. Si una ya no está, no apuestes la otra.</li>
          <li>Las casas limitan las cuentas que hacen surebets a menudo.</li>
          <li>Cada casa tiene sus reglas si el partido se suspende o un tenista se retira: en ese caso una apuesta puede anularse y la otra no.</li>
        </ul>
      </section>

      {isLoading ? <Loading label="Buscando surebets…" />
        : error ? <ErrorBox error={error} />
        : !items.length ? (
          <Empty>
            <span>Ahora mismo no hay surebets{sport === 'all' ? '' : ` de ${SPORT[sport].toLowerCase()}`} entre Winamax y Betway.</span>
            <span className="mt-1 block text-xs text-zinc-500">Se buscan en los partidos de las próximas 48 h con cuotas de las dos casas. Te avisamos en cuanto salga una.</span>
          </Empty>
        ) : items.map(({ m, a }) => <SurebetCard key={`${m.match.a.name}|${m.match.b.name}|${a.key}`} m={m} a={a} amount={amount} cur={cur} />)}
      <PlayNotice />
    </div>
  );
}

function SurebetCard({ m, a, amount, cur }: { m: SurebetMatch; a: Surebet; amount: number; cur: string }) {
  const { openBet, toast } = useApp();
  const qc = useQueryClient();
  const [reading, setReading] = useState<string | null>(null);
  const r = bestStakes(a.legs, amount);
  const age = ageMinutes(m.read, [...new Set(a.legs.map(l => l.book))]);
  const event = `${m.match.a.name} - ${m.match.b.name}`;
  const note = (l: { label: string; price: number; book: string; stake: number }) => openBet({
    sport: m.match.sport, league: m.match.league, event, market: a.market, selection: l.label, odds: l.price, bookmaker: l.book, ...(r ? { stake: l.stake } : {})
  });

  async function reread() {
    setReading('Pidiendo la lectura…');
    try {
      const job = await window.api.odds.auto(m.match, a.key);
      const done = await waitJob(job, j => setReading(jobStage(j)));
      if (done && jobFailed(done)) toast('No se pudo leer el partido en las casas');
      await qc.fetchQuery({ queryKey: ['surebets'], queryFn: () => window.api.odds.surebets(true) });
    } catch (e) { toast((e as Error).message); } finally { setReading(null); }
  }

  return (
    <section className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-800/70 px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-zinc-500">{[SPORT[m.match.sport] ?? m.match.sport, LEAGUE[m.match.league] ?? m.match.league, dayTime(m.match.start)].filter(Boolean).join(' · ')}</div>
          <div className="line-clamp-2 text-sm font-semibold text-zinc-100" title={event}>{event}</div>
          <div className="text-xs text-zinc-400">{decEs(a.market)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold text-emerald-400 tnum">+{pct(a.edge)}</div>
          {a.check && <Badge>Comprueba las cuotas</Badge>}
        </div>
      </div>
      <ul className="divide-y divide-zinc-800/60">
        {(r?.stakes ?? a.legs.map(l => ({ ...l, stake: 0, returns: 0 }))).map(l => (
          <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_90px_120px_auto]">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-zinc-100">{decEs(l.label)}</div>
              <div className="text-xs text-zinc-500">en {l.book}</div>
            </div>
            <div className="text-right text-[13px] font-semibold tnum">{odd(l.price)}</div>
            <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:block sm:text-right">
              {r ? <>
                <div className="text-[13px] text-zinc-100 tnum">apuesta {money(l.stake, cur)}</div>
                <div className="text-xs text-zinc-500 tnum">cobras {money(l.returns, cur)}</div>
              </> : <span className="text-xs text-zinc-500">Pon el dinero total</span>}
              <Button size="sm" variant="ghost" className="sm:hidden" onClick={() => note(l)}>Apuntar</Button>
            </div>
            <Button size="sm" variant="ghost" className="hidden sm:inline-flex" title="Apuntar esta apuesta en Mis apuestas" onClick={() => note(l)}>Apuntar</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/70 px-4 py-2.5 text-xs">
        <span className="text-zinc-400 tnum">
          {r ? <>Apuestas {money(r.spent, cur)} y ganas <span className={r.worst > 0 ? 'text-emerald-400' : 'text-rose-400'}>{money(r.worst, cur)}</span>{r.best - r.worst > 0.01 ? ` a ${money(r.best, cur)}` : ''}</> : null}
        </span>
        <span className="flex items-center gap-2">
          <span className={cn('tnum', age !== null && age > OLD_MIN ? 'text-zinc-200' : 'text-zinc-500')}>
            {reading ?? (age === null ? '' : `leída hace ${age} min${age > OLD_MIN ? ': puede haber cambiado' : ''}`)}
          </span>
          <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" disabled={!!reading} onClick={reread}>
            <RefreshCw size={14} className={cn(reading && 'animate-spin')} />Volver a leer
          </Button>
        </span>
      </div>
    </section>
  );
}
