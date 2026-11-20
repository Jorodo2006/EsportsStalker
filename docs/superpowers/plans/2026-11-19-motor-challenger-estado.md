# Motor de los Challenger: estado y cómo retomarlo

Fecha: 19-11-2026 · Autor: Hugo (con Claude) · Rama: `hugodev` (todavía **no** en `main`)

Este documento es el punto de partida para seguir con el motor de valor de los ATP Challenger desde cualquier equipo. El diseño
completo, con las cifras de cada fase, está en
[`docs/superpowers/specs/2026-11-19-motor-challenger-v2-design.md`](../specs/2026-11-19-motor-challenger-v2-design.md); el
funcionamiento del motor, en [`server/sharpex-tenis/README.md`](../../../server/sharpex-tenis/README.md).

## Dónde está

| Commit en `hugodev` | Qué lleva |
|---|---|
| `ad4fb4c` | Fase 1: saque y resto y cola calibrada |
| `49d1566` | Fases 0, 2, 3 y 4, y las reglas 8 y 9 de `AGENTS.md` (permisos) |
| (éste) | Este documento y los scripts de medición `fase0-casa.mjs` y `medir-retiradas.mjs` |

- **No está en `main`.** Antes de unirlo, que lo revise Jordi (lo pide la especificación). Ojo al unir: la vez anterior que se juntó
  `hugodev` con `main` la unión se quedó con un solo lado y se perdió todo el trabajo de tenis. Después de unir, comprueba que están
  `server/sharpex-tenis/src/form.js`, `src/picks.js` y `src/components/ChallengerPicks.tsx`.
- **Permisos** (`AGENTS.md`): commit y push, y leer o tocar la base de datos de producción, sólo si lo pide Jordi, Hugo o Roberto
  (basta con uno). En producción, sólo lectura (`SET default_transaction_read_only = on`).

## Qué hace el motor ahora

1. **Datos** (`src/data.js`): el histórico de Sackmann (hasta el 1-6-2026) y TennisMyLife (desde entonces), con el país de cada
   jugador, cómo entró al cuadro y si el partido acabó en retirada.
2. **Probabilidad del modelo** (`src/elo.js`, `src/stats.js`, `src/form.js`): Elo por superficie, más saque y resto, más dos
   variables propias de los Challenger. Son los torneos jugados en las 5 semanas anteriores (`bWeeks` 0,101) y jugar en su país
   (`bHome` 0,107). Los pesos se ajustan con 2023 y se evalúan con 2024-2026.
3. **Mezcla con la casa** (`src/picks.js`): `σ(0,20 · logit modelo + 0,80 · logit casa sin margen)`; el peso sale de la fase 0.
4. **Salidas** (`picksOfMatch`), por tramos de cuota (baja 1,15-1,60, media 1,60-2,50, alta 2,50-6,00):
   - ***Alta probabilidad*** (se enseña): 75 % o más, fiabilidad de 65 o más, valor de −3 % o más, modelo y casa a menos de 5 puntos
     y sin avisos físicos. Siempre dice «sin ventaja sobre la casa».
   - ***Valor*** (**oculto**, `VALUE_VISIBLE = false`): valor del +3/+4/+7 % según el tramo. Se calcula y se registra, pero no se
     enseña porque en la fase 0 el modelo no ganó a la cuota de cierre.
5. **Riesgo de retirada** (`retirementRisk` en `src/form.js`): 1,67 % por jugador, ×1,5 si se retiró en los últimos 90 días y ×2,2
   con ranking protegido. Winamax anula la apuesta al ganador si uno se retira (Betway también, sin confirmar en su reglamento), y
   el valor esperado lo tiene en cuenta: `(1 − r) · (p · cuota − 1)`.
6. **Avisos:** `local`, `pocos_datos`, `datos_viejos` y los físicos `retirada_reciente` y `ranking_protegido`, cada uno con su jugador.
   El ranking protegido sale del cuadro final de ProTennisLive (`mds.pdf`, servicio tennis). `tmo_reciente` (tiempo muerto médico)
   existe pero **no tiene fuente** todavía.
7. **Servicio** `challenger`: `GET /api/challenger/recomendaciones?fecha=` (con sesión) y `comparar`. Reentrena solo cada día.
8. **App** (`src/components/ChallengerPicks.tsx`): pestaña *Recomendaciones* de cada Challenger, el circuito *Challenger* en la
   pantalla *Recomendaciones* del tenis, *Las más fiables del día* y la columna del partido elegido.
9. **Registro:** todas en *Mis apuestas → Acierto del modelo*, en grupos «Challenger · Alta probabilidad · cuota baja», «Challenger ·
   Valor · cuota media»…; las de Valor, sin aviso de recomendación fuerte. Se resuelven solas al acabar el partido. El 19-11-2026,
   las 3 primeras de alta probabilidad acertaron.

## Resultados de cada fase

| Fase | Qué | Resultado |
|---|---|---|
| 0 | Modelo frente a la casa (producción, 155 Challengers del 12 al 18-11) | Mezcla al 20 %: mejora un poco a la casa de cierre (sin margen para darlo por seguro). El modelo solo, como valor, pierde frente al cierre (CLV −7,2 % ± 1,3 %) → *Valor* oculto |
| 1 | Saque y resto + cola | log-loss 0,6184 → 0,6157 (28.117 Challengers de 2024-2026) |
| 2 | Actividad y factor local | 0,6157 → 0,6134; Brier 0,2141 → 0,2131; los partidos de la semana anterior no entran |
| 3 | Mezcla, salidas, tramos y registro | En la app y en *Acierto del modelo* |
| 4 | Riesgo de retirada y avisos físicos | Retirada reciente ×1,5 y ranking protegido ×2,2 (tasas de 2021-2023, comprobadas en 2024-2026); tiempo muerto médico sin fuente |

## Decisiones tomadas

- El ranking protegido pasó de la fase 2 a la 4. TennisMyLife no dice cómo entró cada uno al cuadro desde junio de 2026, y la
  fuente en directo es el cuadro final de ProTennisLive.
- *Valor* oculto hasta que una nueva fase 0 diga que el modelo gana a la cuota de cierre.
- Tiempos muertos médicos, para más adelante: LiveScore no los da (Hugo, 19-11-2026).
- Regla de Betway para las retiradas: tratada como «anula», sin confirmar en su reglamento de España (`RETIRE_RULE` en `src/picks.js`).

## Siguientes pasos

1. **Repetir la fase 0 con 4-6 semanas de cuotas** (ver abajo) y decidir con ella:
   - si *Valor* se enseña (`VALUE_VISIBLE`);
   - el peso de la mezcla (`PICKS.w`).

   Con una semana hay mucho margen: 103 de los 155 partidos tenían una sola casa. En diciembre no hay Challenger (de 2022 a 2025,
   el último torneo empezó la última semana de noviembre y el siguiente, entre el 30 de diciembre y el 5 de enero): con las cuotas de
   noviembre, las 4 semanas se juntan hacia mediados de enero y las 6, hacia finales de enero.
2. Mirar en *Acierto del modelo* cómo van «Challenger · Alta probabilidad» por tramo.
3. Fuente para los tiempos muertos médicos. Primero sólo guardarlos; peso cuando haya 3-6 meses medidos.
4. Confirmar la regla de Betway para las retiradas en su reglamento de España.
5. Revisión de Jordi y unión con `main`.

## Cómo repetir las mediciones

Los datos del motor están en el volumen de Docker `challenger`, que se llama `<proyecto>_challenger`: `sharpex_challenger` si el `.env` fija `COMPOSE_PROJECT_NAME=sharpex` (lo recomendado) o, si no, el nombre de la carpeta (`esportsstalker_challenger`). Míralo con `docker volume ls`. Desde la raíz del repo, en Git
Bash (en Windows, `MSYS_NO_PATHCONV=1` para que no cambie las rutas):

```bash
# Imagen del servidor al día (la construye el gateway) y modelo reentrenado tras cambiar el motor
docker compose up -d --build gateway challenger tennis
curl -X POST .../api/challenger/actualizar   # con sesión de administrador, o se reentrena solo cada día

# Validación del modelo (fases 1 y 2): pesos ajustados con el año anterior a --desde
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint node -v sharpex_challenger:/data:ro \
  -v "$PWD/server/sharpex-tenis:/motor:ro" sharpex-server --max-old-space-size=2000 \
  /motor/bin/sharpex-tenis.js validar --datos /data/datos --desde 2024-01-01 --pesos --variables actividad,local

# Riesgo de retirada (fase 4)
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint node -v sharpex_challenger:/data:ro \
  -v "$PWD/server/sharpex-tenis:/motor:ro" sharpex-server --max-old-space-size=2500 \
  /motor/scripts/medir-retiradas.mjs /data/datos
```

**Fase 0** (`server/sharpex-tenis/scripts/fase0-casa.mjs`) necesita dos ficheros en una carpeta **fuera del repo**:

1. `cuotas-prod.csv`: las cuotas de ganador de tenis de producción, con permiso (regla 9) y sólo lectura. Por SSH a la VM compartida:

   ```bash
   ssh <usuario>@<vm-compartida> 'docker exec -i sharpex-db-1 sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -q"' < exportar.sql > cuotas-prod.csv
   ```

   con `exportar.sql`:

   ```sql
   SET default_transaction_read_only = on;
   COPY (
     select m.key as match_key, m.league, m.start, h.book, h.outcome_id, h.price, h.ts, h.last_seen
     from odds.matches m join odds.price_history h on h.match_key = m.key
     where m.sport = 'tennis' and m.start >= '2026-11-10' and m.start < '2026-11-19'
       and h.market_key = 'moneyline|0||' and h.outcome_id in ('a', 'b')
     order by m.key, h.book, h.ts
   ) TO STDOUT WITH CSV HEADER;
   ```

2. `resultados.json`: los Challenger terminados de esos días. Salen de `GET /api/tennis/games?date=` de cualquier servicio de tenis
   (LiveScore), filtrando `level === 'challenger'` y guardando
   `{ id, day, date, tournament, round, state, a: a.name, b: b.name, aw: a.winner, bw: b.winner }`.

Luego cambia en el script los cortes de los dos modelos (M1 y M2: entrenados sólo con lo anterior a cada tramo de partidos). Lánzalo
con la carpeta montada:
`node --max-old-space-size=2500 /motor/scripts/fase0-casa.mjs /data/datos /carpeta`. Escribe `fase0-resultado.json` en esa carpeta.

## Notas para trabajar en él

- Los servicios de Node comparten la imagen `sharpex-server`, que sólo construye el `gateway`: para que un cambio del motor o del
  servicio `challenger` llegue al contenedor, `docker compose up -d --build gateway challenger`.
- El modelo guardado (`/data/modelo.json` del volumen) no se rehace al reconstruir: `POST /api/challenger/actualizar` o esperar al
  reentreno diario. Uno de una fase anterior predice como entonces hasta que se reentrena.
- Entrenar tiene que caber en 256 MB (unos 8-18 s y un `model.json` de 2,9 MB).
- Pruebas: `npm test` en la raíz (las del motor van en `server/sharpex-tenis/test/motor.test.js`; las del cuadro final de
  ProTennisLive, en `server/test/ptl.test.js`).
