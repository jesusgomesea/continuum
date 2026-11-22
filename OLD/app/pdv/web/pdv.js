// PDV do Continuum: JavaScript puro, sem nada da internet.
// Lê o estado do caixa a cada 1 s; todo POST leva `X-Continuum: pdv`.
// O navegador manda só produto e quantidade: preço, total e estoque são do servidor.
'use strict';

const $ = (id) => document.getElementById(id);
const real = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NOMES = { saudavel: 'SAUDÁVEL', degradado: 'DEGRADADO', offline: 'OFFLINE', recuperando: 'RECUPERANDO', sincronizando: 'SINCRONIZANDO' };

let produtos = [];
const carrinho = new Map(); // produtoId -> quantidade, na ordem em que entrou
let chave = null; // chave de idempotência da venda em andamento
let enviando = false;
let modoEstoque = false;
let cupomAberto = null; // vendaId do cupom na tela
let ultimaVendaVista = null;
let reporProduto = null;

// ---------------------------------------------------------------- API
async function postar(rota, corpo) {
  let r;
  try {
    r = await fetch(rota, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-continuum': 'pdv' },
      body: JSON.stringify(corpo ?? {}),
    });
  } catch {
    const erro = new Error('Sem resposta do PDV.');
    erro.semResposta = true;
    throw erro;
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const erro = new Error(dados.erro ?? `erro ${r.status}`);
    erro.status = r.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
}

let toastTimer;
function toast(texto, tipo = '') {
  const el = $('toast');
  el.textContent = texto;
  el.className = `toast ${tipo}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------------------------------------------------------------- estado vindo do servidor
async function atualizar() {
  let e;
  try {
    const r = await fetch('/api/pdv/estado', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    e = await r.json();
  } catch {
    mostrarConexao(null, true);
    return;
  }
  produtos = e.produtos;
  mostrarConexao(e.lab, false);
  const fila = $('fila');
  fila.textContent = e.fila.toLocaleString('pt-BR');
  fila.classList.toggle('crescendo', e.fila > 0 && (e.lab === null || e.lab.estado !== 'saudavel'));
  $('caixa-nome').textContent = e.caixa.caixa;
  $('resumo-caixa').textContent = `${e.caixa.vendas} ${e.caixa.vendas === 1 ? 'venda' : 'vendas'} · ${real(e.caixa.totalCentavos)}`;
  $('demo').hidden = produtos.length >= 6;
  mostrarProdutos();
  mostrarCarrinho();
  mostrarUltimas(e.vendas);
  if (cupomAberto) {
    const c = e.vendas.find((v) => v.vendaId === cupomAberto);
    if (c) { desenharConfirmacao(c); desenharCupom(c); }
  }
}

function mostrarConexao(lab, pdvFora) {
  const el = $('conexao');
  let situacao, titulo, detalhe;
  if (pdvFora) [situacao, titulo, detalhe] = ['offline', 'PDV sem resposta', 'o servidor do caixa parou: veja o console'];
  else if (lab === null) [situacao, titulo, detalhe] = ['alerta', 'LAB fechado', 'vendendo só no local; a fila sobe quando o LAB abrir'];
  else if (lab.queda !== null || lab.estado === 'offline') [situacao, titulo, detalhe] = ['offline', 'Nuvem fora · contingência', 'as vendas continuam e ficam na fila da loja'];
  else if (lab.estado === 'saudavel') [situacao, titulo, detalhe] = ['online', 'Nuvem no ar', 'vendas enviadas pelo sync em instantes'];
  else [situacao, titulo, detalhe] = ['alerta', NOMES[lab.estado] ?? lab.estado, lab.estado === 'sincronizando' ? 'enviando a fila acumulada' : 'confirmando a conexão'];
  el.dataset.situacao = situacao;
  $('conexao-titulo').textContent = titulo;
  $('conexao-detalhe').textContent = detalhe;
}

// ---------------------------------------------------------------- catálogo
const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function filtrados() {
  const termo = semAcento($('busca').value.trim());
  if (!termo) return produtos;
  return produtos.filter((p) => p.codigo.includes(termo) || semAcento(p.nome).includes(termo));
}

// Botões fixos por produto: só o texto muda, para o clique não se perder na atualização.
const botoes = new Map();
function mostrarProdutos() {
  const grade = $('produtos');
  grade.classList.toggle('modo-estoque', modoEstoque);
  const lista = filtrados();
  const ids = new Set(lista.map((p) => p.id));
  for (const [id, b] of botoes) if (!produtos.some((p) => p.id === id)) { b.remove(); botoes.delete(id); }
  lista.forEach((p) => {
    let b = botoes.get(p.id);
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'produto';
      b.dataset.id = p.id;
      botoes.set(p.id, b);
    }
    const noCarrinho = carrinho.get(p.id) ?? 0;
    const livre = p.saldo - noCarrinho;
    const html = `${noCarrinho ? `<span class="no-carrinho">${noCarrinho} no carrinho</span>` : ''}<span class="cod">${esc(p.codigo)}</span><span class="nome">${esc(p.nome)}</span><span class="preco">${real(p.precoCentavos)}</span><span class="estoque ${p.saldo <= 5 ? 'baixo' : ''}">estoque: ${p.saldo.toLocaleString('pt-BR')}</span>`;
    if (b.innerHTML !== html) b.innerHTML = html;
    b.disabled = !modoEstoque && livre <= 0;
    b.title = modoEstoque ? 'Dar entrada no estoque' : livre <= 0 ? 'Sem estoque disponível' : 'Adicionar à venda';
    if (b.parentNode !== grade) grade.append(b);
  });
  for (const [id, b] of botoes) b.hidden = !ids.has(id);
  // Mantém a ordem do cadastro.
  lista.forEach((p) => grade.append(botoes.get(p.id)));
}

$('produtos').addEventListener('click', (e) => {
  const b = e.target.closest('.produto');
  if (!b || b.disabled) return;
  if (modoEstoque) abrirRepor(b.dataset.id);
  else adicionar(b.dataset.id);
});

function adicionar(id, qtd = 1) {
  const p = produtos.find((x) => x.id === id);
  if (!p) return;
  const atual = carrinho.get(id) ?? 0;
  if (atual + qtd > p.saldo) {
    toast(`Estoque insuficiente: ${p.nome} tem ${p.saldo}.`, 'erro');
    return;
  }
  if (atual + qtd <= 0) carrinho.delete(id);
  else carrinho.set(id, atual + qtd);
  mudouCarrinho();
}

function mudouCarrinho() {
  chave = null; // a venda mudou: é outro pedido
  $('mensagem').textContent = '';
  mostrarCarrinho();
  mostrarProdutos();
}

// ---------------------------------------------------------------- carrinho
function totalCarrinho() {
  let total = 0;
  for (const [id, q] of carrinho) total += (produtos.find((p) => p.id === id)?.precoCentavos ?? 0) * q;
  return total;
}

function mostrarCarrinho() {
  const lista = $('itens');
  if (carrinho.size === 0) {
    lista.innerHTML = '<li class="vazio">Clique num produto para começar a venda.</li>';
  } else {
    const html = [...carrinho].map(([id, q]) => {
      const p = produtos.find((x) => x.id === id);
      if (!p) return '';
      return `<li data-id="${id}"><div>${esc(p.nome)}<small>${real(p.precoCentavos)} cada</small></div>
        <div class="qtd"><button type="button" data-acao="menos" aria-label="Diminuir">−</button><b>${q}</b><button type="button" data-acao="mais" aria-label="Aumentar">+</button></div>
        <span class="subtotal">${real(p.precoCentavos * q)}</span></li>`;
    }).join('');
    if (lista.dataset.html !== html) { lista.innerHTML = html; lista.dataset.html = html; }
  }
  if (carrinho.size === 0) lista.dataset.html = '';
  const total = totalCarrinho();
  $('total').textContent = real(total);
  $('finalizar').disabled = carrinho.size === 0 || enviando;
  mostrarTroco(total);
}

$('itens').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-acao]');
  if (!b) return;
  const id = b.closest('li').dataset.id;
  adicionar(id, b.dataset.acao === 'mais' ? 1 : -1);
});

function centavosDe(texto) {
  const limpo = texto.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.');
  const v = Number(limpo);
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}
function mostrarTroco(total = totalCarrinho()) {
  const dinheiro = $('pagamento').value === 'dinheiro';
  $('rotulo-recebido').hidden = !dinheiro;
  const recebido = centavosDe($('recebido').value);
  const troco = $('troco');
  if (!dinheiro || !$('recebido').value) { troco.textContent = '—'; troco.style.color = ''; return; }
  const t = recebido - total;
  troco.textContent = Number.isNaN(t) ? '—' : t < 0 ? `falta ${real(-t)}` : real(t);
  troco.style.color = t < 0 ? 'var(--vermelho)' : 'var(--verde)';
}
$('pagamento').addEventListener('change', () => mostrarTroco());
$('recebido').addEventListener('input', () => mostrarTroco());

function cancelarVenda() {
  if (carrinho.size === 0) return;
  carrinho.clear();
  $('recebido').value = '';
  mudouCarrinho();
}
$('cancelar').addEventListener('click', cancelarVenda);

// ---------------------------------------------------------------- finalizar
async function finalizar() {
  if (enviando || carrinho.size === 0) return;
  const total = totalCarrinho();
  if ($('pagamento').value === 'dinheiro' && $('recebido').value && centavosDe($('recebido').value) < total) {
    $('mensagem').textContent = 'Valor recebido menor que o total.';
    return;
  }
  enviando = true;
  $('finalizar').disabled = true;
  $('finalizar').textContent = 'Gravando…';
  $('mensagem').textContent = '';
  // A mesma chave em toda nova tentativa desta venda: o servidor nunca grava duas vezes.
  chave ??= crypto.randomUUID();
  try {
    const forma = $('pagamento').value;
    const recebido = forma === 'dinheiro' && $('recebido').value ? centavosDe($('recebido').value) : null;
    const { cupom } = await postar('/api/pdv/vendas', {
      chave,
      itens: [...carrinho].map(([produtoId, quantidade]) => ({ produtoId, quantidade })),
      pagamento: { forma, recebidoCentavos: Number.isNaN(recebido) ? null : recebido },
    });
    carrinho.clear();
    chave = null;
    $('recebido').value = '';
    ultimaVendaVista = cupom.vendaId;
    abrirCupom(cupom);
    void atualizar();
  } catch (erro) {
    // Resposta de negócio (estoque, dado inválido, banco ocupado): nada foi gravado, a próxima tentativa é nova.
    // Sem resposta: a venda pode ter sido gravada; a chave fica para a nova tentativa não duplicar.
    if (!erro.semResposta) chave = null;
    $('mensagem').textContent = erro.message;
    if (erro.dados?.codigo === 'estoque-insuficiente') void atualizar();
  } finally {
    enviando = false;
    $('finalizar').textContent = 'Finalizar venda (F9)';
    mostrarCarrinho();
  }
}
$('finalizar').addEventListener('click', finalizar);

// ---------------------------------------------------------------- venda finalizada e cupom
const FORMAS = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix' };
function desenharConfirmacao(c) {
  $('fin-quando').textContent = `Venda nº ${c.numero.toLocaleString('pt-BR')} · ${new Date(c.ocorridoEm).toLocaleString('pt-BR')} · ${c.caixa}`;
  $('fin-codigo').textContent = c.codigo;
  $('fin-total').textContent = real(c.totalCentavos);
  const p = c.pagamento;
  $('fin-forma').textContent = p ? FORMAS[p.forma] ?? p.forma : '—';
  $('fin-recebido').textContent = p ? real(p.recebidoCentavos) : '—';
  $('fin-troco').textContent = p ? real(p.trocoCentavos) : '—';
  const s = $('fin-situacao');
  s.className = `fin-situacao ${c.situacao}`;
  s.textContent = c.situacao === 'nuvem'
    ? `✓ Na nuvem · confirmada pelo sync às ${hora(c.sincronizadoEm)}`
    : '● Salva na loja · aguardando a nuvem (está na fila)';
}

function desenharCupom(c) {
  const linhas = c.itens.map((i) => `<tr><td>${i.quantidade} × ${esc(i.nome)}<br><small>${real(i.precoUnitarioCentavos)}</small></td><td class="num">${real(i.quantidade * i.precoUnitarioCentavos)}</td></tr>`).join('');
  const situacao = c.situacao === 'nuvem'
    ? `<div class="situacao nuvem">✓ Na nuvem<small>confirmada pelo sync às ${hora(c.sincronizadoEm)}</small></div>`
    : '<div class="situacao pendente">● Salva na loja · aguardando a nuvem<small>está na fila (outbox); o sync envia quando a nuvem responder</small></div>';
  const html = `<h3 id="cupom-titulo">CONTINUUM</h3><div class="centro">Loja LAB · ${esc(c.caixa)}</div><hr>
    <div>Venda nº <b>${c.numero.toLocaleString('pt-BR')}</b></div><div>Código <b>${esc(c.codigo)}</b></div><div class="data">${new Date(c.ocorridoEm).toLocaleString('pt-BR')}</div><hr>
    <table>${linhas}<tr class="tot"><td>TOTAL</td><td class="num">${real(c.totalCentavos)}</td></tr>${c.pagamento ? `<tr><td>${esc(FORMAS[c.pagamento.forma] ?? c.pagamento.forma)}</td><td class="num">${real(c.pagamento.recebidoCentavos)}</td></tr><tr><td>Troco</td><td class="num">${real(c.pagamento.trocoCentavos)}</td></tr>` : ''}</table><hr>
    <div class="centro">evento nº ${c.seq ?? '—'} na outbox · ${c.vendaId.slice(0, 8)}</div>${situacao}`;
  const papel = $('cupom-papel');
  if (papel.dataset.html !== html) { papel.innerHTML = html; papel.dataset.html = html; }
}
function abrirCupom(c) {
  cupomAberto = c.vendaId;
  desenharConfirmacao(c);
  desenharCupom(c);
  $('cupom-fundo').hidden = false;
  $('cupom-fechar').focus();
}
function fecharCupom() {
  cupomAberto = null;
  $('cupom-fundo').hidden = true;
  $('busca').focus();
}
$('cupom-fechar').addEventListener('click', fecharCupom);
$('fin-copiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('fin-codigo').textContent); toast('Código copiado.', 'bom'); }
  catch { toast('Não foi possível copiar: anote o código.', 'erro'); }
});
$('cupom-fundo').addEventListener('click', (e) => { if (e.target === $('cupom-fundo')) fecharCupom(); });

function mostrarUltimas(vendas) {
  const lista = $('ultimas');
  if (vendas.length === 0) { lista.innerHTML = '<li class="vazio">Nenhuma venda ainda.</li>'; return; }
  const html = vendas.map((v) => `<li data-id="${v.vendaId}" class="${v.vendaId === ultimaVendaVista ? 'novo' : ''}"><b class="cod-venda">${esc(v.codigo)}</b><time>${hora(v.ocorridoEm)}</time><span class="valor">${real(v.totalCentavos)}</span><span class="selo ${v.situacao}">${v.situacao === 'nuvem' ? 'na nuvem' : 'aguardando'}</span></li>`).join('');
  if (lista.dataset.html !== html) { lista.innerHTML = html; lista.dataset.html = html; }
  ultimaVendaVista = null;
  lista._vendas = vendas;
}
$('ultimas').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  const v = li && $('ultimas')._vendas?.find((x) => x.vendaId === li.dataset.id);
  if (v) abrirCupom(v);
});

// ---------------------------------------------------------------- estoque
$('modo-estoque').addEventListener('click', () => {
  modoEstoque = !modoEstoque;
  $('modo-estoque').setAttribute('aria-pressed', String(modoEstoque));
  $('modo-estoque').textContent = modoEstoque ? 'Sair da reposição' : 'Repor estoque';
  $('aviso-estoque').hidden = !modoEstoque;
  mostrarProdutos();
});
function abrirRepor(id) {
  reporProduto = produtos.find((p) => p.id === id);
  if (!reporProduto) return;
  $('repor-titulo').textContent = `Repor: ${reporProduto.nome}`;
  $('repor-texto').textContent = `Estoque atual: ${reporProduto.saldo}. A entrada vira uma movimentação na loja e um evento para a nuvem.`;
  $('repor-fundo').hidden = false;
  $('repor-qtd').select();
}
const fecharRepor = () => { $('repor-fundo').hidden = true; reporProduto = null; };
$('repor-cancelar').addEventListener('click', fecharRepor);
$('repor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = reporProduto;
  try {
    const { saldo } = await postar('/api/pdv/estoque', { produtoId: p.id, quantidade: Number($('repor-qtd').value) });
    toast(`${p.nome}: estoque agora ${saldo}.`, 'bom');
    fecharRepor();
    void atualizar();
  } catch (erro) { toast(erro.message, 'erro'); }
});
$('cadastrar-demo').addEventListener('click', async () => {
  $('cadastrar-demo').disabled = true;
  try {
    const { criados } = await postar('/api/pdv/catalogo-demo');
    toast(criados ? `${criados} produtos cadastrados com estoque inicial.` : 'Os produtos de demonstração já existem.', 'bom');
    void atualizar();
  } catch (erro) { toast(erro.message, 'erro'); } finally { $('cadastrar-demo').disabled = false; }
});

// ---------------------------------------------------------------- teclado e busca
$('busca').addEventListener('input', mostrarProdutos);
$('busca').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const termo = $('busca').value.trim();
  const lista = filtrados();
  const exato = produtos.find((p) => p.codigo === termo.padStart(3, '0'));
  const alvo = exato ?? (lista.length === 1 ? lista[0] : null);
  if (alvo) {
    if (modoEstoque) abrirRepor(alvo.id); else adicionar(alvo.id);
    $('busca').value = '';
    mostrarProdutos();
  }
});
document.addEventListener('keydown', (e) => {
  if (!$('repor-fundo').hidden) { if (e.key === 'Escape') fecharRepor(); return; }
  if (!$('cupom-fundo').hidden) {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); fecharCupom(); }
    return;
  }
  if (e.key === 'F2') { e.preventDefault(); $('busca').focus(); $('busca').select(); }
  else if (e.key === 'F9') { e.preventDefault(); void finalizar(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelarVenda(); }
});

const relogio = () => { $('relogio').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
relogio();
setInterval(relogio, 10_000);
void atualizar();
setInterval(() => void atualizar(), 1000);
$('busca').focus();
