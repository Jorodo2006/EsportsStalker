// Firma de las cabeceras de usuario entre el gateway y los servicios.
// El gateway pone x-user-id y x-user-admin tras comprobar la sesión; con INTERNAL_SECRET también pone x-user-sig,
// un HMAC de ambas. Así, un contenedor que consiga hablar con un servicio no puede hacerse pasar por otro usuario
// ni por el administrador sin conocer el secreto. Sin INTERNAL_SECRET (desarrollo) no se firma ni se exige.
const crypto = require('crypto');

const secret = () => process.env.INTERNAL_SECRET || '';
const mac = (id, admin) => crypto.createHmac('sha256', secret()).update(`${id}|${admin}`).digest('hex');

// admin es '1' o '0', tal como viaja en la cabecera
function sign(id, admin) {
  return secret() ? mac(id, admin) : null;
}

function verify(id, admin, sig) {
  if (!secret()) return true;
  if (typeof sig !== 'string' || !sig) return false;
  const a = Buffer.from(mac(id, admin));
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { sign, verify };
