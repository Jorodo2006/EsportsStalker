// Cupón de apuestas (el "carrito"): las cuotas que se pulsan en cualquier app se van juntando aquí. Desde el cupón
// se elige si van como apuestas simples (un stake para cada una) o como combinada (un stake para todas),
// se ve lo que se puede ganar y se registran en Mis apuestas. El saldo es el de la cartera común.
// docked: fijo en la columna derecha de las pantallas anchas (siempre visible, con aviso si está vacío);
// sin docked: flotante abajo a la derecha (móvil y pantallas medianas), sólo cuando hay algo.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pencil, Ticket, Trash2, X } from 'lucide-react';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { cn, money, odd } from '@/lib/format';
import type { BetDraft, SlipLeg } from '@/lib/types';
import { comboOdds } from './BetForm';
import { Button, chip, PlayNotice, seg } from './ui';

const QUICK = [5, 10, 25, 50];
const SPORT_TAG: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol' };
const num = (v: string) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const keyOf = (l: SlipLeg) => `${l.event}|${l.market}|${l.selection}`;

export function Coupon({ docked }: { docked?: boolean }) {
  const { slip, removeFromSlip, keepInSlip, clearSlip, openBet, betDraft, toast } = useApp();
  const qc = useQueryClient();
  const cur = useCurrency();
  const w = useWallet();
  // El flotante empieza plegado: abierto taparía las tarjetas (en pantallas anchas va fijo en la columna derecha)
  const [open, setOpen] = useState(() => !!docked);
  const [mode, setMode] = useState<'single' | 'combo'>('single');
  const [stakes, setStakes] = useState<Record<string, string>>({});
  const [comboStake, setComboStake] = useState('');
  const [saving, setSaving] = useState(false);
  if (!slip.length) return docked ? <EmptyCoupon balance={money(w.balance, cur)} /> : null;
  if (betDraft && !docked) return null;

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
            odds: l.odds, bookmaker: l.bookmaker || '', stake: num(stakes[keyOf(l)]), status: 'pending', ref: l.ref
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

  const quick = (on: boolean) => cn(chip(on), 'justify-center px-0 font-mono tnum');

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-2xl border border-amber-500/40 bg-surface',
      docked ? 'shrink-0' : 'fixed inset-x-2 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 max-h-[75dvh] shadow-2xl shadow-black/70 sm:left-auto sm:w-[360px] lg:bottom-5 lg:right-5')}>
      <button onClick={() => !docked && setOpen(!open)} className={cn('flex w-full items-center gap-2 bg-zinc-900 px-3 py-2.5 text-left', !docked && 'cursor-pointer')}>
        <Ticket size={16} className="text-amber-400" />
        <span className="text-[15px] font-semibold">Cupón</span>
        <span className="rounded bg-amber-500 px-1.5 text-[11px] font-semibold text-zinc-950 tnum">{slip.length}</span>
        {m === 'combo' && <span className="font-mono text-[13px] font-semibold text-amber-400 tnum">@ {odd(comboOdds(slip))}</span>}
        <span className="ml-auto text-xs text-zinc-500">Saldo <span className="text-zinc-100 tnum">{money(w.balance, cur)}</span></span>
        {!docked && <ChevronDown size={15} className={cn('text-zinc-400 transition', !open && 'rotate-180')} />}
      </button>
      {open && <>
        <div className="mx-3 my-2.5 grid grid-cols-2 gap-0.5 rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800">
          {([['single', `Simples (${slip.length})`], ['combo', 'Combinada']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setMode(v)} disabled={v === 'combo' && !canCombo}
              title={v === 'combo' && clash ? 'Hay dos selecciones del mismo mercado y partido' : v === 'combo' && slip.length < 2 ? 'Añade al menos dos selecciones' : undefined}
              className={cn(seg(m === v), 'py-1')}>{label}</button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
          {slip.map((l, i) => (
            <div key={keyOf(l)} className="rounded-xl bg-zinc-900/70 px-3 py-2.5 ring-1 ring-inset ring-zinc-800">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px]">
                    {l.bookmaker && <span className="font-semibold text-amber-400">{l.bookmaker}</span>}
                    <span className="text-zinc-500">{l.bookmaker ? ' · ' : ''}{l.market}</span>
                  </div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-zinc-50">{l.selection}</div>
                  <div className="truncate font-mono text-[11px] text-zinc-500">{[SPORT_TAG[l.sport || 'lol'], l.event].filter(Boolean).join(' · ')}</div>
                </div>
                <button title="Quitar" onClick={() => removeFromSlip(i)} className="grid h-6 w-6 cursor-pointer place-items-center rounded-md text-zinc-500 transition hover:bg-rose-500/15 hover:text-rose-300"><X size={14} /></button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-amber-400 tnum">@ {odd(l.odds)}</span>
                {m === 'single' && <>
                  <span className="ml-auto hidden font-mono text-[11px] text-zinc-500 min-[380px]:inline">gana <b className="font-semibold text-emerald-400 tnum">{money(num(stakes[keyOf(l)] || '') * (l.odds - 1), cur)}</b></span>
                  <StakeInput value={stakes[keyOf(l)] || ''} onChange={v => setStakes(s => ({ ...s, [keyOf(l)]: v }))} cur={cur} />
                </>}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-zinc-800 bg-zinc-900/60 p-3">
          {m === 'combo' && (
            <div className="flex items-end justify-between gap-3">
              <div><div className="label-data text-zinc-500">Cuota combinada</div><div className="font-mono text-2xl font-bold text-zinc-50 tnum">@ {odd(comboOdds(slip))}</div></div>
              <StakeInput value={comboStake} onChange={setComboStake} cur={cur} />
            </div>
          )}
          <div className="grid grid-cols-4 gap-1">
            {QUICK.map(q => <button key={q} onClick={() => (m === 'combo' ? setComboStake(String(q)) : setAll(String(q)))}
              className={quick(m === 'combo' ? num(comboStake) === q : slip.every(l => num(stakes[keyOf(l)] || '') === q))}>{q} {cur}</button>)}
          </div>
          {books.length > 1 && m === 'combo' && <div className="text-xs text-amber-300/80">Las cuotas son de casas distintas ({books.join(', ')}): en una sola casa la combinada puede pagar otra cosa.</div>}
          <div className="flex items-end justify-between gap-2">
            <div><div className="label-data text-zinc-500">{m === 'combo' ? 'Importe' : 'Importe total'}</div><div className="font-mono text-sm font-semibold text-zinc-100 tnum">{money(total, cur)}</div></div>
            <div className="text-right"><div className="label-data text-zinc-500">Retorno posible</div><div className="font-mono text-2xl font-bold text-emerald-400 tnum">{money(win, cur)}</div></div>
          </div>
          {total > w.balance && w.balance > 0 && <div className="text-xs text-rose-300">Es más de lo que te queda en la cartera ({money(w.balance, cur)}).</div>}
          <div className="flex gap-1.5">
            <Button className="h-10 flex-1" disabled={saving || !total} onClick={place}>{m === 'combo' ? 'Registrar combinada' : 'Registrar apuestas'}</Button>
            {m === 'combo' && <Button variant="secondary" className="h-10 w-10" size="icon" title="Abrir en el formulario (más opciones)"
              onClick={() => openBet({ legs: slip.map(({ bookmaker: _, ...l }) => l), stake: num(comboStake) || undefined, bookmaker: books.length === 1 ? books[0] : '', fromSlip: true })}><Pencil size={15} /></Button>}
            <Button variant="secondary" className="h-10 w-10" size="icon" title="Vaciar el cupón" onClick={clearSlip}><Trash2 size={15} /></Button>
          </div>
          <PlayNotice className="text-center" />
        </div>
      </>}
    </div>
  );
}

// Cupón fijo sin selecciones: explica cómo se llena
function EmptyCoupon({ balance }: { balance: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-surface px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><Ticket size={15} className="text-zinc-500" />Cupón</div>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">Pulsa una cuota en la ficha de un partido para añadirla. Aquí eliges simples o combinada y la registras.</p>
      <div className="mt-3 flex justify-between border-t border-zinc-800 pt-2.5 text-xs text-zinc-500">Saldo <span className="text-zinc-200 tnum">{balance}</span></div>
      <PlayNotice className="mt-2.5" />
    </div>
  );
}

function StakeInput({ value, onChange, cur }: { value: string; onChange: (v: string) => void; cur: string }) {
  return (
    <label className="flex h-8 w-28 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 transition focus-within:border-zinc-500">
      <input inputMode="decimal" placeholder="Importe" value={value} onChange={e => onChange(e.target.value)} className="w-full bg-transparent text-right font-mono text-sm tnum outline-none placeholder:text-zinc-600" />
      <span className="font-mono text-xs text-zinc-500">{cur}</span>
    </label>
  );
}
