// Reglas del panel de administración. Todo es puro (sin base de datos) para poder probarlo con npm test; admin.js las aplica
// dentro de una transacción, con el candado que evita que dos administradores se quiten el rol a la vez.

// Misma regla que el registro (auth.js): 3 a 30 letras, números o . _ -
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,30}$/u;
const validUsername = name => USERNAME_RE.test(String(name ?? ''));

// Devuelve el mensaje de error, o null si el cambio se puede hacer. target: la cuenta tal como está ahora;
// activeAdmins: cuántos administradores hay sin suspender (contando a target si lo es)
function checkUserChange({ actorId, target, patch, activeAdmins }) {
  const self = String(actorId) === String(target.id);
  if (patch.username !== undefined && !validUsername(patch.username)) return 'El usuario debe tener de 3 a 30 letras, números o . _ -';
  // Quitarse uno mismo el rol o suspenderse deja la sesión sin poder deshacerlo: que lo haga otro administrador
  if (self && patch.isAdmin === false) return 'No puedes quitarte a ti mismo el rol de administrador';
  if (self && patch.suspended === true) return 'No puedes suspender tu propia cuenta';
  // Un administrador suspendido ya no cuenta como activo, así que degradarlo no deja a nadie sin acceso
  const losesAdmin = target.isAdmin && !target.suspended && (patch.isAdmin === false || patch.suspended === true);
  if (losesAdmin && activeAdmins <= 1) return 'Tiene que quedar al menos un administrador activo';
  return null;
}

// Borrar arrastra apuestas, amigos y mensajes: sólo una cuenta ya suspendida y confirmando su nombre exacto
function checkDelete({ actorId, target, confirm, targetName }) {
  if (String(actorId) === String(target.id)) return 'No puedes borrar tu propia cuenta';
  if (!target.suspended) return 'Suspende la cuenta antes de borrarla';
  if (!confirm || confirm !== targetName) return 'Escribe el nombre de la cuenta para confirmar';
  return null;
}

// Lo que se guarda en el detalle del registro nunca lleva contraseñas ni tokens, aunque alguien los pase por error
const SECRET = /pass|contraseña|token/i;
function redact(detail) {
  if (Array.isArray(detail)) return detail.map(redact);
  if (!detail || typeof detail !== 'object') return detail;
  return Object.fromEntries(Object.entries(detail).filter(([k]) => !SECRET.test(k)).map(([k, v]) => [k, redact(v)]));
}

// El último acceso se anota como mucho cada 5 min: userOf corre en cada petición y no debe escribir en la base cada vez
const SEEN_EVERY_MS = 5 * 60e3;
const seenStale = (lastSeen, now = Date.now()) => !lastSeen || now - new Date(lastSeen).getTime() >= SEEN_EVERY_MS;

module.exports = { validUsername, checkUserChange, checkDelete, redact, seenStale, SEEN_EVERY_MS };
