// Página de la app "actualizando cuotas": avisa a la extensión del trabajo que tiene que hacer
if (location.port === '__PORT__' && location.pathname === '/auto') {
  const id = new URLSearchParams(location.search).get('job');
  if (id) chrome.runtime.sendMessage({ type: 'lolet-job', id });
}
