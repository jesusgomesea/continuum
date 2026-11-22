// Painel do LAB (ADR 013): JavaScript puro, sem biblioteca, sem nada da internet.
// Consulta a API a cada 500 ms (sem WebSocket, ADR 005). Todo POST leva o
// cabeçalho X-Continuum: lab, sem o qual o LAB responde 403.
// Armazenamento, Segurança e as outras lojas são ilustrativos (selo "simulação").
'use strict';

const INTERVALO_MS = 500;
const NOMES = {
  saudavel: 'SAUDÁVEL',
  degradado: 'DEGRADADO',
  offline: 'OFFLINE',
  recuperando: 'RECUPERANDO',
  sincronizando: 'SINCRONIZANDO',
  suspenso: 'SUSPENSO',
};
const EXTRAS = { offline: 'Contingência ativa' };
const DETALHES = {
  saudavel: 'Sistema estável · nuvem respondendo, o sync envia normalmente.',
  degradado: 'Sinal instável com a loja. Os números abaixo são os da última sincronização.',
  offline: 'Sem sinal da loja. Ela segue vendendo em contingência; as vendas chegam na próxima sincronização.',
  recuperando: 'A nuvem voltou a responder. Confirmando a estabilidade antes de enviar.',
  sincronizando: 'Nuvem confirmada. Enviando a fila acumulada em lotes.',
  suspenso: 'Sync suspenso.',
};
const COLUNAS = 14; // colunas da fila: uma amostra por segundo

const $ = (id) => document.getElementById(id);
const numero = new Intl.NumberFormat('pt-BR');
let ultimoEstado = null;
let ultimaQueda;
let editandoModo = false;
const amostras = []; // pendentes, um valor por segundo
let ultimaAmostra = 0;
let eventosNuvemAntes = null; // para saber se a nuvem recebeu eventos desde a última consulta
let caboOcupado = false;

// Visão da nuvem. O painel faz o papel do Monitor, que fica na NUVEM: com a loja sem
// conexão, a nuvem não tem como saber quantas vendas a loja está fazendo nem o tamanho
// da fila dela. Então, na queda, o painel mostra a última posição sincronizada e
// "pendente de sincronização"; os números reais aparecem quando a loja reconecta.
// (A API do LAB roda na loja e conhece os números locais; o painel os esconde de propósito.)
let retrato = null; // última posição da loja que a nuvem conhece: { vendas, eventos, pendentes, em }
let semSinalDesde = null;
const hora = (t) => new Date(t).toLocaleTimeString('pt-BR');

// Episódio de queda medido pelo painel (relógio do navegador, precisão de ~0,5 s,
// o intervalo da consulta). Começa ao derrubar a nuvem, termina ao voltar ao SAUDÁVEL.
// Se o painel abrir com a nuvem já fora, o começo é desconhecido e nada é medido.
let episodio = null;
// { inicio, vendasInicio, deteccao, volta, vendasDurante, recuperacao }

const segundos = (ms) => `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

// Mensagens de erro: uma por tela (Simulador e Topologia).
function avisar(texto) {
  for (const el of document.querySelectorAll('.mensagem')) el.textContent = texto;
}

async function enviar(rota, corpo) {
  avisar('');
  try {
    const resposta = await fetch(rota, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-continuum': 'lab' },
      body: JSON.stringify(corpo ?? {}),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      avisar(dados.erro ?? `erro ${resposta.status}`);
      return null;
    }
    await atualizar();
    return dados;
  } catch {
    avisar('Sem resposta do LAB.');
    return null;
  }
}

// tipo: o estado de destino (dá a cor), 'acao' (queda/volta da nuvem) ou 'tempo' (medição).
function registrar(texto, tipo) {
  const item = document.createElement('li');
  item.dataset.tipo = tipo;
  const ponto = document.createElement('span');
  ponto.className = 'p';
  const descricao = document.createElement('span');
  descricao.textContent = texto;
  const hora = document.createElement('time');
  hora.className = 't';
  hora.textContent = new Date().toLocaleTimeString('pt-BR');
  item.append(ponto, descricao, hora);
  $('linha-do-tempo').prepend(item);
  $('sem-atividade').hidden = true;
  // As outras telas (paginas.js) ouvem: notificações, auditoria, relatórios.
  document.dispatchEvent(new CustomEvent('continuum:registro', { detail: { texto, tipo, t: Date.now() } }));
}

// Queda ou volta da nuvem: abre ou fecha o episódio medido.
function acompanharNuvem(s, agora) {
  const queda = s.kryptonita.queda;
  if (queda !== ultimaQueda) {
    if (ultimaQueda !== undefined) {
      // A ação entra na linha do tempo antes da mudança de estado que ela causa.
      registrar(queda === null ? 'Nuvem restaurada' : `Nuvem derrubada (${queda === 'corte' ? 'conexão cortada' : '503'})`, 'acao');
      if (ultimaQueda === null) {
        episodio = { inicio: agora, tipo: queda, vendasInicio: s.local.vendas, deteccao: null, volta: null, vendasDurante: null, recuperacao: null };
      } else if (queda === null && episodio !== null && episodio.volta === null) {
        episodio.volta = agora;
        episodio.vendasDurante = s.local.vendas - episodio.vendasInicio;
      }
    } else if (queda !== null) {
      episodio = null; // painel aberto com a nuvem já fora: começo desconhecido
    }
    ultimaQueda = queda;
  }
}

// Mede a detecção (até o OFFLINE) e a recuperação (até o SAUDÁVEL) e registra na linha do tempo.
function medirQueda(s, agora) {
  if (episodio === null) return;
  if (episodio.deteccao === null && episodio.volta === null && s.estado === 'offline') {
    episodio.deteccao = agora - episodio.inicio;
    registrar(`Queda detectada em ${segundos(episodio.deteccao)}`, 'tempo');
  }
  if (episodio.volta !== null && episodio.recuperacao === null && s.estado === 'saudavel') {
    episodio.recuperacao = agora - episodio.volta;
    registrar(`De volta ao SAUDÁVEL em ${segundos(episodio.recuperacao)} após a nuvem voltar`, 'tempo');
    document.dispatchEvent(new CustomEvent('continuum:episodio', { detail: { ...episodio } }));
  }
}

function mostrarTempos(s, agora, v) {
  const e = episodio;
  const deteccao = $('tempo-deteccao');
  const recuperacao = $('tempo-recuperacao');
  // Enquanto mede, mostra o relógio correndo; depois, o valor fixo.
  if (e === null) deteccao.textContent = '—';
  else if (e.deteccao !== null) deteccao.textContent = segundos(e.deteccao);
  else if (e.volta === null) deteccao.textContent = segundos(agora - e.inicio);
  else deteccao.textContent = 'não detectada';
  deteccao.classList.toggle('medindo', e !== null && e.deteccao === null && e.volta === null);

  if (e === null || e.volta === null) recuperacao.textContent = '—';
  else if (e.recuperacao !== null) recuperacao.textContent = segundos(e.recuperacao);
  else recuperacao.textContent = segundos(agora - e.volta);
  recuperacao.classList.toggle('medindo', e !== null && e.volta !== null && e.recuperacao === null);

  // Vendas durante a queda: a nuvem só fica sabendo quando a loja reconecta e envia a fila.
  const visivel = e !== null && e.deteccao !== null;
  $('durante-queda').hidden = !visivel;
  if (visivel) {
    $('vendas-queda').textContent = v.semSinal ? 'pendente' : numero.format(e.vendasDurante ?? s.local.vendas - e.vendasInicio);
    $('vendas-queda').classList.toggle('medindo', v.semSinal);
  }
}

/** O que a nuvem sabe da loja agora. Sem sinal: queda da conexão ou estado OFFLINE/DEGRADADO. */
function visaoDaNuvem(s, agora) {
  const semSinal = s.kryptonita.queda !== null || s.estado === 'offline' || s.estado === 'degradado';
  if (!semSinal) {
    retrato = { vendas: s.local.vendas, eventos: s.local.eventos, pendentes: s.local.pendentes, em: agora };
    semSinalDesde = null;
  } else {
    // Painel aberto já com a loja sem sinal: a nuvem só conhece o que já recebeu.
    retrato ??= { vendas: s.nuvem?.vendas ?? 0, eventos: s.nuvem?.eventos ?? 0, pendentes: 0, em: null };
    semSinalDesde ??= agora;
  }
  return { semSinal, desde: semSinalDesde, loja: semSinal ? retrato : s.local, ultimaSync: retrato?.em ?? null };
}

const desdeTexto = (v) => (v.ultimaSync ? `última sincronização às ${hora(v.ultimaSync)}` : 'sem sinal desde que o painel abriu');

function chip(id, texto, cor) {
  const el = $(id);
  el.textContent = texto;
  el.className = `chip ${cor}`;
}

function marcar(id, situacao) {
  $(id).className = situacao; // '' (ok), 'falha' ou 'espera'
}

function mostrarFila(loja, agora, v) {
  if (agora - ultimaAmostra >= 1000 && !v.semSinal) {
    ultimaAmostra = agora;
    amostras.push(loja.pendentes);
    if (amostras.length > COLUNAS) amostras.shift();
    const maior = Math.max(1, ...amostras);
    const colunas = $('colunas');
    while (colunas.children.length < amostras.length) colunas.append(document.createElement('span'));
    amostras.forEach((valor, i) => {
      colunas.children[i].style.height = `${Math.round((valor / maior) * 100)}%`;
    });
  }
}

function mostrar(s) {
  const agora = Date.now();
  const queda = s.kryptonita.queda;
  const processos = s.sync.rodando && s.kryptonita.rodando;

  // Faixa de estado
  $('faixa').dataset.estado = s.estado;
  $('estado').textContent = NOMES[s.estado] ?? s.estado;
  $('estado-extra').textContent = EXTRAS[s.estado] ?? '';
  const v = visaoDaNuvem(s, agora);
  const loja = v.loja;
  $('estado-detalhe').textContent = v.semSinal
    ? `${DETALHES[s.estado === 'saudavel' ? 'offline' : s.estado] ?? DETALHES.offline}${v.desde ? ` Desde ${hora(v.desde)}.` : ''}`
    : (DETALHES[s.estado] ?? '');
  $('aviso-sync').hidden = processos;

  // A ação (queda ou volta da nuvem) entra na linha do tempo antes da mudança de estado que ela causa.
  acompanharNuvem(s, agora);
  if (s.estado !== ultimoEstado) {
    if (ultimoEstado !== null) registrar(`${NOMES[ultimoEstado] ?? ultimoEstado} → ${NOMES[s.estado] ?? s.estado}`, s.estado);
    ultimoEstado = s.estado;
  }
  medirQueda(s, agora);
  mostrarTempos(s, agora, v);

  // Status do sistema: a loja do LAB, como a nuvem a vê.
  $('vendas-local').textContent = numero.format(loja.vendas);
  $('anel-rotulo').textContent = v.semSinal ? 'na última sync' : 'vendas na loja';
  $('eventos-local').textContent = v.semSinal
    ? `${numero.format(loja.eventos)} eventos até a última sync`
    : `${numero.format(loja.eventos)} eventos gravados`;
  $('anel-cor').classList.toggle('fora', s.estado === 'offline');
  $('anel-cor').classList.toggle('alerta', s.estado !== 'offline' && s.estado !== 'saudavel');
  if (!processos) chip('chip-status', 'Atenção', 'vermelho');
  else if (s.estado === 'offline') chip('chip-status', 'Contingência', 'vermelho');
  else chip('chip-status', 'Online', 'verde');
  marcar('chk-servicos', processos ? '' : 'falha');
  marcar('chk-nuvem', queda === null && s.nuvem !== null ? '' : 'falha');
  marcar('chk-fila', v.semSinal || loja.pendentes > 0 ? 'espera' : '');
  $('chk-fila-texto').textContent = v.semSinal ? 'Pendente de sincronização' : loja.pendentes > 0 ? 'Sincronizando' : 'Sincronização em dia';
  marcar('chk-gravado', '');

  // Sincronização: o que a nuvem já tem.
  if (s.nuvem === null) {
    $('vendas-nuvem').textContent = '—';
    $('eventos-nuvem').textContent = 'PostgreSQL sem resposta';
    $('barra-sync').style.width = '0';
    $('pct-sync').textContent = 'nuvem sem resposta';
  } else {
    $('vendas-nuvem').textContent = numero.format(s.nuvem.vendas);
    $('eventos-nuvem').textContent = `${numero.format(s.nuvem.eventos)} eventos recebidos`;
    const pct = loja.eventos === 0 ? 100 : Math.min(100, Math.floor((s.nuvem.eventos / loja.eventos) * 100));
    $('barra-sync').style.width = `${pct}%`;
    $('pct-sync').textContent = v.semSinal
      ? `loja sem sinal · ${desdeTexto(v)}`
      : `${pct}% dos eventos da loja na nuvem`;
  }
  if (s.estado === 'offline' || s.estado === 'degradado') chip('chip-sync', 'Pausada', 'ambar');
  else if (s.estado === 'recuperando') chip('chip-sync', 'Aguardando', 'ambar');
  else if (s.estado === 'sincronizando' || loja.pendentes > 0) chip('chip-sync', 'Em andamento', 'azul');
  else chip('chip-sync', 'Em dia', 'verde');

  // Fila de operações: o tamanho da fila da loja só chega à nuvem quando a loja reconecta.
  $('pendentes').textContent = v.semSinal ? '—' : numero.format(loja.pendentes);
  $('pendentes').classList.toggle('crescendo', false);
  $('pendentes-sub').textContent = v.semSinal ? 'pendente de sincronização: a fila fica na loja' : 'eventos pendentes';
  if (v.semSinal) chip('chip-fila', 'Pendente sync', 'ambar');
  else if (loja.pendentes === 0) chip('chip-fila', 'Vazia', 'verde');
  else chip('chip-fila', 'Recebendo', 'azul');
  mostrarFila(loja, agora, v);

  // Simulador
  const g = s.geracao;
  if (g === null) {
    $('geracao').textContent = 'Nenhuma geração ainda.';
    $('progresso').style.width = '0';
  } else {
    const ritmo = g.ritmo === null ? 'sem pausa' : `${numero.format(g.ritmo)}/s pedido`;
    const falhas = g.falhas > 0 ? ` · ${numero.format(g.falhas)} falhas (${g.ultimoErro})` : '';
    $('geracao').textContent =
      `${g.ativa ? 'Gerando' : 'Concluído'}: ${numero.format(g.feitas)} de ${numero.format(g.quantidade)} · ` +
      `${numero.format(g.ritmoMedido)}/s agora (${ritmo})${falhas}`;
    $('progresso').style.width = `${Math.round(((g.feitas + g.falhas) / g.quantidade) * 100)}%`;
  }
  $('gerar').disabled = g !== null && g.ativa;
  $('parar').disabled = g === null || !g.ativa;

  const nuvem = $('nuvem-situacao');
  nuvem.textContent = queda === null ? 'nuvem no ar' : queda === 'corte' ? 'nuvem fora (corte)' : 'nuvem fora (503)';
  nuvem.className = queda === null ? 'chip verde' : 'chip fora';
  $('derrubar').disabled = queda !== null;
  $('restaurar').disabled = queda === null;

  if (!editandoModo) $('modo').value = s.modo;
  const p = s.proposta;
  $('proposta').textContent =
    p === null ? 'Nenhuma transição proposta.' : `Proposta: ${NOMES[p.de] ?? p.de} → ${NOMES[p.para] ?? p.para} (${p.motivo})`;
  $('confirmar').disabled = p === null;

  mostrarTopologia(s, v);
  // As outras telas recebem a mesma visão: "local" é o que a nuvem conhece; "localReal",
  // os números da própria loja (só para ferramentas do laboratório, como o teste de recuperação).
  document.dispatchEvent(new CustomEvent('continuum:situacao', { detail: { ...s, local: loja, localReal: s.local, visao: v } }));
}

// Topologia: o cabo Loja LAB ↔ Nuvem e os dois nós dele mostram o LAB real.
function mostrarTopologia(s, v) {
  const queda = s.kryptonita.queda;
  const enviou = s.nuvem !== null && eventosNuvemAntes !== null && s.nuvem.eventos > eventosNuvemAntes;
  eventosNuvemAntes = s.nuvem === null ? null : s.nuvem.eventos;
  const cabo = $('cabo-real');
  cabo.classList.toggle('fora', queda !== null);
  cabo.classList.toggle('enviando', queda === null && enviou);
  const acao = queda === null ? 'derrubar' : 'restaurar';
  $('rotulo-real').textContent = queda === null ? 'AO VIVO · clique para derrubar' : 'CORTADO · clique para restaurar';
  cabo.setAttribute('aria-label', `Cabo Loja LAB ↔ Nuvem: clique para ${acao} a nuvem`);
  $('topo-dica').textContent =
    queda === null ? 'Clique no cabo para derrubar a nuvem (corte de conexão).' : `Nuvem fora (${queda === 'corte' ? 'conexão cortada' : '503'}). Clique no cabo para restaurar.`;
  $('no-nuvem').classList.toggle('fora', queda !== null);
  $('topo-nuvem').textContent =
    queda !== null ? 'fora do ar' : s.nuvem === null ? 'sem resposta' : `${numero.format(s.nuvem.vendas)} vendas`;
  $('topo-loja').textContent = v.semSinal ? 'sem sinal · pendente sync' : `${numero.format(v.loja.vendas)} vendas`;
  $('topo-estado').dataset.estado = s.estado;
  $('topo-estado').textContent = NOMES[s.estado] ?? s.estado;
  $('topo-extra').textContent = EXTRAS[s.estado] ?? '';
  $('topo-pendentes').textContent = v.semSinal ? '—' : numero.format(v.loja.pendentes);
  $('topo-pendentes-sub').textContent = v.semSinal ? `pendente de sincronização · ${desdeTexto(v)}` : 'eventos pendentes';
}

// Clique no cabo real: as mesmas rotas do Simulador (com X-Continuum).
async function alternarCabo() {
  if (caboOcupado || ultimaQueda === undefined) return; // ainda sem a primeira situação
  caboOcupado = true;
  $('cabo-real').classList.add('ocupado');
  try {
    if (ultimaQueda === null) await enviar('/api/nuvem/derrubar', { tipo: $('tipo-queda').value });
    else await enviar('/api/nuvem/restaurar');
  } finally {
    caboOcupado = false;
    $('cabo-real').classList.remove('ocupado');
  }
}

// Telas na mesma página (o endereço guarda a escolha em #nome; o Dashboard fica sem #).
const TELAS = [...document.querySelectorAll('.tela')].map((el) => el.id.replace('tela-', ''));
function abrirTela(nome) {
  if (!TELAS.includes(nome)) nome = 'dashboard';
  for (const tela of TELAS) $(`tela-${tela}`).hidden = tela !== nome;
  for (const item of document.querySelectorAll('nav [data-tela]')) {
    const ativo = item.dataset.tela === nome;
    item.classList.toggle('ativo', ativo);
    if (ativo) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  history.replaceState(null, '', nome === 'dashboard' ? location.pathname : `#${nome}`);
  document.dispatchEvent(new CustomEvent('continuum:tela', { detail: nome }));
}
window.abrirTela = abrirTela;
window.registrarAtividade = registrar; // usado pelo paginas.js (ex.: vendas do PDV)

function aoAtivar(elemento, acao) {
  elemento.addEventListener('click', acao);
  elemento.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      acao();
    }
  });
}

function conexao(ligado, texto) {
  $('ponto-conexao').className = `ponto ${ligado ? 'ligado' : 'desligado'}`;
  $('conexao-titulo').textContent = ligado ? 'LAB conectado' : 'LAB fora do ar';
  $('conexao').textContent = texto;
  $('caixa-conexao').classList.toggle('erro', !ligado);
}

async function atualizar() {
  try {
    const resposta = await fetch('/api/situacao');
    if (!resposta.ok) throw new Error(String(resposta.status));
    mostrar(await resposta.json());
    conexao(true, `Última atualização: ${new Date().toLocaleTimeString('pt-BR')}`);
  } catch {
    conexao(false, 'sem conexão com o LAB: ele está rodando?');
  }
}

$('form-vendas').addEventListener('submit', (evento) => {
  evento.preventDefault();
  void enviar('/api/vendas', { quantidade: Number($('quantidade').value), ritmo: Number($('ritmo').value) });
});
$('parar').addEventListener('click', () => void enviar('/api/vendas/parar'));
$('derrubar').addEventListener('click', () => void enviar('/api/nuvem/derrubar', { tipo: $('tipo-queda').value }));
$('restaurar').addEventListener('click', () => void enviar('/api/nuvem/restaurar'));
$('modo').addEventListener('focus', () => (editandoModo = true));
$('modo').addEventListener('blur', () => (editandoModo = false));
$('modo').addEventListener('change', async () => {
  await enviar('/api/modo', { modo: $('modo').value });
  editandoModo = false;
});
$('confirmar').addEventListener('click', () => void enviar('/api/confirmar'));

for (const item of document.querySelectorAll('nav [data-tela]')) aoAtivar(item, () => abrirTela(item.dataset.tela));
aoAtivar($('cabo-real'), () => void alternarCabo());
abrirTela(location.hash.slice(1) || 'dashboard');
addEventListener('hashchange', () => abrirTela(location.hash.slice(1) || 'dashboard'));

void atualizar();
setInterval(() => void atualizar(), INTERVALO_MS);
