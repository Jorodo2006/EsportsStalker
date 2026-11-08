// Tipos de la interfaz (src/lib/api.ts implementa window.api) y de lo que devuelve el backend (server/)
import type { Reliability } from './value';

export type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'cashout' | 'halfwon' | 'halflost';

// Selección de una combinada
export type LegStatus = 'pending' | 'won' | 'lost' | 'void';
export type Sport = 'lol' | 'basket' | 'tennis' | 'football';
export interface BetLeg { event: string; league: string; market: string; selection: string; odds: number; status: LegStatus; sport?: Sport }
// En el boleto se guarda también la casa de donde salió la cuota
export type SlipLeg = BetLeg & { bookmaker?: string };

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
}

// fromSlip: la combinada viene del boleto (se vacía al guardarla)
export type BetDraft = Partial<Bet> & { fromSlip?: boolean };

export interface Settings {
  currency: string;
  initialBankroll: number;
  featuredBooks: string;
  leaguepediaUser: string;
  leaguepediaPassword: string;
  lolesportsKey: string;
  refreshSeconds: number;
  favoriteLeagues: string[];
  oddsAutoEnabled: boolean; // lecturas de cuotas programadas (las hace el lector de Docker)
  oddsFarEnabled: boolean; // leer también, más espaciados, los partidos de hasta 48 h
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
  queued: number; // trabajos esperando al lector
  running: number;
  lastPoll: number | null; // última vez que el lector preguntó si había trabajo (null: no lo ha visto)
}

// true si responde cada pieza del backend
export type BackendStatus = { gateway: boolean; bets: boolean; esports: boolean; odds: boolean; basket?: boolean; tennis?: boolean; football?: boolean };

// ---------- Fútbol (servicio football: ESPN) ----------
export type FootballLeagueId = 'laliga' | 'champions' | 'premier' | 'seriea' | 'bundesliga' | 'ligue1' | 'europa' | 'conference' | 'segunda' | 'copa';
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
  stage: string; venue: string; city: string; home: FootballTeam; away: FootballTeam; incidents: FootballEvent[];
}
export interface FootballPlayer { id: string; name: string; number: string; pos: string; starter: boolean; subIn: boolean; subOut: boolean; place: number | null }
export interface FootballLineup { team: string; formation: string; players: FootballPlayer[] }
export interface FootballPastGame { id: string; date: string; result: 'G' | 'E' | 'P' | ''; score: string; home: boolean; league: string; opponent: { id: string; name: string; logo: string }; team?: string }
export interface FootballDetail {
  match: FootballMatch; timeline: FootballEvent[]; stats: Record<string, Record<string, number | null>>; lineups: FootballLineup[];
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
}
export interface TennisMatch {
  id: string; tour: Tour; tournament: string; tournamentId: string; major: boolean; date: string; state: 'pre' | 'in' | 'post';
  status: string; round: string; court: string; city: string; bestOf: number; note: string; a: TennisPlayer; b: TennisPlayer;
  points?: TennisPoints | null; // sólo en juego, si cuadra con los juegos de ESPN
  level?: 'challenger'; // ATP Challenger (LiveScore): sin modelo, recomendaciones ni fichas de jugador
}
// Puntos del juego en curso: "15", "40", "AD"; en el tie-break, los que lleven. at: cuándo cambiaron por última vez (ms); source: de dónde salen
export interface TennisPoints { a: string; b: string; server: 'a' | 'b' | null; tiebreak: boolean; at: number; source: string }
export interface TennisRank { rank: number; previous: number; points: number; trend: string; id: string; name: string; short: string; flag: string; country: string }

// Recomendaciones de un partido (modelo + cuotas). p, pModel y pMarket van de 0 a 1; ev es el valor esperado por unidad
export interface TennisPick {
  id: string; title: string; market: string; selection: string; family: string; side: 'a' | 'b' | null; book: string; price: number; prices: Record<string, number>;
  p: number; pModel: number; pMarket: number; fair: number; ev: number; rel: Reliability; why: string;
}
export interface TennisPicks {
  ready: boolean; reason?: 'started' | 'finished' | 'noodds'; surface?: TennisSurface | null; indoor?: boolean; bestOf?: number; oddsAge?: number;
  match?: { pModel: number; pElo: number; pStats: number; pMarket: number | null; pFinal: number; expectedGames: number; holdA: number; holdB: number; weight: number };
  top?: TennisPick | null; easy?: TennisPick[]; hard?: TennisPick[]; considered?: number; warnings?: string[];
}
export interface TennisDayPick { id: string; tour: Tour; tournament: string; round: string; date: string; a: TennisPlayer; b: TennisPlayer; top: TennisPick; hard: TennisPick | null }

// Ficha de un tenista: datos personales, balance y últimos resultados
export interface TennisRecord { won: number; lost: number; titles: number; doublesTitles: number; prize: number }
export interface TennisResult {
  id: string; date: string; tournament: string; major: boolean; round: string; city: string; win: boolean; score: string; note: string;
  sets: number; games: number; opponent: { id: string; name: string; flag: string; rank: number | null };
}
export interface TennisProfile {
  id: string; tour: Tour; name: string; photo: string; photoFrom: string; flag: string; country: string; rank: number | null; previous: number | null; points: number | null;
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
  vs: { top10: TennisWinLoss; top11to50: TennisWinLoss; rest: TennisWinLoss }; levels: { grandSlam: TennisWinLoss; masters: TennisWinLoss; others: TennisWinLoss };
}
export interface TennisStats { source: string; updated: string | null; minSurface: number; found: boolean; periods: TennisStatPeriod[] }

// ---------- Baloncesto (servicio basket: ESPN para NBA/WNBA, API de la Euroliga para Euroliga/EuroCup) ----------
export type BasketLeagueId = 'nba' | 'wnba' | 'euroleague' | 'eurocup';
export interface BasketLeague { id: BasketLeagueId; name: string; country: string; logo: string }
export interface BasketSide { id: string; abbr: string; name: string; logo: string; score: string | null; record: string; alt?: string[] }
export interface BasketGame {
  id: string; league: BasketLeagueId; date: string; state: 'pre' | 'in' | 'post'; status: string; clock: string; round?: string;
  home: BasketSide; away: BasketSide;
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
export interface BasketInjury { playerId: string | null; name: string; teamId: string; team: string; status: string; detail: string; returnDate: string | null }
export interface BasketPlayerHit { id: string; league: BasketLeagueId; name: string; team: string; teamId?: string; pos: string; headshot: string }
// Un partido de un jugador (lo más reciente primero en BasketGamelog.games)
export interface BasketLogGame {
  id: string; date: string; season: number; type: 'reg' | 'post' | 'pre'; home: boolean | null; opp: string;
  team: string | null; teamId: string | null; result: string; score: string;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg3m: number;
}
export interface BasketGamelog { currentSeason: number; games: BasketLogGame[] }
// Plantilla con los partidos de cada jugador (escáner de líneas)
export interface BasketTeamLogs { currentSeason: number; players: (BasketRosterPlayer & { games: BasketLogGame[] })[] }
// Partidos terminados de una liga con sus parciales (q: un valor por cuarto y prórroga), de más reciente a más antiguo
export interface BasketPointSide { id: string; pts: number; q: number[] }
export interface BasketPointGame { id: string; date: string; season: number; type: 'reg' | 'post'; home: BasketPointSide; away: BasketPointSide }
export interface BasketLeagueGames { currentSeason: number; teams: Record<string, { abbr: string; name: string; logo: string }>; games: BasketPointGame[] }
// Estadísticas de un partido: por equipo, puntos por cuarto, jugadores y totales; series = enfrentamientos de la temporada
export interface BoxLine { min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg: string; fg3: string; ft: string; pm: string }
export interface BoxTeam { id: string; name: string; abbr: string; logo: string; side: 'home' | 'away'; periods: number[]; players: (BoxLine & { id: string; name: string; starter: boolean })[]; totals: BoxLine }
export interface BasketBox { teams: BoxTeam[]; series: { date: string; status: string; score: { abbr: string; score: string; winner: boolean }[] }[] }

export interface AuthUser { id: string; username: string; isAdmin: boolean }

export interface Api {
  auth: {
    me(): Promise<AuthUser | null>;
    config(): Promise<{ first: boolean; signupOpen: boolean }>;
    login(username: string, password: string): Promise<AuthUser>;
    register(username: string, password: string): Promise<AuthUser>;
    logout(): Promise<void>;
    changePassword(current: string, next: string): Promise<void>;
  };
  settings: { get(): Promise<Settings>; set(p: Partial<Settings>): Promise<Settings> };
  bets: {
    list(): Promise<Bet[]>; save(b: BetDraft): Promise<Bet>; delete(id: string): Promise<void>;
    export(): Promise<string | null>; import(): Promise<number>;
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
    match(m: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string }, opts?: { quiet?: boolean }): Promise<MatchOdds>;
    board(events: { id: string; a: TeamRef; b: TeamRef; start: string }[]): Promise<Record<string, { a: number; b: number }>>;
    auto(m: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string }): Promise<AutoJob>;
    autoStatus(): Promise<AutoStatus>;
  };
  football: {
    leagues(): Promise<FootballLeague[]>;
    games(date: string): Promise<FootballMatch[]>;
    days(from: string, n: number): Promise<Record<string, { total: number; live: number }>>;
    live(): Promise<FootballMatch[]>;
    match(id: string): Promise<FootballDetail>;
    standings(league: FootballLeagueId): Promise<FootballGroup[]>;
  };
  tennis: {
    games(date: string): Promise<TennisMatch[]>;
    days(from: string, n: number): Promise<Record<string, { total: number; live: number }>>;
    live(): Promise<TennisMatch[]>;
    rankings(tour: Tour): Promise<TennisRank[]>;
    player(tour: Tour, id: string): Promise<TennisMatch[]>;
    profile(tour: Tour, id: string): Promise<TennisProfile>;
    stats(tour: Tour, id: string): Promise<TennisStats>;
    surface(tour: Tour, name: string, city: string): Promise<TennisSurface | null>;
    picks(date: string, id: string): Promise<TennisPicks>;
    picksDay(date: string): Promise<TennisDayPick[]>;
  };
  basket: {
    leagues(): Promise<BasketLeague[]>;
    games(date: string): Promise<BasketGame[]>;
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
    search(q: string): Promise<BasketPlayerHit[]>;
    gamelog(league: BasketLeagueId, playerId: string, teamId?: string): Promise<BasketGamelog>;
  };
  onOddsAuto(cb: (job: AutoJob) => void): () => void;
  marcador: { url(): Promise<string>; paste(m?: { a: TeamRef; b: TeamRef }): Promise<{ ok: boolean; partido: string | null }> };
  onOddsImported(cb: () => void): () => void;
  backend: { status(): Promise<BackendStatus> };
  onBackendStatus(cb: (up: boolean) => void): () => void;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window { api: Api }
}
