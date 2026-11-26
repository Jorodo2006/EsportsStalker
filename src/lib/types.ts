// Tipos de la interfaz (src/lib/api.ts implementa window.api) y de lo que devuelve el backend (server/)
import type { Reliability } from './value';

export type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'cashout' | 'halfwon' | 'halflost';

// Selección de una combinada
export type LegStatus = 'pending' | 'won' | 'lost' | 'void';
export type Sport = 'lol' | 'basket' | 'tennis' | 'football' | 'mma';
// A qué partido y mercado pertenece una apuesta o selección, para que el servidor la resuelva sola (server/services/bets/settle.js).
// key: la clave del comparador ("total|0||212.5", "player|Asistencias|naji marshall|2.5"); out: la selección ("over", "a", "x"…).
// settled: lo puso el servidor al resolverla; guessed: la reconoció por el texto (apuestas de antes)
export interface BetRef {
  sport: Sport; match: string; key: string; out: string; start?: string;
  guessed?: boolean; settled?: { at: string; text: string };
}
// Cuota de cierre (la última de la casa antes de empezar), la pone sólo el servidor (bets/closing.js) para el CLV. price null: se
// buscó y no la hay (el partido no se leyó cerca del inicio)
export interface BetClose { price: number | null; book: string }
export interface BetLeg { event: string; league: string; market: string; selection: string; odds: number; status: LegStatus; sport?: Sport; ref?: BetRef; close?: BetClose }
// En el boleto se guarda también la casa de donde salió la cuota
// Para volver a leer la cuota desde el cupón: el partido como lo pide el comparador, la clave del mercado y la selección.
// at: cuándo se leyó la cuota (o se añadió); was: la cuota de antes si al actualizar cambió; gone: la casa ya no ofrece la línea.
// Sólo vive en el cupón: no se guarda en la apuesta
export interface SlipLive {
  match: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string; event?: string };
  key: string; out: string; at?: number; was?: number; gone?: boolean;
  checked?: boolean; // ya se ha comparado con la última lectura guardada (al entrar en el cupón)
}
export type SlipLeg = BetLeg & { bookmaker?: string; live?: SlipLive };

export interface Bet {
  id: string;
  date: string; // YYYY-MM-DD
  sport?: Sport | 'mix'; // sin deporte es LoL; 'mix' = combinada con selecciones de varios deportes
  league: string;
  event: string;
  market: string;
  selection: string;
  bookmaker: string;
  odds: number;
  stake: number;
  status: BetStatus;
  cashout: number;
  notes: string;
  legs?: BetLeg[]; // combinada: 2 o más selecciones (cuota = producto, estado según las selecciones)
  ref?: BetRef; // simple: su partido y mercado, para resolverla sola
  close?: BetClose; // simple: su cuota de cierre
}

// Una recomendación del modelo tal y como se registra: su partido y mercado (como el ref de una apuesta), lo que decía
// (p, la probabilidad que enseña la app; pModel y pMarket, sus dos partes) y la cuota
export interface PredictionIn {
  sport: Sport; match: string; key: string; out: string; start: string; group: string; title: string; event: string; league: string;
  book?: string; price: number; p: number; pModel?: number | null; pMarket?: number | null; ev: number; rel?: number;
}
export interface PublicConfig {
  ads: { client: string; slots: { rect: string | null; half: string | null } } | null;
  legal: { owner: string | null; nif: string | null; address: string | null; email: string | null };
}
// Un favorito: se identifica por deporte y nombre; el escudo es para pintarlo
export interface Favorite { sport: Sport; name: string; logo?: string }
// Amigos (server/services/bets/friends.js): los aceptados, las solicitudes que te han hecho y las que has hecho tú
export interface Friend { id: string; username: string; since: string }
// De los aceptados, también los mensajes sin leer y cuándo fue lo último de la conversación
export interface FriendRow extends Friend { unread: number; last: string | null; preview: string | null }
// Avisos de cuotas (server/services/bets/alerts.js): caída o subida fuerte en lo tuyo, o recomendación nueva con valor.
// open: el partido que abre el aviso (sin id, sólo el deporte y el día)
export type OddsAlertKind = 'drop' | 'rise' | 'value' | 'news';
export interface OddsAlert { id: string; kind: OddsAlertKind; sport: Sport | ''; title: string; body: string; open: { sport: Sport; id?: string; date?: string } | null; created: string; read: boolean }
export interface AlertsList { list: OddsAlert[]; unread: number; push: { key: string | null; devices: number } }
// status y reason: lo que respondió el servicio de push (Apple, Google…) si no lo aceptó; gone: dio el dispositivo por caducado
export interface PushTestResult { ok: boolean; missing?: boolean; gone?: boolean; status?: number; reason?: string }
export type OddsAlertPrefs = Record<OddsAlertKind, boolean>;
// Lo del cupón que vigila el servidor: el partido con los nombres del comparador, la clave del mercado y la selección
export interface OddsWatch { sport: Sport; a: string; b: string; key: string; out: string; id?: string; date?: string }
export interface FriendsList { friends: FriendRow[]; incoming: Friend[]; outgoing: Friend[] }
// Una apuesta que te ha enviado un amigo: lo apostado (sin su importe ni sus notas)
export type SharedBetData = Pick<Bet, 'sport' | 'date' | 'league' | 'event' | 'market' | 'selection' | 'bookmaker' | 'odds' | 'legs' | 'ref'>;
// Cómo va ahora la apuesta original (status null: no se sabe) y, en una combinada, cada selección. open: se puede copiar,
// porque no está resuelta (server/services/bets/friends.js, stateOf)
export interface SharedState { status: BetStatus | null; legStatus: LegStatus[] | null; open: boolean }
export interface SharedBet extends SharedState { id: string; from: string; bet: SharedBetData; note: string; created: string; seen: boolean; copied: boolean }
// La conversación con un amigo: mensajes y apuestas pasadas, por fecha (mine: lo has enviado tú)
export type ChatItem =
  | { kind: 'msg'; id: string; mine: boolean; body: string; created: string; read: boolean }
  | ({ kind: 'bet'; id: string; shareId: string; mine: boolean; bet: SharedBetData; note: string; created: string; copied: boolean } & SharedState);
export interface PredictionRow {
  // closePrice: la cuota de cierre de la casa (la última antes de empezar, del histórico; bets/closing.js); null si no se leyó cerca
  sport: Sport; group: string; league: string; book: string; price: number; firstPrice: number; closePrice: number | null; p: number; pModel: number | null;
  pMarket: number | null; ev: number; rel: number | null; status: 'won' | 'lost' | 'void'; start: string; title: string; event: string; result: string | null;
}
// Lo que falta por resolver, por lo que le pasa: por jugar, en juego (menos de 2 h), acabadas esperando resultado y sin poder
// resolver en 4 días (fuera de las cuentas). oldestWaiting: el partido más antiguo de las que esperan resultado
export interface PredictionQueue { resolved: number; upcoming: number; playing: number; waiting: number; unknown: number; oldestWaiting: string | null }
export interface PredictionReport { pending: number; unknown: number; since: string | null; queue: PredictionQueue & { bySport: Partial<Record<Sport, PredictionQueue>> }; rows: PredictionRow[] }

// fromSlip: la combinada viene del boleto (se vacía al guardarla)
export type BetDraft = Partial<Bet> & { fromSlip?: boolean };
// Lo leído de la captura de un ticket: el borrador y, por selección, si se ha enlazado a su partido (y si no, por qué)
export interface TicketScan {
  book: string; kind: 'single' | 'combo' | 'builder'; draft: BetDraft; warnings: string[];
  legs: { linked: boolean; text: string; game: string | null; why: string | null }[];
}

export interface Settings {
  currency: string;
  initialBankroll: number;
  unitSize?: number; // lo que vale una unidad (Mis apuestas); 0 = el 1 % de la banca inicial (useUnit)
  welcomed?: boolean; // la cuenta ya vio la bienvenida (Welcome.tsx)
  featuredBooks: string;
  leaguepediaUser: string;
  leaguepediaPassword: string;
  lolesportsKey: string;
  refreshSeconds: number;
  favoriteLeagues: string[];
  favorites?: Favorite[]; // equipos, jugadores y luchadores que sigue el usuario (components/Favorites.tsx)
  marketAliases?: Record<string, string>; // mercados que el usuario ha enseñado: { texto sin acentos: mercado de la app } (MarketHint)
  oddsAutoEnabled: boolean; // lecturas de cuotas programadas (las hace el lector de Docker)
  oddsFarEnabled: boolean; // leer también, más espaciados, los partidos de hasta 48 h
  challengerOddsEnabled?: boolean; // leer los Challenger: una vez hasta 12 h antes y la de cierre
  signupOpen: boolean; // si se pueden crear cuentas nuevas (lo cambia el administrador)
  oddsRefreshMinutes: number; // cada cuántos minutos se vuelve a leer cada partido
  oddsAutoHours: number; // partidos que empiezan en las próximas N horas
  envKeys?: (keyof Settings)[]; // ajustes que vienen del fichero .env (sus valores no llegan a la interfaz)
  envFile?: string | null;
}

export interface League { id: string; slug: string; name: string; region: string; image: string; priority: number }

export interface MatchTeam {
  name: string; code: string; image: string;
  wins: number | null; outcome: 'win' | 'loss' | null; record: string;
}

export interface MatchEvent {
  id: string;
  startTime: string;
  state: 'unstarted' | 'inProgress' | 'completed';
  blockName: string;
  league: string;
  leagueSlug: string;
  bestOf: number | null;
  teams: MatchTeam[];
}

export interface Schedule { events: MatchEvent[]; older: string | null; newer: string | null }

export interface EventDetails {
  id: string;
  league: string;
  teams: { id: string; name: string; code: string; image: string; wins: number }[];
  games: { id: string; number: number; state: 'unstarted' | 'inProgress' | 'completed' | 'unneeded'; vods: number }[];
}

export interface LivePlayer {
  name: string; champion: string; role: string; level: number; kills: number; deaths: number; assists: number;
  cs: number; gold: number; hp: number; maxHp: number;
}

export interface LiveSide {
  teamId: string | null; gold: number; kills: number; towers: number; inhibitors: number; barons: number;
  dragons: string[]; players: LivePlayer[];
}

export interface LiveWindow {
  patch: string; state: 'in_game' | 'paused' | 'finished'; timestamp: string; firstTimestamp: string;
  blue: LiveSide; red: LiveSide;
}

export interface PlayerHit { id: string; page: string; realName: string; team: string; role: string; country: string; retired: boolean }

export interface PlayerGame {
  player: string; team: string; champion: string; role: string; kills: number; deaths: number; assists: number;
  cs: number; gold: number; damage: number; win: boolean; date: string; tournament: string; side: string;
}

export interface TeamGame {
  team1: string; team2: string; winner: string; date: string; tournament: string; length: string; k1: string; k2: string;
}

export interface TeamHit { name: string; page: string; short: string; region: string; disbanded: boolean }
export interface RosterPlayer { id: string; page: string; role: string; country: string }

// Últimas partidas de cada jugador con su equipo actual (Leaguepedia), lo más reciente primero
export interface FormGame { k: number; d: number; a: number; win: boolean; date: string }
export interface TeamForm { team: string; players: { name: string; link: string; role: string; games: FormGame[] }[] }

export interface MarketOutcome { id: string; label: string; prices: Record<string, number> }

export interface MarketLine {
  key: string;
  group: string; // "Ganador del partido", "Mapa 1 · Total de kills"…
  period: number; // 0 = partido, 1..5 = mapa, 50 = otros, 99 = especiales
  line: number | null;
  main: boolean;
  outcomes: MarketOutcome[];
}

// Una cuota de una casa desde ts hasta last_seen (book en minúsculas: "betway"; market_key y outcome_id, los del comparador)
export interface PriceHistoryRow { book: string; market_key: string; outcome_id: string; line: number | null; price: number; ts: number; last_seen: number }

export interface MatchOdds {
  books: string[];
  markets: MarketLine[];
  sources: Record<string, { ok: boolean; msg: string; ts?: number }>;
}

export interface TeamRef { name: string; code: string; alt?: string[] } // alt: otros nombres del equipo en las casas

// Trabajo del botón "Actualizar cuotas" (lo hace la extensión de Chrome)
export interface AutoJob {
  id: string;
  match: { a: TeamRef; b: TeamRef };
  books: string[];
  source?: 'manual' | 'auto'; // botón "Actualizar cuotas" o lectura programada
  created: number;
  picked: boolean;
  done: boolean;
  error?: string;
  steps: Record<string, { estado: 'esperando' | 'buscando' | 'leyendo' | 'ok' | 'error'; msg: string }>;
}

// Estado de las lecturas programadas (pantalla de Ajustes)
export interface AutoStatus {
  enabled: boolean;
  minutes: number;
  hours: number;
  lastRun: number | null; // última pasada del programador
  error: string | null;
  matches: { id: string; league: string; start: string; a: TeamRef; b: TeamRef }[]; // partidos cercanos que entran ahora
  far: number; // partidos más lejanos que se leen más espaciados
  challengerEnabled?: boolean;
  challenger?: number; // Challenger con lecturas programadas (de las próximas 12 h o con retraso)
  queued: number; // trabajos esperando al lector
  running: number;
  lastPoll: number | null; // última vez que el lector preguntó si había trabajo (null: no lo ha visto)
}

// true si responde cada pieza del backend
export type BackendStatus = { gateway: boolean; bets: boolean; esports: boolean; odds: boolean; basket?: boolean; tennis?: boolean; football?: boolean; mma?: boolean; challenger?: boolean };

// ---------- Fútbol (servicio football: ESPN) ----------
export type FootballLeagueId = 'laliga' | 'champions' | 'premier' | 'seriea' | 'bundesliga' | 'ligue1' | 'europa' | 'conference' | 'segunda' | 'copa' | 'nations' | 'amistosos' | 'wchampions' | 'ligaf' | 'wsl';
// Una noticia unida a los equipos de un partido (server/shared/news.js). seen_at: cuándo la vio Sharpex. teams: claves de los
// equipos (fútbol: id de ESPN; baloncesto: «nba:19»).
// tags: baja, duda, vuelve, sancion, rotacion, alineacion, entrenador
// La noticia en la que se basa algo (una baja, una recomendación). seen_at: cuándo la vio Sharpex
// Reajuste diario del modelo de baloncesto (server/services/bets/tuning.js). ll: pérdida logarítmica en los días de prueba con el peso
// de antes, el nuevo, la casa sola y el modelo solo
export interface ModelTuningRow {
  day: string; kind: 'player' | 'team'; prev: number; fit: number; w: number; applied: boolean; reason: string; nFit: number; nTest: number;
  ll: { prev: number | null; next: number | null; market: number | null; model: number | null };
}
// feed: las líneas de baloncesto guardadas por día de partido de las dos últimas semanas (de lo que aprende el reajuste)
export interface ModelWeights { player: number; team: number; updated: string | null; history: ModelTuningRow[]; feed?: { day: string; n: number; resolved: number }[] }
export interface NewsBasis { title: string; source: string; url: string; published: string; seen_at: string }
// Lo que dice una noticia de un jugador (shared/news.js, playerStatuses)
export type PlayerNewsStatus = 'out' | 'doubt' | 'injured' | 'suspended' | 'back';
export interface PlayerNews { name: string; team: string; status: PlayerNewsStatus }
export interface NewsItem {
  id: string; source: string; url: string; title: string; summary: string; published: string; seen_at: string;
  teams: string[]; players: string[]; tags: string[]; outs: PlayerNews[];
}
export interface FootballLeague { id: FootballLeagueId; name: string; country: string; logo: string }
// form: últimos resultados (G, E o P); record: ganados-empatados-perdidos en la competición; color y alt: los del equipo, sin #
export interface FootballTeam {
  id: string; name: string; short: string; abbr: string; logo: string; color: string | null; alt: string | null;
  score: number | null; winner: boolean; form: string; record: string; alts: string[];
}
export type FootballEventKind = 'goal' | 'penalty' | 'owngoal' | 'missed' | 'yellow' | 'red' | 'sub';
// other: en los goles, quien da la asistencia; en los cambios, el que sale
export interface FootballEvent { kind: FootballEventKind; minute: string; team: string; player: string; other?: string }
export interface FootballMatch {
  id: string; league: FootballLeagueId; leagueName: string; date: string; state: 'pre' | 'in' | 'post'; status: string; off: boolean;
  stage: string; venue: string; city: string; neutral?: boolean; home: FootballTeam; away: FootballTeam; incidents: FootballEvent[];
}
export interface FootballPlayer { id: string; name: string; number: string; pos: string; starter: boolean; subIn: boolean; subOut: boolean; place: number | null }
export interface FootballLineup { team: string; formation: string; players: FootballPlayer[] }
export interface FootballPastGame { id: string; date: string; result: 'G' | 'E' | 'P' | ''; score: string; home: boolean; league: string; opponent: { id: string; name: string; logo: string }; team?: string }
// Un tiro: x de 0 a 100 hacia la portería rival (100 es su línea de gol), y de 0 a 100 a lo ancho (lo bajo es la derecha
// del que tira); x2/y2, hasta dónde llegó. kind: gol, parado (a puerta), fuera o bloqueado
export interface FootballShot {
  kind: 'goal' | 'saved' | 'off' | 'blocked'; team: string; player: string; minute: string; header: boolean; penalty: boolean;
  x: number; y: number; x2: number | null; y2: number | null;
}
export interface FootballDetail {
  match: FootballMatch; timeline: FootballEvent[]; stats: Record<string, Record<string, number | null>>; lineups: FootballLineup[]; shots: FootballShot[];
  form: Record<string, FootballPastGame[]>; h2h: FootballPastGame[]; attendance: number | null; hasStandings: boolean;
}
export interface FootballStandingRow {
  rank: number | null; team: { id: string; name: string; abbr: string; logo: string }; played: number; won: number; drawn: number; lost: number;
  gf: number; ga: number; gd: number; points: number; zone: { color: string; text: string } | null;
}
export interface FootballGroup { name: string; rows: FootballStandingRow[] }

// ---------- Tenis (servicio tennis: ESPN, ATP y WTA individuales) ----------
export type Tour = 'atp' | 'wta';
export interface TennisPlayer {
  id: string; name: string; short: string; flag: string; country: string; seed: number | null; rank: number | null;
  sets: number[]; setWins: boolean[]; tiebreaks: (number | null)[]; winner: boolean; alt: string[];
  entry?: string | null; // Challenger: cómo entró al cuadro, de ProTennisLive ('PR' ranking protegido, 'WC', 'Q'…)
  // Dobles: el lado es una pareja (name "Orlando Luz / Rafael Matos", short "Luz / Matos") y aquí van sus dos jugadores
  players?: { name: string; short: string; flag: string; country: string }[];
}
// Estadísticas de un jugador en un partido (server/services/tennis/matchstats.js); null si la fuente no lo da
export interface TennisStatSide {
  aces: number | null; df: number | null; servePts: number | null; firstIn: number | null; firstWon: number | null; secondWon: number | null;
  bpConv: number | null; bpChances: number | null; bpSaved: number | null; bpFaced: number | null; serveGames: number | null; totalPts: number | null;
}
export interface TennisMatchStats {
  source: string; live: boolean; minutes?: number | null;
  total: { a: TennisStatSide; b: TennisStatSide } | null;
  sets: { n: number; time: string | null; a: TennisStatSide; b: TennisStatSide }[];
}
export interface TennisMatch {
  id: string; tour: Tour; tournament: string; tournamentId: string; major: boolean; date: string; state: 'pre' | 'in' | 'post';
  status: string; round: string; court: string; city: string; bestOf: number; note: string; a: TennisPlayer; b: TennisPlayer;
  points?: TennisPoints | null; // sólo en juego, si cuadra con los juegos de ESPN
  level?: 'challenger'; // ATP Challenger (LiveScore): sin modelo, recomendaciones ni fichas de jugador
  fixed?: string; // el rival de ESPN no cuadraba con LiveScore y se ha cambiado (checkRivals en el servicio): qué daba cada uno
  // Dobles (server/services/tennis/doubles.js, id "dbl:…"): sin modelo, recomendaciones ni fichas, y sus cuotas sólo se leen a mano.
  // mtb: el tercer set es un super tie-break (llega como un set 1-0 con los puntos en tiebreaks)
  doubles?: true; mtb?: true;
}
// Puntos del juego en curso: "15", "40", "AD"; en el tie-break, los que lleven. at: cuándo cambiaron por última vez (ms); source: de dónde salen
export interface TennisPoints { a: string; b: string; server: 'a' | 'b' | null; tiebreak: boolean; at: number; source: string }
export interface TennisRank { rank: number; previous: number; points: number; trend: string; id: string; name: string; short: string; flag: string; country: string }

// Recomendaciones de un partido (modelo + cuotas). p, pModel y pMarket van de 0 a 1; ev es el valor esperado por unidad
export interface TennisPick {
  id: string; title: string; market: string; selection: string; family: string; side: 'a' | 'b' | null; who?: 'a' | 'b' | null; book: string; price: number; prices: Record<string, number>;
  p: number; pModel: number; pMarket: number; fair: number; ev: number; rel: Reliability; why: string;
}
// Un partido de un tenista en TennisMyLife (GET /api/tennis/gamelog), desde su lado. date: el lunes de la semana del torneo (no da
// el día). Las estadísticas de saque son null si el partido no las tiene; breaks: los que hizo él
export interface TennisLogMatch {
  id: string; date: string; tournament: string; surface: TennisSurface | null; level: string; round: string; bestOf: number;
  opp: string; oppRank: number | null; win: boolean; score: string; retired: boolean; minutes: number | null;
  gamesWon: number; gamesLost: number; setsWon: number; setsLost: number; tbWon: number; tbLost: number;
  aces: number | null; df: number | null; svpt: number | null; firstIn: number | null; firstWon: number | null; secondWon: number | null; svGms: number | null;
  bpFaced: number | null; bpSaved: number | null; breaks: number | null; oppAces: number | null;
}
export interface TennisGamelog { source: string; updated: string | null; found: boolean; matches: TennisLogMatch[] }
// Los mercados del perfil del tenista (pestaña Líneas): sus juegos, los del partido, su hándicap, sus aces, sus sets y sus dobles
// faltas (de estas sólo el histórico: ni el modelo ni las casas)
export type TennisLineMarket = 'games' | 'total' | 'spread' | 'aces' | 'sets' | 'df';
export type TennisModelMarket = Exclude<TennisLineMarket, 'df'>;
// Su próximo partido y lo que espera el modelo (GET /api/tennis/picks/player): next null si no juega en 7 días; ready false si ya
// ha empezado. ladders: la probabilidad de superar cada línea (en el hándicap, de cubrirlo); picks: sus líneas de las casas
export interface TennisPlayerLines {
  next: TennisMatch | null; side?: 'a' | 'b'; ready?: boolean; reason?: string;
  surface?: TennisSurface | null; bestOf?: number; withOdds?: boolean; oddsAge?: number | null; known?: boolean; pWin?: number; weight?: number;
  expected?: Record<TennisModelMarket, number>; ladders?: Record<TennisModelMarket, { line: number; p: number }[]>; picks?: TennisPick[]; warnings?: string[];
}
// summary: el partido según el modelo (pModel, pElo, pStats), las casas (pMarket) y la mezcla (pFinal), todo para el jugador a.
// picks: las líneas de las casas que el servicio no descarta; la interfaz las separa por riesgo (lib/tennis-picks.ts)
export interface TennisMatchPicks {
  surface: TennisSurface | null; indoor: boolean; bestOf: number; oddsAge: number;
  summary: { pModel: number; pElo: number; pStats: number; pMarket: number | null; pFinal: number; expectedGames: number; holdA: number; holdB: number; weight: number };
  picks: TennisPick[]; considered: number; warnings: string[];
  // La más fiable, las fáciles y las complicadas según el servicio: son las que se registran para medir el acierto (lib/predictions.ts)
  top: TennisPick | null; easy: TennisPick[]; hard: TennisPick[];
}
// Recomendaciones de fútbol (server/services/football/picks.js): las mismas piezas que las de tenis. who: de qué equipo es la
// línea (goles de un equipo) o a quién favorece
export type FootballPick = TennisPick & { who?: 'a' | 'b' | null };
export interface FootballPicks {
  ready: boolean; reason?: 'started' | 'finished' | 'noodds' | 'nomodel'; oddsAge?: number;
  match?: { home: number; draw: number; away: number; pMarketHome: number | null; goalsHome: number; goalsAway: number; weight: number; fav: 'a' | 'b'; pFav: number };
  all?: FootballPick[]; top?: FootballPick | null; easy?: FootballPick[]; hard?: FootballPick[]; considered?: number; warnings?: string[];
  // Cómo están los jugadores según las noticias de las últimas 48 h; removed: se han quitado sus líneas (no juega o sancionado)
  basis?: (PlayerNews & { removed: boolean; news: NewsBasis })[];
}

// ---------- MMA (servicio mma: UFC y PFL de ESPN, WOW de wowmma.com) ----------
export type MmaOrg = 'ufc' | 'pfl' | 'wow';
export interface MmaLeague { id: MmaOrg; name: string; logo: string; source: 'espn' | 'wow' }
// a: esquina roja (el primero del cartel); b: esquina azul. age, weightKg y heightM sólo los da WOW
export interface MmaFighter {
  id: string; name: string; short: string; country: string; flag: string; record: string; photo: string; alt: string[];
  age?: number | null; weightKg?: number | null; heightM?: number | null;
}
export type MmaMethod = 'ko' | 'sub' | 'dec' | 'other' | '';
export interface MmaResult { winner: 'a' | 'b' | null; method: MmaMethod; round: number | null; time: string; draw: boolean; noContest: boolean }
export interface MmaFight {
  id: string; org: MmaOrg; orgName: string; event: string; eventId: string; date: string; state: 'pre' | 'in' | 'post'; status: string;
  weightClass: string; title: boolean; rounds: number; cardPos: number; venue: string; city: string; cancelled?: boolean;
  a: MmaFighter; b: MmaFighter; result?: MmaResult;
}
export interface MmaHistoryRow { id: string; date: string; org: MmaOrg; event: string; opponent: { id: string; name: string }; result: 'G' | 'P' | 'E' | 'N'; method: MmaMethod; round: number | null; time: string }
// Ficha de un luchador de ESPN (GET /api/mma/profile): medidas en métrico, KO y sumisiones ganados y estilo. null: ESPN no lo da
export interface MmaProfile {
  age: number | null; heightCm: number | null; reachCm: number | null; weightKg: number | null; stance: string; country: string;
  wins: number | null; losses: number | null; draws: number | null; kos: number | null; subs: number | null; decisions: number | null; titleWins: number | null;
  strikesPerMin: number | null; strikeAccuracy: number | null; takedownAvg: number | null; submissionAvg: number | null;
}
// Ranking por Elo del modelo (no es el oficial de ninguna organización): luchadores activos con al menos 5 combates
export interface MmaRank { id: string; rank: number; name: string; record: string; org: MmaOrg; elo: number; fights: number; lastDate: string }
export interface MmaFighterCard {
  id: string; name: string; record: string; rating: { elo: number; fights: number; lastDate: string } | null;
  stats: { fights: number; wins: number; losses: number; streak: number; methods: { ko: number; sub: number; dec: number } | null };
  history: MmaHistoryRow[];
}
// Recomendaciones (server/services/mma/picks.js): las mismas piezas que las de tenis y fútbol
export type MmaPick = TennisPick & { who?: 'a' | 'b' | null };
export interface MmaPred { pA: number; pB: number; method: { ko: number; sub: number; dec: number }; goesDistance: number; reliability: 'alta' | 'media' | 'baja' }
export interface MmaPicks {
  ready: boolean; reason?: 'started' | 'finished' | 'noodds'; pred?: MmaPred;
  match?: { pModel: number; pMarket: number | null; pFinal: number; weight: number };
  all?: MmaPick[]; top?: MmaPick | null; easy?: MmaPick[]; hard?: MmaPick[]; considered?: number; warnings?: string[];
}
// Una línea del escáner: el combate y lo que el modelo calcula de ella
export interface MmaLineRow { id: string; org: MmaOrg; orgName: string; date: string; a: MmaFighter; b: MmaFighter; pick: MmaPick }
export interface MmaDayPick { id: string; org: MmaOrg; orgName: string; date: string; a: MmaFighter; b: MmaFighter; top: MmaPick; hard: MmaPick | null }
// Buscador (GET /api/search): partidos de ayer a dentro de una semana y competiciones de los cuatro deportes. team: encaja por
// equipo o jugador (no sólo por la competición). event: en LoL, el partido entero para abrirlo
export interface SearchMatch {
  sport: Sport; id: string; home: string; away: string; league: string; stage: string; date: string; state: 'pre' | 'in' | 'post';
  status: string; score: string | null; team: boolean; event?: MatchEvent;
}
export interface SearchCompetition { sport: Sport; id: string; name: string; sub: string; next: string | null }
export interface SearchResults { matches: SearchMatch[]; competitions: SearchCompetition[] }
export interface FootballDayPick { id: string; league: FootballLeagueId; leagueName: string; date: string; home: FootballTeam; away: FootballTeam; top: FootballPick; hard: FootballPick | null }
// Una línea del escáner: el partido y lo que el modelo calcula de ella
export interface FootballLineRow { id: string; league: FootballLeagueId; leagueName: string; date: string; home: FootballTeam; away: FootballTeam; pick: FootballPick }
export interface TennisDayPick { id: string; tour: Tour; tournament: string; round: string; date: string; a: TennisPlayer; b: TennisPlayer; top: TennisPick; hard: TennisPick | null }
export type TennisPicks = ({ ready: true } & TennisMatchPicks) | { ready: false; reason: 'started' | 'finished' | 'noodds' };
// Las recomendaciones de los partidos de un día (day, en hora de España) y los que todavía no tienen cuotas
export interface TennisBoardMatch extends TennisMatchPicks { m: TennisMatch; day: string }
export interface TennisBoard { matches: TennisBoardMatch[]; noOdds: { id: string; date: string; a: string; b: string }[] }

// Recomendaciones de los Challenger (servicio challenger, fase 3 del motor: server/sharpex-tenis/src/picks.js). En cada partido,
// las probabilidades son del jugador a; en cada pick, de su jugador. tipo 'probabilidad': alta probabilidad, sin ventaja sobre la
// casa; 'valor': valor esperado mínimo por tramo, que no se enseña mientras valorVisible sea false (se registra para medirlo)
export type ChallengerAviso = 'local' | 'pocos_datos' | 'datos_viejos' | 'ranking_protegido' | 'retirada_reciente' | 'tmo_reciente';
export interface ChallengerPick {
  tipo: 'valor' | 'probabilidad'; tramo: 'baja' | 'media' | 'alta'; lado: 'a' | 'b'; jugador: string; p: number; pModelo: number; pCasa: number;
  valor: number; cuota: number; casa: string; fiabilidad: number; avisos: ChallengerAviso[]; visible: boolean;
}
export interface ChallengerMatchPicks {
  id: string; fecha: string; torneo: string; ronda: string; a: string; b: string; superficie: TennisSurface; superficieConocida: boolean;
  partidosJugados: [number, number] | null; modelo: number | null; casa: number | null; final: number | null; fiabilidad: Reliability | null;
  factores: {
    weeks5: [number, number]; lastWeek: [number, number]; home: [number | null, number | null]; venue: string | null; stale: boolean;
    retire?: [number, number]; recentRet?: [boolean, boolean]; pr?: [boolean, boolean];
  } | null;
  // quien: de qué jugador es cada aviso; retirada: probabilidad de que se retire cada uno (fase 4); entradas: cómo entró cada uno al cuadro
  avisos: ChallengerAviso[]; quien?: Partial<Record<ChallengerAviso, ('a' | 'b')[]>>; retirada?: { a: number; b: number; total: number };
  entradas?: [string | null, string | null]; descartado: 'sin_modelo' | 'sin_cuotas' | 'pocos_datos' | 'discrepancia' | 'ninguna' | null; picks: ChallengerPick[];
}
export interface ChallengerDay { fecha: string; peso: number; valorVisible: boolean; modelo: { ultimoPartido: string | null }; partidos: ChallengerMatchPicks[] }

// Ficha de un tenista: datos personales, balance y últimos resultados
// El circuito de la ficha de un jugador: los de los Challenger no la tienen en ESPN y salen de TennisMyLife, con su nombre como id
export type SheetTour = Tour | 'challenger';
export interface TennisRecord { won: number; lost: number; titles: number; doublesTitles: number; prize: number }
export interface TennisResult {
  id: string; date: string; tournament: string; major: boolean; round: string; city: string; win: boolean; score: string; note: string;
  sets: number; games: number; opponent: { id: string; name: string; flag: string; rank: number | null };
  // La superficie del torneo (null si no se sabe) y, en los de TennisMyLife, su nivel ('C' Challenger, 'A' ATP, 'G' Grand Slam…)
  surface?: TennisSurface | null; level?: string;
}
export interface TennisProfile {
  id: string; tour: SheetTour; name: string; photo: string; photoFrom: string; flag: string; country: string; rank: number | null; previous: number | null; points: number | null;
  age: number | null; birthDate: string | null; birthPlace: string; height: string; weight: string; hand: string; years: number | null; debut: number | null; active: boolean;
  year: number; season: TennisRecord | null; lastSeason: TennisRecord | null; career: TennisRecord | null; matches: TennisResult[];
}

// Estadísticas de juego (TennisMyLife): los porcentajes van de 0 a 1 y son null si no hay datos
export type TennisSurface = 'Hard' | 'Clay' | 'Grass';
export interface TennisStatBlock {
  matches: number; won: number; lost: number; winPct: number | null; statMatches: number;
  gamesWon: number; gamesLost: number; gamesPct: number | null; gamesPerMatch: number | null; gamesWonPerMatch: number | null; gamesLostPerMatch: number | null;
  setsWon: number; setsLost: number; setsPct: number | null; tbWon: number; tbLost: number; tbPct: number | null; minutesPerMatch: number | null;
  aces: number; df: number; acesPerMatch: number | null; dfPerMatch: number | null; acePct: number | null; dfPct: number | null;
  firstInPct: number | null; firstWonPct: number | null; secondWonPct: number | null; servePtsPct: number | null; holdPct: number | null; bpSavedPct: number | null; bpFacedPerMatch: number | null;
  acesAgainstPerMatch: number | null; ret1Pct: number | null; ret2Pct: number | null; retPtsPct: number | null; breakPct: number | null; bpConvPct: number | null; bpChancesPerMatch: number | null; totalPtsPct: number | null;
}
export interface TennisWinLoss { won: number; lost: number; winPct: number | null }
export interface TennisStatPeriod {
  key: string; label: string; total: TennisStatBlock; surfaces: Record<TennisSurface, TennisStatBlock>; tour: Record<TennisSurface | 'all', TennisStatBlock>; best: TennisSurface | null; worst: TennisSurface | null;
  vs: { top10: TennisWinLoss; top11to50: TennisWinLoss; rest: TennisWinLoss }; levels: { grandSlam: TennisWinLoss; masters: TennisWinLoss; others: TennisWinLoss; challenger?: TennisWinLoss };
}
export interface TennisStats { source: string; updated: string | null; minSurface: number; found: boolean; periods: TennisStatPeriod[] }

// ---------- Baloncesto (servicio basket: ESPN para NBA/WNBA, API de la Euroliga para Euroliga/EuroCup) ----------
export type BasketLeagueId = 'nba' | 'wnba' | 'euroleague' | 'eurocup' | 'nbl';
export interface BasketLeague { id: BasketLeagueId; name: string; country: string; logo: string }
export interface BasketSide { id: string; abbr: string; name: string; logo: string; score: string | null; record: string; alt?: string[] }
export interface BasketGame {
  id: string; league: BasketLeagueId; date: string; state: 'pre' | 'in' | 'post'; status: string; clock: string; round?: string;
  home: BasketSide; away: BasketSide;
  // NBA: partido de la NBA Cup (fase de grupos o eliminatoria) y pista neutral (sin ventaja de campo: Las Vegas, otros países)
  cup?: 'group' | 'ko'; neutral?: boolean;
}
export interface BasketRosterPlayer { id: string; name: string; pos: string; jersey: string; headshot: string; injury: string | null }
// Clasificación y ficha de equipo
export interface BasketStanding {
  id: string; abbr: string; name: string; logo: string; pos: number; seed: number | null; w: number; l: number; pct: number; home: string; road: string; last: string;
  streak: string; pf: number | null; pa: number | null; diff: number | null; gb: string; form: string[];
}
export interface BasketGroup { name: string; teams: BasketStanding[] }
export interface BasketTeamSide { me: boolean; abbr: string; name: string; logo: string; score: string | null; winner: boolean }
export interface BasketTeamGame { id: string; date: string; state: string; home: boolean; us: BasketTeamSide; them: BasketTeamSide }
export interface BasketTeamPlayer {
  id: string; name: string; pos: string; jersey: string; headshot: string; age: number | null; height: string; weight: string; from: string; years: number | null; salary: number | null;
  injury: string | null; injuryDetail: string; injuryReturn: string | null; avg: { pts?: number; reb?: number; ast?: number; min?: number } | null;
}
export interface BasketTeamInfo {
  id: string; league: BasketLeagueId; name: string; abbr: string; logo: string; color: string; coach: string; venue: string; capacity: number | null; city: string; country: string;
  president: string; website: string; division: string; group: string; standing: BasketStanding | null; stats: { label: string; value: string; group?: string }[];
  leaders: { label: string; players: { id: string; name: string; value: string }[] }[]; results: BasketTeamGame[]; upcoming: BasketTeamGame[]; roster: BasketTeamPlayer[];
}
// Colores de un equipo ("#552583"); alt puede faltar
export interface BasketTeamColor { color: string; alt: string | null }
// news: la noticia en la que se basa una baja que todavía no da ESPN (/api/basket/injuries la añade si la prensa dice que no juega)
export interface BasketInjury { playerId: string | null; name: string; teamId: string; team: string; status: string; detail: string; returnDate: string | null; news?: NewsBasis }
export interface BasketPlayerHit { id: string; league: BasketLeagueId; name: string; team: string; teamId?: string; pos: string; headshot: string }
// Un partido de un jugador (lo más reciente primero en BasketGamelog.games)
export interface BasketLogGame {
  id: string; date: string; season: number; type: 'reg' | 'post' | 'pre'; home: boolean | null; opp: string;
  team: string | null; teamId: string | null; result: string; score: string;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg3m: number;
  cup?: 'group' | 'ko'; // NBA Cup: fase de grupos o eliminatoria (de eventNote de ESPN; los registros guardados antes no lo llevan)
}
export interface BasketGamelog { currentSeason: number; games: BasketLogGame[] }
// Un partido reciente de su equipo que no jugó, con el motivo (sólo NBA y WNBA)
// Descanso de un equipo antes de un partido: noches libres desde el anterior (0 = B2B), partidos en las 4 últimas noches
export interface BasketRest { teamId: string; days: number | null; b2b: boolean; in4: number; prev: { date: string; opp: string; home: boolean } | null; nextB2b: boolean }
export interface BasketAbsence { id: string; date: string; home: boolean; opp: string; reason: string }
// Plantilla con los partidos de cada jugador (escáner de líneas)
export interface BasketTeamLogs { currentSeason: number; players: (BasketRosterPlayer & { games: BasketLogGame[] })[] }
// Partidos terminados de una liga con sus parciales (q: un valor por cuarto y prórroga), de más reciente a más antiguo
export interface BasketPointSide { id: string; pts: number; q: number[] }
export interface BasketPointGame { id: string; date: string; season: number; type: 'reg' | 'post'; home: BasketPointSide; away: BasketPointSide }
export interface BasketLeagueGames { currentSeason: number; teams: Record<string, { abbr: string; name: string; logo: string }>; games: BasketPointGame[] }
// Cómo fue un partido: el marcador tras cada canasta (t: minutos jugados; a: visitante, b: local), cambios de líder, empates,
// mayor ventaja y mayor parcial de cada uno. available: false sin jugada a jugada (Euroliga)
export interface BasketFlow {
  available: boolean; periodLen?: number; periods?: number; points?: { t: number; a: number; b: number; per: number }[];
  leadChanges?: number; ties?: number; maxLead?: { a: number; b: number }; runs?: { a: { pts: number; per: number }; b: { pts: number; per: number } };
}
// Un partido acabado de un equipo de fútbol, con sus goles primero
export interface FootballTeamGame { id: string; date: string; home: boolean; gf: number; ga: number; opp: { id: string; name: string; logo: string }; league: string }
// Estadísticas de un partido: por equipo, puntos por cuarto, jugadores y totales; series = enfrentamientos de la temporada
// oreb/dreb: rebotes ofensivos y defensivos; pf: faltas personales
export interface BoxLine { min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg: string; fg3: string; ft: string; pm: string; oreb?: number; dreb?: number; pf?: number }
// El partido de un jugador por cuartos (de las jugadas de ESPN) y sus tiros. x, y: pies desde el aro (x a lo ancho, 0 en el
// centro; y hacia el medio campo). period 0 = todo el partido. available: false si la fuente no da jugada a jugada (Euroliga)
export interface BasketShot { period: number; clock: string; x: number; y: number; made: boolean; value: 2 | 3; text: string }
export interface BasketPlayerGame {
  available: boolean; periods: number[];
  byPeriod: Record<string, { pts: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number; oreb: number; dreb: number; ast: number; stl: number; blk: number; tov: number; pf: number }>;
  shots: BasketShot[];
}
export interface BoxTeam { id: string; name: string; abbr: string; logo: string; side: 'home' | 'away'; periods: number[]; players: (BoxLine & { id: string; name: string; starter: boolean })[]; out?: { id: string; name: string; reason: string }[]; totals: BoxLine }
export interface BasketBox { teams: BoxTeam[]; series: { date: string; status: string; score: { abbr: string; score: string; winner: boolean }[] }[] }

// google: tiene Google vinculado (googleEmail, su correo); hasPassword: también puede entrar con contraseña
// Panel de administración (docs/superpowers/specs/2026-11-18-panel-admin-design.md): cuentas y registros, sólo para administradores
export interface AdminUser { id: string; username: string; isAdmin: boolean; suspended: boolean; createdAt: string; lastSeenAt: string | null; hasPassword: boolean; googleEmail: string | null; bets: number; sessions: number }
export interface AdminLogRow { id: string; at: string; adminId: string | null; adminName: string; action: string; targetId: string | null; targetName: string | null; detail: Record<string, unknown> }
export type AuthEventKind = 'login_ok' | 'login_fail' | 'register' | 'register_blocked';
export interface AuthEventRow { id: string; at: string; kind: AuthEventKind; userId: string | null; username: string | null; ip: string | null }

export interface AuthUser { id: string; username: string; isAdmin: boolean; google?: boolean; googleEmail?: string | null; hasPassword?: boolean }

export interface Api {
  search(q: string): Promise<SearchResults>;
  auth: {
    me(): Promise<AuthUser | null>;
    // google: si está configurado «Continuar con Google» (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y PUBLIC_URL en el .env)
    config(): Promise<{ first: boolean; signupOpen: boolean; google?: boolean }>;
    login(username: string, password: string): Promise<AuthUser>;
    register(username: string, password: string): Promise<AuthUser>;
    logout(): Promise<void>;
    changePassword(current: string, next: string): Promise<void>;
  };
  // public: los comunes sin credenciales, para quien no ha entrado
  settings: { get(): Promise<Settings>; set(p: Partial<Settings>): Promise<Settings>; public(): Promise<Settings> };
  admin: {
    users(): Promise<AdminUser[]>;
    updateUser(id: string, patch: { username?: string; isAdmin?: boolean; suspended?: boolean }): Promise<AdminUser>;
    setPassword(id: string, password: string): Promise<{ ok: true }>;
    closeSessions(id: string): Promise<{ closed: number }>;
    deleteUser(id: string, confirm: string): Promise<{ ok: true }>;
    log(p?: { limit?: number; before?: string }): Promise<AdminLogRow[]>;
    authEvents(p?: { kind?: string; limit?: number; before?: string }): Promise<AuthEventRow[]>;
    // Acierto del modelo: las recomendaciones resueltas de todos los deportes
    predictions(): Promise<PredictionReport>;
  };
  // Anuncios (cuenta de AdSense) y responsable de la web (aviso legal), del .env del servidor
  publicConfig(): Promise<PublicConfig>;
  bets: {
    list(): Promise<Bet[]>; save(b: BetDraft): Promise<Bet>; delete(id: string): Promise<void>;
    // Mira ya los resultados de las pendientes (el servidor también lo hace solo cada 5 minutos)
    settle(): Promise<{ changed: number }>;
    export(): Promise<string | null>; import(): Promise<number>;
    // Recomendaciones del modelo, para medir si acierta (no son de ningún usuario)
    recordPredictions(list: PredictionIn[]): Promise<{ saved: number }>;
    // Enviar una apuesta tuya a amigos (sin tu importe ni tus notas; ven cómo va)
    share(id: string, to: string[], note?: string): Promise<{ sent: number }>;
    // Leer la captura de un ticket de la casa (PNG/JPEG en data URL): borrador enlazado a su partido, sin guardar (server/services/bets/scan.js)
    scan(image: string): Promise<TicketScan>;
    // Cuánto pesa hoy el modelo de baloncesto frente a la casa (reajuste diario con los resultados) y los últimos intentos
    modelWeights(): Promise<ModelWeights>;
    // ¿Entiende la app el mercado escrito? (fútbol, tenis y MMA; null si aún no hay partido o mercado). market: cómo lo entiende
    understand(q: { sport: Sport; event: string; market: string; selection: string }): Promise<{ known: boolean; market: string | null } | null>;
  };
  friends: {
    list(): Promise<FriendsList>;
    request(username: string): Promise<{ username: string; status: 'pending' | 'accepted' }>;
    accept(id: string): Promise<FriendsList>;
    remove(id: string): Promise<FriendsList>;
    chat(id: string): Promise<{ items: ChatItem[] }>;
    send(id: string, text: string): Promise<ChatItem>;
  };
  alerts: {
    list(): Promise<AlertsList>;
    read(ids?: string[]): Promise<{ ok: boolean }>;
    prefs(): Promise<OddsAlertPrefs>;
    setPrefs(p: OddsAlertPrefs): Promise<OddsAlertPrefs>;
    watch(list: OddsWatch[]): Promise<{ n: number }>;
    subscribe(subscription: PushSubscriptionJSON): Promise<{ ok: boolean }>;
    unsubscribe(endpoint: string): Promise<{ ok: boolean }>;
    // Un aviso de prueba sólo a este dispositivo: lo que dijo su servicio de push (missing: el servidor no lo tiene apuntado)
    testPush(endpoint: string): Promise<PushTestResult>;
  };
  shared: {
    inbox(): Promise<{ unseen: number; list: SharedBet[] }>;
    seen(): Promise<{ ok: boolean }>;
    copied(id: string): Promise<{ ok: boolean }>;
    hide(id: string): Promise<{ ok: boolean }>;
  };
  esports: {
    leagues(): Promise<League[]>;
    schedule(o: { leagueIds?: string[]; pageToken?: string | null }): Promise<Schedule>;
    live(): Promise<MatchEvent[]>;
    eventDetails(id: string): Promise<EventDetails | null>;
    liveWindow(gameId: string): Promise<LiveWindow | null>;
  };
  stats: {
    searchPlayers(q: string): Promise<PlayerHit[]>;
    searchTeams(q: string): Promise<TeamHit[]>;
    resolveTeam(name: string, code?: string): Promise<string>;
    playerGames(page: string): Promise<PlayerGame[]>;
    teamGames(team: string): Promise<TeamGame[]>;
    teamRoster(team: string): Promise<RosterPlayer[]>;
    teamForm(name: string, code?: string): Promise<TeamForm>;
  };
  odds: {
    // quiet: sólo leer, sin apuntarlo como el último partido abierto (el marcador lo usa para repartir sus capturas)
    match(m: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string; event?: string }, opts?: { quiet?: boolean }): Promise<MatchOdds>;
    board(events: { id: string; a: TeamRef; b: TeamRef; start: string }[]): Promise<Record<string, { a: number; b: number; x?: number }>>; // x: empate (fútbol)
    // focus: la clave del mercado que interesa; el lector sólo lee sus pestañas de Betway (más rápido). Sin ella, todo el partido
    auto(m: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string; event?: string }, focus?: string): Promise<AutoJob>;
    job(id: string): Promise<AutoJob>; // cómo va una lectura
    autoStatus(): Promise<AutoStatus>;
    // Histórico de cuotas del partido (odds.price_history): una fila cada vez que cambia una cuota de una casa
    history(m: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string }): Promise<PriceHistoryRow[]>;
  };
  football: {
    leagues(): Promise<FootballLeague[]>;
    games(date: string): Promise<FootballMatch[]>;
    days(from: string, n: number): Promise<Record<string, { total: number; live: number }>>;
    live(): Promise<FootballMatch[]>;
    match(id: string): Promise<FootballDetail>;
    // Noticias de los dos equipos (ids de ESPN) de los últimos días, lo más nuevo primero
    news(teams: string[]): Promise<NewsItem[]>;
    // Estadísticas de un jugador en un partido (API core de ESPN), { nombre de ESPN: valor }
    playerStats(match: string, team: string, player: string): Promise<Record<string, number>>;
    // Foto del jugador: ESPN o, si no tiene, Wikipedia; url vacía si no hay
    photo(id: string, name: string, team: string): Promise<{ url: string; from: string }>;
    // Las de una alineación entera: null en las que aún se están buscando (hay que volver a preguntar)
    photos(players: { id: string; name: string; team: string }[]): Promise<Record<string, { url: string; from: string } | null>>;
    // Últimos partidos acabados de un equipo (todas las competiciones)
    teamGames(teamId: string): Promise<FootballTeamGame[]>;
    standings(league: FootballLeagueId): Promise<FootballGroup[]>;
    picks(date: string, id: string): Promise<FootballPicks>;
    picksDay(date: string): Promise<FootballDayPick[]>;
    picksLines(date: string): Promise<FootballLineRow[]>;
  };
  mma: {
    leagues(): Promise<MmaLeague[]>;
    games(date: string): Promise<MmaFight[]>;
    days(from: string, n: number): Promise<Record<string, { total: number; live: number }>>;
    live(): Promise<MmaFight[]>;
    match(id: string): Promise<{ fight: MmaFight }>;
    fighter(id: string): Promise<MmaFighterCard>;
    ranking(): Promise<MmaRank[]>;
    profile(id: string): Promise<MmaProfile>;
    picks(date: string, id: string): Promise<MmaPicks>;
    picksDay(date: string): Promise<MmaDayPick[]>;
    picksLines(date: string): Promise<MmaLineRow[]>;
  };
  tennis: {
    games(date: string): Promise<TennisMatch[]>;
    doubles(date: string): Promise<TennisMatch[]>; // los dobles del día (ATP, WTA y Challenger), aparte de games
    // Estadísticas de un partido: de la web de la WTA o, ya acabado, de TennisMyLife (null si aún no hay)
    matchStats(q: { tour: SheetTour; date: string; state: TennisMatch['state']; a: string; b: string }): Promise<TennisMatchStats | null>;
    // doubles y doublesLive: los dobles de cada día, aparte (total y live son sólo los individuales)
    days(from: string, n: number): Promise<Record<string, { total: number; live: number; doubles?: number; doublesLive?: number }>>;
    live(): Promise<TennisMatch[]>;
    rankings(tour: Tour): Promise<TennisRank[]>;
    player(tour: Tour, id: string): Promise<TennisMatch[]>;
    profile(tour: SheetTour, id: string): Promise<TennisProfile>;
    // Cara a cara de los últimos tres años (TennisMyLife, desde el año since), por los nombres y desde a; found: false si no encuentra a alguno
    h2h(tour: SheetTour, a: string, b: string): Promise<{ found: boolean; since: string; matches: TennisResult[] }>;
    stats(tour: SheetTour, id: string): Promise<TennisStats>;
    gamelog(tour: SheetTour, id: string): Promise<TennisGamelog>; // su partido a partido (TennisMyLife)
    playerLines(tour: Tour, id: string): Promise<TennisPlayerLines>; // su próximo partido y sus líneas (pide cuenta)
    surface(tour: SheetTour, name: string, city: string): Promise<TennisSurface | null>;
    picks(date: string, id: string): Promise<TennisPicks>;
    picksDay(date: string): Promise<TennisDayPick[]>;
    picksBoard(date: string): Promise<TennisBoard>;
  };
  // Motor de los Challenger (servicio challenger): las recomendaciones de los Challenger de un día
  challenger: {
    picks(date: string): Promise<ChallengerDay>;
  };
  basket: {
    leagues(): Promise<BasketLeague[]>;
    games(date: string): Promise<BasketGame[]>;
    // Noticias de unos equipos («nba:19»), de los últimos días, lo más nuevo primero
    news(teams: string[]): Promise<NewsItem[]>;
    days(from: string, n: number): Promise<Record<string, { total: number; live: number }>>;
    live(): Promise<BasketGame[]>;
    roster(league: BasketLeagueId, teamId: string): Promise<BasketRosterPlayer[]>;
    standings(league: BasketLeagueId): Promise<BasketGroup[]>;
    team(league: BasketLeagueId, teamId: string): Promise<BasketTeamInfo>;
    leagueGames(league: BasketLeagueId): Promise<BasketLeagueGames>;
    colors(league: BasketLeagueId): Promise<Record<string, BasketTeamColor>>;
    teamLogs(league: BasketLeagueId, teamId: string): Promise<BasketTeamLogs>;
    injuries(): Promise<BasketInjury[]>;
    boxscore(gameId: string): Promise<BasketBox>;
    // El partido de un jugador por cuartos y sus tiros (sólo NBA y WNBA)
    playerGame(gameId: string, playerId: string): Promise<BasketPlayerGame>;
    flow(gameId: string): Promise<BasketFlow>;
    search(q: string): Promise<BasketPlayerHit[]>;
    gamelog(league: BasketLeagueId, playerId: string, teamId?: string): Promise<BasketGamelog>;
    absences(league: BasketLeagueId, playerId: string, teamId: string): Promise<BasketAbsence[]>;
    schedule(league: BasketLeagueId, teamId: string): Promise<{ id: string; date: string }[]>;
    rest(gameId: string, homeId: string, awayId: string): Promise<{ home: BasketRest | null; away: BasketRest | null }>;
  };
  onOddsAuto(cb: (job: AutoJob) => void): () => void;
  marcador: { url(): Promise<string>; paste(m?: { a: TeamRef; b: TeamRef }): Promise<{ ok: boolean; partido: string | null }> };
  // d.matchKey: el partido que tiene cuotas nuevas ("equipo A|equipo B"); sin d, una reconexión
  onOddsImported(cb: (d?: { matchKey?: string; book?: string }) => void): () => void;
  // El servidor ha resuelto alguna apuesta sola
  onBetsSettled(cb: () => void): () => void;
  // El administrador ha cambiado los ajustes de la app: valen para todos y se recargan
  onSettingsChanged(cb: () => void): () => void;
  // Un amigo te ha escrito o pasado una apuesta (new), o ha leído lo tuyo (read). Sólo le llega al destinatario
  onChat(cb: (type: 'new' | 'read') => void): () => void;
  onAlert(cb: () => void): () => void; // hay un aviso de cuotas nuevo (sólo le llega a su usuario)
  backend: { status(): Promise<BackendStatus> };
  onBackendStatus(cb: (up: boolean) => void): () => void;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window { api: Api }
}
