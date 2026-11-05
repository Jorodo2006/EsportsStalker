// Icono de cada casa de apuestas. Si pones una imagen en src/assets/books/ (bet365.png, winamax.png, betway.png…)
// se usa esa; si no, un distintivo con los colores de la casa.
import { cn } from '@/lib/format';

const FILES = import.meta.glob('../assets/books/*.{png,svg,jpg,jpeg,webp}', { eager: true, import: 'default' }) as Record<string, string>;
const IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([f, url]) => [f.split('/').pop()!.replace(/\.\w+$/, '').toLowerCase(), url])
);

const BRAND: Record<string, { bg: string; fg: string; text: string }> = {
  bet365: { bg: '#126e51', fg: '#ffdf1b', text: '365' },
  winamax: { bg: '#e30613', fg: '#ffffff', text: 'W' },
  betway: { bg: '#0c0c0c', fg: '#00a826', text: 'bw' }
};

export const bookKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export function BookIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const key = bookKey(name);
  const img = IMAGES[key];
  if (img) return <img src={img} alt="" width={size} height={size} className={cn('shrink-0 rounded-[4px] object-contain', className)} style={{ width: size, height: size }} />;
  const b = BRAND[key] ?? { bg: '#3f3f46', fg: '#e4e4e7', text: name.slice(0, 2) };
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-[4px] font-black leading-none ring-1 ring-white/10', className)}
      style={{ width: size, height: size, background: b.bg, color: b.fg, fontSize: Math.round(size * (b.text.length > 2 ? 0.42 : 0.55)) }}>
      {b.text}
    </span>
  );
}

// Cabecera de columna: icono + nombre
export function BookHead({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center justify-center gap-1.5 text-[11px] font-semibold text-zinc-300', className)} title={name}>
      <BookIcon name={name} size={16} /><span className="hidden truncate sm:inline">{name}</span>
    </span>
  );
}
