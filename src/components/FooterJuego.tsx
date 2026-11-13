// Pie con los avisos de juego, al final de la entrada y de cada pantalla de la app. Con los colores del tema, como el resto:
// tiene que leerse, no gritar. Tres columnas (qué es Sharpex con el «+18», juego seguro y ayuda) y abajo que no es un operador.
// El +18 (AgeBadge) es el único toque de rojo.
// Sin los sellos «Juego Seguro» ni «Juego Autorizado» de la DGOJ ni logos de medios de pago: son de operadores con licencia,
// y Sharpex no lo es.
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/format';
import { AgeBadge, SAFE_PLAY_URL } from './ui';

const RGIAJ_URL = 'https://www.ordenacionjuego.es/participantes-juego/juego-seguro/rgiaj';
const FEJAR_URL = 'https://www.fejar.org';

// inner: ancho y márgenes del contenido, los mismos que los de la pantalla en la que va, para que quede alineado con ella
export function FooterJuego({ className, inner = 'max-w-6xl px-5 sm:px-10' }: { className?: string; inner?: string }) {
  return (
    <footer className={cn('shrink-0 border-t border-zinc-800 bg-zinc-950', className)}>
      <div className={cn('mx-auto w-full', inner)}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 py-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-12">
          <div className="col-span-2 lg:col-span-1">
            <div className="text-[15px] font-semibold tracking-tight text-zinc-50">Sharpex</div>
            <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-zinc-500">Análisis estadístico de LoL, baloncesto, tenis y fútbol: partidos, cuotas comparadas y recomendaciones del modelo.</p>
            <div className="mt-5 flex items-center gap-3">
              <AgeBadge className="h-9 w-9 text-[11px]" />
              <div>
                <div className="text-sm font-medium text-zinc-200">El juego es un riesgo</div>
                <div className="text-xs text-zinc-500">Solo para mayores de 18 años</div>
              </div>
            </div>
          </div>
          <Column title="Juego seguro">
            <Item href={RGIAJ_URL} sub="Registro de autoexclusión de la DGOJ">AutoProhibición</Item>
            <Item href={SAFE_PLAY_URL} sub="Información oficial de la DGOJ">juegoseguro.es</Item>
          </Column>
          <Column title="¿Necesitas ayuda?">
            <Item href={FEJAR_URL} sub="Federación Española de Jugadores de Azar Rehabilitados">FEJAR</Item>
            <Item href="tel:900200225" sub="Línea gratuita y confidencial"><span className="tnum">900 200 225</span></Item>
          </Column>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-zinc-800/70 py-5 text-xs leading-relaxed text-zinc-500 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <p className="max-w-3xl">Sharpex es una herramienta de análisis estadístico. No es un operador de juego, no acepta apuestas y no gestiona dinero de usuarios.</p>
          <p className="shrink-0">© {new Date().getFullYear()} Sharpex</p>
        </div>
      </div>
    </footer>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h2 className="text-xs font-medium text-zinc-500">{title}</h2>
      <ul className="mt-3 flex flex-col gap-3.5">{children}</ul>
    </div>
  );
}

// Los enlaces de fuera se abren en otra pestaña y sin decir de dónde vienen (la flecha lo avisa); el teléfono llama
function Item({ href, sub, children }: { href: string; sub: string; children: ReactNode }) {
  const away = !href.startsWith('tel:');
  return (
    <li>
      <a href={href} {...(away ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="group block">
        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-zinc-200 transition group-hover:text-zinc-50">
          {children}
          {away && <ArrowUpRight size={13} className="text-zinc-600 transition group-hover:text-zinc-300" />}
        </span>
        <span className="block text-xs leading-snug text-zinc-500">{sub}</span>
      </a>
    </li>
  );
}
