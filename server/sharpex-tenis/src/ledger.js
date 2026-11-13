// Registro de picks a prueba de retoques.
//
// Cada registro lleva:
//  - fecha y hora de creación (antes del partido)
//  - un hash encadenado con el registro anterior
// Si alguien edita o borra un registro viejo, la cadena se rompe y verifyChain() lo detecta.
// Así podéis publicar el historial y cualquiera puede comprobar que no está maquillado.
//
// La cadena son funciones puras sobre una lista de registros: Ledger los guarda en un fichero JSON Lines (la línea de
// órdenes) y el servicio challenger, en PostgreSQL (server/services/challenger). Las dos usan exactamente estas.

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { clv } from './odds.js';

export const GENESIS = 'GENESIS';
export const RESULTS = ['won', 'lost', 'void'];

const sha = (s) => createHash('sha256').update(s).digest('hex');

function canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

const hashOf = (body) => sha(canonical({ ...body, data: canonical(body.data) }));

/** Registro nuevo enganchado al hash del anterior (GENESIS si es el primero). */
export function chainEntry(prev, type, data, at = new Date().toISOString()) {
  const body = { type, at, data, prev };
  return { ...body, hash: hashOf(body) };
}

/** Datos de un pick nuevo, comprobados y con identificador. Hay que registrarlo ANTES de que empiece el partido. */
export function pickData(p) {
  const id = p.id ?? randomUUID().slice(0, 8);
  for (const k of ['match', 'pick', 'odds', 'modelProb']) if (p[k] === undefined) throw new Error(`Falta "${k}" en el pick`);
  return { stake: 0.01, ...p, id };
}

/** Cuota de cierre (justo antes de empezar). opponentOdds es opcional y mejora el CLV. */
export const closeData = (id, closingOdds, opponentOdds = null) => ({ id, closingOdds, opponentOdds });

/** Resultado: 'won' | 'lost' | 'void' */
export function settleData(id, result) {
  if (!RESULTS.includes(result)) throw new Error('Resultado debe ser won, lost o void');
  return { id, result };
}

/** Comprueba que nadie ha tocado el historial. */
export function verifyChain(entries) {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...body } = entries[i];
    if (body.prev !== prev) return { ok: false, brokenAt: i, reason: 'La cadena no enlaza con el registro anterior' };
    if (hashOf(body) !== hash) return { ok: false, brokenAt: i, reason: 'El contenido de este registro ha sido modificado' };
    prev = hash;
  }
  return { ok: true, entries: entries.length, head: prev };
}

/** Estado actual de un pick juntando sus registros. */
export function pickOf(entries, id) {
  const evs = entries.filter((e) => e.data.id === id);
  if (!evs.some((e) => e.type === 'pick')) throw new Error(`No existe el pick ${id}`);
  return reduce(evs);
}

export function picksOf(entries) {
  const byId = new Map();
  for (const e of entries) {
    if (!byId.has(e.data.id)) byId.set(e.data.id, []);
    byId.get(e.data.id).push(e);
  }
  return [...byId.values()].filter((evs) => evs.some((e) => e.type === 'pick')).map(reduce);
}

export function statsOf(entries) {
  const ps = picksOf(entries);
  const settled = ps.filter((p) => p.result && p.result !== 'void');
  let staked = 0, profit = 0, wins = 0;
  for (const p of settled) {
    staked += p.stake;
    if (p.result === 'won') { profit += p.stake * (p.odds - 1); wins++; }
    else profit -= p.stake;
  }
  const withClv = ps.filter((p) => p.clv);
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  const clvEV = withClv.map((p) => p.clv.clvEV).filter((x) => x !== undefined);
  return {
    picks: ps.length,
    settled: settled.length,
    pending: ps.filter((p) => !p.result).length,
    wins,
    hitRate: settled.length ? wins / settled.length : null,
    staked,
    profit,
    roi: staked ? profit / staked : null,
    avgEdgeAtPick: avg(ps.map((p) => p.edge).filter((x) => typeof x === 'number')),
    avgClvOdds: avg(withClv.map((p) => p.clv.clvOdds)),
    avgClvEV: avg(clvEV),
    beatClosingPct: withClv.length ? withClv.filter((p) => p.clv.clvOdds > 0).length / withClv.length : null,
  };
}

function reduce(evs) {
  const pick = { ...evs.find((e) => e.type === 'pick')?.data, createdAt: evs[0].at };
  const c = evs.filter((e) => e.type === 'close').pop();
  if (c) {
    pick.closingOdds = c.data.closingOdds;
    pick.clv = clv(pick.odds, c.data.closingOdds, c.data.opponentOdds);
  }
  const s = evs.filter((e) => e.type === 'settle').pop();
  if (s) { pick.result = s.data.result; pick.settledAt = s.at; }
  return pick;
}

/** El historial en un fichero JSON Lines (la línea de órdenes). */
export class Ledger {
  constructor(path) {
    this.path = path;
    if (!existsSync(path)) writeFileSync(path, '');
  }

  entries() {
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  append(type, data) {
    const e = this.entries();
    const entry = chainEntry(e.length ? e[e.length - 1].hash : GENESIS, type, data);
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    return entry;
  }

  addPick(p) { return this.append('pick', pickData(p)); }

  close(id, closingOdds, opponentOdds = null) {
    this.get(id);
    return this.append('close', closeData(id, closingOdds, opponentOdds));
  }

  settle(id, result) {
    const data = settleData(id, result);
    this.get(id);
    return this.append('settle', data);
  }

  get(id) { return pickOf(this.entries(), id); }
  picks() { return picksOf(this.entries()); }
  verify() { return verifyChain(this.entries()); }
  stats() { return statsOf(this.entries()); }
}
