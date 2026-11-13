# Sharpex Tenis · motor de valor para Challengers

Calcula la probabilidad real de cada partido Challenger, la compara con la cuota de la casa y te dice dónde hay valor. Cada pick se guarda con fecha y hora en un historial que no se puede retocar, y mide el **CLV** (si tu cuota fue mejor que la de cierre).

Node 18+, sin dependencias.

```bash
npm test                         # 16 tests (también entran en el npm test de la raíz)
node bin/sharpex-tenis.js demo   # crea datos simulados en ./demo y te dice qué probar
node bin/sharpex-tenis.js datos  # descarga el histórico real en ./datos (63 MB, ver "Datos"); cada semana
```

## Cómo funciona

1. **Modelo Elo por superficie** (`src/elo.js`)
   Cada jugador tiene un rating general y otro por superficie. La predicción mezcla los dos (`surfaceWeight`, 0.3 por defecto, ajustado con datos reales). Los ratings se calculan con Challengers, ATP, previas e ITF; sólo se apuesta en Challengers. La confianza de la predicción se rebaja un poco (`confidence`, 0.91): en el cuadro final de los Challengers el Elo se pasaba de confiado con los favoritos claros. El K baja a medida que el jugador acumula partidos y sube un poco tras un parón largo (vuelta de lesión). Si alguno de los dos tiene menos de 10 partidos en el histórico, el partido se marca como "pocos datos" y el escáner no lo recomienda.

2. **Validación sin trampas** (`src/evaluate.js`)
   El modelo predice cada partido *antes* de ver el resultado y solo se puntúan los Challengers desde la fecha que elijas. Saca el acierto, el Brier y el log-loss, más una tabla de calibración ("cuando dice 70 %, ¿gana el 70 %?"). Con `--ajustar` prueba combinaciones de parámetros **en el año anterior** a esa fecha, no en los partidos que puntúa (si no, las cifras salen mejores de lo que serán).

3. **Escáner** (`src/scanner.js`)
   - Quita el margen de la casa (método potencia, que carga más margen en el no favorito, como hacen las casas en tenis).
   - Calcula el valor (`prob × cuota − 1`) y el stake con cuarto de Kelly, con un tope del 3 % de la banca.
   - Empareja nombres escritos "como las casas" (`Nadal R.`, `R. Nadal`, `Nadal, Rafael`, apellidos compuestos…). Si un nombre es ambiguo, **no lo empareja**: mejor perder un pick que apostar al jugador equivocado. Las ambigüedades se resuelven con `--alias alias.json`.

4. **Historial a prueba de retoques** (`src/ledger.js`)
   Fichero JSON Lines con un hash encadenado. Si alguien cambia o borra un pick antiguo, `historial` lo detecta. Así podéis publicar el historial completo y cualquiera puede comprobar que no está maquillado.

## Datos

`datos` junta dos fuentes gratuitas:

- **[roblotlot/tennis-sackmann-archive](https://github.com/roblotlot/tennis-sackmann-archive)**, una copia de los CSV de Jeff Sackmann (su repositorio original ya no existe) que acaba el **1 de junio de 2026**. Por cada año: Challengers con las previas de ATP (`atp_matches_qual_chall_AAAA.csv`), cuadro final de ATP (`atp_matches_AAAA.csv`) e ITF (`atp_matches_futures_AAAA.csv`).
- **[TennisMyLife](https://stats.tennismylife.org/tennis-match-database)**, que se actualiza cada semana, para lo que falta desde 2026: `AAAA_challenger.csv` (sólo cuadro final, sin previas) y `AAAA.csv` (ATP). Se guardan como `tml_*.csv`. No tiene ITF. Es la misma fuente que ya usa el servicio de tenis (`server/services/tennis/tml.js`).

TennisMyLife usa los identificadores de la ATP y Sackmann los suyos. `mergeSources` (`src/data.js`) empareja a cada jugador por los partidos que están en las dos fuentes (mismo torneo y ronda: vale aunque el nombre se escriba distinto) o, si no, por nombre y país; si no se puede, entra como jugador nuevo. Los partidos repetidos se cuentan una vez. Con los datos de noviembre de 2026: 965 jugadores emparejados, 15 nuevos y 4 partidos de 4.700 contados dos veces.

La carpeta `datos/`, el modelo y el historial de picks están en `.gitignore`: no se suben al repo. **Vuelve a lanzar `datos` y `entrenar` cada semana**: es lo que más mejora el modelo (ver abajo).

Validación con datos reales (Challengers desde el 1-1-2024, parámetros ajustados con 2023):

| Historial | Partidos puntuados | Acierto | Brier | Log-loss | Cuando dice 82 %, gana… |
|---|---|---|---|---|---|
| Sólo Challengers (el de antes) | 20.696 | 63,0 % | 0,2259 | 0,6432 | 77 % |
| Challengers + ATP + previas + ITF (ahora) | los mismos 20.696 | 64,5 % | 0,2202 | 0,6301 | 79 % |
| Motor actual (con TennisMyLife hasta nov. 2026 y `confidence`), todos los que no son "pocos datos" | 27.908 | 65,5 % | 0,2151 | 0,6182 | 81 % |

Con más historial hay menos jugadores con pocos datos, así que se pueden puntuar (y recomendar) más partidos.

**Datos al día.** En los mismos 3.412 Challengers de junio a noviembre de 2026, el modelo parado el 1 de junio da log-loss 0,6543 (acierto 62,0 %); al día con TennisMyLife, 0,6422 (63,4 %). Es la mejora más grande de todas: siete veces lo que dan las estadísticas de saque. Esos partidos son sólo de cuadro final, que es más difícil que las previas: en el mismo tramo de 2025, con Sackmann, daba 0,6402.

**Lo que se ha probado y no se ha metido** (Challengers 2024-2026, ajuste con 2023):

| Idea | Log-loss | Por qué no |
|---|---|---|
| Elo actual | 0,6155 | |
| Margen de victoria (juegos ganados) | 0,6150 | Casi nada, y empeora la calibración de los favoritos claros |
| Rating inicial según el ranking | 0,6154 | Nada |
| Retiradas con medio peso | igual | Nada |
| Elo + puntos al saque y al resto (como `server/services/tennis/model.js`) | 0,6087 → 0,6068 (sin retiradas) | Mejora poco para lo que complica: los ITF no traen estadísticas. Es la siguiente mejora del modelo si hace falta |

## En la web: servicio `challenger`

Con `npm run backend` el motor corre como servicio (`server/services/challenger`, puerto 4008, detrás del gateway en `/api/challenger`):

- **Datos y modelo solos.** Al arrancar y cada día baja lo que falta (del archivo de Sackmann, sólo la primera vez; de TennisMyLife, siempre) al volumen `challenger` y reentrena en un proceso aparte con 256 MB (unos 7 s; la primera vez, con la descarga, unos 20 s). El modelo nuevo se lee en cuanto está; si falla, sigue el anterior y se vuelve a probar a las 6 horas.
- **Historial en PostgreSQL** (`challenger.historial`), con la misma cadena de hashes que el fichero de la línea de órdenes (`src/ledger.js`). La base de datos no deja cambiar ni borrar registros, y entra en `npm run db:backup`.

| Ruta | Quién | Qué hace |
|---|---|---|
| `POST /api/challenger/escanear` | con sesión (registrar: administrador) | Cuerpo `{ cuotas, superficie, torneo, casa, minEdge, minCuota, maxCuota, incluirPocosDatos, alias, registrar }`; `cuotas` en cualquiera de los formatos de abajo |
| `GET /api/challenger/historial` | con sesión | Picks, rendimiento, CLV y si la cadena está íntegra |
| `GET /api/challenger/comparar?fecha=AAAA-MM-DD` | con sesión | Los Challenger del día (LiveScore) con la probabilidad del modelo, la superficie (por la ciudad del torneo) y la cuota de apertura y de cierre de cada casa, con la probabilidad del mercado sin margen. Las cuotas las lee el lector dos veces por partido (`server/services/odds/scheduler.js`, ajuste *Leer los Challenger*) |
| `POST /api/challenger/picks/:id/cierre` | administrador | `{ cuota, rival? }` |
| `POST /api/challenger/picks/:id/resultado` | administrador | `{ resultado: won \| lost \| void }` (o ganada, perdida, nula) |
| `GET /api/challenger/estado` | con sesión | Jugadores, último partido, cuándo se entrenó y cómo fue la última actualización |
| `POST /api/challenger/actualizar` | administrador | Baja los datos y reentrena ya (responde enseguida) |

## Comandos

```bash
# 0. Histórico (Challengers, ATP e ITF desde 2015)
node bin/sharpex-tenis.js datos --carpeta datos

# 1. Ratings con el histórico
node bin/sharpex-tenis.js entrenar --datos datos/ --salida modelo.json

# 2. ¿Es bueno el modelo? (entrena con lo anterior, puntúa los Challengers desde la fecha)
node bin/sharpex-tenis.js validar --datos datos/ --desde 2024-01-01 --ajustar

# 3. Buscar valor en las cuotas de hoy y registrar los picks
node bin/sharpex-tenis.js escanear --modelo modelo.json --cuotas cuotas.json \
     --superficie Clay --min-edge 0.03 --registrar picks.jsonl

# 4. Justo antes del partido: guardar la cuota de cierre (para el CLV)
node bin/sharpex-tenis.js pick cierre --historial picks.jsonl --id <id> --cuota 1.85 --rival 2.05

# 5. Al acabar: resultado
node bin/sharpex-tenis.js pick resultado --historial picks.jsonl --id <id> --es won

# 6. Rendimiento + comprobación de integridad
node bin/sharpex-tenis.js historial --historial picks.jsonl
```

## Formatos

**Resultados históricos.** Se acepta cualquiera de estos dos:
- Ficheros de Jeff Sackmann `atp_matches_*.csv`. Entran los niveles de `--niveles` (por defecto `C,G,M,A,F,O,S,15,25`: todo menos la Copa Davis).
- Formato propio: `date,tourney,level,surface,round,winner,loser,score` (fecha `AAAA-MM-DD`).

**Cuotas.**
- JSON de los bookmarklets:
  ```json
  { "type": "TENNIS_EDGE_ODDS", "market": "winner", "surface": "Clay",
    "tournament": "Challenger Biella", "bookmaker": "Winamax",
    "entries": [ { "p1": "Nadal R.", "p2": "Alcaraz C.", "o1": 2.1, "o2": 1.75 } ] }
  ```
  También vale `player1/player2/odds1/odds2`. De momento solo se soporta el mercado de ganador del partido.
- CSV: `p1,p2,o1,o2,surface,tournament,start,bookmaker`

## ⚠️ Antes de usarlo en serio

- **Licencia de los datos:** los ficheros de Sackmann son **CC BY-NC-SA 4.0 (no comercial)** y TennisMyLife sólo permite uso personal y no comercial. Sirven para desarrollar y validar, pero **no para un producto de pago**. Para Sharpex Premium necesitáis una fuente propia o de pago.
- **Datos al día:** sin ITF ni previas de Challenger desde junio de 2026 (TennisMyLife no los tiene), y TennisMyLife va unos días por detrás. `entrenar` avisa si el último partido tiene más de dos semanas.
- **Acertar resultados no es ganar a la casa.** La validación compara con los resultados, no con las cuotas: el archivo no trae cuotas históricas. Que el modelo esté bien calibrado no dice si es mejor que la casa; eso sólo lo dirá el CLV de los picks registrados.
- **El modelo no lo sabe todo:** no tiene en cuenta lesiones, cansancio, viajes, altitud ni motivación. Por eso el CLV es la métrica que manda: si a la larga no ganáis al cierre, el modelo no tiene ventaja real, aunque una racha salga bien.

## Próximos pasos sugeridos

1. ~~Validar con datos reales y ajustar parámetros.~~ Hecho (ver "Datos").
2. ~~Meter también los partidos de ATP e ITF de esos jugadores.~~ Hecho.
3. ~~Completar los resultados desde junio de 2026.~~ Hecho con TennisMyLife. Falta lanzarlo solo cada semana (en el servicio) y, si se quiere ir al día, los resultados de ayer de LiveScore.
4. Guardar la cuota de cierre de forma automática (el bookmarklet o un scraper 5 minutos antes del partido).
5. Más mercados: total de juegos, hándicap.
6. ~~Exponerlo como API para la web de Sharpex.~~ Hecho: servicio `challenger` (arriba).
7. ~~Leer las cuotas de los Challenger con el lector (una por la mañana y la de cierre).~~ Hecho (`comparar`).
8. Con 4-6 semanas de cuotas y resultados, medir el modelo frente a la casa (log-loss del modelo, del mercado y de la mezcla) y decidir cuánto pesa cada uno. Después, picks solos en el historial y en la app de tenis.
