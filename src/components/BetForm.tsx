import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Clock, Layers, Plus, Trash2, X } from 'lucide-react';
import { useApp, useCurrency, useBets } from '@/lib/app-context';
import { cn, money, odd, pct } from '@/lib/format';
import type { BetDraft, BetLeg, BetRef, BetStatus, LegStatus, MatchOdds, Schedule } from '@/lib/types';
import { Badge, Button, Dialog, Field, Input, Select, inputCls, seg, segWrap } from './ui';
import { MatchPicker, matchName } from './MatchPicker';
import { OptionInput, type Option } from './OptionInput';
import { GamePicker, MarketHint, PlayersList } from './GamePicker';

// Todos los mercados habituales de LoL en las casas, con los mismos nombres que usa el comparador de cuotas
const MAP_MARKETS = ['Ganador', 'Hándicap de kills', 'Total de kills', 'Kills par / impar', 'Kills de equipo', 'Primera sangre',
  'Primer equipo en 5 kills', 'Primer equipo en 10 kills', 'Primera torre', 'Primer dragón', 'Primer heraldo', 'Primeras larvas',
  'Primer barón', 'Primer inhibidor', 'Total de torres', 'Hándicap de torres', 'Total de dragones', 'Hándicap de dragones',
  'Total de barones', 'Total de inhibidores', 'Duración del mapa', 'Alma de dragón', 'Robo de barón / dragón'];
const MARKETS: Option[] = [
  ...['Ganador del partido', 'Hándicap de mapas', 'Total de mapas', 'Resultado exacto', 'Ambos ganan un mapa', 'Total de kills del partido',
    'Hándicap de kills del partido', 'Primera sangre del partido'].map(value => ({ value, group: 'Partido' })),
  ...[1, 2, 3, 4, 5].flatMap(n => MAP_MARKETS.map(m => ({ value: `Mapa ${n} · ${m}`, group: `Mapa ${n}` }))),
  ...['Jugadores · Kills', 'Jugadores · Asistencias', 'Jugadores · Muertes', 'Jugadores · KDA', 'Jugadores · Más kills del partido',
    'Jugadores · Comparación de kills', 'Jugadores · MVP'].map(value => ({ value, group: 'Jugadores' })),
  ...['Ganador del torneo', 'Ganador del grupo', 'Pasa de fase', 'Llega a la final', 'Región ganadora', 'Equipo con más kills del torneo']
    .map(value => ({ value, group: 'Torneo y especiales' }))
];
// Mercados de baloncesto: los del analizador de jugadores y los de partido
const BASKET_MARKETS: Option[] = [
  ...['Ganador del partido', 'Hándicap', 'Total de puntos', 'Ganador del 1.er cuarto', 'Total de puntos de un equipo']
    .map(value => ({ value, group: 'Partido' })),
  ...['Puntos', 'Rebotes', 'Asistencias', 'Triples anotados', 'Pts + Reb + Ast', 'Pts + Reb', 'Pts + Ast', 'Reb + Ast', 'Robos',
    'Tapones', 'Robos + Tapones', 'Pérdidas', 'Doble-doble'].map(m => ({ value: `Jugador · ${m}`, group: 'Jugadores' }))
];
// Mercados de tenis más habituales en Winamax y Betway
const TENNIS_MARKETS: Option[] = ['Ganador', 'Hándicap de juegos', 'Total de juegos', 'Hándicap de sets', 'Resultado exacto', '1.er set · Ganador',
  '1.er set · Total de juegos', 'Gana al menos un set', 'Juegos de un jugador'].map(value => ({ value, group: 'Tenis' }));
// Mercados de MMA más habituales en Winamax y Betway
const MMA_MARKETS: Option[] = ['Ganador', 'Método de victoria', 'Gana por KO/TKO', 'Gana por sumisión', 'Gana por decisión', 'El combate llega a decisión', 'Total de asaltos']
  .map(value => ({ value, group: 'MMA' }));
// Mercados de fútbol más habituales en Winamax y Betway
const FOOTBALL_MARKETS: Option[] = ['1X2', 'Doble oportunidad', 'Empate no válido', 'Total de goles', 'Ambos marcan', 'Hándicap asiático',
  'Hándicap europeo', 'Resultado exacto', 'Descanso / Final', '1.ª parte · 1X2', '1.ª parte · Total de goles', 'Goles de un equipo',
  'Goleador', 'Total de córners', 'Total de tarjetas'].map(value => ({ value, group: 'Fútbol' }));
const BOOKS = ['Winamax', 'Betway'];

const today = () => new Date().toISOString().slice(0, 10);
// Qué se escribe en la selección: el equipo o jugador del mercado
const selHint = (sport?: BetLeg['sport']) => sport === 'football' ? 'Liverpool, Más de 2.5, o el jugador' : sport === 'basket' ? 'LAL, Más de 220.5' : sport === 'tennis' || sport === 'mma' ? 'El jugador, Más de 22.5' : 'G2';
const LEG_LABEL: Record<LegStatus, string> = { pending: 'Pendiente', won: 'Ganada', lost: 'Perdida', void: 'Nula' };
// Botones para marcar cada selección de la combinada (el color del activo es el de su estado)
const LEG_ICON: Record<LegStatus, typeof Check> = { pending: Clock, won: Check, lost: X, void: Ban };
const LEG_ON: Record<LegStatus, string> = {
  pending: 'border-zinc-600 bg-zinc-800 text-zinc-200', won: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
  lost: 'border-rose-500/50 bg-rose-500/15 text-rose-300', void: 'border-zinc-600 bg-zinc-800 text-zinc-300'
};
const emptyLeg = (): BetLeg => ({ event: '', league: '', market: '', selection: '', odds: 0, status: 'pending' });
// Cuota total de la combinada: producto de las cuotas (las nulas cuentan como 1)
export const comboOdds = (legs: { odds: number; status?: string }[]) =>
  Math.round(legs.reduce((p, l) => p * (l.status === 'void' ? 1 : l.odds || 1), 1) * 100) / 100;
function comboStatus(legs: BetLeg[]): LegStatus {
  if (legs.some(l => l.status === 'lost')) return 'lost';
  if (legs.some(l => l.status === 'pending')) return 'pending';
  return legs.every(l => l.status === 'void') ? 'void' : 'won';
}

export function BetFormDialog() {
  const { betDraft, closeBet, toast, addToSlip, clearSlip } = useApp();
  const currency = useCurrency();
  const qc = useQueryClient();
  const { data: bets = [] } = useBets();
  const [f, setF] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [legs, setLegs] = useState<BetLeg[] | null>(null); // null = apuesta simple
  // El partido y mercado de una simple (para que se resuelva sola) va aparte: f sólo guarda textos
  const [ref, setRef] = useState<BetRef | undefined>(undefined);
  // Combinada: una sola cuota, la de la casa para toda la apuesta. Si las selecciones traen la suya (del cupón), sale ya calculada
  const [total, setTotal] = useState('');

  useEffect(() => {
    if (!betDraft) return;
    const { legs: dl, fromSlip: _, ref: r, ...rest } = betDraft;
    setRef(r);
    const d: BetDraft = { date: today(), market: 'Ganador del partido', status: 'pending', sport: 'lol', ...rest };
    setF(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v == null || v === 0 && k === 'cashout' ? '' : String(v)])));
    setLegs(dl?.length ? dl.map(l => ({ ...emptyLeg(), ...l, status: l.status || 'pending' })) : null);
    const t = dl?.length ? (rest.odds && rest.odds > 1 ? rest.odds : dl.every(l => l.odds > 1) ? comboOdds(dl) : 0) : 0;
    setTotal(t > 1 ? String(t) : '');
  }, [betDraft]);

  const set = (k: string) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));
  const o = legs ? parseFloat(total) : parseFloat(f.odds), s = parseFloat(f.stake);
  const setLeg = (i: number, p: Partial<BetLeg>) => setLegs(ls => ls && ls.map((l, j) => j === i ? { ...l, ...p } : l));
  const events = useMemo(() => [...new Set(bets.flatMap(b => b.legs ? b.legs.map(l => l.event) : [b.event]).filter(Boolean))].slice(0, 200), [bets]);
  const usedMarkets = useMemo(() => [...new Set(bets.flatMap(b => b.legs ? b.legs.map(l => l.market) : [b.market]).filter(Boolean))]
    .map(value => ({ value, group: 'Usados antes' })), [bets]);
  // Mercados: primero los que el comparador ya leyó de ese partido (si se abrió su ficha), después la lista completa
  const nba = f.sport === 'basket';
  // Fuera de LoL no hay calendario de lolesports para elegir el partido: se escribe a mano
  const free = (f.sport || 'lol') !== 'lol';
  const foot = f.sport === 'football';
  const sportNow = (f.sport || 'lol') as NonNullable<BetLeg['sport']>;
  const marketsFor = (event: string, sport = f.sport): Option[] => {
    if (sport === 'basket') return [...BASKET_MARKETS, ...usedMarkets];
    if (sport === 'tennis') return [...TENNIS_MARKETS, ...usedMarkets];
    if (sport === 'football') return [...FOOTBALL_MARKETS, ...usedMarkets];
    if (sport === 'mma') return [...MMA_MARKETS, ...usedMarkets];
    const read: Option[] = [];
    for (const [, d] of qc.getQueriesData<Schedule>({ queryKey: ['schedule'] }))
      for (const ev of d?.events ?? []) if (ev.teams.length === 2 && event && matchName(ev) === event)
        for (const m of qc.getQueryData<MatchOdds>(['odds', ev.id])?.markets ?? []) read.push({ value: m.group, group: 'Con cuotas leídas de este partido' });
    return [...read, ...MARKETS, ...usedMarkets];
  };

  function toCombo() {
    const first: BetLeg = { event: f.event || '', league: f.league || '', market: f.market || '', selection: f.selection || '', odds: parseFloat(f.odds) || 0, status: 'pending', sport: sportNow };
    // Las selecciones nuevas, del deporte elegido (antes salían de LoL y pedían su partido aunque se hubiera elegido otro)
    const blank = (): BetLeg => ({ ...emptyLeg(), sport: sportNow });
    setLegs(first.selection || first.event ? [first, blank()] : [blank(), blank()]);
    setTotal('');
  }
  function toSingle() {
    const l = legs?.[0];
    if (l) setF(p => ({ ...p, event: l.event, league: l.league || p.league || '', market: l.market, selection: l.selection, odds: l.odds ? String(l.odds) : '' }));
    setLegs(null);
  }

  const leagues = useMemo(() => [...new Set(bets.map(b => b.league).filter(Boolean))], [bets]);
  const books = useMemo(() => [...new Set([...BOOKS, ...bets.map(b => b.bookmaker).filter(Boolean)])], [bets]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (legs) {
        const ok = legs.filter(l => l.selection.trim() || l.event.trim());
        if (ok.length < 2) throw new Error('Una combinada necesita al menos 2 selecciones');
        const t = parseFloat(total);
        if (!(t > 1)) throw new Error('Pon la cuota total de la combinada');
        // Si la total no es el producto de las de cada selección («Crear apuesta», cuota mejorada), las selecciones se quedan sin
        // cuota (0) y vale la total: así el servidor no la vuelve a calcular
        const same = ok.every(l => l.odds > 1) && Math.abs(comboOdds(ok) - t) < 0.015;
        const sent = same ? ok : ok.map(l => ({ ...l, odds: 0 }));
        await window.api.bets.save({ ...f, id: betDraft?.id, odds: t, legs: sent, status: f.status === 'cashout' ? 'cashout' : 'pending' } as unknown as BetDraft);
        if (betDraft?.fromSlip) clearSlip();
      } else {
        await window.api.bets.save({ ...f, id: betDraft?.id, ...(ref ? { ref } : {}) } as unknown as BetDraft);
      }
      await qc.invalidateQueries({ queryKey: ['bets'] });
      toast(legs ? 'Combinada guardada' : 'Apuesta guardada');
      closeBet();
    } catch (err) { toast((err as Error).message); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!betDraft?.id || !confirm('¿Eliminar esta apuesta?')) return;
    await window.api.bets.delete(betDraft.id);
    await qc.invalidateQueries({ queryKey: ['bets'] });
    closeBet();
  }

  const canAdd = !betDraft?.id && !legs && !!f.selection && parseFloat(f.odds) > 1;
  const title = legs ? (betDraft?.id ? 'Editar combinada' : 'Nueva combinada') : betDraft?.id ? 'Editar apuesta' : 'Nueva apuesta';
  const editing = !!betDraft?.id;
  const SPORT_NAME: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };
  const mixed = !!legs && new Set(legs.map(l => l.sport || 'lol')).size > 1;
  const sec = 'border-b border-zinc-800 pb-1 text-xs font-medium text-zinc-400';

  const when = (
    <div className={cn('grid grid-cols-1 gap-3', legs ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      <Field label="Fecha"><Input type="date" required value={f.date || ''} onChange={set('date')} /></Field>
      {!legs && <Field label="Liga"><Input list="dl-leagues" placeholder={nba ? 'NBA, Euroliga…' : foot ? 'LaLiga, Champions…' : 'LEC, LCK, Worlds…'} value={f.league || ''} onChange={set('league')} /></Field>}
      <Field label="Casa de apuestas"><Input list="dl-books" placeholder="Winamax, Betway…" value={f.bookmaker || ''} onChange={set('bookmaker')} /></Field>
    </div>
  );

  return (
    <Dialog open={!!betDraft} onClose={closeBet} title={title} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{legs ? `Combinada ×${legs.length}` : 'Simple'}</Badge>
            <Badge>{mixed ? 'Varios deportes' : SPORT_NAME[f.sport || 'lol']}</Badge>
            {!legs && f.league && <Badge>{f.league}</Badge>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <div className={segWrap}>
              {[{ v: false, l: 'Simple' }, { v: true, l: 'Combinada' }].map(x => (
                <button key={x.l} type="button" onClick={() => x.v ? !legs && toCombo() : legs && toSingle()}
                  className={seg(!!legs === x.v)}>{x.l}</button>
              ))}
            </div>
            <div className={segWrap}
              title={legs ? 'Deporte de las selecciones nuevas' : 'Deporte: separa las estadísticas de cada app'}>
              {[{ v: 'lol', l: 'LoL' }, { v: 'basket', l: 'Baloncesto' }, { v: 'tennis', l: 'Tenis' }, { v: 'football', l: 'Fútbol' }, { v: 'mma', l: 'MMA' }].map(x => (
                <button key={x.v} type="button" onClick={() => setF(p => ({ ...p, sport: x.v, league: x.v === 'basket' ? (p.league || 'NBA') : p.league === 'NBA' ? '' : p.league }))}
                  className={seg((f.sport || 'lol') === x.v)}>{x.l}</button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className={sec}>La apuesta</div>
            {legs ? (
              <div className="rounded-xl border border-zinc-800">
                <div className="flex flex-col gap-2 p-3">
                  {legs.map((l, i) => (
                    <div key={i} className="grid grid-cols-6 items-center gap-2 border-b border-zinc-800/60 pb-3 last:border-0 ">
                      <div className="col-span-6 sm:col-span-3">
                        {(l.sport || 'lol') !== 'lol'
                          ? <GamePicker sport={l.sport!} day={f.date || today()} placeholder={l.sport === 'football' ? 'Real Madrid - Barcelona' : l.sport === 'mma' ? 'Ilia Topuria vs Max Holloway' : l.sport === 'tennis' ? 'Carlos Alcaraz - Jannik Sinner' : 'LAL @ BOS'}
                            value={l.event} onChange={v => setLeg(i, { event: v })} onPick={g => setLeg(i, { event: g.event, league: g.league })} />
                          : <MatchPicker value={l.event} day={f.date} past={events} onChange={v => setLeg(i, { event: v })}
                            onPick={ev => setLeg(i, { event: matchName(ev), league: ev.league })} />}
                      </div>
                      <div className="col-span-6 sm:col-span-3"><OptionInput placeholder="Ganador del partido" value={l.market} options={marketsFor(l.event, l.sport)} onChange={v => setLeg(i, { market: v })} /></div>
                      <Input className="col-span-6 sm:col-span-3" list={`dl-pl-${i}`} placeholder={selHint(l.sport)} value={l.selection} onChange={e => setLeg(i, { selection: e.target.value })} />
                      {(l.sport || 'lol') !== 'lol' && <PlayersList id={`dl-pl-${i}`} sport={l.sport!} day={f.date || today()} event={l.event} />}
                      <div className="col-span-5 flex gap-1 sm:col-span-2">
                        {(Object.keys(LEG_LABEL) as LegStatus[]).map(v => {
                          const Icon = LEG_ICON[v];
                          return (
                            <button key={v} type="button" title={LEG_LABEL[v]} aria-pressed={l.status === v} onClick={() => setLeg(i, { status: v })}
                              className={cn('grid h-9 flex-1 cursor-pointer place-items-center rounded-lg border transition',
                                l.status === v ? LEG_ON[v] : 'border-zinc-800 bg-zinc-900 text-zinc-600 hover:border-zinc-700 hover:text-zinc-300')}>
                              <Icon size={15} />
                            </button>
                          );
                        })}
                      </div>
                      <Button type="button" size="icon" variant="ghost" title="Quitar" disabled={legs.length <= 2} onClick={() => setLegs(legs.filter((_, j) => j !== i))}><X size={15} /></Button>
                      <MarketHint sport={l.sport || 'lol'} event={l.event} market={l.market} selection={l.selection} />
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setLegs([...legs, { ...emptyLeg(), sport: sportNow }])}><Plus size={14} />Añadir selección</Button>
                    <div className="text-sm text-zinc-400">{legs.length} selecciones{o > 1 && <> · cuota total <span className="ml-1 text-base font-bold text-amber-300 tabular-nums">{odd(o)}</span></>}</div>
                  </div>
                </div>
              </div>
            ) : <>
              <Field label="Partido">
                {free
                  ? <GamePicker required sport={sportNow} day={f.date || today()} placeholder={foot ? 'Real Madrid - Barcelona' : 'LAL @ BOS'} value={f.event || ''}
                    onChange={v => setF(p => ({ ...p, event: v }))} onPick={g => setF(p => ({ ...p, event: g.event, league: g.league }))} />
                  : <MatchPicker required value={f.event || ''} day={f.date} past={events} onChange={v => setF(p => ({ ...p, event: v }))}
                    onPick={ev => setF(p => ({ ...p, event: matchName(ev), league: ev.league }))} />}
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Mercado"><OptionInput value={f.market || ''} options={marketsFor(f.event || '')} onChange={v => setF(p => ({ ...p, market: v }))} /></Field>
                <Field label="Selección"><Input required list="dl-pl-s" placeholder={nba ? 'LeBron James · Más de 25.5' : foot ? 'Real Madrid' : 'G2'} value={f.selection || ''} onChange={set('selection')} /></Field>
              </div>
              {free && <PlayersList id="dl-pl-s" sport={sportNow} day={f.date || today()} event={f.event || ''} />}
              {!ref && <MarketHint sport={sportNow} event={f.event || ''} market={f.market || ''} selection={f.selection || ''} />}
            </>}
            {when}
            <Field label="Notas"><textarea rows={2} className={inputCls + ' h-auto py-2'} value={f.notes || ''} onChange={set('notes')} /></Field>
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-zinc-800 lg:pl-6">
            <div className={sec}>Dinero y resultado</div>
            <div className="grid grid-cols-2 gap-3">
              {legs
                ? <Field label="Cuota total"><Input type="number" step="0.01" min="1.01" required placeholder="La de la casa" value={total} onChange={e => setTotal(e.target.value)} /></Field>
                : <Field label="Cuota (decimal)"><Input type="number" step="0.01" min="1.01" required value={f.odds || ''} onChange={set('odds')} /></Field>}
              <Field label={`Stake (${currency})`}><Input type="number" step="0.01" min="0" required value={f.stake || ''} onChange={set('stake')} /></Field>
            </div>
            <Field label="Estado">
              {legs ? (
                <Select value={f.status === 'cashout' ? 'cashout' : 'auto'} onChange={e => setF(p => ({ ...p, status: e.target.value === 'cashout' ? 'cashout' : 'pending' }))}>
                  <option value="auto">Auto: {LEG_LABEL[comboStatus(legs)]}</option>
                  <option value="cashout">Cash out</option>
                </Select>
              ) : (
                <Select value={f.status || 'pending'} onChange={set('status')}>
                  {(['pending', 'won', 'lost', 'void', 'cashout', 'halfwon', 'halflost'] as BetStatus[]).map(v => (
                    <option key={v} value={v}>{{ pending: 'Pendiente', won: 'Ganada', lost: 'Perdida', void: 'Nula / devuelta', cashout: 'Cash out', halfwon: 'Medio ganada', halflost: 'Medio perdida' }[v]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={`Importe cash out (${currency})`}><Input type="number" step="0.01" min="0" disabled={f.status !== 'cashout'} value={f.cashout || ''} onChange={set('cashout')} /></Field>
            {o > 1 && s > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
                <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-zinc-500">Si sale</span><span className="font-semibold text-emerald-400 tabular-nums">{money(s * (o - 1), currency, true)}</span></div>
                <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-zinc-500">Cobro total</span><span className="font-semibold tabular-nums">{money(s * o, currency)}</span></div>
                <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-zinc-500">Prob. implícita</span><span className="font-semibold tabular-nums">{pct(1 / o)}</span></div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 pt-4">
          <Button type="submit" disabled={saving}>Guardar apuesta</Button>
          <Button type="button" variant="ghost" onClick={closeBet}>Cancelar</Button>
          {canAdd && (
            <Button type="button" variant="secondary" className="ml-auto" title="Guarda la selección en el boleto para combinarla con otras"
              onClick={() => { addToSlip({ event: f.event || '', league: f.league || '', market: f.market || '', selection: f.selection, odds: parseFloat(f.odds), status: 'pending', bookmaker: f.bookmaker, sport: sportNow }); closeBet(); }}>
              <Layers size={15} />Añadir a combinada
            </Button>
          )}
          {betDraft?.id && <Button type="button" variant="danger" className="ml-auto" onClick={remove}><Trash2 size={15} />Eliminar</Button>}
        </div>
      </form>
      <datalist id="dl-leagues">{leagues.map(x => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-events">{events.map(x => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-books">{books.map(x => <option key={x} value={x} />)}</datalist>
    </Dialog>
  );
}
