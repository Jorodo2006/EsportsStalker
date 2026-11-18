// Textos de ESPN en castellano para enseñarlos: la posición del jugador y su parte médico.
// Sólo al pintar: el modelo y los filtros siguen leyendo el original en inglés ("Out", "Day-To-Day"; badInjury, playerOut)
const POS: Record<string, string> = {
  PG: 'Base', SG: 'Escolta', SF: 'Alero', PF: 'Ala-pívot', C: 'Pívot', G: 'Exterior', F: 'Alero',
  'G-F': 'Escolta-alero', 'F-G': 'Alero-escolta', 'F-C': 'Ala-pívot', 'C-F': 'Pívot-ala',
  Guard: 'Exterior', Forward: 'Alero', Center: 'Pívot'
};
const INJURY: Record<string, string> = {
  Out: 'Baja', 'Day-To-Day': 'Duda', Questionable: 'Duda', Doubtful: 'Muy dudoso', Probable: 'Probable',
  Suspension: 'Sanción', 'Injured Reserve': 'Baja larga', 'Out For Season': 'Baja para la temporada'
};

export const posEs = (p?: string | null) => (p ? POS[p] ?? p : '');
export const injuryEs = (s?: string | null) => (s ? INJURY[s] ?? s : '');

// El detalle del parte ("Knee · Soreness"), palabra a palabra: lo que no está en la lista se queda como viene
const BODY: Record<string, string> = {
  'lower back': 'lumbares', 'not injury related': 'sin lesión', 'injury management': 'dosificación', 'left': 'izquierda', 'right': 'derecha',
  knee: 'rodilla', ankle: 'tobillo', hamstring: 'isquiotibiales', foot: 'pie', back: 'espalda', hip: 'cadera', shoulder: 'hombro',
  calf: 'gemelo', groin: 'ingle', wrist: 'muñeca', hand: 'mano', finger: 'dedo', thumb: 'pulgar', elbow: 'codo', achilles: 'Aquiles',
  concussion: 'conmoción', illness: 'enfermedad', rest: 'descanso', personal: 'motivos personales', toe: 'dedo del pie',
  quadriceps: 'cuádriceps', thigh: 'muslo', neck: 'cuello', head: 'cabeza', oblique: 'oblicuo', rib: 'costilla', leg: 'pierna',
  heel: 'talón', face: 'cara', eye: 'ojo', nose: 'nariz', chest: 'pecho', soreness: 'molestias', sprain: 'esguince', strain: 'distensión',
  surgery: 'operación', fracture: 'fractura', contusion: 'contusión', tear: 'rotura', bruise: 'contusión', tendinitis: 'tendinitis',
  inflammation: 'inflamación', suspension: 'sanción', other: 'otros'
};
const BODY_RE = new RegExp(`\\b(${Object.keys(BODY).sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi');
export const injuryDetailEs = (s?: string | null) => {
  const t = String(s || '').replace(BODY_RE, w => BODY[w.toLowerCase()] ?? w);
  return t.charAt(0).toUpperCase() + t.slice(1);
};
