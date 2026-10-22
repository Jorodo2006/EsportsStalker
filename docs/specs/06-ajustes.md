# 06 · Ajustes y pendientes

## Ajustes (`src/views/SettingsView.tsx`, valores por defecto en `store.js`)

| Ajuste | Por defecto | Uso |
|---|---|---|
| `currency` | `€` | Moneda de las cantidades |
| `initialBankroll` | 0 | Banca inicial, que se suma al beneficio |
| `featuredBooks` | `Bet365,Winamax,Betway` | Columnas del comparador y su orden |
| `refreshSeconds` | 30 | Refresco del calendario y del directo (mínimo 10) |
| `favoriteLeagues` | `[]` | Ligas que salen primero |
| `lolesportsKey` | clave pública de lolesports.com | Cabecera `x-api-key` |
| `leaguepediaUser` / `leaguepediaPassword` | vacío | *Bot password* de Fandom (opcional). **Sólo en `data.json`, nunca en el repo** |

Secciones de la pantalla:

- **Preferencias.**
- **Fuentes de datos**: incluye *Probar conexiones* para comprobar lolesports y Leaguepedia.
- **Cuotas automáticas**: carpeta de la extensión, con un botón para abrirla y los pasos para cargarla en
  `chrome://extensions` con *Cargar descomprimida*.
- **Marcador de cuotas**: un enlace que se arrastra a la barra de favoritos.

Al cargar los ajustes:

- las listas antiguas de casas pasan a la nueva (`OLD_FEATURED`);
- se borran los ajustes de las antiguas APIs de cuotas (`OBSOLETE`: Pinnacle, OddsPapi, Kambi).

## Historial de decisiones

- **Se quitaron las APIs de cuotas** (Pinnacle, OddsPapi, Unibet/Kambi) porque el usuario no quiere fuentes de pago
  ni APIs de cuotas. Desde entonces las cuotas sólo se leen de las páginas, con el marcador o la extensión.
- **Se quitó William Hill.** Se quedan Bet365, Winamax y Betway.
- **Se eligió la extensión de Chrome** para automatizar, frente a un navegador controlado por la app, porque usa el
  Chrome real del usuario, sin bloqueos anti-bot.
- **Rediseño del comparador**: tres columnas fijas por casa con icono, mercados plegables y pestañas de sección.
- **Combinadas** con boleto flotante, formulario por selecciones y historial desplegable.

## Pendientes

- Lector de los mercados generales de Bet365, que necesita una captura con contenido (ver [03-cuotas.md](03-cuotas.md)).
- Iconos reales de las casas en `src/assets/books/` (opcional).
