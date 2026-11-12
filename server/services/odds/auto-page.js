// Página que se abre en Chrome al pulsar "Actualizar cuotas": la extensión la detecta (pagina.js) y se pone a
// trabajar; la página enseña el progreso de cada casa.
const AUTO_PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>LoL Tracker · cuotas</title>
<style>body{background:#18181b;color:#e4e4e7;font:15px system-ui,sans-serif;display:flex;justify-content:center;padding-top:12vh}
main{width:440px}h1{font-size:18px;color:#fbbf24}li{margin:6px 0;list-style:none}.m{color:#a1a1aa;font-size:13px}.e{color:#f87171}</style></head>
<body><main><h1>Sharpex · actualizando cuotas</h1><p id="t" class="m"></p><ul id="l"></ul><p id="x" class="m"></p></main>
<script>
var id=new URLSearchParams(location.search).get('job'),N={bet365:'Bet365',winamax:'Winamax',betway:'Betway'},I={esperando:'⏳',buscando:'🔎',leyendo:'📖',ok:'✅',error:'⚠️'};
function tick(){fetch('/auto/status?id='+id).then(function(r){return r.json()}).then(function(j){
 document.getElementById('t').textContent=j.match?j.match.a.name+' vs '+j.match.b.name:'';
 document.getElementById('l').innerHTML=Object.keys(j.steps||{}).map(function(b){var s=j.steps[b];return '<li>'+(I[s.estado]||'')+' <b>'+N[b]+'</b> <span class="m">'+(s.msg||s.estado)+'</span></li>'}).join('');
 var x=document.getElementById('x');
 if(j.error==='sin extensión'||(!j.picked&&Date.now()-j.created>6000))x.innerHTML='<span class="e">No detecto la extensión de LoL Tracker en este Chrome. Instálala desde Ajustes de la app.</span>';
 else x.textContent=j.done?'Listo. Puedes volver a la app (esta pestaña se cierra sola).':'Se abren pestañas en segundo plano; no hace falta que hagas nada.';
 if(!j.done)setTimeout(tick,1000);}).catch(function(){setTimeout(tick,2000)})}tick();
</script></body></html>`;

module.exports = { AUTO_PAGE };
