import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, Loader2, PlugZap, XCircle } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import type { Settings } from '@/lib/types';
import { Button, Card, Field, Input, PageHeader } from '@/components/ui';

type Check = { name: string; ok?: boolean; msg?: string; ms?: number };

export default function SettingsView() {
  const { settings, saveSettings, toast } = useApp();
  const [f, setF] = useState<Partial<Settings>>({});
  const [checks, setChecks] = useState<Check[]>([]);
  useEffect(() => { if (settings) setF(settings); }, [settings]);
  const set = <K extends keyof Settings>(k: K) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    await saveSettings({
      ...f,
      initialBankroll: parseFloat(String(f.initialBankroll)) || 0,
      refreshSeconds: Math.max(10, parseInt(String(f.refreshSeconds), 10) || 30)
    });
    toast('Ajustes guardados');
  }

  async function test() {
    const names = ['lolesports (calendario y directo)', 'Leaguepedia (stats)'];
    setChecks(names.map(name => ({ name })));
    const put = (name: string, r: Omit<Check, 'name'>) => setChecks(c => c.map(x => (x.name === name ? { name, ...r } : x)));
    const timed = async (name: string, fn: () => Promise<string>) => {
      const t = performance.now();
      try { put(name, { ok: true, msg: await fn(), ms: Math.round(performance.now() - t) }); }
      catch (e) { put(name, { ok: false, msg: (e as Error).message }); }
    };
    await Promise.all([
      timed(names[0], async () => `${(await window.api.esports.schedule({})).events.length} partidos`),
      timed(names[1], async () => `${(await window.api.stats.searchPlayers('Faker')).length} resultados`)
    ]);
  }

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <form onSubmit={submit}>
          <Card title="Preferencias">
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Moneda"><Input maxLength={4} value={f.currency ?? ''} onChange={set('currency')} /></Field>
                <Field label="Banca inicial"><Input type="number" step="0.01" value={f.initialBankroll ?? ''} onChange={set('initialBankroll')} /></Field>
              </div>
              <Field label="Casas del comparador" hint="Orden de las columnas al abrir un partido, separadas por comas.">
                <Input value={f.featuredBooks ?? ''} onChange={set('featuredBooks')} />
              </Field>
              <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="text-sm font-medium">Leaguepedia (opcional)</div>
                <p className="text-xs leading-relaxed text-zinc-500">
                  Sin sesión, Fandom deja muy pocas consultas por minuto. Para subir el límite, crea una cuenta gratis en Fandom y una
                  "bot password" en{' '}
                  <button type="button" className="cursor-pointer text-amber-400 hover:underline" onClick={() => window.api.openExternal('https://lol.fandom.com/wiki/Special:BotPasswords')}>
                    lol.fandom.com/wiki/Special:BotPasswords
                  </button>{' '}
                  (sólo con permiso de lectura). Copia aquí el usuario que te da (tipo <code>TuUsuario@app</code>) y la contraseña.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Usuario del bot"><Input value={f.leaguepediaUser ?? ''} onChange={set('leaguepediaUser')} placeholder="TuUsuario@app" /></Field>
                  <Field label="Contraseña del bot"><Input type="password" value={f.leaguepediaPassword ?? ''} onChange={set('leaguepediaPassword')} /></Field>
                </div>
              </div>
              <Field label="Refresco automático (segundos)"><Input type="number" min={10} value={f.refreshSeconds ?? ''} onChange={set('refreshSeconds')} /></Field>
              <details className="group rounded-lg border border-zinc-800 p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-zinc-400">
                  Avanzado: claves públicas de las webs <ChevronDown size={16} className="transition group-open:rotate-180" />
                </summary>
                <div className="mt-4 space-y-3">
                  <Field label="Clave lolesports"><Input value={f.lolesportsKey ?? ''} onChange={set('lolesportsKey')} /></Field>
                </div>
              </details>
              <Button type="submit">Guardar</Button>
            </div>
          </Card>
        </form>

        <Card title="Fuentes de datos" action={<Button variant="secondary" size="sm" onClick={test}><PlugZap size={14} />Probar conexiones</Button>}>
          <ul className="space-y-3 text-sm text-zinc-300">
            <li><b>Calendario, resultados y directo:</b> API de lolesports.com (no oficial, gratis).</li>
            <li><b>Stats de jugadores y equipos:</b> Leaguepedia (lol.fandom.com), gratis.</li>
            <li><b>Cuotas:</b> Bet365, Winamax y Betway, leídas de sus webs en tu Chrome con el marcador. No se usa ninguna API de cuotas.</li>
          </ul>
          {!!checks.length && (
            <div className="mt-5 space-y-2 border-t border-zinc-800 pt-4">
              {checks.map(c => (
                <div key={c.name} className="flex items-start gap-2.5 text-sm">
                  {c.ok === undefined ? <Loader2 size={16} className="mt-0.5 animate-spin text-zinc-500" />
                    : c.ok ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-400" /> : <XCircle size={16} className="mt-0.5 text-rose-400" />}
                  <div>
                    <div className="font-medium">{c.name}</div>
                    {c.msg && <div className={c.ok ? 'text-zinc-500' : 'text-rose-300'}>{c.msg}{c.ms !== undefined && ` · ${c.ms} ms`}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <ExtensionCard />
        <MarcadorCard />
      </div>
    </>
  );
}

// Extensión de Chrome: hace el trabajo del marcador sola al pulsar "Actualizar cuotas" en un partido
function ExtensionCard() {
  const { toast } = useApp();
  const [folder, setFolder] = useState('');
  useEffect(() => { window.api.extension.folder().then(setFolder).catch(() => {}); }, []);
  return (
    <Card className="xl:col-span-2" title="Cuotas automáticas (extensión de Chrome)">
      <p className="mb-2 text-sm text-zinc-400">Con la extensión, el botón <b>Actualizar cuotas</b> de cada partido abre Bet365, Winamax y Betway en pestañas de fondo de tu Chrome, busca el partido y trae las cuotas sin que hagas nada más.</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-400">
        <li>En Chrome abre <code>chrome://extensions</code> y activa el <b>Modo de desarrollador</b> (arriba a la derecha).</li>
        <li>Pulsa <b>Cargar descomprimida</b> y elige esta carpeta: <code className="break-all text-zinc-300">{folder || '…'}</code></li>
        <li>Listo. Si la app se actualiza, pulsa el botón de recargar ⟳ de la extensión en <code>chrome://extensions</code>.</li>
      </ol>
      <p className="mt-2 text-xs text-zinc-500">Si no encuentra un partido en una casa, ábrelo allí una vez y pulsa el marcador: la app recuerda la dirección y la próxima vez va directa.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={!folder} onClick={async () => { await navigator.clipboard.writeText(folder); toast('Ruta copiada'); }}>Copiar ruta</Button>
        <Button size="sm" variant="secondary" onClick={() => window.api.extension.open().catch(e => toast((e as Error).message))}>Abrir carpeta</Button>
      </div>
    </Card>
  );
}

// Marcador de cuotas: las casas bloquean las ventanas de la app, así que las cuotas se leen desde tu Chrome normal
function MarcadorCard() {
  const { toast } = useApp();
  const [url, setUrl] = useState('');
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { window.api.marcador.url().then(setUrl).catch(() => {}); }, []);
  // React no deja poner "javascript:" en href desde JSX: se pone directamente en el elemento
  useEffect(() => { if (url && link.current) link.current.setAttribute('href', url); }, [url]);
  return (
    <Card className="xl:col-span-2" title="Marcador de cuotas (Bet365, Winamax, Betway)">
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-400">
        <li>Instálalo una vez: pulsa <b>Copiar marcador</b>. En Chrome, Ctrl+Shift+B → clic derecho en la barra de favoritos → <b>Añadir página…</b> → pega en <b>URL</b> y guarda. Si ya tenías el de Bet365, edítalo y pega el nuevo.</li>
        <li>Abre el partido en la app y déjalo abierto.</li>
        <li>En Chrome abre ese partido en la casa. En Bet365 ve a la sección de <b>jugadores</b> (kills, asistencias, muertes) y despliégala; en Betway abre la pestaña <b>Mapa N - Especiales de Jugadores</b> (el marcador despliega solo los mercados). En Winamax basta con la página del partido.</li>
        <li>Pulsa el favorito. Las cuotas llegan solas a la app. Si Chrome pide permiso de red local, acéptalo; si dice que las ha copiado, pulsa <b>Pegar cuotas del marcador</b> en el partido.</li>
      </ol>
      <p className="mt-2 text-xs text-zinc-500">Pon las cuotas en formato decimal. Cada envío vale 3 horas; repite el marcador para actualizar. Cada vez que lo usas se guarda una foto de la página (<code>captura-casa-marcador.json</code>) para poder mejorar el lector.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!url} onClick={async () => { await navigator.clipboard.writeText(url); toast('Marcador copiado'); }}>Copiar marcador</Button>
        <a ref={link} onClick={e => e.preventDefault()} draggable
          className="cursor-grab rounded-lg border-2 border-dashed border-amber-500 px-4 py-1.5 text-sm font-semibold text-amber-400" title="También puedes arrastrarlo a la barra de favoritos">
          ⚡ LoL Tracker
        </a>
      </div>
    </Card>
  );
}
