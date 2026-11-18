import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import type { AdminUser } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { useUser } from '@/components/AuthGate';
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Input, Loading, panelCls, td, th } from '@/components/ui';
import { fmtWhen } from '@/views/admin/shared';

// Usuarios: lista y acciones sobre la cuenta. Del dinero y las apuestas de cada uno sólo se ve cuántas hay. El servidor es quien
// decide qué se puede (último administrador, la propia cuenta…): aquí sólo se deshabilita lo evidente y se enseña su mensaje
export default function UsersTab() {
  const me = useUser().data;
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  // Se pide al abrir y tras cada acción; sin consultas periódicas
  const q = useQuery({ queryKey: ['admin', 'users'], queryFn: () => window.api.admin.users(), staleTime: 0, refetchOnWindowFocus: false });
  const list = useMemo(() => (q.data ?? []).filter(u => u.username.toLowerCase().includes(filter.trim().toLowerCase())), [q.data, filter]);
  const picked = q.data?.find(u => u.id === sel) ?? null;

  const names = (u: AdminUser) => (
    <>
      <span className="font-medium text-zinc-100">{u.username}</span>
      {u.isAdmin && <Badge tone="info">Admin</Badge>}
      {u.suspended && <Badge tone="danger">Suspendida</Badge>}
      {!!u.googleEmail && <Badge>Google</Badge>}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar usuario" className="pl-9" aria-label="Buscar usuario" />
        </div>
        <Button variant="secondary" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw size={14} className={q.isFetching ? 'animate-spin' : ''} />Actualizar</Button>
        <span className="text-xs text-zinc-500">{q.data ? `${list.length} de ${q.data.length}` : ''}</span>
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && !list.length && <Empty>No hay usuarios que coincidan.</Empty>}

      {!!list.length && (
        <>
          <div className={`${panelCls} hidden overflow-x-auto lg:block`}>
            <table className="w-full">
              <thead className="border-b border-zinc-800">
                <tr><th className={th}>Usuario</th><th className={th}>Alta</th><th className={th}>Último acceso</th><th className={`${th} text-right`}>Apuestas</th><th className={`${th} text-right`}>Sesiones</th><th className={th} /></tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {list.map(u => (
                  <tr key={u.id}>
                    <td className={td}><div className="flex flex-wrap items-center gap-2">{names(u)}</div></td>
                    <td className={`${td} text-zinc-400`}>{fmtDate(u.createdAt)}</td>
                    <td className={`${td} text-zinc-400`}>{fmtWhen(u.lastSeenAt)}</td>
                    <td className={`${td} text-right tnum`}>{u.bets}</td>
                    <td className={`${td} text-right tnum`}>{u.sessions}</td>
                    <td className={`${td} text-right`}><Button size="sm" variant="secondary" onClick={() => setSel(u.id)}>Gestionar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 lg:hidden">
            {list.map(u => (
              <div key={u.id} className={`${panelCls} flex flex-col gap-2 p-3`}>
                <div className="flex flex-wrap items-center gap-2">{names(u)}</div>
                <div className="text-xs text-zinc-400">Alta {fmtDate(u.createdAt)} · Último acceso {fmtWhen(u.lastSeenAt)}</div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-400 tnum">{u.bets} apuestas · {u.sessions} sesiones</span>
                  <Button size="sm" variant="secondary" onClick={() => setSel(u.id)}>Gestionar</Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {picked && me && <ManageDialog key={picked.id} user={picked} meId={me.id} onClose={() => setSel(null)} />}
    </div>
  );
}

type Mode = 'menu' | 'rename' | 'password' | 'delete';

function ManageDialog({ user, meId, onClose }: { user: AdminUser; meId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const [mode, setMode] = useState<Mode>('menu');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const self = user.id === meId;

  async function run(fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true); setErr(null);
    try {
      await fn();
      toast(ok);
      await qc.invalidateQueries({ queryKey: ['admin'] });
      setText(''); setMode('menu');
      after?.();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const go = (m: Mode, initial = '') => { setMode(m); setText(initial); setErr(null); };
  const api = window.api.admin;

  const row = (title: string, desc: string, button: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-800 py-3 last:border-0">
      <div className="min-w-0"><div className="text-sm font-medium text-zinc-100">{title}</div><div className="text-xs text-zinc-500">{desc}</div></div>
      <div className="shrink-0">{button}</div>
    </div>
  );

  return (
    <Dialog open onClose={onClose} title={<>{user.username}{user.isAdmin && <Badge tone="info">Admin</Badge>}{user.suspended && <Badge tone="danger">Suspendida</Badge>}</>}>
      {err && <div className="mb-3 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-300" role="alert">{err}</div>}

      {mode === 'menu' && (
        <div>
          {row('Nombre de usuario', 'Cambiarlo no afecta a sus amigos ni a sus apuestas.', <Button size="sm" variant="secondary" onClick={() => go('rename', user.username)}>Renombrar</Button>)}
          {row('Rol de administrador', user.isAdmin ? 'Quitarlo le deja con una cuenta normal.' : 'Podrá gestionar cuentas y los ajustes de la app.',
            <Button size="sm" variant="secondary" disabled={busy || self} title={self ? 'No puedes quitarte el rol a ti mismo' : undefined}
              onClick={() => run(() => api.updateUser(user.id, { isAdmin: !user.isAdmin }), user.isAdmin ? 'Rol quitado' : 'Ahora es administrador')}>{user.isAdmin ? 'Quitar rol' : 'Dar rol'}</Button>)}
          {row(user.suspended ? 'Cuenta suspendida' : 'Suspender', user.suspended ? 'No puede entrar. Reactivarla le deja volver a iniciar sesión.' : 'No podrá entrar y se cierran sus sesiones al momento.',
            <Button size="sm" variant={user.suspended ? 'success' : 'danger'} disabled={busy || self} title={self ? 'No puedes suspender tu propia cuenta' : undefined}
              onClick={() => run(() => api.updateUser(user.id, { suspended: !user.suspended }), user.suspended ? 'Cuenta reactivada' : 'Cuenta suspendida')}>{user.suspended ? 'Reactivar' : 'Suspender'}</Button>)}
          {row('Contraseña temporal', 'Le pones una y se cierran todas sus sesiones. Debe cambiarla al entrar.', <Button size="sm" variant="secondary" onClick={() => go('password')}>Cambiar</Button>)}
          {row('Cerrar sesiones', `Ahora tiene ${user.sessions} abierta${user.sessions === 1 ? '' : 's'}.`,
            <Button size="sm" variant="secondary" disabled={busy || !user.sessions}
              onClick={() => run(() => api.closeSessions(user.id), 'Sesiones cerradas')}>Cerrar</Button>)}
          {row('Borrar la cuenta', user.suspended ? 'Arrastra sus apuestas, amigos y mensajes. No se puede deshacer.' : 'Primero hay que suspenderla.',
            <Button size="sm" variant="danger" disabled={busy || self || !user.suspended} title={self ? 'No puedes borrar tu propia cuenta' : !user.suspended ? 'Suspéndela antes' : undefined}
              onClick={() => go('delete')}>Borrar</Button>)}
        </div>
      )}

      {mode === 'rename' && (
        <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); run(() => api.updateUser(user.id, { username: text }), 'Nombre cambiado'); }}>
          <Field label="Nuevo nombre" hint="De 3 a 30 letras, números o . _ -"><Input value={text} onChange={e => setText(e.target.value)} autoFocus maxLength={30} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => go('menu')}>Volver</Button><Button type="submit" disabled={busy || !text.trim()}>Guardar</Button></div>
        </form>
      )}

      {mode === 'password' && (
        <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); run(() => api.setPassword(user.id, text), 'Contraseña cambiada y sesiones cerradas'); }}>
          <Field label="Contraseña temporal" hint="Al menos 8 caracteres. Díselo por un canal privado; se cierran todas sus sesiones."><Input type="text" autoComplete="off" value={text} onChange={e => setText(e.target.value)} autoFocus /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => go('menu')}>Volver</Button><Button type="submit" disabled={busy || text.length < 8}>Cambiar contraseña</Button></div>
        </form>
      )}

      {mode === 'delete' && (
        <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); run(() => api.deleteUser(user.id, text), 'Cuenta borrada', onClose); }}>
          <p className="text-sm text-zinc-300">Se borran la cuenta de <b>{user.username}</b> y todo lo suyo: {user.bets} apuesta{user.bets === 1 ? '' : 's'}, sus amigos, sus mensajes y sus avisos. No se puede deshacer.</p>
          <Field label={`Escribe «${user.username}» para confirmar`}><Input value={text} onChange={e => setText(e.target.value)} autoFocus autoComplete="off" /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => go('menu')}>Volver</Button><Button type="submit" variant="danger" disabled={busy || text !== user.username}>Borrar para siempre</Button></div>
        </form>
      )}
    </Dialog>
  );
}
