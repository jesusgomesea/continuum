// A página do painel do agente: cada caixa da loja, ao vivo (atualiza a cada 2 segundos).
// Página simples, sem React: é só para olhar. Cores só pelos tokens do Continuum (/estilos.css), tema escuro.
export function paginaDoPainel(): string {
  return `<!doctype html>
<html lang="pt-BR" data-tema="escuro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Continuum Agente</title>
<link rel="stylesheet" href="/estilos.css">
<style>
  .topo { display: flex; align-items: center; gap: var(--espaco-4); padding: var(--espaco-4) var(--espaco-6); background: var(--cor-lateral); border-bottom: 1px solid var(--cor-borda); }
  .topo strong { font-weight: var(--peso-extra); letter-spacing: 0.08em; }
  .topo strong span { background: var(--gradiente-primario); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .topo small { color: var(--cor-texto-fraco); }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--espaco-4); padding: var(--espaco-6); }
  .caixa { display: grid; gap: var(--espaco-3); padding: var(--espaco-5); background: var(--cor-superficie); border: 1px solid var(--cor-borda); border-radius: var(--raio-g); border-top: 4px solid var(--estado-cor, var(--cor-borda)); }
  .caixa h2 { font-size: var(--texto-lg); display: flex; justify-content: space-between; gap: var(--espaco-2); }
  .chip { display: inline-flex; align-items: center; gap: var(--espaco-1); padding: 2px var(--espaco-3); border-radius: var(--raio-pilula); font-size: var(--texto-xs); font-weight: var(--peso-forte); background: var(--cor-neutra-fundo); color: var(--estado-cor, var(--cor-neutra)); }
  .chip::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  dl { display: grid; grid-template-columns: 1fr auto; gap: var(--espaco-1) var(--espaco-4); margin: 0; }
  dt { color: var(--cor-texto-suave); } dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--espaco-1); font-size: var(--texto-sm); }
  li { display: flex; justify-content: space-between; gap: var(--espaco-2); font-family: var(--fonte-mono); }
  li.cancelada { color: var(--cor-erro); text-decoration: line-through; }
  .vazio { color: var(--cor-texto-fraco); padding: var(--espaco-6); }
  [data-estado="saudavel"] { --estado-cor: var(--estado-saudavel); }
  [data-estado="degradado"] { --estado-cor: var(--estado-degradado); }
  [data-estado="offline"], [data-estado="sem-sinal"] { --estado-cor: var(--estado-offline); }
  [data-estado="recuperando"] { --estado-cor: var(--estado-recuperando); }
  [data-estado="sincronizando"] { --estado-cor: var(--estado-sincronizando); }
</style>
</head>
<body>
<header class="topo">
  <div><strong>CONTINUUM <span>AGENTE</span></strong><br><small>Caixas desta loja, ao vivo</small></div>
  <small id="hora" style="margin-left:auto"></small>
</header>
<main id="caixas"><p class="vazio">Aguardando o primeiro caixa…</p></main>
<script>
  const NOMES = { saudavel: 'SAUDÁVEL', degradado: 'DEGRADADO', offline: 'OFFLINE', recuperando: 'RECUPERANDO', sincronizando: 'SINCRONIZANDO', 'sem-sinal': 'SEM SINAL' };
  const reais = (c) => (c < 0 ? '-' : '') + 'R$ ' + Math.floor(Math.abs(c) / 100).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.') + ',' + String(Math.abs(c) % 100).padStart(2, '0');
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function nomeDoCaixa(c) {
    const m = /^([A-Z0-9]+)-(\\d)/.exec(c.ultimasVendas[0]?.codigo ?? '');
    return m ? m[1] + ' · Caixa ' + m[2] : 'Caixa ' + c.dispositivoId.slice(-6);
  }
  function cartao(c) {
    const s = c.sinal;
    const estado = !s ? 'sem-sinal' : s.semSinal ? 'sem-sinal' : s.estado;
    const vendas = c.ultimasVendas.map((v) => '<li class="' + (v.cancelada ? 'cancelada' : '') + '"><span>' + esc(v.codigo) + '</span><span>' + reais(v.liquidoCentavos) + '</span></li>').join('');
    return '<section class="caixa" data-estado="' + estado + '">'
      + '<h2><span>' + esc(nomeDoCaixa(c)) + '</span><span class="chip">' + NOMES[estado] + '</span></h2>'
      + '<dl>'
      + '<dt>Caixa</dt><dd>' + (s ? (s.caixaAberto ? 'aberto' : 'fechado') : '—') + '</dd>'
      + '<dt>Último sinal</dt><dd>' + (s ? 'há ' + s.segundosSemSinal + ' s' : 'nunca') + '</dd>'
      + '<dt>Fila no caixa</dt><dd>' + (s ? s.filaPendente + ' eventos' : '—') + '</dd>'
      + '<dt>Eventos recebidos</dt><dd>' + c.ultimaSeq + '</dd>'
      + '<dt>Vendas</dt><dd>' + c.vendas.quantidade + ' · ' + reais(c.vendas.liquidoCentavos) + '</dd>'
      + '<dt>Canceladas</dt><dd>' + c.vendas.canceladas + '</dd>'
      + '<dt>Versão</dt><dd>' + (s ? esc(s.versaoPrograma) : '—') + '</dd>'
      + '</dl>'
      + (vendas ? '<ul>' + vendas + '</ul>' : '<p class="vazio" style="padding:0">Nenhuma venda recebida ainda.</p>')
      + '</section>';
  }
  async function atualizar() {
    try {
      const r = await fetch('/api/painel');
      const d = await r.json();
      document.getElementById('caixas').innerHTML = d.caixas.length ? d.caixas.map(cartao).join('') : '<p class="vazio">Aguardando o primeiro caixa…</p>';
      document.getElementById('hora').textContent = 'Atualizado ' + new Date(d.agora).toLocaleTimeString('pt-BR');
    } catch {
      document.getElementById('hora').textContent = 'Sem resposta do agente';
    }
  }
  atualizar();
  setInterval(atualizar, 2000);
</script>
</body>
</html>`;
}
