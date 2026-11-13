#!/usr/bin/env node
// CLI de Sharpex Tenis. Ejecuta sin argumentos para ver la ayuda.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  EloModel, loadMatches, evaluate, tune, scan, normalizeOddsInput, Ledger, generate, toCsv, PlayerIndex,
  HISTORY_LEVELS, BET_LEVELS, download, venueSurfaces,
} from '../src/index.js';

const HELP = `
Sharpex Tenis · motor de valor para Challengers

Uso: sharpex-tenis <comando> [opciones]

  datos      [--carpeta datos] [--desde-anyo 2015] [--hasta-anyo <este año>] [--forzar]
             Descarga el histórico (Challengers, ATP e ITF) del archivo de Sackmann
             (github.com/roblotlot/tennis-sackmann-archive) y lo que le falta desde junio de 2026
             de TennisMyLife. Uso personal y no comercial. Vuelve a lanzarlo cada semana.

  entrenar   --datos <carpeta|csv> [--salida modelo.json] [--niveles ${HISTORY_LEVELS.join(',')}]
             Calcula los ratings de todos los jugadores con el histórico.

  validar    --datos <carpeta|csv> --desde AAAA-MM-DD [--ajustar] [--niveles …] [--puntuar C]
             Mide lo bueno que es el modelo en partidos que no ha visto. Sólo puntúa los
             Challengers; el resto es historial. Con --ajustar busca los parámetros en el
             año anterior a --desde, no en los partidos que puntúa.

  escanear   --modelo modelo.json --cuotas <json|csv> [--superficie Clay]
             [--min-edge 0.03] [--min-cuota 1.3] [--max-cuota 4] [--incluir-pocos-datos]
             [--registrar picks.jsonl] [--alias alias.json]
             Busca cuotas con valor. Con --registrar guarda las encontradas en el historial.

  pick       cierre    --historial picks.jsonl --id <id> --cuota <cierre> [--rival <cuota rival cierre>]
             resultado --historial picks.jsonl --id <id> --es won|lost|void
             Guarda la cuota de cierre (para el CLV) o el resultado de un pick.

  historial  --historial picks.jsonl [--json]
             Rendimiento, CLV y comprobación de que el historial no se ha retocado.

  demo       [--carpeta demo]
             Genera datos simulados para probar todo sin datos reales.
`;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const pct = (x, d = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)} %`);
const sign = (x, d = 1) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %`);
const need = (a, k) => { if (!a[k]) { console.error(`Falta --${k}`); process.exit(1); } return a[k]; };

const a = args(process.argv.slice(2));
const cmd = a._[0];
const list = (v, def) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : def);

try {
  switch (cmd) {
    case 'datos': {
      const dir = a.carpeta ?? 'datos';
      console.log(`Descargando en ${dir}/ (del archivo de Sackmann, sólo lo que falta${a.forzar ? ': con --forzar, todo' : ''}; de TennisMyLife, lo reciente)`);
      const r = await download({
        dir,
        from: Number(a['desde-anyo'] ?? 2015),
        to: Number(a['hasta-anyo'] ?? new Date().getFullYear()),
        force: !!a.forzar,
        log: (f) => console.log(`  ${f}`),
      });
      console.log(`\n${r.downloaded.length} ficheros descargados, ${r.kept.length} que ya estaban.`);
      if (r.missing.length) console.log(`No están (todavía) en la fuente: ${r.missing.join(', ')}`);
      if (r.failed.length) console.log(`No se pudo bajar: ${r.failed.join(', ')}. El modelo irá con retraso: vuelve a probar más tarde.`);
      console.log('\nDatos de Jeff Sackmann (CC BY-NC-SA 4.0) y TennisMyLife: uso personal y no comercial, no para un producto de pago.');
      console.log(`\nSiguiente paso: sharpex-tenis entrenar --datos ${dir} --salida modelo.json`);
      break;
    }

    case 'entrenar': {
      const levels = list(a.niveles, HISTORY_LEVELS);
      const matches = loadMatches(need(a, 'datos'), { levels });
      const model = new EloModel().fit(matches);
      model.venues = venueSurfaces(matches); // para saber la superficie cuando la fuente de cuotas no la dice
      const out = a.salida ?? 'modelo.json';
      // Aparte y luego se renombra: el servicio challenger lo vuelve a leer en cuanto cambia y no debe verlo a medias
      writeFileSync(`${out}.nuevo`, JSON.stringify(model));
      renameSync(`${out}.nuevo`, out);
      console.log(`Partidos: ${matches.length} (niveles ${levels.join(', ')}) · Jugadores: ${model.players.size} · Último partido: ${model.lastDate}`);
      console.log(`Modelo guardado en ${out}\n\nTop 10 por rating:`);
      console.table(model.top(10).map((p) => ({ jugador: p.name, rating: Math.round(p.rating), partidos: p.matches, ultimo: p.last })));
      // Un jugador que ha subido después del último partido sale infravalorado, y el escáner vería valor donde no lo hay
      const days = model.lastDate ? Math.round((Date.now() - Date.parse(model.lastDate)) / 86400000) : 0;
      if (days > 14) {
        console.log(`\nOjo: el último partido es de hace ${days} días. Los ratings no saben nada de lo jugado después:`);
        console.log('no publiques picks con este modelo sin añadir antes los resultados que faltan (formato propio, ver README).');
      }
      break;
    }

    case 'validar': {
      const levels = list(a.niveles, HISTORY_LEVELS);
      const scoreLevels = list(a.puntuar, BET_LEVELS);
      const matches = loadMatches(need(a, 'datos'), { levels });
      const testFrom = need(a, 'desde');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(testFrom)) throw new Error('--desde tiene que ser AAAA-MM-DD');
      let modelOptions = {};
      if (a.ajustar) {
        const tuneFrom = `${Number(testFrom.slice(0, 4)) - 1}${testFrom.slice(4)}`;
        console.log(`Probando combinaciones de parámetros con los partidos de ${tuneFrom} a ${testFrom}…`);
        const res = tune(matches, { tuneFrom, tuneTo: testFrom, scoreLevels });
        console.table(res.slice(0, 8).map((r) => ({ ...r, logLoss: r.logLoss.toFixed(4), brier: r.brier.toFixed(4), accuracy: pct(r.accuracy) })));
        if (res.length) {
          const { surfaceWeight, kBase, kShape } = res[0];
          modelOptions = { surfaceWeight, kBase, kShape };
          console.log(`Se evalúa con los mejores de ese periodo: ${JSON.stringify(modelOptions)}`);
        }
      }
      const { metrics: m } = evaluate(matches, { testFrom, scoreLevels, modelOptions });
      if (!m) { console.log('No hay partidos para validar en ese periodo.'); break; }
      console.log(`\nPartidos evaluados: ${m.n} de nivel ${scoreLevels.join(', ')} (desde ${testFrom}, sin jugadores con pocos datos)`);
      console.log(`Acierto del favorito: ${pct(m.accuracy)} · Brier: ${m.brier.toFixed(4)} · Log-loss: ${m.logLoss.toFixed(4)}`);
      console.log('\nCalibración (si el modelo dice 70 %, ¿gana el 70 %?):');
      console.table(m.calibration.map((c) => ({ tramo: c.range, partidos: c.n, dice: pct(c.predicted), real: pct(c.actual) })));
      break;
    }

    case 'escanear': {
      const model = EloModel.fromJSON(JSON.parse(readFileSync(need(a, 'modelo'), 'utf8')));
      const rows = normalizeOddsInput(readFileSync(need(a, 'cuotas'), 'utf8'), { surface: a.superficie });
      const { opportunities, skipped } = scan(model, rows, {
        minEdge: a['min-edge'] !== undefined ? Number(a['min-edge']) : undefined,
        minOdds: a['min-cuota'] !== undefined ? Number(a['min-cuota']) : undefined,
        maxOdds: a['max-cuota'] !== undefined ? Number(a['max-cuota']) : undefined,
        allowLowData: !!a['incluir-pocos-datos'],
        aliases: a.alias ? JSON.parse(readFileSync(a.alias, 'utf8')) : undefined,
      });
      console.log(`Partidos leídos: ${rows.length} · Oportunidades: ${opportunities.length} · Descartados: ${skipped.length}\n`);
      if (opportunities.length) {
        console.table(opportunities.map((o) => ({
          partido: o.match, pick: o.pick, cuota: o.odds, 'cuota justa': o.fairOdds.toFixed(2),
          modelo: pct(o.modelProb), casa: pct(o.bookProb), valor: sign(o.edge), stake: pct(o.stake, 2),
        })));
      }
      if (skipped.length) {
        console.log('Descartados:');
        for (const s of skipped) console.log(`  · ${s.p1} vs ${s.p2}: ${s.reason}`);
      }
      if (a.registrar && opportunities.length) {
        const led = new Ledger(a.registrar);
        for (const o of opportunities) {
          const e = led.addPick({
            match: o.match, tournament: o.tournament, surface: o.surface, start: o.start, bookmaker: o.bookmaker,
            pick: o.pick, odds: o.odds, modelProb: o.modelProb, edge: o.edge, stake: o.stake,
          });
          console.log(`Registrado pick ${e.data.id}: ${o.pick} @ ${o.odds}`);
        }
      }
      break;
    }

    case 'pick': {
      const led = new Ledger(need(a, 'historial'));
      const sub = a._[1];
      if (sub === 'cierre') {
        led.close(need(a, 'id'), Number(need(a, 'cuota')), a.rival ? Number(a.rival) : null);
        const p = led.get(a.id);
        console.log(`Cierre guardado. CLV: ${sign(p.clv.clvOdds)}${p.clv.clvEV !== undefined ? ` · valor según cierre: ${sign(p.clv.clvEV)}` : ''}`);
      } else if (sub === 'resultado') {
        led.settle(need(a, 'id'), need(a, 'es'));
        console.log('Resultado guardado.');
      } else console.log('Usa: pick cierre | pick resultado');
      break;
    }

    case 'historial': {
      const led = new Ledger(need(a, 'historial'));
      const v = led.verify();
      const s = led.stats();
      if (a.json) { console.log(JSON.stringify({ verify: v, stats: s, picks: led.picks() }, null, 2)); break; }
      console.log(v.ok ? `Historial íntegro ✓ (${v.entries} registros, huella ${v.head.slice(0, 12)})` : `¡HISTORIAL ALTERADO! Registro ${v.brokenAt}: ${v.reason}`);
      console.log(`\nPicks: ${s.picks} · Resueltos: ${s.settled} · Pendientes: ${s.pending}`);
      console.log(`Acierto: ${pct(s.hitRate)} · ROI: ${sign(s.roi)} · Beneficio: ${s.profit.toFixed(3)} unidades de banca`);
      console.log(`Valor medio al registrar: ${sign(s.avgEdgeAtPick)}`);
      console.log(`CLV medio: ${sign(s.avgClvOdds)} · Picks que ganan al cierre: ${pct(s.beatClosingPct)}`);
      break;
    }

    case 'demo': {
      const dir = a.carpeta ?? 'demo';
      mkdirSync(dir, { recursive: true });
      const { matches } = generate({ years: 3, startYear: 2023 });
      const rows = matches.map((m) => ({ date: m.date, tourney: m.tourney, level: 'C', surface: m.surface, round: m.round, order: m.order, winner: m.winnerName, loser: m.loserName, score: m.score }));
      writeFileSync(join(dir, 'resultados.csv'), toCsv(rows, ['date', 'tourney', 'level', 'surface', 'round', 'order', 'winner', 'loser', 'score']));
      // Cuotas de ejemplo con nombres escritos "como las casas"
      const model = new EloModel().fit(loadMatches(join(dir, 'resultados.csv')));
      const fmt = (n) => { const [f, ...l] = n.split(' '); return `${l.join(' ')} ${f[0]}.`; };
      const idx = new PlayerIndex([...model.players.values()].map((p) => ({ id: p.id, name: p.name })));
      // Elegimos jugadores cuyo nombre "estilo casa" no sea ambiguo.
      const top = model.top(60, 'Clay').filter((p) => idx.find(fmt(p.name))?.name === p.name).slice(0, 12);
      const entries = [];
      for (let i = 0; i + 1 < top.length; i += 2) {
        const p = model.predict([...model.players.values()].find((x) => x.name === top[i].name).id, [...model.players.values()].find((x) => x.name === top[i + 1].name).id, 'Clay').pA;
        // La casa se equivoca a propósito en algunos partidos para que veas el escáner funcionar.
        const skew = i % 4 === 0 ? 0.08 : -0.01;
        const q = Math.min(0.95, Math.max(0.05, p - skew));
        entries.push({ p1: fmt(top[i].name), p2: fmt(top[i + 1].name), o1: +(1 / (q * 1.05)).toFixed(2), o2: +(1 / ((1 - q) * 1.05)).toFixed(2) });
      }
      writeFileSync(join(dir, 'cuotas.json'), JSON.stringify({ type: 'TENNIS_EDGE_ODDS', market: 'winner', surface: 'Clay', tournament: 'Challenger Demo', bookmaker: 'Demo', entries }, null, 2));
      console.log(`Creado ${dir}/resultados.csv (${rows.length} partidos simulados) y ${dir}/cuotas.json\n`);
      console.log('Prueba:');
      console.log(`  sharpex-tenis validar   --datos ${dir}/resultados.csv --desde 2025-01-01`);
      console.log(`  sharpex-tenis entrenar  --datos ${dir}/resultados.csv --salida ${dir}/modelo.json`);
      console.log(`  sharpex-tenis escanear  --modelo ${dir}/modelo.json --cuotas ${dir}/cuotas.json --registrar ${dir}/picks.jsonl`);
      console.log(`  sharpex-tenis historial --historial ${dir}/picks.jsonl`);
      break;
    }

    default:
      console.log(HELP);
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
