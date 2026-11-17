// Esperar a que el lector termine una lectura pedida a mano (el botón de las recomendaciones y el del cupón). Se reconoce por el
// número del trabajo, no por el partido: el programador lanza a la vez lecturas automáticas del mismo partido, que antes se
// confundían con la nuestra. Escucha el aviso en vivo (odds:auto) y, por si se pierde (la conexión de avisos se corta y vuelve),
// pregunta cada pocos segundos. Si en 4 minutos no ha terminado, se deja de esperar: la lectura sigue y las cuotas llegarán solas.
import type { AutoJob } from './types';

const POLL_MS = 6000;
const MAX_MS = 4 * 60e3;

export function waitJob(job: AutoJob, onChange?: (j: AutoJob) => void): Promise<AutoJob | null> {
  if (job.done) return Promise.resolve(job);
  return new Promise(resolve => {
    let over = false;
    const end = (j: AutoJob | null) => {
      if (over) return;
      over = true; off(); clearInterval(poll); clearTimeout(limit);
      resolve(j);
    };
    const seen = (j: AutoJob) => { if (over || j.id !== job.id) return; onChange?.(j); if (j.done) end(j); };
    const off = window.api.onOddsAuto(seen);
    const poll = setInterval(() => { window.api.odds.job(job.id).then(seen).catch(() => {}); }, POLL_MS);
    const limit = setTimeout(() => end(null), MAX_MS);
  });
}

// En qué va, para decirlo mientras gira: en cola, o qué casa está leyendo
export function jobStage(j: AutoJob | null): string {
  if (!j) return 'Pidiendo la lectura…';
  if (j.done) return 'Hecho';
  if (!j.picked) return 'En cola: el lector termina la lectura que está haciendo';
  const books: Record<string, string> = { winamax: 'Winamax', betway: 'Betway' };
  const busy = Object.entries(j.steps ?? {}).find(([, s]) => s && ['buscando', 'leyendo'].includes(s.estado));
  return busy ? `Leyendo ${books[busy[0]] ?? busy[0]}…` : 'Leyendo…';
}

// Si todas las casas fallaron
export const jobFailed = (j: AutoJob) => !!j.error || Object.values(j.steps ?? {}).every(s => s?.estado === 'error');
