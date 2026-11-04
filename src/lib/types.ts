// Tipos compartidos con el proceso principal (electron/preload.js expone window.api) y el backend (server/)

export type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'cashout' | 'halfwon' | 'halflost';

// Selección de una combinada
export type LegStatus = 'pending' | 'won' | 'lost' | 'void';
export type Sport = 'lol' | 'basket' | 'tennis';
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
  oddsAutoEnabled: boolean; // lecturas de cuotas programadas (las hace la extensión de Chrome)
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
  sources: Record<string, { ok: boolean; msg: string }>;
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
  matches: { id: string; league: string; start: string; a: TeamRef; b: TeamRef }[]; // partidos que entran ahora
  queued: number; // trabajos esperando a la extensión
  running: number;
  lastPoll: number | null; // última vez que la extensión preguntó si había trabajo (null: no la ha visto)
}

// true si responde cada pieza del backend
export type BackendStatus = { gateway: boolean; bets: boolean; esports: boolean; odds: boolean; basket?: boolean; tennis?: boolean };

// ---------- Tenis (servicio tennis: ESPN, ATP y WTA individuales) ----------
export type Tour = 'atp' | 'wta';
export interface TennisPlayer {
  id: string; name: string; short: string; flag: string; country: string; seed: number | null; rank: number | null;
  sets: number[]; setWins: boolean[]; tiebreaks: (number | null)[]; winner: boolean; alt: string[];
}
export interface TennisMatch {
  id: string; tour: Tour; tournament: string; tournamentId: string; major: boolean; date: string; state: 'pre' | 'in' | 'post';
  status: string; round: string; court: string; city: string; bestOf: number; note: string; a: TennisPlayer; b: TennisPlayer;
}
export interface TennisRank { rank: number; previous: number; points: number; trend: string; id: string; name: string; short: string; flag: string; country: string }

// ---------- Baloncesto (servicio basket: ESPN para NBA/WNBA, API de la Euroliga para Euroliga/EuroCup) ----------
export type BasketLeagueId = 'nba' | 'wnba' | 'euroleague' | 'eurocup';
export interface BasketLeague { id: BasketLeagueId; name: string; country: string; logo: string }
export interface BasketSide { id: string; abbr: string; name: string; logo: string; score: string | null; record: string; alt?: string[] }
export interface BasketGame {
  id: string; league: BasketLeagueId; date: string; state: 'pre' | 'in' | 'post'; status: string; clock: string; round?: string;
  home: BasketSide; away: BasketSide;
}
export interface BasketRosterPlayer { id: string; name: string; pos: string; jersey: string; headshot: string; injury: string | null }
export interface BasketInjury { playerId: string | null; name: string; teamId: string; team: string; status: string; detail: string; returnDate: string | null }
export interface BasketPlayerHit { id: string; league: BasketLeagueId; name: string; team: string; teamId?: string; pos: string; headshot: string }
// Un partido de un jugador (lo más reciente primero en BasketGamelog.games)
export interface BasketLogGame {
  id: string; date: string; season: number; type: 'reg' | 'post' | 'pre'; home: boolean | null; opp: string;
  team: string | null; teamId: string | null; result: string; score: string;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg3m: number;
}
export interface BasketGamelog { currentSeason: number; games: BasketLogGame[] }
// Estadísticas de un partido: por equipo, puntos por cuarto, jugadores y totales; series = enfrentamientos de la temporada
export interface BoxLine { min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg: string; fg3: string; ft: string; pm: string }
export interface BoxTeam { id: string; name: string; abbr: string; logo: string; side: 'home' | 'away'; periods: number[]; players: (BoxLine & { id: string; name: string; starter: boolean })[]; totals: BoxLine }
export interface BasketBox { teams: BoxTeam[]; series: { date: string; status: string; score: { abbr: string; score: string; winner: boolean }[] }[] }

export interface Api {
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
    match(m: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string }): Promise<MatchOdds>;
    board(events: { id: string; a: TeamRef; b: TeamRef; start: string }[]): Promise<Record<string, { a: number; b: number }>>;
    auto(m: { a: TeamRef; b: TeamRef; start?: string; sport?: Sport; league?: string }): Promise<AutoJob>;
    autoStatus(): Promise<AutoStatus>;
  };
  tennis: {
    games(date: string): Promise<TennisMatch[]>;
    days(from: string, n: number): Promise<Record<string, { total: number; live: number }>>;
    live(): Promise<TennisMatch[]>;
    rankings(tour: Tour): Promise<TennisRank[]>;
    player(tour: Tour, id: string): Promise<TennisMatch[]>;
  };
  basket: {
    leagues(): Promise<BasketLeague[]>;
    games(date: string): Promise<BasketGame[]>;
    days(from: string, n: number): Promise<Record<string, { total: number; live: number }>>;
    live(): Promise<BasketGame[]>;
    roster(league: BasketLeagueId, teamId: string): Promise<BasketRosterPlayer[]>;
    injuries(): Promise<BasketInjury[]>;
    boxscore(gameId: string): Promise<BasketBox>;
    search(q: string): Promise<BasketPlayerHit[]>;
    gamelog(league: BasketLeagueId, playerId: string, teamId?: string): Promise<BasketGamelog>;
  };
  extension: { folder(): Promise<string>; open(): Promise<void> };
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
