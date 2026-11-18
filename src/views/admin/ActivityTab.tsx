import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminLogRow, AuthEventKind, AuthEventRow } from '@/lib/types';
import { Badge, Button, Empty, ErrorBox, Loading, chip, panelCls, seg, segWrap } from '@/components/ui';
import { fmtWhen } from '@/views/admin/shared';

const PAGE = 50;

// Lo que hacen los administradores y los accesos. Más recientes primero; «Cargar más» pide la página siguiente con el id de la última fila
export default function ActivityTab() {
  const [which, setWhich] = useState<'log' | 'events'>('log');
  return (
    <div className="flex flex-col gap-4">
      <div className={segWrap}>
        <button className={seg(which === 'log')} onClick={() => setWhich('log')}>Acciones de administradores</button>
        <button className={seg(which === 'events')} onClick={() => setWhich('events')}>Accesos</button>
      </div>
      {which === 'log' ? <LogList /> : <EventsList />}
    </div>
  );
}

const ACTIONS: Record<string, (d: Record<string, unknown>) => string> = {
  'user.rename': d => `Renombró la cuenta (${String(d.from ?? '?')} → ${String(d.to ?? '?')})`,
  'user.role': d => (d.admin ? 'Dio el rol de administrador' : 'Quitó el rol de administrador'),
  'user.suspend': () => 'Suspendió la cuenta',
  'user.unsuspend': () => 'Reactivó la cuenta',
  'user.password': () => 'Puso una contraseña temporal y cerró sus sesiones',
  'user.sessions': d => `Cerró sus sesiones (${Number(d.closed ?? 0)})`,
  'user.delete': () => 'Borró la cuenta'
};

function LogList() {
  const q = useInfiniteQuery({
    queryKey: ['admin', 'log'], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => window.api.admin.log({ limit: PAGE, before: pageParam }),
    getNextPageParam: (last: AdminLogRow[]) => (last.length >= PAGE ? last[last.length - 1].id : undefined),
    staleTime: 0, refetchOnWindowFocus: false
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <List loading={q.isLoading} error={q.error} empty={!rows.length} emptyText="Todavía no hay acciones de administradores." more={q.hasNextPage} onMore={() => q.fetchNextPage()} busy={q.isFetchingNextPage}>
      {rows.map(r => (
        <li key={r.id} className="flex flex-col gap-0.5 px-4 py-3 text-[13px]">
          <div><span className="font-medium text-zinc-100">{r.adminName}</span> <span className="text-zinc-400">{(ACTIONS[r.action] ?? (() => r.action))(r.detail)}</span>{r.targetName && <> · <span className="text-zinc-200">{r.targetName}</span></>}</div>
          <div className="text-xs text-zinc-500 tnum">{fmtWhen(r.at)}</div>
        </li>
      ))}
    </List>
  );
}

const KINDS: { value: AuthEventKind | ''; label: string }[] = [
  { value: '', label: 'Todos' }, { value: 'login_ok', label: 'Entradas' }, { value: 'login_fail', label: 'Fallidos' },
  { value: 'register', label: 'Altas' }, { value: 'register_blocked', label: 'Altas bloqueadas' }
];
const KIND_LABEL: Record<AuthEventKind, { text: string; tone: 'success' | 'danger' | 'info' | 'warning' }> = {
  login_ok: { text: 'Entrada', tone: 'success' }, login_fail: { text: 'Intento fallido', tone: 'danger' },
  register: { text: 'Alta', tone: 'info' }, register_blocked: { text: 'Alta bloqueada', tone: 'warning' }
};

function EventsList() {
  const [kind, setKind] = useState<AuthEventKind | ''>('');
  const q = useInfiniteQuery({
    queryKey: ['admin', 'events', kind], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => window.api.admin.authEvents({ kind: kind || undefined, limit: PAGE, before: pageParam }),
    getNextPageParam: (last: AuthEventRow[]) => (last.length >= PAGE ? last[last.length - 1].id : undefined),
    staleTime: 0, refetchOnWindowFocus: false
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <>
      <div className="flex flex-wrap gap-2">{KINDS.map(k => <button key={k.value} className={chip(kind === k.value)} onClick={() => setKind(k.value)}>{k.label}</button>)}</div>
      <List loading={q.isLoading} error={q.error} empty={!rows.length} emptyText="No hay accesos de este tipo (se guardan 90 días)." more={q.hasNextPage} onMore={() => q.fetchNextPage()} busy={q.isFetchingNextPage}>
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px]">
            <Badge tone={KIND_LABEL[r.kind].tone}>{KIND_LABEL[r.kind].text}</Badge>
            <span className="font-medium text-zinc-100">{r.username ?? <span className="font-normal text-zinc-500">cuenta desconocida</span>}</span>
            <span className="text-xs text-zinc-500 tnum">{r.ip ?? ''}</span>
            <span className="ml-auto text-xs text-zinc-500 tnum">{fmtWhen(r.at)}</span>
          </li>
        ))}
      </List>
    </>
  );
}

function List({ loading, error, empty, emptyText, more, onMore, busy, children }:
  { loading: boolean; error: unknown; empty: boolean; emptyText: string; more: boolean; onMore: () => void; busy: boolean; children: React.ReactNode }) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (empty) return <Empty>{emptyText}</Empty>;
  return (
    <div className="flex flex-col items-center gap-3">
      <ul className={`${panelCls} w-full divide-y divide-zinc-800/70`}>{children}</ul>
      {more && <Button variant="secondary" onClick={onMore} disabled={busy}>{busy ? 'Cargando…' : 'Cargar más'}</Button>}
    </div>
  );
}
