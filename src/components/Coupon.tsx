// Cupón de apuestas (el "carrito"): las cuotas que se pulsan en cualquier app se van juntando aquí. Desde el cupón
// se elige si van como apuestas simples (un stake para cada una) o como combinada (un stake para todas),
// se ve lo que se puede ganar y se registran en Mis apuestas. El saldo es el de la cartera común.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pencil, Ticket, Trash2, X } from 'lucide-react';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { cn, money, odd } from '@/lib/format';
import type { BetDraft, SlipLeg } from '@/lib/types';
import { comboOdds } from './BetForm';
import { Button } from './ui';

const QUICK = [5, 10, 25, 50];
const SPORT_TAG: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis' };
const num = (v: string) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const keyOf = (l: SlipLeg) => `${l.event}|${l.market}|${l.selection}`;

export function Coupon() {
  const { slip, removeFromSlip, keepInSlip, clearSlip, openBet, betDraft, toast } = useApp();
  const qc = useQueryClient();
  const cur = useCurrency();
  const w = useWallet();
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<'single' | 'combo'>('single');
  const [stakes, setStakes] = useState<Record<string, string>>({});
  const [comboStake, setComboStake] = useState('');
  const [saving, setSaving] = useState(false);
  if (!slip.length || betDraft) return null;

  // Dos selecciones del mismo mercado y partido no se pueden combinar
  const clash = slip.some((l, i) => slip.some((x, j) => j !== i && x.event === l.event && x.market === l.market));
  const canCombo = slip.length >= 2 && !clash;
  const m = mode === 'combo' && canCombo ? 'combo' : 'single';
  const total = m === 'combo' ? num(comboStake) : slip.reduce((s, l) => s + num(stakes[keyOf(l)] || ''), 0);
  const win = m === 'combo' ? num(comboStake) * comboOdds(slip) : slip.reduce((s, l) => s + num(stakes[keyOf(l)] || '') * l.odds, 0);
  const setAll = (v: string) => setStakes(Object.fromEntries(slip.map(l => [keyOf(l), v])));
  const books = [...new Set(slip.map(l => l.bookmaker).filter(Boolean))];

  async function place() {
    setSaving(true);
    try {
      if (m === 'combo') {
        if (!num(comboStake)) throw new Error('Pon cuánto le metes a la combinada');
        await window.api.bets.save({
          date: today(), stake: num(comboStake), status: 'pending', bookmaker: books.length === 1 ? books[0] : '',
          legs: slip.map(({ bookmaker: _, ...l }) => ({ ...l, status: 'pending' }))
        } as BetDraft);
      } else {
        const list = slip.filter(l => num(stakes[keyOf(l)] || ''));
        if (!list.length) throw new Error('Pon el stake de al menos una apuesta');
        for (const l of list) {
          await window.api.bets.save({
            date: today(), sport: l.sport, league: l.league, event: l.event, market: l.market, selection: l.selection,
            odds: l.odds, bookmaker: l.bookmaker || '', stake: num(stakes[keyOf(l)]), status: 'pending'
          });
        }
        // Las que no tenían stake se quedan en el cupón
        const done = new Set(list.map(keyOf));
        keepInSlip(l => !done.has(keyOf(l)));
      }
      await qc.invalidateQueries({ queryKey: ['bets'] });
      if (m === 'combo') clearSlip();
      setStakes({}); setComboStake('');
      toast(m === 'combo' ? 'Combinada registrada' : 'Apuestas registradas');
    } catch (e) { toast((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex max-h-[80vh] w-[360px] flex-col overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-950 shadow-2xl shadow-black/60">
      <button onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center gap-2 bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950">
        <Ticket size={16} />Cupón
        <span className="rounded-full bg-zinc-950/20 px-1.5 text-xs">{slip.length}</span>
        {m === 'combo' && <span className="ml-1 font-score text-base tnum">@ {odd(comboOdds(slip))}</span>}
        <span className="ml-auto text-xs font-medium">Cartera {money(w.balance, cur)}</span>
        <ChevronDown size={15} className={cn('transition', !open && 'rotate-180')} />
      </button>
      {open && <>
        <div className="flex gap-1 border-b border-zinc-800 p-2">
          {([['single', `Simples (${slip.length})`], ['combo', 'Combinada']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setMode(v)} disabled={v === 'combo' && !canCombo}
              title={v === 'combo' && clash ? 'Hay dos selecciones del mismo mercado y partido' : v === 'combo' && slip.length < 2 ? 'Añade al menos dos selecciones' : undefined}
              className={cn('flex-1 cursor-pointer rounded-lg py-1.5 text-sm font-medium transition disabled:cursor-default disabled:opacity-35',
                m === v ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200')}>{label}</button>
          ))}
        </div>

        <div className="min-h-0 flex-1 divide-y divide-zinc-800/70 overflow-y-auto">
          {slip.map((l, i) => (
            <div key={keyOf(l)} className="px-4 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{l.selection}</div>
                  <div className="truncate text-xs text-zinc-500">{l.market}</div>
                  <div className="truncate text-xs text-zinc-600">{[SPORT_TAG[l.sport || 'lol'], l.event, l.bookmaker].filter(Boolean).join(', ')}</div>
                </div>
                <span className="pt-0.5 font-score text-lg font-semibold tnum">{odd(l.odds)}</span>
                <button title="Quitar" onClick={() => removeFromSlip(i)} className="cursor-pointer pt-1 text-zinc-600 hover:text-rose-400"><X size={14} /></button>
              </div>
              {m === 'single' && (
                <div className="mt-2 flex items-center gap-2">
                  <StakeInput value={stakes[keyOf(l)] || ''} onChange={v => setStakes(s => ({ ...s, [keyOf(l)]: v }))} cur={cur} />
                  <span className="ml-auto text-xs text-zinc-500">gana <b className="text-emerald-400 tnum">{money(num(stakes[keyOf(l)] || '') * (l.odds - 1), cur)}</b></span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-zinc-800 p-4">
          {m === 'single'
            ? <div className="flex items-center gap-1.5 text-xs text-zinc-500">A todas:
              {QUICK.map(q => <button key={q} onClick={() => setAll(String(q))} className="cursor-pointer rounded-md border border-zinc-800 px-2 py-0.5 tnum text-zinc-300 hover:border-zinc-600">{q}</button>)}
            </div>
            : <div className="flex items-center gap-2">
              <StakeInput value={comboStake} onChange={setComboStake} cur={cur} />
              {QUICK.map(q => <button key={q} onClick={() => setComboStake(String(q))} className="cursor-pointer rounded-md border border-zinc-800 px-2 py-0.5 text-xs tnum text-zinc-300 hover:border-zinc-600">{q}</button>)}
            </div>}
          {books.length > 1 && m === 'combo' && <div className="text-xs text-amber-300/80">Las cuotas son de casas distintas ({books.join(', ')}): en una sola casa la combinada puede pagar otra cosa.</div>}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><div className="text-xs text-zinc-500">Apuestas</div><div className="font-semibold tnum">{money(total, cur)}</div></div>
            <div className="text-right"><div className="text-xs text-zinc-500">Retorno posible</div><div className="font-score text-xl font-semibold text-emerald-400 tnum">{money(win, cur)}</div></div>
          </div>
          {total > w.balance && w.balance > 0 && <div className="text-xs text-rose-300">Es más de lo que te queda en la cartera ({money(w.balance, cur)}).</div>}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={saving || !total} onClick={place}>{m === 'combo' ? 'Registrar combinada' : 'Registrar apuestas'}</Button>
            {m === 'combo' && <Button variant="secondary" size="icon" title="Abrir en el formulario (más opciones)"
              onClick={() => openBet({ legs: slip.map(({ bookmaker: _, ...l }) => l), stake: num(comboStake) || undefined, bookmaker: books.length === 1 ? books[0] : '', fromSlip: true })}><Pencil size={15} /></Button>}
            <Button variant="ghost" size="icon" title="Vaciar el cupón" onClick={clearSlip}><Trash2 size={15} /></Button>
          </div>
        </div>
      </>}
    </div>
  );
}

function StakeInput({ value, onChange, cur }: { value: string; onChange: (v: string) => void; cur: string }) {
  return (
    <label className="flex h-8 w-28 items-center gap-1 rounded-lg border border-zinc-700/70 bg-zinc-900 px-2 focus-within:border-amber-500/70">
      <input inputMode="decimal" placeholder="Stake" value={value} onChange={e => onChange(e.target.value)} className="w-full bg-transparent text-sm tnum outline-none placeholder:text-zinc-600" />
      <span className="text-xs text-zinc-500">{cur}</span>
    </label>
  );
}
