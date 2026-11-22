// «Subir ticket»: la captura de una apuesta hecha en la casa (Winamax, bet365…) se lee en el servidor (OCR, server/services/bets/
// scan.js) y vuelve como apuesta enlazada a su partido, para revisarla y guardarla. Enlazada, sale en «Tus apuestas» con su barra
// y se resuelve sola. La imagen se amplía aquí antes de subirla (el OCR lee mucho mejor el texto pequeño al doble) y el servidor
// no la guarda.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ImageUp, X } from 'lucide-react';
import { useApp, useBets, useCurrency } from '@/lib/app-context';
import { cn, decEs, money, odd } from '@/lib/format';
import type { Bet, BetDraft, TicketScan } from '@/lib/types';
import { Button, Dialog } from './ui';

const KIND = { single: 'Simple', combo: 'Combinada', builder: 'Crear apuesta' } as const;

// La captura, ampliada al doble si mide menos de 2000 px de ancho (hasta 3200 px; las de bet365 en el ordenador miden ~1400 y
// sin ampliar el OCR leía «Real Madrid» como "real vacia"), en PNG; si pesa demasiado, en JPEG
async function prepare(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(bmp.width < 2000 ? 2 : 1, 3200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const png = c.toDataURL('image/png');
  return png.length < 7e6 ? png : c.toDataURL('image/jpeg', 0.92);
}

// ¿Ya está apuntada? Mismo día, importe y cuota, y el mismo partido
const sameBet = (a: BetDraft, b: Bet) => a.date === b.date && Math.abs((a.stake ?? 0) - b.stake) < 0.01 && Math.abs((a.odds ?? 0) - b.odds) < 0.01 &&
  (a.legs ? !!b.legs && b.legs.length === a.legs.length : !b.legs && (a.ref?.match ? b.ref?.match === a.ref.match : a.event === b.event));

export function TicketUpload({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)} title="Sube la captura de una apuesta hecha en la casa y se apunta sola"><ImageUp size={15} />Subir ticket</Button>
      {open && <TicketDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function TicketDialog({ onClose }: { onClose: () => void }) {
  const { openBet, toast } = useApp();
  const qc = useQueryClient();
  const cur = useCurrency();
  const bets = useBets().data ?? [];
  const [state, setState] = useState<{ step: 'pick' } | { step: 'reading' } | { step: 'done'; r: TicketScan } | { step: 'error'; msg: string }>({ step: 'pick' });
  const [saving, setSaving] = useState(false);

  async function read(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setState({ step: 'error', msg: 'Eso no es una imagen: sube una captura (PNG o JPG).' }); return; }
    setState({ step: 'reading' });
    try { setState({ step: 'done', r: await window.api.bets.scan(await prepare(file)) }); }
    catch (e) { setState({ step: 'error', msg: (e as Error).message }); }
  }

  // En el ordenador también se puede pegar la captura (Ctrl+V)
  useEffect(() => {
    if (state.step !== 'pick') return;
    const h = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/')); if (f) read(f); };
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, [state.step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(d: BetDraft) {
    setSaving(true);
    try {
      await window.api.bets.save(d);
      qc.invalidateQueries({ queryKey: ['bets'] });
      toast('Apuesta apuntada');
      onClose();
    } catch (e) { toast('No se ha podido guardar: ' + (e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Dialog open onClose={onClose} title="Subir ticket">
      {state.step === 'pick' || state.step === 'error' ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-400">Haz una captura de la apuesta en la casa (el ticket entero: importe, cuota y selecciones) y súbela. Se apunta en Mis apuestas enlazada a su partido, para seguirla y que se resuelva sola. La imagen no se guarda.</p>
          <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); read(e.dataTransfer.files[0]); }}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-zinc-700 bg-zinc-900/50 px-4 py-8 text-center transition hover:border-zinc-500">
            <ImageUp size={22} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-100">Elegir captura</span>
            <span className="text-xs text-zinc-500">o arrástrala aquí<span className="max-lg:hidden">, o pégala con Ctrl+V</span></span>
            <input type="file" accept="image/*" className="sr-only" onChange={e => read(e.target.files?.[0])} />
          </label>
          {state.step === 'error' && <p className="text-sm text-rose-300">{state.msg}</p>}
          <p className="text-xs text-zinc-500">Se leen bien los de Winamax y bet365. Se reconocen ganador, hándicap y totales; en baloncesto, también las líneas de jugador, y en fútbol, ambos marcan, tarjetas, córners, goleadores, paradas, remates, faltas y amonestados. Lo demás se guarda como texto.</p>
        </div>
      ) : state.step === 'reading' ? (
        <p className="py-10 text-center text-sm text-zinc-400">Leyendo el ticket…</p>
      ) : (
        <Result r={state.r} cur={cur} dup={bets.some(b => sameBet(state.r.draft, b))} saving={saving}
          onSave={() => save(state.r.draft)} onEdit={() => { onClose(); openBet(state.r.draft); }} onAgain={() => setState({ step: 'pick' })} />
      )}
    </Dialog>
  );
}

function Result({ r, cur, dup, saving, onSave, onEdit, onAgain }: {
  r: TicketScan; cur: string; dup: boolean; saving: boolean; onSave: () => void; onEdit: () => void; onAgain: () => void;
}) {
  const d = r.draft;
  const rows = d.legs ?? [d];
  const linked = r.legs.filter(l => l.linked).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-zinc-50">{[r.book || 'Casa sin reconocer', KIND[r.kind]].join(' · ')}</span>
        <span className="text-zinc-400 tnum">{money(d.stake ?? 0, cur)} a {odd(d.odds ?? 0)}</span>
        {d.date && <span className="text-zinc-500 tnum">{d.date.split('-').reverse().join('/')}</span>}
        {d.status === 'cashout' && <span className="text-zinc-400">cerrada por {money(d.cashout ?? 0, cur)}</span>}
      </div>
      <ul className="divide-y divide-zinc-800/70 rounded-[10px] border border-zinc-800">
        {rows.map((l, i) => {
          const info = r.legs[i];
          return (
            <li key={i} className="flex items-start gap-3 px-4 py-2.5">
              {info?.linked ? <Check size={15} className="mt-0.5 shrink-0 text-emerald-400" /> : <X size={15} className="mt-0.5 shrink-0 text-rose-300" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-zinc-50">{l.selection ? decEs(l.selection) : decEs(info?.text) || 'Sin leer'}</span>
                <span className="block text-xs text-zinc-500">{[l.market && decEs(l.market), info?.game ?? l.event].filter(Boolean).join(' · ')}</span>
                {!info?.linked && info?.why && <span className="block text-xs text-rose-300">{info.why}</span>}
              </span>
              {r.kind !== 'builder' && <span className="shrink-0 text-sm text-zinc-300 tnum">{odd(l.odds ?? 0)}</span>}
            </li>
          );
        })}
      </ul>
      {r.warnings.map(w => <p key={w} className="text-xs text-amber-300">{w}</p>)}
      <p className={cn('text-xs', linked === r.legs.length ? 'text-zinc-500' : 'text-zinc-400')}>
        {linked === r.legs.length ? 'Todo enlazado a su partido: saldrá en «Tus apuestas» y se resolverá sola.'
          : linked ? `${linked} de ${r.legs.length} selecciones enlazadas. Las demás se guardan como texto y se resuelven a mano.`
            : 'No se ha podido enlazar a ningún partido: se guarda como texto y se resuelve a mano. Revísala en el formulario.'}
        {' '}Comprueba el importe y la cuota: el lector de imágenes a veces confunde una cifra.
      </p>
      {dup && <p className="text-sm text-amber-300">Ya tienes una apuesta igual apuntada (mismo día, importe y cuota). Guárdala sólo si es otra.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onAgain}>Otra captura</Button>
        <Button variant="secondary" onClick={onEdit}>Revisar en el formulario</Button>
        <Button onClick={onSave} disabled={saving || !(d.stake && d.stake > 0)}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </div>
  );
}
