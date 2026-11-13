// Pie con los avisos de juego: en la portada (pantalla de entrada) y al final de cada pantalla de la app. Colores y medidas
// propios, no los del tema ni el acento de cada app: es un aviso legal y tiene que verse igual en todas partes.
// Sin los sellos «Juego Seguro» ni «Juego Autorizado» de la DGOJ ni logos de medios de pago: son de operadores con licencia,
// y Sharpex no lo es.
import { cn } from '@/lib/format';
import { SAFE_PLAY_URL } from './ui';

const RGIAJ_URL = 'https://www.ordenacionjuego.es/participantes-juego/juego-seguro/rgiaj';
const FEJAR_URL = 'https://www.fejar.org';
// Los enlaces salen de la app en otra pestaña y sin decir de dónde vienen
const out = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function FooterJuego({ className }: { className?: string }) {
  return (
    <footer className={cn('shrink-0 border-t border-[#2A323D] bg-[#08090B] text-white', className)}>
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5 lg:justify-between">
          <div className="border-[3px] border-white px-3 py-1.5 text-center text-sm font-extrabold uppercase leading-tight">El juego es un riesgo</div>
          <p className="text-sm text-white">Solo para mayores de 18 años</p>
          <span role="img" aria-label="Sólo para mayores de 18 años"
            className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full bg-[#E3001B] text-xl font-extrabold text-white tnum">+18</span>
          <a href={RGIAJ_URL} {...out} title="Registro de autoprohibición de la DGOJ" className="flex flex-col items-center gap-1 text-xs font-medium hover:underline">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#E3001B]"><HandIcon /></span>
            AutoProhibición
          </a>
          <a href={SAFE_PLAY_URL} {...out} className="text-sm font-semibold underline-offset-2 hover:underline">www.juegoseguro.es</a>
          <div className="text-center text-sm lg:text-left">
            <div className="text-[#9AA3B2]">¿Necesitas ayuda?</div>
            <a href={FEJAR_URL} {...out} className="font-semibold underline-offset-2 hover:underline tnum">FEJAR · 900 200 225</a>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2 border-t border-[#2A323D] pt-4 text-xs leading-relaxed text-[#9AA3B2] sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <p className="max-w-3xl">Sharpex es una herramienta de análisis estadístico. No es un operador de juego, no acepta apuestas y no gestiona dinero de usuarios.</p>
          <p className="shrink-0">© {new Date().getFullYear()} Sharpex</p>
        </div>
      </div>
    </footer>
  );
}

// Mano abierta (alto), la señal de la autoprohibición
function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" aria-hidden="true">
      <rect x="7.2" y="4" width="2.6" height="9" rx="1.3" />
      <rect x="10.1" y="2.5" width="2.6" height="10" rx="1.3" />
      <rect x="13" y="3.2" width="2.6" height="9.5" rx="1.3" />
      <rect x="15.9" y="5.2" width="2.6" height="8" rx="1.3" />
      <rect x="7.2" y="10" width="11.3" height="10.5" rx="4" />
      <rect x="5" y="10" width="2.6" height="7" rx="1.3" transform="rotate(-28 6.3 17)" />
    </svg>
  );
}
