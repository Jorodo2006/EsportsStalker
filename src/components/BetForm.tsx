import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Trash2, X } from 'lucide-react';
import { useApp, useCurrency } from '@/lib/app-context';
import { cn, money, odd, pct } from '@/lib/format';
import type { BetDraft, BetLeg, BetStatus, LegStatus } from '@/lib/types';
import { Button, Dialog, Field, Input, Select, inputCls } from './ui';

const MARKETS = ['Ganador del partido', 'Ganador mapa 1', 'Hándicap de mapas', 'Total de mapas', 'Total de kills', 'Primera sangre', 'Primer dragón', 'Primer barón'];
const BOOKS = ['Bet365', 'Winamax', 'Betway'];

const today = () => new Date().toISOString().slice(0, 10);
const LEG_LABEL: Record<LegStatus, string> = { pending: 'Pendiente', won: 'Ganada', lost: 'Perdida', void: 'Nula' };
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
  const { data: bets = [] } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  const [f, setF] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [legs, setLegs] = useState<BetLeg[] | null>(null); // null = apuesta simple

  useEffect(() => {
    if (!betDraft) return;
    const { legs: dl, fromSlip: _, ...rest } = betDraft;
    const d: BetDraft = { date: today(), market: 'Ganador del partido', status: 'pending', ...rest };
    setF(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v == null || v === 0 && k === 'cashout' ? '' : String(v)])));
    setLegs(dl?.length ? dl.map(l => ({ ...emptyLeg(), ...l, status: l.status || 'pending' })) : null);
  }, [betDraft]);

  const set = (k: string) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));
  const o = legs ? comboOdds(legs) : parseFloat(f.odds), s = parseFloat(f.stake);
  const setLeg = (i: number, p: Partial<BetLeg>) => setLegs(ls => ls && ls.map((l, j) => j === i ? { ...l, ...p } : l));
  const events = useMemo(() => [...new Set(bets.flatMap(b => b.legs ? b.legs.map(l => l.event) : [b.event]).filter(Boolean))].slice(0, 200), [bets]);

  function toCombo() {
    const first: BetLeg = { event: f.event || '', league: f.league || '', market: f.market || '', selection: f.selection || '', odds: parseFloat(f.odds) || 0, status: 'pending' };
    setLegs(first.selection || first.event ? [first, emptyLeg()] : [emptyLeg(), emptyLeg()]);
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
        if (ok.some(l => !(l.odds > 1))) throw new Error('Pon la cuota de cada selección');
        await window.api.bets.save({ ...f, id: betDraft?.id, odds: comboOdds(ok), legs: ok, status: f.status === 'cashout' ? 'cashout' : 'pending' } as unknown as BetDraft);
        if (betDraft?.fromSlip) clearSlip();
      } else {
        await window.api.bets.save({ ...f, id: betDraft?.id } as unknown as BetDraft);
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

  return (
    <Dialog open={!!betDraft} onClose={closeBet} title={title} wide={!!legs}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex w-fit rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 text-sm">
          {[{ v: false, l: 'Simple' }, { v: true, l: 'Combinada' }].map(x => (
            <button key={x.l} type="button" onClick={() => x.v ? !legs && toCombo() : legs && toSingle()}
              className={cn('cursor-pointer rounded-md px-3 py-1 font-medium transition', !!legs === x.v ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200')}>{x.l}</button>
          ))}
        </div>
        <div className={cn('grid gap-3', legs ? 'grid-cols-2' : 'grid-cols-3')}>
          <Field label="Fecha"><Input type="date" required value={f.date || ''} onChange={set('date')} /></Field>
          {!legs && <Field label="Liga"><Input list="dl-leagues" placeholder="LEC, LCK, Worlds…" value={f.league || ''} onChange={set('league')} /></Field>}
          <Field label="Casa de apuestas"><Input list="dl-books" placeholder="Bet365, Pinnacle…" value={f.bookmaker || ''} onChange={set('bookmaker')} /></Field>
        </div>
        {legs ? (
          <div className="rounded-xl border border-zinc-800">
            <div className="grid grid-cols-[1.3fr_1.2fr_1.1fr_84px_132px_32px] gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-medium text-zinc-400">
              <span>Partido</span><span>Mercado</span><span>Selección</span><span>Cuota</span><span>Estado</span><span />
            </div>
            <div className="flex flex-col gap-2 p-3">
              {legs.map((l, i) => (
                <div key={i} className="grid grid-cols-[1.3fr_1.2fr_1.1fr_84px_132px_32px] items-center gap-2">
                  <Input list="dl-events" placeholder="G2 vs FNC" value={l.event} onChange={e => setLeg(i, { event: e.target.value })} />
                  <Input list="dl-markets" placeholder="Ganador del partido" value={l.market} onChange={e => setLeg(i, { market: e.target.value })} />
                  <Input placeholder="G2" value={l.selection} onChange={e => setLeg(i, { selection: e.target.value })} />
                  <Input type="number" step="0.01" min="1.01" value={l.odds || ''} onChange={e => setLeg(i, { odds: parseFloat(e.target.value) || 0 })} />
                  <Select value={l.status} onChange={e => setLeg(i, { status: e.target.value as LegStatus })}>
                    {(Object.keys(LEG_LABEL) as LegStatus[]).map(v => <option key={v} value={v}>{LEG_LABEL[v]}</option>)}
                  </Select>
                  <Button type="button" size="icon" variant="ghost" title="Quitar" disabled={legs.length <= 2} onClick={() => setLegs(legs.filter((_, j) => j !== i))}><X size={15} /></Button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <Button type="button" size="sm" variant="secondary" onClick={() => setLegs([...legs, emptyLeg()])}><Plus size={14} />Añadir selección</Button>
                <div className="text-sm text-zinc-400">{legs.length} selecciones · cuota total <span className="ml-1 text-base font-bold text-amber-300 tabular-nums">{odd(o)}</span></div>
              </div>
            </div>
          </div>
        ) : <>
          <Field label="Partido"><Input required placeholder="G2 vs FNC" value={f.event || ''} onChange={set('event')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mercado"><Input list="dl-markets" value={f.market || ''} onChange={set('market')} /></Field>
            <Field label="Selección"><Input required placeholder="G2" value={f.selection || ''} onChange={set('selection')} /></Field>
          </div>
        </>}
        <div className="grid grid-cols-4 gap-3">
          {legs
            ? <Field label="Cuota total"><div className={inputCls + ' flex items-center font-semibold tabular-nums text-zinc-300'}>{odd(o)}</div></Field>
            : <Field label="Cuota (decimal)"><Input type="number" step="0.01" min="1.01" required value={f.odds || ''} onChange={set('odds')} /></Field>}
          <Field label={`Stake (${currency})`}><Input type="number" step="0.01" min="0" required value={f.stake || ''} onChange={set('stake')} /></Field>
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
          <Field label="Importe cash out"><Input type="number" step="0.01" min="0" disabled={f.status !== 'cashout'} value={f.cashout || ''} onChange={set('cashout')} /></Field>
        </div>
        <Field label="Notas"><textarea rows={2} className={inputCls + ' h-auto py-2'} value={f.notes || ''} onChange={set('notes')} /></Field>

        {o > 1 && s > 0 && (
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
            <div><div className="text-xs text-zinc-500">Si gana</div><div className="font-semibold text-emerald-400">{money(s * (o - 1), currency, true)}</div></div>
            <div><div className="text-xs text-zinc-500">Retorno total</div><div className="font-semibold">{money(s * o, currency)}</div></div>
            <div><div className="text-xs text-zinc-500">Prob. implícita</div><div className="font-semibold">{pct(1 / o)}</div></div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={saving}>Guardar apuesta</Button>
          <Button type="button" variant="ghost" onClick={closeBet}>Cancelar</Button>
          {canAdd && (
            <Button type="button" variant="secondary" className="ml-auto" title="Guarda la selección en el boleto para combinarla con otras"
              onClick={() => { addToSlip({ event: f.event || '', league: f.league || '', market: f.market || '', selection: f.selection, odds: parseFloat(f.odds), status: 'pending', bookmaker: f.bookmaker }); closeBet(); }}>
              <Layers size={15} />Añadir a combinada
            </Button>
          )}
          {betDraft?.id && <Button type="button" variant="danger" className="ml-auto" onClick={remove}><Trash2 size={15} />Eliminar</Button>}
        </div>
      </form>
      <datalist id="dl-leagues">{leagues.map(x => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-books">{books.map(x => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-events">{events.map(x => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-markets">{MARKETS.map(x => <option key={x} value={x} />)}</datalist>
    </Dialog>
  );
}
