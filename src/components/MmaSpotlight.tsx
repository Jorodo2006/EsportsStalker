// "Spotlight" de un combate: las fotos de los dos luchadores a los lados y, en medio, la tabla cara a cara (edad, récord, altura,
// alcance, KO, sumisiones…). Los datos de ESPN vienen de su ficha (GET /api/mma/profile); los de WOW, de su propia web. Lo que
// no se sabe sale como "–". El que va por delante en cada fila va en negrita y con el acento.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/format';
import type { MmaFight, MmaFighter, MmaFighterCard, MmaProfile } from '@/lib/types';
import { parseRecord } from './mma';
import { sized } from '@/lib/img';

type Better = 'high' | 'low' | null;
interface Row { label: string; a: number | null; b: number | null; fmt: (v: number) => string; better: Better; title?: string; textA?: string; textB?: string }

const int = (v: number) => String(Math.round(v));
const dec1 = (v: number) => v.toFixed(1).replace('.', ',');
const cm = (v: number) => `${Math.round(v)} cm`;

// Lo que se sabe de un luchador: la ficha de ESPN o, si no la hay (WOW), lo que trae su combate y su historial
function known(f: MmaFighter, prof: MmaProfile | undefined, card: MmaFighterCard | undefined) {
  const methods = card?.stats.methods ?? null;
  return {
    age: prof?.age ?? f.age ?? null,
    height: prof?.heightCm ?? (f.heightM != null ? f.heightM * 100 : null),
    reach: prof?.reachCm ?? null,
    kos: prof?.kos ?? methods?.ko ?? null,
    subs: prof?.subs ?? methods?.sub ?? null,
    decisions: prof?.decisions ?? methods?.dec ?? null,
    spm: prof?.strikesPerMin ?? null,
    td: prof?.takedownAvg ?? null,
    pct: parseRecord(f.record)?.pct ?? null
  };
}

function Face({ f, side }: { f: MmaFighter; side: 'a' | 'b' }) {
  const [broken, setBroken] = useState(false);
  const initials = f.name.split(' ').map(x => x[0]).join('').slice(0, 2);
  return (
    <div className={cn('relative min-h-28 overflow-hidden bg-zinc-900 sm:min-h-72', side === 'a' ? 'border-r' : 'border-l', 'border-zinc-800')}>
      {f.photo && !broken
        ? <img src={sized(f.photo, 160)} alt="" onError={() => setBroken(true)} loading="lazy" decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-top" style={{ maskImage: 'linear-gradient(to bottom, #000 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 70%, transparent 100%)' }} />
        : <div className="absolute inset-0 grid place-items-center font-mono text-5xl font-bold uppercase text-zinc-800">{initials}</div>}
      <div className={cn('absolute inset-x-0 bottom-0 p-2 sm:p-3', side === 'b' && 'text-right')}>
        <div className="truncate text-[13px] font-bold uppercase leading-tight tracking-tight text-zinc-50 sm:text-lg">{f.name.split(' ').slice(1).join(' ') || f.name}</div>
        <div className="truncate text-[11px] text-zinc-400">{f.name.split(' ')[0]}{f.country ? ` · ${f.country}` : ''}</div>
      </div>
    </div>
  );
}

export function MmaSpotlight({ f, eloA, eloB, cardA, cardB, onFighter }: {
  f: MmaFight; eloA: number | null; eloB: number | null; cardA?: MmaFighterCard; cardB?: MmaFighterCard; onFighter: (id: string) => void;
}) {
  // La ficha de ESPN sólo existe para sus luchadores (el id es numérico); los de WOW salen de su web
  const espn = (id: string) => /^\d+$/.test(id);
  const pa = useQuery({ queryKey: ['mma', 'profile', f.a.id], queryFn: () => window.api.mma.profile(f.a.id), enabled: espn(f.a.id), staleTime: 6 * 3600e3, retry: false });
  const pb = useQuery({ queryKey: ['mma', 'profile', f.b.id], queryFn: () => window.api.mma.profile(f.b.id), enabled: espn(f.b.id), staleTime: 6 * 3600e3, retry: false });
  const a = known(f.a, pa.data, cardA), b = known(f.b, pb.data, cardB);
  const rows = ([
    { label: 'Edad', a: a.age, b: b.age, fmt: int, better: null },
    { label: 'Récord', a: a.pct, b: b.pct, fmt: int, better: 'high', textA: f.a.record || '–', textB: f.b.record || '–', title: 'Ganado / perdido / empatado; gana quien tiene mejor porcentaje de victorias' },
    { label: 'Altura', a: a.height, b: b.height, fmt: cm, better: 'high' },
    { label: 'Alcance', a: a.reach, b: b.reach, fmt: cm, better: 'high' },
    { label: 'KO/TKO', a: a.kos, b: b.kos, fmt: int, better: 'high', title: 'Victorias por KO o TKO' },
    { label: 'Sumisiones', a: a.subs, b: b.subs, fmt: int, better: 'high', title: 'Victorias por sumisión' },
    { label: 'Decisiones', a: a.decisions, b: b.decisions, fmt: int, better: null, title: 'Victorias por decisión' },
    { label: 'Golpes / min', a: a.spm, b: b.spm, fmt: dec1, better: 'high', title: 'Golpes conectados por minuto' },
    { label: 'Derribos / 15 min', a: a.td, b: b.td, fmt: dec1, better: 'high' },
    { label: 'Elo del modelo', a: eloA, b: eloB, fmt: int, better: 'high', title: 'Calculado con los combates de UFC, PFL y WOW desde 2016' }
  ] as Row[]).filter(r => r.a != null || r.b != null || r.textA);
  const lead = (r: Row, side: 'a' | 'b') => r.better != null && r.a != null && r.b != null && r.a !== r.b && (r.better === 'high' ? r.a > r.b : r.a < r.b) === (side === 'a');
  const cell = (r: Row, side: 'a' | 'b') => {
    const v = side === 'a' ? r.a : r.b, t = side === 'a' ? r.textA : r.textB;
    return <span className={cn('font-mono text-[14px] tnum', side === 'b' && 'text-right', lead(r, side) ? 'font-bold text-[var(--tv-mark)]' : 'font-medium text-zinc-300')}>{t ?? (v == null ? '–' : r.fmt(v))}</span>;
  };
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[var(--tv-bg)]">
      <div className="flex flex-wrap items-center gap-x-2 border-b border-zinc-800 px-4 py-2 text-[13px]">
        <span className="font-semibold text-zinc-100">Cara a cara</span>
        <span className="text-xs text-zinc-500">{[f.weightClass, `${f.rounds} asaltos`, f.title ? 'por el título' : ''].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <Face f={f.a} side="a" />
        <div className="flex flex-col justify-center px-2 py-2 sm:px-4">
          <div className="mb-1 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
            <button onClick={() => onFighter(f.a.id)} className="cursor-pointer truncate text-left hover:text-amber-400" title="Ver su ficha">Esquina roja</button>
            <button onClick={() => onFighter(f.b.id)} className="cursor-pointer truncate text-right hover:text-amber-400" title="Ver su ficha">Esquina azul</button>
          </div>
          {rows.map(r => (
            <div key={r.label} title={r.title} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t border-zinc-800/70 py-1.5 first:border-t-0">
              {cell(r, 'a')}
              <span className="whitespace-nowrap text-center font-mono text-[10.5px] font-medium uppercase tracking-wide text-zinc-500 sm:text-[11px]">{r.label}</span>
              {cell(r, 'b')}
            </div>
          ))}
        </div>
        <Face f={f.b} side="b" />
      </div>
      <p className="border-t border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-500">
        {f.org === 'wow' ? 'Datos de wowmma.com y del historial de WOW.' : 'Datos de ESPN: medidas y estilo de su ficha; el Elo, del modelo.'} En negrita y con el acento, quien va por delante; "–" si no se sabe.
        {(pa.data?.stance || pb.data?.stance) ? ` Guardia: ${[pa.data?.stance, pb.data?.stance].map(x => x || '–').join(' / ')}.` : ''}
      </p>
    </div>
  );
}
