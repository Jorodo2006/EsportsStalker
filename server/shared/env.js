// Credenciales del fichero .env de la raíz del proyecto. Docker Compose las mete como variables de entorno
// en cada contenedor (env_file), así que aquí sólo se traducen a nombres de ajuste.
// Lo que venga del .env manda sobre lo guardado en la base de datos.
const MAP = {
  LEAGUEPEDIA_USER: 'leaguepediaUser',
  LEAGUEPEDIA_PASSWORD: 'leaguepediaPassword',
  LOLESPORTS_KEY: 'lolesportsKey'
};

// Ajustes que vienen del .env (sólo los que tienen valor)
function settings() {
  const out = {};
  for (const [k, key] of Object.entries(MAP)) if (process.env[k]) out[key] = process.env[k];
  return out;
}

module.exports = { settings, MAP };
