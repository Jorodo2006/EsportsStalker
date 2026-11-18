// Fecha y hora corta para las listas del panel de administración
export const fmtWhen = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
