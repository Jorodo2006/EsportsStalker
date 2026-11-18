// ¿Bloquea la red la casa? Algunas redes (la del instituto, con Cisco Umbrella) desvían por DNS las webs de apuestas a una página de
// bloqueo. El lector la abría, no veía partidos y decía "No encuentro el partido", que no era verdad: la lectura no podía funcionar
// desde ahí. Se mira antes de abrir nada y se dice lo que pasa. No se intenta saltar el bloqueo (regla 1 de AGENTS.md).
const dns = require('dns').promises;

const HOSTS = { winamax: 'www.winamax.es', betway: 'betway.es' };
const NAME = { winamax: 'Winamax', betway: 'Betway' };
// Páginas de bloqueo conocidas: Cisco Umbrella / OpenDNS (146.112.61.104-110) y los DNS que devuelven 0.0.0.0 o la propia máquina
const BLOCK_IPS = [/^146\.112\.61\.\d{1,3}$/, /^0\.0\.0\.0$/, /^127\.\d+\.\d+\.\d+$/, /^::1?$/];
const isBlockIp = ip => BLOCK_IPS.some(re => re.test(String(ip || '').replace(/^::ffff:/, '')));

const cache = new Map();
// null si se puede intentar; si no, el mensaje que enseñar. Se guarda 5 min: no hace falta preguntar al DNS en cada lectura
async function blocked(book, lookup = dns.lookup) {
  const host = HOSTS[book];
  if (!host) return null;
  const hit = cache.get(book);
  if (hit && Date.now() - hit.t < 5 * 60e3) return hit.v;
  let v = null;
  try {
    const list = await lookup(host, { all: true });
    if (list.length && list.every(a => isBlockIp(a.address))) {
      v = `La red de este equipo bloquea ${NAME[book]}: su DNS la manda a una página de bloqueo (${String(list[0].address).replace(/^::ffff:/, '')}). No es un fallo de la app: desde otra red sí se lee`;
    }
  } catch (e) {
    if (e && (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN')) v = `Este equipo no encuentra ${NAME[book]} en el DNS: sin internet, o la red la bloquea`;
  }
  cache.set(book, { t: Date.now(), v });
  return v;
}

module.exports = { blocked, isBlockIp };
