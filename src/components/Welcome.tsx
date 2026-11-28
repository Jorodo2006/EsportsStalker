// Bienvenida de una cuenta nueva: la banca con la que empieza y el deporte que más sigue. Sin banca, la cartera salía en
// negativo con la primera apuesta (-10,00 € en la cabecera del móvil) y la banca estaba escondida en «Tu cuenta».
// Sale una vez por cuenta, en cualquier dispositivo: al cerrarla se guarda welcomed en sus ajustes (USER_KEYS en store.js).
// No sale a quien ya tiene banca o apuestas: las cuentas de antes de esta ventana no la necesitan
import { useState, type FormEvent } from 'react';
import { useApp, useBets, useCurrency, type AppId } from '@/lib/app-context';
import { useMember } from './AuthGate';
import { Button, Dialog, Field, Input, seg, segWrap } from './ui';

const SPORTS: [AppId, string][] = [['basket', 'Baloncesto'], ['tennis', 'Tenis'], ['football', 'Fútbol'], ['mma', 'MMA'], ['lol', 'LoL']];

export function Welcome() {
  const member = useMember();
  const { settings, saveSettings, app, switchApp, toast } = useApp();
  const bets = useBets();
  const cur = useCurrency();
  const [bank, setBank] = useState('');
  const [sport, setSport] = useState<AppId>(app);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const open = member && !gone && !!settings && !settings.welcomed && !settings.initialBankroll && bets.isSuccess && !bets.data.length;

  async function close(keep: boolean) {
    const amount = Math.max(0, parseFloat(bank.replace(',', '.')) || 0);
    setBusy(true);
    try {
      await saveSettings({ welcomed: true, ...(keep && amount ? { initialBankroll: amount } : {}) });
      if (keep && sport !== app) switchApp(sport);
      setGone(true);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); close(true); };

  return (
    <Dialog open={open} onClose={() => close(false)} title="Bienvenido a Sharpex">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-zinc-400">
          Dos datos para empezar. Los dos se pueden cambiar cuando quieras: la banca en <b className="text-zinc-200">Tu cuenta</b> y el
          deporte, arriba.
        </p>
        <Field label={`¿Con cuánto empiezas a apostar? (${cur})`}
          hint="Es tu banca inicial. Sharpex le suma lo que ganes y le resta lo que pierdas para darte tu saldo. Si lo dejas vacío, sólo verás tu beneficio.">
          <Input type="number" inputMode="decimal" step="0.01" min={0} placeholder="Por ejemplo, 200" value={bank} onChange={e => setBank(e.target.value)} autoFocus />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">¿Qué deporte sigues más?</span>
          <div className={segWrap} role="radiogroup" aria-label="Deporte">
            {SPORTS.map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={sport === id} onClick={() => setSport(id)} className={seg(sport === id)}>{label}</button>
            ))}
          </div>
          <span className="text-xs text-zinc-500">La web se abrirá en él.</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close(false)}>Ahora no</Button>
          <Button type="submit" disabled={busy}>Empezar</Button>
        </div>
      </form>
    </Dialog>
  );
}
