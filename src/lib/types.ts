// Tipos compartidos con el proceso principal (electron/preload.js expone window.api) y el backend (server/)

export type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'cashout' | 'halfwon' | 'halflost';

// Selección de una combinada
export type LegStatus = 'pending' | 'won' | 'lost' | 'void';
export interface BetLeg { event: string; league: string; market: string; selection: string; odds: number; status: LegStatus }
// En el boleto se guarda también la casa de donde salió la cuota
export type SlipLeg = BetLeg & { bookmaker?: string };

export interface Bet {
  id: string;
  date: string; // YYYY-MM-DD
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

export interface TeamRef { name: string; code: string }

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
export type BackendStatus = { gateway: boolean; bets: boolean; esports: boolean; odds: boolean };

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
    match(m: { a: TeamRef; b: TeamRef; start?: string }): Promise<MatchOdds>;
    board(events: { id: string; a: TeamRef; b: TeamRef; start: string }[]): Promise<Record<string, { a: number; b: number }>>;
    auto(m: { a: TeamRef; b: TeamRef }): Promise<AutoJob>;
    autoStatus(): Promise<AutoStatus>;
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
