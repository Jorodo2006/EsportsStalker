// Amigos: añadir a alguien por su nombre de usuario (tiene que aceptar), las solicitudes y las apuestas que te han enviado,
// que se pueden copiar a tus apuestas con tu propio importe. Lo que se envía no lleva el importe ni el resultado de quien
// la envía (server/services/bets/friends.js). Las apuestas se envían desde Mis apuestas, con ShareDialog.
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Send, UserPlus, X } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import type { Bet, SharedBet } from '@/lib/types';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, Loading, PageHeader } from '@/components/ui';

const SPORT_NAME: Record<string, string> = { basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA', lol: 'LoL', mix: 'Varios' };
const errMsg = (e: unknown) => (e as Error)?.message || 'No se ha podido';
const useFriends = () => useQuery({ queryKey: ['friends'], queryFn: () => window.api.friends.list(), staleTime: 30e3, refetchInterval: 2 * 60e3 });
const useInbox = () => useQuery({ queryKey: ['shared'], queryFn: () => window.api.shared.inbox(), staleTime: 30e3, refetchInterval: 2 * 60e3 });
const when = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

// Lo que hay por mirar (solicitudes y apuestas sin ver), para el menú
export function FriendsBadge() {
  const f = useFriends(), s = useInbox();
  const n = (f.data?.incoming.length ?? 0) + (s.data?.unseen ?? 0);
  return n ? <span className="ml-auto rounded bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-300 tnum">{n}</span> : null;
}

export default function FriendsView() {
  const qc = useQueryClient();
  const { toast } = useApp();
  const f = useFriends(), s = useInbox();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // Al entrar, lo recibido deja de contar como nuevo
  useEffect(() => {
    if (s.data?.unseen) window.api.shared.seen().then(() => qc.invalidateQueries({ queryKey: ['shared'] })).catch(() => {});
  }, [s.data?.unseen, qc]);

  const run = async (p: Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await p; if (ok) toast(ok); qc.invalidateQueries({ queryKey: ['friends'] }); }
    catch (e) { toast(errMsg(e)); }
    finally { setBusy(false); }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    run(window.api.friends.request(name.trim()).then(r => { toast(r.status === 'accepted' ? `${r.username} y tú ya sois amigos` : `Solicitud enviada a ${r.username}`); setName(''); }));
  };

  return (
    <>
      <PageHeader title="Amigos" subtitle="Añade a tus amigos y pasaos las apuestas que registráis" />
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Received q={s} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Añadir un amigo">
            <form onSubmit={add} className="flex flex-col gap-3">
              <Field label="Su nombre de usuario" hint="El que usa para entrar en Sharpex. Tendrá que aceptar la solicitud.">
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="nombre de usuario" autoComplete="off" maxLength={40} />
              </Field>
              <Button type="submit" disabled={busy || !name.trim()}><UserPlus size={15} />Enviar solicitud</Button>
            </form>
          </Card>
          {f.isLoading ? <Loading label="Cargando tus amigos…" /> : f.error ? <ErrorBox error={f.error} /> : <>
            {!!f.data!.incoming.length && (
              <Card title="Solicitudes" action={<Badge tone="warning">{f.data!.incoming.length}</Badge>}>
                <ul className="-mx-5 -my-3 divide-y divide-zinc-800/60">
                  {f.data!.incoming.map(u => (
                    <li key={u.id} className="flex items-center gap-2 px-5 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{u.username}</span>
                      <Button size="sm" disabled={busy} onClick={() => run(window.api.friends.accept(u.id), `${u.username} y tú ya sois amigos`)}><Check size={14} />Aceptar</Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(window.api.friends.remove(u.id))}>Rechazar</Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title="Tus amigos" action={<span className="text-[11px] text-zinc-500">{f.data!.friends.length || 'ninguno'}</span>}>
              {!f.data!.friends.length && !f.data!.outgoing.length ? (
                <p className="text-sm text-zinc-400">Todavía no tienes amigos en Sharpex. Añade a alguien por su nombre de usuario y, cuando acepte, podréis enviaros apuestas desde Mis apuestas.</p>
              ) : (
                <ul className="-mx-5 -my-3 divide-y divide-zinc-800/60">
                  {f.data!.friends.map(u => (
                    <li key={u.id} className="flex items-center gap-2 px-5 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{u.username}</span>
                      <button type="button" disabled={busy} onClick={() => confirm(`¿Dejar de ser amigo de ${u.username}?`) && run(window.api.friends.remove(u.id))}
                        title={`Dejar de ser amigo de ${u.username}`} aria-label={`Dejar de ser amigo de ${u.username}`}
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"><X size={14} /></button>
                    </li>
                  ))}
                  {f.data!.outgoing.map(u => (
                    <li key={u.id} className="flex items-center gap-2 px-5 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{u.username}</span>
                      <span className="text-xs text-zinc-500">pendiente de aceptar</span>
                      <button type="button" disabled={busy} onClick={() => run(window.api.friends.remove(u.id))} title="Cancelar la solicitud" aria-label={`Cancelar la solicitud a ${u.username}`}
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"><X size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>}
        </div>
      </div>
    </>
  );
}

// Las apuestas que te han enviado
function Received({ q }: { q: ReturnType<typeof useInbox> }) {
  const qc = useQueryClient();
  const { openBet, toast } = useApp();
  const copy = (x: SharedBet) => {
    const b = x.bet;
    // Se abre el formulario con lo apostado y sin importe: cada uno pone el suyo
    openBet({
      sport: b.sport, league: b.league, event: b.event, market: b.market, selection: b.selection, bookmaker: b.bookmaker, odds: b.odds,
      ...(b.legs?.length ? { legs: b.legs.map(l => ({ ...l, status: 'pending' as const })) } : {}), ...(b.ref ? { ref: b.ref } : {}),
      status: 'pending', notes: `Me la pasó ${x.from}${x.note ? `: ${x.note}` : ''}`
    });
    window.api.shared.copied(x.id).then(() => qc.invalidateQueries({ queryKey: ['shared'] })).catch(() => {});
  };
  const hide = (x: SharedBet) => window.api.shared.hide(x.id).then(() => qc.invalidateQueries({ queryKey: ['shared'] })).catch(e => toast(errMsg(e)));

  return (
    <Card title="Apuestas que te han pasado" action={<span className="text-[11px] text-zinc-500">de los últimos 60 días</span>}>
      {q.isLoading ? <Loading label="Cargando…" /> : q.error ? <ErrorBox error={q.error} /> : !q.data!.list.length ? (
        <Empty icon={<Send size={20} />}>Cuando un amigo te pase una apuesta, saldrá aquí. Podrás copiarla a tus apuestas con tu propio importe.</Empty>
      ) : (
        <ul className="-mx-5 -my-3 divide-y divide-zinc-800/60">
          {q.data!.list.map(x => {
            const b = x.bet, combo = (b.legs?.length ?? 0) > 1;
            return (
              <li key={x.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                    <span className="font-medium text-zinc-300">{x.from}</span><span>{when(x.created)}</span>
                    <span>· {SPORT_NAME[b.sport || 'lol'] ?? b.sport}</span>
                    {!x.seen && <Badge tone="warning">nueva</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium text-zinc-50">{combo ? `Combinada de ${b.legs!.length}` : b.selection}</div>
                  <div className="truncate text-xs text-zinc-400">
                    {combo ? b.legs!.map(l => `${l.selection} (${l.event})`).join(' · ') : [b.market, b.event].filter(Boolean).join(' · ')}
                  </div>
                  {x.note && <div className="mt-1 text-xs italic text-zinc-400">«{x.note}»</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-score text-lg font-semibold text-zinc-50 tnum">{odd(b.odds)}</span>
                  {b.bookmaker && <span className="text-xs text-zinc-500">{b.bookmaker}</span>}
                  <Button size="sm" variant={x.copied ? 'secondary' : 'primary'} onClick={() => copy(x)} title="Abre el formulario con esta apuesta: pon tu importe y guárdala">
                    <Copy size={14} />{x.copied ? 'Copiar otra vez' : 'Copiar a mis apuestas'}
                  </Button>
                  <button type="button" onClick={() => hide(x)} title="Quitar de la lista" aria-label="Quitar de la lista"
                    className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"><X size={14} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className={cn('mt-3 text-[11px] text-zinc-500', !q.data?.list.length && 'hidden')}>Las cuotas son las que tenía tu amigo al apostar: mira la de ahora antes de copiarla.</p>
    </Card>
  );
}

// Enviar una apuesta tuya a uno o varios amigos (desde Mis apuestas)
export function ShareDialog({ bet, onClose }: { bet: Bet | null; onClose: () => void }) {
  const { toast, go } = useApp();
  const f = useFriends();
  const [to, setTo] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTo([]); setNote(''); }, [bet?.id]);
  const send = async () => {
    if (!bet || !to.length) return;
    setBusy(true);
    try { const r = await window.api.bets.share(bet.id, to, note.trim() || undefined); toast(r.sent === 1 ? 'Apuesta enviada' : `Apuesta enviada a ${r.sent} amigos`); onClose(); }
    catch (e) { toast(errMsg(e)); }
    finally { setBusy(false); }
  };
  const friends = f.data?.friends ?? [];
  return (
    <Dialog open={!!bet} onClose={onClose} title="Pasar la apuesta a un amigo">
      {bet && <div className="flex flex-col gap-4">
        <div className="rounded-md border border-zinc-800 px-3 py-2 text-sm">
          <div className="truncate font-medium text-zinc-50">{(bet.legs?.length ?? 0) > 1 ? `Combinada de ${bet.legs!.length}` : bet.selection} <span className="tnum text-zinc-400">· {odd(bet.odds)}</span></div>
          <div className="truncate text-xs text-zinc-500">{[bet.market, bet.event].filter(Boolean).join(' · ')}</div>
          <div className="mt-1 text-[11px] text-zinc-500">Le llega lo apostado, sin tu importe ni tu resultado.</div>
        </div>
        {f.isLoading ? <Loading label="Cargando tus amigos…" /> : !friends.length ? (
          <p className="text-sm text-zinc-400">Todavía no tienes amigos. <button type="button" className="cursor-pointer text-amber-400 underline" onClick={() => { onClose(); go('friends'); }}>Añade alguno</button> y, cuando acepte, podrás pasarle apuestas.</p>
        ) : <>
          <div className="flex flex-wrap gap-2">
            {friends.map(u => {
              const on = to.includes(u.id);
              return (
                <button key={u.id} type="button" aria-pressed={on} onClick={() => setTo(on ? to.filter(x => x !== u.id) : [...to, u.id])}
                  className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm transition', on ? 'border-amber-500/60 bg-amber-500/10 text-amber-200' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800')}>
                  {on && <Check size={13} />}{u.username}
                </button>
              );
            })}
          </div>
          <Field label="Mensaje (opcional)"><Input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="Por qué te gusta" /></Field>
          <Button onClick={send} disabled={busy || !to.length}><Send size={15} />{to.length > 1 ? `Enviar a ${to.length} amigos` : 'Enviar'}</Button>
        </>}
      </div>}
    </Dialog>
  );
}
