-- Los ajustes pasan a ser de la app entera: sólo los cambia el administrador y valen para todos. La moneda, las casas del
-- comparador y el refresco eran de cada usuario: se quedan los del primer administrador para todos (si no había ya uno común).
-- La banca inicial y el filtro de ligas siguen siendo de cada uno (USER_KEYS en store.js)
INSERT INTO bets.settings (key, value)
SELECT us.key, us.value
FROM bets.user_settings us
JOIN (SELECT id FROM bets.users WHERE is_admin ORDER BY id LIMIT 1) admin ON admin.id = us.user_id
WHERE us.key IN ('currency', 'featuredBooks', 'refreshSeconds')
ON CONFLICT (key) DO NOTHING;

DELETE FROM bets.user_settings WHERE key IN ('currency', 'featuredBooks', 'refreshSeconds');
