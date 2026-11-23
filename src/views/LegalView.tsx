// Aviso legal, privacidad y cookies, cada una con su dirección (/aviso-legal, /privacidad, /cookies) para que se pueda
// enlazar y la encuentre Google (AdSense pide que la web tenga política de privacidad). Lo que se dice aquí tiene que
// coincidir con lo que hace la app: si cambia lo que se guarda o se añade una cookie, cámbialo también aquí.
// El responsable (nombre, NIF, dirección y correo) sale del .env del servidor (LEGAL_*), no del repositorio.
import type { ReactNode } from 'react';
import { useApp, type LegalPage } from '@/lib/app-context';
import { cn } from '@/lib/format';
import { PageHeader, panelCls, seg, segWrap } from '@/components/ui';
import { openCookieSettings, usePublicConfig } from '@/lib/ads';

const UPDATED = '15 de noviembre de 2026';
const TITLES: Record<LegalPage, string> = { 'aviso-legal': 'Aviso legal', privacidad: 'Privacidad', cookies: 'Cookies' };

export default function LegalView() {
  const { viewParam, go } = useApp();
  const page: LegalPage = viewParam === 'privacidad' || viewParam === 'cookies' ? viewParam : 'aviso-legal';
  return (
    <>
      <PageHeader title={TITLES[page]} subtitle={`Última actualización: ${UPDATED}`} />
      <div className={cn(segWrap, 'mb-5 inline-flex')} role="tablist">
        {(Object.keys(TITLES) as LegalPage[]).map(p => (
          <button key={p} role="tab" aria-selected={p === page} onClick={() => go('legal', p)} className={seg(p === page)}>{TITLES[p]}</button>
        ))}
      </div>
      <article className={cn(panelCls, 'max-w-3xl px-5 py-6 text-sm leading-relaxed text-zinc-300 sm:px-8')}>
        {page === 'aviso-legal' ? <Notice /> : page === 'privacidad' ? <Privacy /> : <Cookies />}
      </article>
    </>
  );
}

function H({ children }: { children: ReactNode }) { return <h2 className="mb-2 mt-6 text-[15px] font-semibold text-zinc-50 first:mt-0">{children}</h2>; }
function P({ children }: { children: ReactNode }) { return <p className="mb-3">{children}</p>; }
function UL({ children }: { children: ReactNode }) { return <ul className="mb-3 list-disc space-y-1.5 pl-5">{children}</ul>; }

// Quién es el responsable, tal y como esté en el .env; lo que falte se dice, no se inventa
function Owner() {
  const q = usePublicConfig();
  const l = q.data?.legal;
  if (q.isLoading) return <P>Cargando…</P>;
  const rows: [string, string | null | undefined][] = [['Titular', l?.owner], ['NIF', l?.nif], ['Domicilio', l?.address], ['Correo de contacto', l?.email]];
  return (
    <UL>
      {rows.map(([k, v]) => <li key={k}><span className="text-zinc-400">{k}:</span> {v ? (k === 'Correo de contacto' ? <a className="text-amber-400 underline" href={`mailto:${v}`}>{v}</a> : v) : <span className="text-zinc-500">pendiente de publicar</span>}</li>)}
    </UL>
  );
}
const Contact = () => {
  const email = usePublicConfig().data?.legal.email;
  return email ? <a className="text-amber-400 underline" href={`mailto:${email}`}>{email}</a> : <>el correo de contacto del aviso legal</>;
};

function Notice() {
  return <>
    <H>Quién está detrás de Sharpex</H>
    <P>En cumplimiento del artículo 10 de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI):</P>
    <Owner />
    <H>Qué es Sharpex</H>
    <P>Sharpex es una herramienta de análisis estadístico de deportes y esports: calendario y resultados, estadísticas, cuotas publicadas por casas de apuestas y estimaciones de un modelo propio. <b className="text-zinc-100">No es un operador de juego</b>: no acepta apuestas, no gestiona dinero de nadie y no tiene relación comercial con las casas cuyas cuotas enseña. El registro de apuestas que ofrece es una libreta personal: lo que se apunta ahí no se apuesta en ningún sitio.</P>
    <H>Mayores de edad y juego responsable</H>
    <P>El contenido sobre apuestas está dirigido a mayores de 18 años. El juego puede crear adicción: si necesitas ayuda, tienes los enlaces del pie de cada página (AutoProhibición, juegoseguro.es y FEJAR, 900 200 225).</P>
    <H>Exactitud de los datos</H>
    <P>Los resultados, las estadísticas y las cuotas salen de fuentes públicas y pueden tener retrasos o errores; las estimaciones del modelo son probabilidades, no garantías. Comprueba siempre la cuota en la casa antes de apostar. Sharpex no responde de las decisiones que se tomen con esta información.</P>
    <H>Marcas y contenidos de terceros</H>
    <P>Los nombres, escudos y logotipos de equipos, competiciones y casas de apuestas son de sus dueños y se usan sólo para identificarlos. Los datos se citan con su fuente cuando la fuente lo pide. Si eres titular de algún contenido y quieres que se retire, escribe a <Contact />.</P>
    <H>Enlaces</H>
    <P>Los enlaces a otras webs se ofrecen como referencia; Sharpex no controla su contenido.</P>
    <H>Ley aplicable</H>
    <P>Este aviso se rige por la ley española.</P>
  </>;
}

function Privacy() {
  return <>
    <H>Responsable</H>
    <Owner />
    <H>Qué datos se tratan y para qué</H>
    <UL>
      <li><b className="text-zinc-100">Sin cuenta</b> no se te pide ningún dato. La dirección IP de cada visita se usa en el momento para limitar el número de peticiones y proteger la web, y no se guarda.</li>
      <li><b className="text-zinc-100">Tu cuenta:</b> el nombre de usuario y la contraseña, que se guarda cifrada (nunca en claro). Si entras con Google, también el identificador de tu cuenta de Google y su correo. Sirven para que puedas entrar.</li>
      <li><b className="text-zinc-100">Accesos:</b> de cada intento de entrar o de crear una cuenta, salga bien o mal, se guarda la fecha, la dirección IP y, sólo si la cuenta existe, el nombre de usuario, durante 90 días, para detectar abusos y proteger las cuentas. Los administradores pueden ver ese registro y se anota lo que hacen sobre las cuentas (renombrar, suspender, cambiar la contraseña, borrar). Un administrador no ve el contenido de tus apuestas, tu dinero ni tus mensajes: sólo cuántas apuestas tiene cada cuenta.</li>
      <li><b className="text-zinc-100">Lo que apuntas:</b> tus apuestas, tu banca inicial, tus favoritos, los mercados que enseñas a la app y tus avisos. Sólo los ves tú.</li>
      <li><b className="text-zinc-100">Capturas de tickets:</b> si subes la captura de una apuesta para apuntarla, se lee en nuestro servidor (sin enviarla a nadie) y no se guarda: sólo queda la apuesta que confirmes.</li>
      <li><b className="text-zinc-100">Avisos de cuotas:</b> para avisarte cuando cambia una cuota, se guardan los avisos que te llegan (14 días) y, con cuenta, las selecciones de tu cupón (el partido, el mercado y la selección, sin importes). Si activas los avisos con la app cerrada, se guarda la dirección de avisos de tu navegador o móvil; el aviso viaja cifrado por el servicio de notificaciones de tu navegador (Google, Mozilla, Apple o Microsoft), que no puede leerlo. Lo desactivas en Tu cuenta.</li>
      <li><b className="text-zinc-100">Amigos:</b> a quién añades, los mensajes que os escribís y las apuestas que os pasáis (lo apostado y si va ganada, perdida o pendiente, sin el importe ni las notas). Sólo los veis los dos.</li>
      <li><b className="text-zinc-100">Publicidad:</b> si aceptas las cookies de publicidad, Google puede usarlas para enseñarte anuncios personalizados (lo explica la página de cookies).</li>
    </UL>
    <H>Base legal</H>
    <UL>
      <li>La cuenta, lo que apuntas y los amigos: la ejecución del servicio que pides al registrarte (art. 6.1.b del RGPD).</li>
      <li>La protección de la web frente a abusos: el interés legítimo (art. 6.1.f).</li>
      <li>Las cookies de publicidad: tu consentimiento (art. 6.1.a), que puedes retirar cuando quieras.</li>
    </UL>
    <H>Con quién se comparten</H>
    <P>No se venden ni se ceden tus datos. Para funcionar se usan estos proveedores:</P>
    <UL>
      <li><b className="text-zinc-100">Cloudflare</b>, por donde pasa el tráfico de la web (protección y entrega).</li>
      <li><b className="text-zinc-100">Google</b>, si eliges entrar con Google y para los anuncios (Google AdSense), según su política de privacidad: <a className="text-amber-400 underline" href="https://policies.google.com/technologies/partner-sites?hl=es" target="_blank" rel="noopener noreferrer">cómo usa Google los datos de las webs que usan sus servicios</a>.</li>
    </UL>
    <P>Estos proveedores pueden tratar datos fuera del Espacio Económico Europeo con las garantías que exige el RGPD (como el Marco de Privacidad de Datos UE-EE. UU.).</P>
    <H>Cuánto tiempo</H>
    <P>Mientras tengas la cuenta. Si pides que se borre, se borran tu cuenta, tus apuestas, tus ajustes, tus amigos, tus mensajes y tus avisos. La sesión caduca a los 30 días y los avisos se borran a los 14.</P>
    <H>Tus derechos</H>
    <P>Puedes pedir acceder a tus datos, corregirlos, borrarlos, llevártelos (Mis apuestas permite exportarlas en CSV), oponerte o limitar su uso escribiendo a <Contact />. Si crees que no se han respetado, puedes reclamar ante la Agencia Española de Protección de Datos (<a className="text-amber-400 underline" href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">aepd.es</a>).</P>
    <H>Menores</H>
    <P>Sharpex no está dirigido a menores de 18 años y no se deben crear cuentas por debajo de esa edad.</P>
  </>;
}

function Cookies() {
  const ads = !!usePublicConfig().data?.ads;
  return <>
    <P>Una cookie es un pequeño fichero que la web guarda en tu navegador. Sharpex usa las mínimas:</P>
    <H>Necesarias (no piden consentimiento)</H>
    <UL>
      <li><code className="text-zinc-100">lolet_session</code>: mantiene la sesión abierta cuando entras con tu cuenta. Dura 30 días o hasta que sales.</li>
      <li><code className="text-zinc-100">lolet_google</code>: sólo mientras entras con Google, unos minutos, para comprobar que la vuelta de Google es tuya.</li>
      <li>Cookies de <b className="text-zinc-100">Cloudflare</b> que protegen la web frente a tráfico automatizado.</li>
      <li>Además, la web guarda en tu navegador (almacenamiento local, no cookies) tus preferencias: el deporte elegido, el cupón, las secciones plegadas y los avisos vistos. No salen de tu navegador, salvo las selecciones del cupón cuando tienes cuenta, para avisarte si cambian sus cuotas (lo explica la página de privacidad).</li>
    </UL>
    <H>Publicidad (sólo si las aceptas)</H>
    <P>Los anuncios los sirve <b className="text-zinc-100">Google AdSense</b>. Con tu consentimiento, Google y sus socios usan cookies para personalizar los anuncios y medir cómo funcionan; si no lo das, los anuncios no son personalizados. El aviso para aceptarlas o rechazarlas es el de Google, que cumple el marco de consentimiento de la UE (TCF de IAB Europe). Más información: <a className="text-amber-400 underline" href="https://policies.google.com/technologies/ads?hl=es" target="_blank" rel="noopener noreferrer">cómo usa Google las cookies de publicidad</a>.</P>
    <H>Cambiar tu elección</H>
    <P>
      {ads ? <>Puedes cambiarla cuando quieras: <button type="button" onClick={openCookieSettings} className="cursor-pointer text-amber-400 underline">configurar las cookies</button> (también en el pie de cada página). </> : <>Ahora mismo la web no enseña anuncios. </>}
      También puedes borrar o bloquear las cookies desde los ajustes de tu navegador; si bloqueas las necesarias, no podrás entrar en tu cuenta.
    </P>
  </>;
}
