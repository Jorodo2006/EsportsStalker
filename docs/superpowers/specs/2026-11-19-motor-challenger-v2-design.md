# Motor de los Challenger, segunda versión — diseño

Fecha: 2026-11-19 · Estado: fases 0 a 4 hechas (ver sus «resultado»; de la 4 falta el tiempo muerto médico, sin fuente); pendiente de
revisión por Jordi

## Intención

Mejorar el motor de valor de los ATP Challenger (`server/sharpex-tenis`, servicio `challenger`) con el mismo rigor que el de
baloncesto: cada variable entra sólo si mejora las probabilidades con partidos que no se usaron para ajustarla, la probabilidad
final se mezcla con la de la casa con un peso medido y las recomendaciones salen en dos tipos, *Valor* y *Alta probabilidad*,
repartidas en tres tramos de cuota.

## Objetivos

- Probabilidad del modelo con el Elo de todos los niveles (lo que ya hay), las estadísticas de saque y resto y una calibración por
  tramos, más las variables propias de los Challenger que se han medido con efecto: actividad, factor local y ranking protegido.
- Mezcla con la casa sin margen (método potencia) con un peso medido con las cuotas de apertura y cierre que ya guarda el servicio.
- Riesgo de retirada (en los Challenger se retira alguien en el 4 % de los partidos) y avisos físicos.
- Dos salidas, *Valor* y *Alta probabilidad*, en cuotas bajas, medias y altas, cada tipo y tramo con su acierto por separado.

## No objetivos

- Tocar el modelo de baloncesto ni el de ATP y WTA (`server/services/tennis/model.js`).
- Cuotas de fuera de Winamax y Betway o de una API de cuotas (regla 1 de `AGENTS.md`).
- Usar los tiempos muertos médicos (Telegram) como variable del modelo antes de tener historial con el que medirlos.

## Anti-objetivos (aunque funcione, sería un fracaso)

- Que *Alta probabilidad* parezca una apuesta segura o rentable. Sin valor se pierde, de media, el margen de la casa: el valor
  esperado se enseña siempre y la etiqueta dice «sin ventaja sobre la casa». Nada de «fiable», «segura» ni «garantizada»
  («fiabilidad» en la app es otra cosa: cuánto nos fiamos del cálculo).
- Meter una variable porque «tiene sentido» sin medirla, o ajustarla y evaluarla con los mismos partidos.
- Penalizar a un jugador por un aviso de otro (nombres mal emparejados): ante la duda, el aviso no se guarda.
- Que una discrepancia grande con la casa salga como valor: casi siempre es una cuota mal leída o una lesión que el modelo no sabe.

## Lo medido antes de diseñar

Cuadro final de los Challenger, 14.108 partidos de 2024 a mayo de 2026 (archivo de Sackmann), pesos ajustados con 2023. Residuo
positivo: el jugador gana más de lo que dice el Elo. Log-loss: error de las probabilidades (más bajo, mejor; el Elo de hoy da
0,6311).

| Variable | Efecto (± margen al 95 %) | Log-loss | Decisión |
|---|---|---|---|
| Torneos jugados en las 5 semanas anteriores | 4 o más: +1,8 pts (±1,0); 1: −2,5 (±1,7) | −0,0013 | Entra (es forma, no cansancio) |
| Juega en su país | +2,1 pts (±1,1) | −0,0006 | Entra |
| Ranking protegido (vuelve de lesión) | −7,8 pts (±6,3), 216 casos | — | Aviso y, si se confirma, peso |
| Cambia de país respecto a la semana anterior | sin efecto | −0,0002 | No |
| Entra con invitación, desde la previa o como lucky loser | sin efecto | 0 | No |
| Se retiró hace 5 semanas o menos | −1,9 (±2,0) | −0,0002 | Sólo para el riesgo de retirada |
| Ranking frente al Elo | el Elo ya lo recoge | 0 | No |
| Ronda (motivación) | bien calibrado en todas | — | No |
| Estadísticas de saque y resto (medido en la fase 1) | — | −0,0027 | Entra: es lo que más aporta |

- En este experimento (un Elo propio que no contaba las retiradas) el Elo se pasaba de confiado con los favoritos claros: decía
  92,8 % y pasaba el 88,0 %. Con el Elo real del motor es mucho menos (dice 92,2 % y pasa el 91,5 %): ver la fase 1.
- Margen de las casas en el ganador (cuotas guardadas en local, noviembre de 2026): Challenger 7,9 % en Winamax y 7,3 % en Betway;
  ATP y WTA, 5,5 %. El modelo tiene que acertar más que la casa por más que eso para que haya valor.
- Retiradas: 4 % de los partidos en los Challenger, frente al 1,5 % en la ATP. En la ATP y la WTA, quien se retiró hace menos de
  5 semanas vuelve a retirarse el doble (2,9-3,0 % frente a 1,4-1,5 %) sin rendir peor cuando acaba el partido.

## Estructura

### Capa 1: probabilidad del modelo (sin mirar la casa)

```
logit p_modelo = calibración( wE · logit(p_Elo) + wS · logit(p_estadísticas) )
               + βA · Δactividad + βL · Δlocal + βPR · ΔPR
```

- `p_Elo`: el de `src/elo.js` (Challengers, ATP, previas e ITF desde 2015; 30 % de superficie; K que sube tras un parón).
- `p_estadísticas`: puntos ganados al saque y al resto por encima de la media de la superficie, corregidos por el rival y con los
  partidos recientes pesando más (como `server/services/tennis/model.js`), pasados a probabilidad de ganar el partido punto a
  punto. Con poca muestra (los ITF no traen estadísticas) tiran hacia la media y manda el Elo.
- `calibración`: corrección por tramos ajustada con un año distinto del evaluado, para quitar el exceso de confianza con los
  favoritos claros.
- `Δ`: diferencia entre los dos jugadores, normalizada. Actividad: torneos en las 5 semanas anteriores (hasta 4) y partidos de la
  semana anterior. Local: si juega en el país del torneo (tabla de ciudades, como la de superficies). PR: si entra con ranking
  protegido.

### Capa 2: mezcla con la casa

```
p_final = σ( w · logit p_modelo + (1 − w) · logit p_casa_sin_margen )
```

- Sin margen con el método potencia (`src/odds.js`).
- `w` se mide con las cuotas de apertura y de cierre que guarda el servicio (`/api/challenger/comparar`) y los resultados: el que
  dé menos log-loss en un periodo, comprobado en otro. Hasta tenerlo, el de las otras apps (25 %).
- Fuera lo que discrepe de la casa en más de 20 puntos.

### Capa 3: riesgo de retirada

`P(retirada)` desde el 4 % de los Challenger, subiendo con una retirada reciente, el ranking protegido y un tiempo muerto médico
reciente. Sólo cambia el valor esperado según cómo pague cada casa una retirada (hay que confirmarlo en sus reglas); en la
resolución automática de la app las retiradas ya se resuelven a mano.

## Salidas

| | Cuota baja (1,15-1,60) | Media (1,60-2,50) | Alta (2,50-6,00) |
|---|---|---|---|
| *Valor*: valor esperado mínimo con `p_final` | +3 % | +4 % | +7 % |
| *Alta probabilidad*: `p_final` mínima | 75 % | 75 % | — |

- Las dos: jugadores con datos suficientes, fiabilidad del cálculo ≥ 55 (≥ 65 en *Alta probabilidad*) y sin discrepar de la casa
  más de 20 puntos.
- *Alta probabilidad*, además: valor esperado ≥ −3 %, modelo y casa a menos de 5 puntos y ningún aviso físico.
- En el sistema:

```
{ tipo: 'valor' | 'probabilidad', tramo: 'baja' | 'media' | 'alta', p, pModelo, pCasa, valor, fiabilidad,
  avisos: ['local', 'ranking_protegido', 'retirada_reciente', 'tmo_reciente', 'pocos_datos'] }
```

- En la app: «Valor +5,2 %» en el acento; «Alta probabilidad · 81 % · sin ventaja sobre la casa» en gris; los avisos como
  etiquetas. El acierto de cada tipo y tramo se mide aparte en *Acierto del modelo*.

## Validación y criterios de aceptación

- Ajuste con un periodo y evaluación con otro, siempre: los pesos de las capas 1 y 2 con 2023 y la evaluación con 2024-2026.
- Una pieza entra si baja el log-loss de la evaluación y no empeora la calibración de ningún tramo de probabilidad más allá de su
  margen. Las cifras van a la tabla del `README.md` del motor, también las de lo que se pruebe y no entre.
- La categoría *Valor* sólo se enseña si la fase 0 dice que el modelo aporta algo frente a la cuota de cierre.

## Fases

0. **Comprobar la premisa** con los Challenger ya guardados en producción: log-loss de la casa, del modelo y de la mezcla, y CLV de
   las que habrían sido recomendaciones. Hecha (permiso de Jordi, Hugo y Roberto; regla 9 de `AGENTS.md`). Repetirla cuando haya
   4-6 semanas de cuotas: con una semana, las cifras tienen mucho margen.
1. **Estadísticas de saque y resto, y calibración por tramos.** Hecha.
2. **Actividad y factor local.** Hecha. El ranking protegido pasa a la fase 4 (ver «Fase 2: resultado»).
3. **Mezcla con la casa, las dos salidas, los tramos y su registro.** Hecha (Valor, oculto: ver «Fase 0: resultado»).
4. **Riesgo de retirada y avisos físicos.** Hecha la retirada reciente y el ranking protegido (del cuadro final de ProTennisLive).
   El tiempo muerto médico queda para más adelante: LiveScore no lo da y no hay otra fuente (19-11-2026, decisión de Hugo).

## Fase 4: resultado (19-11-2026)

**Riesgo de retirada** (`retirementRisk` en `src/form.js`), medido en los Challenger del histórico (cuadro final y previas), con las
tasas de 2021-2023 y la comprobación en 2024-2026. Se retira alguno en el 3,6-3,8 % de los partidos; cada jugador, en el 1,8 %:

| Jugador | 2021-2023 (tasas) | 2024-2026 (comprobación) |
|---|---|---|
| Sin retirada en los 90 días anteriores | 1,67 % | 1,69 % |
| Se retiró en los últimos 90 días | 2,49 % (×1,5) | 2,90 % (×1,7) |
| Con ranking protegido (sólo Sackmann, que dice la entrada) | 4,04 % (×2,2; 470 casos) | 3,11 % (×1,7; 386) |
| Vuelve tras 180 días o más sin jugar | 1,73 % | 2,30 % |

- Entran la retirada reciente (×1,5) y el ranking protegido (×2,2): `r = 1,67 % × 1,5 × 2,2` según lo que tenga cada uno. El
  parón largo no cambia nada claro y no entra. Por separado, 14 y 15-35 días dan lo mismo que 36-90 (2,5 % en 2021-2023).
- **Cómo pagan las casas** (`RETIRE_RULE` en `src/picks.js`): Winamax anula la apuesta al ganador si uno se retira (su reglamento,
  sección Tenis; la «Garantía Abandono», que la paga, es sólo para la ATP y la WTA: los Challenger no entran). Betway, también según
  las comparativas, sin confirmar en su reglamento de España. Con la apuesta anulada, una retirada devuelve lo apostado: el valor
  esperado es `(1 − r) · (p · cuota − 1)`, con r el riesgo de los dos.
- **Avisos físicos:** `retirada_reciente` (en los últimos 90 días) y `ranking_protegido`, con de qué jugador es cada uno (`who`).
  Con uno, no hay *Alta probabilidad*. El modelo guarda la fecha de la última retirada de cada jugador (`lastRet`); el 19-11-2026,
  2.982 jugadores tienen una y 84 en los últimos 90 días.
- **Ranking protegido en directo:** del cuadro final de cada Challenger en ProTennisLive (`mds.pdf`, `parseEntries` en
  `server/services/tennis/ptlpdf.js`), que marca con PR a quien entra con él (en Champaign, noviembre de 2026: Patrick Maloney).
  El servicio tennis lo pone en `entry` de cada jugador de los Challenger de LiveScore y el motor lo recibe en `predict`.
- **Tiempo muerto médico:** sin fuente (LiveScore no lo trae en sus incidencias). El aviso `tmo_reciente` existe y quita la alta
  probabilidad, pero nada lo pone todavía.

## Fase 0: resultado (19-11-2026)

Cuotas de ganador de producción (sólo lectura) de los Challenger del cuadro final del 12 al 18 de noviembre, resultados de LiveScore
y el motor entrenado sólo con lo anterior a cada partido (con datos hasta el 8 de noviembre los del 12 al 15, y hasta el 15 los del
16 al 18). 155 partidos medibles: 50 sin cuotas, 4 con un jugador sin emparejar y 2 con pocos datos. 103 de los 155 tenían una sola
casa, y la cuota se movió de media 1,6 puntos de la apertura al cierre.

| | Log-loss |
|---|---|
| Casa (apertura / cierre, sin margen) | 0,5931 / 0,5932 |
| Modelo solo | 0,5955 |
| Mezcla al 25 % con la apertura / con el cierre | 0,5901 / 0,5900 |

- La mezcla al 25 % baja el log-loss de la casa de cierre en 0,0031, con un error de ±0,0042: mejora, pero no se puede dar por
  segura. Con el 10 %, −0,0015 ± 0,0017.
- **Peso de la mezcla:** el mejor en la mitad grande (16-18, 119 partidos) es 0,15 con la apertura y 0,20 con el cierre, y comprobado
  en la otra mitad (12-15, 36) también gana a la casa (0,6657 frente a 0,6751). Ajustado en la mitad pequeña sale 1, que en la grande
  es peor que la casa: con 36 partidos no vale. Se usa **w = 0,20**.
- **Valor frente a la cuota de cierre:** las que el modelo solo daría como valor (58) pierden frente al cierre: CLV −7,2 % ± 1,3 %
  y sólo el 36 % mejora la cuota de cierre, en los tres tramos. Con la mezcla al 25 % y los umbrales de abajo sale una sola en 155
  partidos. **El modelo no aporta nada frente a la cuota de cierre: *Valor* se calcula y se registra, pero no se enseña**
  (`VALUE_VISIBLE` en `src/picks.js`), hasta que el CLV de las registradas diga lo contrario.

## Fase 3: resultado (19-11-2026)

- **Motor** (`src/picks.js`): `blendWithMarket` (w 0,20), `marketOf` (lo último de cada casa, sin margen por el método potencia,
  la mejor cuota de cada uno), `reliabilityOf` (datos de los jugadores, acuerdo con la casa, cuotas y contexto; misma forma que la
  del tenis) y `picksOfMatch` con los tramos y mínimos de «Salidas». Avisos de ahora: `local`, `pocos_datos` (menos de 25 partidos)
  y `datos_viejos` (actividad sin la semana anterior); los físicos llegan con la fase 4.
- **Servicio:** `GET /api/challenger/recomendaciones?fecha=` (con sesión): los Challenger del día sin empezar con el modelo, la casa,
  la mezcla, la fiabilidad, los avisos y las recomendaciones. Se guarda un minuto por día.
- **App:** pestaña *Recomendaciones* en la ficha de cada Challenger, el circuito *Challenger* en la pantalla *Recomendaciones* del
  tenis (con *Todos*, debajo de la ATP y la WTA), las de alta probabilidad en *Las más fiables del día* y en la columna del partido
  elegido. *Alta probabilidad* dice siempre «sin ventaja sobre la casa» y su valor esperado; *Valor*, oculto con su motivo.
- **Registro:** se apuntan todas en *Acierto del modelo*, en grupos «Challenger · Alta probabilidad · cuota baja», «Challenger ·
  Valor · cuota media»…; las de Valor ocultas, sin el aviso de recomendación fuerte (`logPredictions` con `alert: false`).
- El 19-11-2026, de los 21 Challenger sin empezar, 3 con alta probabilidad (78-80 %, cuota 1,22-1,25, valor −2,5 a −2,8 %), 15 sin
  ninguna que llegue al nivel, 2 con pocos datos y 1 sin cuotas.

## Fase 1: resultado (19-11-2026)

Saque y resto (`src/stats.js`) y la cola de la calibración (`tailSlope` en `src/elo.js`), con pesos y parámetros elegidos con 2023
(`fitWeights`). En los 28.117 Challengers del 1-1-2024 al 14-11-2026 (cuadro final y previas, sin jugadores con pocos datos):

| Modelo | Log-loss | Brier | Acierto |
|---|---|---|---|
| Elo solo (el de antes) | 0,6184 | 0,2152 | 65,5 % |
| Elo con la cola recalibrada | 0,6184 | 0,2152 | 65,5 % |
| Elo + saque y resto + cola (el de ahora) | **0,6157** | **0,2141** | 65,5 % |

- La mejora se repite en los dos tramos (Sackmann hasta mayo de 2026: 0,6149 → 0,6122; TennisMyLife de junio a noviembre:
  0,6400 → 0,6373) y no empeora la calibración de ningún tramo.
- Es menos de lo esperado (el README daba −0,0068 por una prueba anterior cuyo código no está): sigue siendo lo que más aporta,
  el doble que la actividad (−0,0013) y cuatro veces el factor local (−0,0006).
- La cola apenas cambia nada: con el Elo real, el exceso de confianza con los favoritos es pequeño. Se queda porque no empeora.
- No contar las retiradas en saque y resto: igual. No entra.
- Entrenar con 256 MB: 17 s, `model.json` de 2,8 MB.

## Fase 2: resultado (19-11-2026)

Actividad y factor local (`src/form.js`) en el logit, con sus pesos ajustados con 2023 junto a los de la fase 1 (`fitWeights`
con `features`). En los mismos 28.117 Challengers del 1-1-2024 al 14-11-2026:

| Modelo | Log-loss | Brier | Acierto |
|---|---|---|---|
| Fase 1 | 0,6157 | 0,2141 | 65,5 % |
| + torneos en las 5 semanas anteriores | 0,6138 | 0,2133 | 65,7 % |
| + partidos de la semana anterior | 0,6155 | 0,2140 | 65,6 % |
| + juega en su país | 0,6153 | 0,2139 | 65,7 % |
| **+ torneos en 5 semanas y juega en su país (el de ahora)** | **0,6134** | **0,2131** | 65,8 % |

- Entran los torneos de las 5 semanas anteriores (`bWeeks` 0,101) y jugar en su país (`bHome` 0,107). Mejoran los dos tramos
  (Sackmann hasta mayo de 2026: 0,6122 → 0,6097; TennisMyLife desde junio: 0,6373 → 0,6364) y ningún tramo de probabilidad
  empeora más allá de su margen.
- Los partidos de la semana anterior no entran: con los torneos de 5 semanas no añaden nada (0,6139 frente a 0,6138).
- El país del torneo: el de la mayoría de sus invitados en todas sus ediciones (396 de 455 ciudades) y, en directo, el del nombre
  de LiveScore. Desde junio de 2026 TennisMyLife no dice quién entra invitado: las ciudades nuevas se quedan sin país al evaluar.
- **Ranking protegido, a la fase 4:** Sackmann trae la entrada al cuadro, pero desde junio de 2026 TennisMyLife la deja vacía (7.114
  de 7.124 partidos) y en directo nadie la da, así que no se podría usar al predecir.
- En directo, si el modelo no llega a la semana anterior al partido (TennisMyLife va con días de retraso), la actividad no cuenta
  (`factors.stale`).
- Entrenar con 256 MB: 8 s, `model.json` de 2,9 MB. `comparar` devuelve `modelo.factores` de cada partido.

## Límites

- El archivo de Sackmann acaba el 1 de junio de 2026; desde entonces TennisMyLife sólo trae el cuadro final de los Challenger, sin
  previas ni ITF, y sus estadísticas llegan con días de retraso.
- Licencias: Sackmann es CC BY-NC-SA 4.0 y TennisMyLife sólo permite uso personal y no comercial (ver el `README.md` del motor).
