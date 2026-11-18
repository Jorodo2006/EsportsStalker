// Lo que se ve sin cuenta: partidos, directo, fichas, estadísticas y cuotas de los cinco deportes (para que Google, y quien
// llegue de un buscador, vea la web antes de registrarse; AdSense no aprueba una web que es sólo una pantalla de entrada).
// Con cuenta, lo de cada usuario (apuestas, cartera, amigos, ajustes) y las recomendaciones del modelo.
// También la configuración pública (anuncios y datos del aviso legal, del .env) y el ads.txt de AdSense.

// Lecturas de los deportes, salvo las recomendaciones (/picks) y el motor de los Challenger
const SPORT_READ = /^\/api\/(esports|stats|basket|tennis|football|mma)\/(?!picks(\/|$))/;
// Cuotas: se piden con POST porque llevan el partido en el cuerpo, pero sólo leen. Leer cuotas a mano (/api/odds/jobs) pide cuenta
const ODDS_READ = /^\/api\/odds\/(match|board|history)$/;
// Entrar, registrarse y salir: abiertas como siempre
const AUTH = /^\/api\/auth\/(config|me|register|login|logout|google|google\/callback)$/;

// El panel de administración: el gateway exige sesión y administrador (index.js); aquí sólo se reconoce el prefijo
const isAdminPath = pathname => pathname === '/api/admin' || pathname.startsWith('/api/admin/');

function isPublic(method, pathname) {
  if (AUTH.test(pathname)) return true;
  if (method === 'GET') return SPORT_READ.test(pathname) || pathname === '/api/search' || pathname === '/api/settings/public' || pathname.startsWith('/api/public/');
  if (method === 'POST') return ODDS_READ.test(pathname) || pathname === '/api/football/photos';
  return false;
}

// Límite para quien no ha entrado: una página de partidos hace unas 30 peticiones; con 300 por minuto se navega sin notarlo,
// y un programa que lo descargue todo no deja sin servicio a los demás ni hace que las fuentes nos bloqueen
const LIMIT = 300, WINDOW = 60e3;
const hits = new Map();
function anonymousAllowed(ip, now = Date.now()) {
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW) { hits.set(ip, { start: now, n: 1 }); return true; }
  h.n++;
  return h.n <= LIMIT;
}
// Que el mapa no crezca sin fin
setInterval(() => { const now = Date.now(); for (const [ip, h] of hits) if (now - h.start > WINDOW) hits.delete(ip); }, WINDOW).unref();

// Los ajustes comunes que necesita la interfaz sin cuenta (moneda, casas y plazos de las lecturas, para decir desde cuándo
// habrá cuotas). Nada de credenciales ni del .env
const SAFE_SETTINGS = ['currency', 'featuredBooks', 'refreshSeconds', 'oddsAutoEnabled', 'oddsRefreshMinutes', 'oddsAutoHours', 'oddsFarEnabled', 'challengerOddsEnabled', 'signupOpen'];
const publicSettings = s => ({
  ...Object.fromEntries(SAFE_SETTINGS.filter(k => k in (s || {})).map(k => [k, s[k]])),
  initialBankroll: 0, favorites: [], favoriteLeagues: []
});

// ca-pub-1234567890123456: lo que da AdSense. Se acepta también sin el «ca-»
const clientOf = v => { const m = String(v || '').trim().match(/^(?:ca-)?(pub-\d{10,20})$/); return m ? `ca-${m[1]}` : null; };
const slotOf = v => (/^\d{6,20}$/.test(String(v || '').trim()) ? String(v).trim() : null);
const text = (v, max = 200) => String(v || '').trim().slice(0, max) || null;

function publicConfig(env = process.env) {
  const client = clientOf(env.ADSENSE_CLIENT);
  return {
    ads: client ? { client, slots: { rect: slotOf(env.ADSENSE_SLOT_RECT), half: slotOf(env.ADSENSE_SLOT_HALF) } } : null,
    // Quién es el responsable de la web (aviso legal y privacidad, LSSI y RGPD)
    legal: { owner: text(env.LEGAL_OWNER), nif: text(env.LEGAL_NIF, 20), address: text(env.LEGAL_ADDRESS), email: text(env.LEGAL_EMAIL, 120) }
  };
}

// ads.txt: dice qué vendedores pueden vender los anuncios de la web. f08c47fec0942fa0 es el identificador de Google en el IAB
function adsTxt(env = process.env) {
  const client = clientOf(env.ADSENSE_CLIENT);
  return client ? `google.com, ${client.slice(3)}, DIRECT, f08c47fec0942fa0\n` : '# Sin cuenta de AdSense configurada (ADSENSE_CLIENT en el .env)\n';
}

module.exports = { isPublic, anonymousAllowed, publicSettings, publicConfig, adsTxt, LIMIT, isAdminPath };
