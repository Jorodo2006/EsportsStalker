# Motor de los Challenger, segunda versión — diseño

Fecha: 2026-11-19 · Estado: fase 1 hecha (ver «Fase 1: resultado»); pendiente de revisión por Jordi

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
   las que habrían sido recomendaciones. Necesita permiso de Jordi para leer su base de datos.
1. **Estadísticas de saque y resto, y calibración por tramos.**
2. Actividad, factor local y ranking protegido.
3. Mezcla con la casa, las dos salidas, los tramos y su registro.
4. Riesgo de retirada y avisos de tiempos muertos médicos (primero sólo guardándolos; peso cuando haya 3-6 meses medidos).

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

## Límites

- El archivo de Sackmann acaba el 1 de junio de 2026; desde entonces TennisMyLife sólo trae el cuadro final de los Challenger, sin
  previas ni ITF, y sus estadísticas llegan con días de retraso.
- Licencias: Sackmann es CC BY-NC-SA 4.0 y TennisMyLife sólo permite uso personal y no comercial (ver el `README.md` del motor).
