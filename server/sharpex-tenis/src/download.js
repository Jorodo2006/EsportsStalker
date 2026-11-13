// Descarga del histórico: el archivo de Sackmann (no cambia: sólo se baja lo que falta) y lo reciente de TennisMyLife
// (se baja siempre). Lo usan la línea de órdenes (sharpex-tenis datos) y el servicio challenger.

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE, ARCHIVE_FILES, TML, TML_FILES, TML_FROM } from './data.js';

const UA = 'Sharpex/0.3 (uso personal)';

// Se escribe aparte y se renombra: quien lea la carpeta a la vez nunca ve un fichero a medias
async function save(url, path) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv' }, signal: AbortSignal.timeout(60000) });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`respondió ${res.status}`);
  const tmp = `${path}.descargando`;
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  renameSync(tmp, path);
  return true;
}

/**
 * Baja a `dir` los CSV de los años [from, to].
 *  force: vuelve a bajar también los del archivo que ya están.
 * Devuelve { downloaded, kept, missing, failed }: un año que el archivo no tiene (404) no es un error; si falla
 * TennisMyLife, el modelo seguirá con lo que tenga y irá con retraso.
 */
export async function download({ dir, from = 2015, to = new Date().getFullYear(), force = false, log = () => {} }) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1968 || to < from) throw new Error('Años no válidos');
  mkdirSync(dir, { recursive: true });
  const out = { downloaded: [], kept: [], missing: [], failed: [] };
  for (let y = from; y <= to; y++) {
    for (const f of ARCHIVE_FILES(y)) {
      if (!force && existsSync(join(dir, f))) { out.kept.push(f); continue; }
      try {
        if (await save(`${ARCHIVE}/${f}`, join(dir, f))) { out.downloaded.push(f); log(f); } else out.missing.push(f);
      } catch (e) { out.failed.push(`${f} (${e.message})`); }
    }
  }
  // Lo reciente, con prefijo para no pisar los de Sackmann del mismo año
  for (let y = Math.max(from, TML_FROM); y <= to; y++) {
    for (const f of TML_FILES(y)) {
      try {
        if (await save(`${TML}/${f}`, join(dir, `tml_${f}`))) { out.downloaded.push(`tml_${f}`); log(`tml_${f}`); } else out.missing.push(`tml_${f}`);
      } catch (e) { out.failed.push(`tml_${f} (${e.message})`); }
    }
  }
  return out;
}
