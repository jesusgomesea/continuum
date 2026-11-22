// Telas do MVP: Lojas, Sincronização, Armazenamento, Segurança, Recuperação,
// Relatórios e Configurações. JavaScript puro, sem nada da internet (ADR 013).
// Ouve o painel.js pelos eventos 'continuum:situacao', 'continuum:registro',
// 'continuum:episodio' e 'continuum:tela'. Usa só as rotas que o LAB já tem.
// O que é real leva o selo "ao vivo"; o que é ilustrativo, "simulação".
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('pt-BR');
  const NOMES = {
    saudavel: 'SAUDÁVEL', degradado: 'DEGRADADO', offline: 'OFFLINE',
    recuperando: 'RECUPERANDO', sincronizando: 'SINCRONIZANDO', suspenso: 'SUSPENSO',
  };
  const CORES = { saudavel: '#34d399', degradado: '#fbbf24', offline: '#f87171', recuperando: '#f59e0b', sincronizando: '#38bdf8', suspenso: '#94a3b8' };
  const hora = (t = Date.now()) => new Date(t).toLocaleTimeString('pt-BR');
  const dataHora = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const seg = (ms) => (ms == null ? '—' : `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`);
  const duracao = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${s % 60} s`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const sorteio = (min, max) => min + Math.random() * (max - min);

  // ---------------------------------------------------------------- memória
  // Fica só neste navegador; tudo em try/catch (janela privada, armazenamento bloqueado).
  const CHAVE = 'continuum.painel.v1';
  const PADRAO = () => ({
    inicio: Date.now(), episodios: [], estados: {}, auditoria: [], amostras: [],
    testes: [], backups: null, perfil: 'ti', prefs: { queda: 'corte', qtd: 200, ritmo: 20 },
  });
  let mem = PADRAO();
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? 'null');
    if (salvo && typeof salvo === 'object') mem = { ...mem, ...salvo, prefs: { ...mem.prefs, ...(salvo.prefs ?? {}) } };
  } catch { /* sem armazenamento: segue só na memória */ }
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(mem)); } catch { /* idem */ } };
  setInterval(salvar, 3000);
  addEventListener('beforeunload', salvar);

  // ---------------------------------------------------------------- aviso, diálogo, API
  let toastTimer;
  function toast(texto, tipo = '') {
    const el = $('toast');
    el.textContent = texto;
    el.className = `toast ${tipo}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  function confirmar(titulo, texto, rotuloOk = 'Confirmar', perigo = false) {
    return new Promise((resolver) => {
      $('modal-titulo').textContent = titulo;
      $('modal-texto').textContent = texto;
      const ok = $('modal-ok');
      ok.textContent = rotuloOk;
      ok.className = perigo ? 'perigo' : '';
      $('modal').hidden = false;
      ok.focus();
      const fim = (v) => {
        $('modal').hidden = true;
        ok.onclick = $('modal-cancelar').onclick = null;
        resolver(v);
      };
      ok.onclick = () => fim(true);
      $('modal-cancelar').onclick = () => fim(false);
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) $('modal-cancelar').click(); });

  // Mesmas rotas e o mesmo cabeçalho do painel.js (sem X-Continuum, o LAB responde 403).
  async function api(rota, corpo) {
    try {
      const r = await fetch(rota, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-continuum': 'lab' },
        body: JSON.stringify(corpo ?? {}),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.erro ?? `erro ${r.status}`);
      return dados;
    } catch (erro) {
      throw new Error(erro instanceof TypeError ? 'Sem resposta do LAB.' : erro.message);
    }
  }

  // ---------------------------------------------------------------- perfis (simulação)
  const PERMS = {
    vendas: 'Gerar vendas', nuvem: 'Derrubar / restaurar nuvem', modo: 'Alterar modo do sync',
    backup: 'Backup e restauração', exportar: 'Exportar relatórios',
  };
  const PERFIS = {
    ti: { nome: 'TI (administrador)', curto: 'TI', sigla: 'TI', perms: ['vendas', 'nuvem', 'modo', 'backup', 'exportar'] },
    supervisor: { nome: 'Supervisor da loja', curto: 'Supervisor', sigla: 'SU', perms: ['vendas', 'nuvem', 'exportar'] },
    caixa: { nome: 'Operador de caixa', curto: 'Caixa', sigla: 'OP', perms: ['vendas'] },
    auditor: { nome: 'Auditor', curto: 'Auditor', sigla: 'AU', perms: ['exportar'] },
  };
  if (!PERFIS[mem.perfil]) mem.perfil = 'ti';
  const pode = (perm) => PERFIS[mem.perfil].perms.includes(perm);

  function auditar(acao, resultado = 'ok') {
    mem.auditoria.unshift({ t: Date.now(), perfil: mem.perfil, acao, resultado });
    mem.auditoria.length = Math.min(mem.auditoria.length, 200);
    mostrarAuditoria();
  }

  function aplicarPerfil() {
    const p = PERFIS[mem.perfil];
    $('avatar').textContent = p.sigla;
    $('usuario-perfil').textContent = p.nome;
    for (const el of document.querySelectorAll('[data-perm]')) {
      const bloqueado = !pode(el.dataset.perm);
      el.classList.toggle('sem-permissao', bloqueado);
      if (bloqueado) el.setAttribute('title', `Sem permissão no perfil ${p.nome}`);
      else el.removeAttribute('title');
    }
    for (const id of ['perfil', 'cfg-perfil']) $(id).value = mem.perfil;
    mostrarMatriz();
  }

  // Bloqueia, antes do painel.js, qualquer ação sem permissão (clique, teclado, envio).
  function negar(perm, evento) {
    evento.preventDefault();
    evento.stopImmediatePropagation();
    toast(`Perfil ${PERFIS[mem.perfil].nome}: sem permissão para "${PERMS[perm]}".`, 'erro');
    auditar(`Tentou: ${PERMS[perm]}`, 'negado');
  }
  function barrar(evento) {
    const alvo = evento.target.closest?.('[data-perm]');
    if (!alvo || pode(alvo.dataset.perm)) return;
    if (evento.type === 'keydown' && evento.key !== 'Enter' && evento.key !== ' ') return;
    // mousedown só importa para o select (abre a lista antes do clique).
    if (evento.type === 'mousedown' && alvo.tagName !== 'SELECT') return;
    negar(alvo.dataset.perm, evento);
  }
  for (const tipo of ['click', 'keydown', 'mousedown']) document.addEventListener(tipo, barrar, true);
  // Enter num campo envia o formulário sem clicar no botão: barra também.
  const PERM_FORM = { 'form-vendas': 'vendas', 'rt-form': 'nuvem' };
  document.addEventListener('submit', (e) => {
    const perm = PERM_FORM[e.target.id];
    if (perm && !pode(perm)) negar(perm, e);
  }, true);

  // Ações reais do Dashboard/Topologia também entram na auditoria.
  const ACOES_DASH = { gerar: 'Gerou vendas (simulador)', parar: 'Parou a geração', derrubar: 'Derrubou a nuvem', restaurar: 'Restaurou a nuvem', confirmar: 'Confirmou transição' };
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('button');
    if (b && ACOES_DASH[b.id] && !b.disabled) auditar(ACOES_DASH[b.id]);
    if (e.target.closest?.('#cabo-real')) auditar(ultimo?.kryptonita.queda === null ? 'Cortou o cabo na Topologia' : 'Religou o cabo na Topologia');
  });
  $('modo').addEventListener('change', () => auditar(`Modo alterado para ${$('modo').value}`));

  // ---------------------------------------------------------------- estado vindo do painel.js
  let ultimo = null; // última situação
  let anterior = null;
  let ultimoTick = null;
  let telaAtual = 'dashboard';
  const porSegundo = []; // { t, aceitos, pendentes, vendas } 1 por segundo, 90 s
  let marcoSegundo = null;
  const lotes = [];
  let picoFila = 0;
  let ultimaTransicao = null; // { de, para }

  document.addEventListener('continuum:tela', (e) => { telaAtual = e.detail; desenharTela(); });

  document.addEventListener('continuum:situacao', (e) => {
    anterior = ultimo;
    ultimo = e.detail;
    const s = ultimo;
    const agora = Date.now();

    // Tempo em cada estado (lacunas grandes, como o painel fechado, não contam).
    if (ultimoTick !== null) {
      const dt = Math.min(agora - ultimoTick, 3000);
      mem.estados[s.estado] = (mem.estados[s.estado] ?? 0) + dt;
      if (s.kryptonita.queda !== null) mem.estados.__nuvemFora = (mem.estados.__nuvemFora ?? 0) + dt;
      mem.estados.__total = (mem.estados.__total ?? 0) + dt;
    }
    ultimoTick = agora;
    if (anterior && anterior.estado !== s.estado) ultimaTransicao = { de: anterior.estado, para: s.estado };

    // Pico da fila no episódio atual.
    if (s.kryptonita.queda !== null || s.estado !== 'saudavel') picoFila = Math.max(picoFila, s.local.pendentes);

    // Lotes: a nuvem recebeu eventos desde a última consulta.
    if (anterior?.nuvem && s.nuvem && s.nuvem.eventos > anterior.nuvem.eventos) {
      lotes.unshift({ t: agora, de: anterior.nuvem.eventos + 1, ate: s.nuvem.eventos });
      lotes.length = Math.min(lotes.length, 8);
    }

    // Amostra por segundo (vazão e fila).
    if (marcoSegundo === null || agora - marcoSegundo.t >= 1000) {
      const aceitos = marcoSegundo && s.nuvem && marcoSegundo.nuvem !== null ? Math.max(0, s.nuvem.eventos - marcoSegundo.nuvem) : 0;
      const vendas = marcoSegundo ? Math.max(0, s.local.vendas - marcoSegundo.vendas) : 0;
      const dts = marcoSegundo ? (agora - marcoSegundo.t) / 1000 : 1;
      porSegundo.push({ t: agora, aceitos: aceitos / dts, pendentes: s.local.pendentes, vendas: vendas / dts });
      if (porSegundo.length > 90) porSegundo.shift();
      marcoSegundo = { t: agora, nuvem: s.nuvem ? s.nuvem.eventos : null, vendas: s.local.vendas };
    }

    // Amostra para o relatório, a cada 5 s, última hora.
    const ua = mem.amostras.at(-1);
    if (!ua || agora - ua.t >= 5000) {
      mem.amostras.push({ t: agora, vl: s.local.vendas, vn: s.nuvem ? s.nuvem.vendas : null, p: s.local.pendentes, e: s.estado, q: s.kryptonita.queda !== null ? 1 : 0 });
      if (mem.amostras.length > 720) mem.amostras.splice(0, mem.amostras.length - 720);
    }

    tickLojas(agora);
    desenharTela();
    if (testeAtivo) testeAtivo.aoAtualizar(s);
  });

  document.addEventListener('continuum:episodio', (e) => {
    const ep = e.detail;
    mem.episodios.unshift({
      inicio: ep.inicio, tipo: ep.tipo ?? 'corte', deteccao: ep.deteccao, recuperacao: ep.recuperacao,
      vendas: ep.vendasDurante ?? 0, pico: picoFila,
    });
    mem.episodios.length = Math.min(mem.episodios.length, 50);
    picoFila = 0;
    salvar();
  });

  // Notificações: o sino guarda as últimas 15 entradas da linha do tempo.
  const notificacoes = [];
  document.addEventListener('continuum:registro', (e) => {
    notificacoes.unshift(e.detail);
    notificacoes.length = Math.min(notificacoes.length, 15);
    $('sino-ponto').hidden = !$('notif').hidden ? true : false;
    mostrarNotificacoes();
  });
  function mostrarNotificacoes() {
    const lista = $('notif-lista');
    lista.innerHTML = notificacoes.length === 0
      ? '<li class="vazio">Nada por enquanto.</li>'
      : notificacoes.map((n) => `<li data-tipo="${esc(n.tipo)}"><span class="p"></span><span>${esc(n.texto)}</span><time>${hora(n.t)}</time></li>`).join('');
  }
  $('sino').addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = $('notif').hidden;
    $('notif').hidden = !abrir;
    $('sino').setAttribute('aria-expanded', String(abrir));
    if (abrir) $('sino-ponto').hidden = true;
  });
  $('notif-limpar').addEventListener('click', () => { notificacoes.length = 0; mostrarNotificacoes(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.notif-envolve')) $('notif').hidden = true; });

  // Busca: leva à tela pelo nome ou por palavras-chave.
  const BUSCA = [
    ['dashboard', 'Dashboard', 'visão geral status simulador gerar vendas atividade'],
    ['topologia', 'Topologia', 'mapa arquitetura cabo matriz ssd hd'],
    ['lojas', 'Lojas', 'rede filial loja pdv'],
    ['sincronizacao', 'Sincronização', 'sync fila outbox lote vazão máquina estados pipeline'],
    ['armazenamento', 'Armazenamento', 'backup disco ssd hd retenção sqlite'],
    ['seguranca', 'Segurança', 'perfil acesso permissão auditoria bisseção suspeito controle'],
    ['recuperacao', 'Recuperação', 'teste queda rto rpo restauração restaurar ponto'],
    ['relatorios', 'Relatórios', 'relatório exportar csv imprimir pdf disponibilidade'],
    ['configuracoes', 'Configurações', 'config modo manual automático local forçado parâmetros perfil'],
  ];
  const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function sugerir() {
    const termo = semAcento($('busca').value.trim());
    const lista = $('sugestoes');
    if (!termo) { lista.hidden = true; return []; }
    const achados = BUSCA.filter(([, nome, chaves]) => semAcento(`${nome} ${chaves}`).includes(termo));
    lista.innerHTML = achados.length === 0
      ? '<li class="vazio">Nada encontrado.</li>'
      : achados.map(([tela, nome, chaves]) => `<li data-ir="${tela}" tabindex="0"><b>${esc(nome)}</b><span>${esc(chaves.split(' ').slice(0, 4).join(' · '))}</span></li>`).join('');
    lista.hidden = false;
    return achados;
  }
  function irPara(tela) {
    window.abrirTela(tela);
    $('busca').value = '';
    $('sugestoes').hidden = true;
  }
  $('busca').addEventListener('input', sugerir);
  $('busca').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = sugerir(); if (a[0]) irPara(a[0][0]); }
    if (e.key === 'Escape') { $('busca').value = ''; $('sugestoes').hidden = true; }
  });
  $('sugestoes').addEventListener('click', (e) => { const li = e.target.closest('[data-ir]'); if (li) irPara(li.dataset.ir); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.busca')) $('sugestoes').hidden = true; });

  function desenharTela() {
    if (!ultimo) return;
    const f = { lojas: mostrarLojas, sincronizacao: mostrarSync, armazenamento: mostrarArmaz, seguranca: mostrarSeguranca, recuperacao: mostrarRecuperacao, relatorios: mostrarRelatorios, configuracoes: mostrarConfig }[telaAtual];
    f?.();
  }

  // ---------------------------------------------------------------- gráfico simples (SVG)
  function linha(valores, largura, altura, maximo, margem = 6) {
    if (valores.length < 2) return '';
    const passo = largura / (valores.length - 1);
    return valores.map((v, i) => `${(i * passo).toFixed(1)},${(altura - margem - (v / maximo) * (altura - margem * 2)).toFixed(1)}`).join(' ');
  }
  function grade(largura, altura, n = 3) {
    let g = '';
    for (let i = 1; i <= n; i++) { const y = (altura / (n + 1)) * i; g += `<line x1="0" y1="${y}" x2="${largura}" y2="${y}" class="g-grade"/>`; }
    return g;
  }

  // ================================================================ LOJAS
  const LOJAS = [
    { id: 'lab', nome: 'Loja LAB', cidade: 'Laboratório · ao vivo', real: true, pdvs: 1 },
    { id: 'centro', nome: 'Loja Centro', cidade: 'São Paulo · SP', pdvs: 6, ritmo: 1.1, vendas: 18420 },
    { id: 'norte', nome: 'Shopping Norte', cidade: 'Guarulhos · SP', pdvs: 8, ritmo: 1.5, vendas: 23115 },
    { id: 'campinas', nome: 'Loja Campinas', cidade: 'Campinas · SP', pdvs: 5, ritmo: 0.8, vendas: 12904 },
    { id: 'santos', nome: 'Loja Santos', cidade: 'Santos · SP', pdvs: 4, ritmo: 0.6, vendas: 9873 },
    { id: 'rodovia', nome: 'Loja Rodovia', cidade: 'Jundiaí · SP', pdvs: 3, ritmo: 0.5, vendas: 7310 },
  ];
  for (const l of LOJAS) if (!l.real) Object.assign(l, { estado: 'saudavel', fila: 0, sync: Date.now() - sorteio(1, 4) * 1000, serie: [], quedaEm: null, voltaEm: null });
  let lojaSel = 'lab';
  let ultimoTickLojas = null;

  function tickLojas(agora) {
    const dt = ultimoTickLojas === null ? 0 : Math.min(agora - ultimoTickLojas, 3000) / 1000;
    ultimoTickLojas = agora;
    for (const l of LOJAS) {
      if (l.real) continue;
      const novas = Math.random() < l.ritmo * dt ? Math.ceil(sorteio(0.5, 2)) : 0;
      l.vendas += novas;
      l.acumulado = (l.acumulado ?? 0) + novas;
      // Mesmo caminho da máquina de estados real, em ritmo de demonstração.
      if (l.estado === 'degradado' && agora - l.quedaEm > 2400) l.estado = 'offline';
      if (l.estado === 'recuperando' && agora - l.voltaEm > 2500) l.estado = 'sincronizando';
      // O que a nuvem conhece da loja só avança enquanto há sinal.
      if (l.estado !== 'offline' && l.estado !== 'degradado') l.vendasVistas = l.vendas;
      if (l.estado === 'offline' || l.estado === 'degradado' || l.estado === 'recuperando') {
        l.fila += novas * 3; // venda + movimentação + itens (fica na loja; a nuvem não vê)
      } else {
        l.fila += novas * 3;
        l.fila = Math.max(0, l.fila - Math.ceil(60 * dt));
        if (l.fila === 0) {
          l.sync = agora;
          if (l.estado === 'sincronizando') l.estado = 'saudavel';
        }
      }
    }
    // Série por segundo, para o gráfico do detalhe.
    if (!tickLojas.marco || agora - tickLojas.marco >= 1000) {
      tickLojas.marco = agora;
      for (const l of LOJAS) {
        if (l.real) continue;
        l.serie.push(l.acumulado ?? 0);
        l.acumulado = 0;
        if (l.serie.length > 60) l.serie.shift();
      }
    }
    const sim = LOJAS.filter((l) => !l.real);
    const ok = sim.filter((l) => l.estado === 'saudavel').length;
    $('extras-rede').textContent = ok === sim.length ? `+${sim.length} lojas da rede · saudáveis` : `+${sim.length} lojas da rede · ${sim.length - ok} em contingência`;
  }

  // Como a NUVEM vê cada loja: sem sinal, vendas congeladas na última sincronização e
  // fila desconhecida (null = "pendente de sincronização").
  function dadosLoja(l) {
    if (!l.real) {
      const semSinal = l.estado === 'offline' || l.estado === 'degradado';
      return semSinal ? { ...l, vendas: l.vendasVistas ?? l.vendas, fila: null } : l;
    }
    const s = ultimo;
    const v = s.visao;
    return {
      ...l, estado: s.estado, vendas: s.local.vendas, fila: v?.semSinal ? null : s.local.pendentes,
      sync: v?.ultimaSync ?? null, serie: porSegundo.slice(-60).map((p) => p.vendas),
    };
  }
  const textoFila = (fila) => (fila === null ? 'pendente sync' : fmt.format(fila));

  function chipEstado(estado) {
    return `<span class="chip-estado" style="--c:${CORES[estado] ?? '#94a3b8'}">${NOMES[estado] ?? estado}</span>`;
  }
  const relativo = (t) => {
    if (!t) return '—';
    const s = Math.round((Date.now() - t) / 1000);
    return s < 3 ? 'agora' : s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`;
  };

  function mostrarLojas() {
    const todas = LOJAS.map(dadosLoja);
    $('lj-ok').textContent = todas.filter((l) => l.estado === 'saudavel').length;
    const cont = todas.filter((l) => l.estado !== 'saudavel' && l.estado !== 'sincronizando').length;
    $('lj-cont').textContent = cont;
    $('lj-cont').className = `kpi-valor ${cont > 0 ? 'vermelho' : ''}`;
    $('lj-vendas').textContent = fmt.format(todas.reduce((a, l) => a + l.vendas, 0));
    const semSinal = todas.filter((l) => l.fila === null).length;
    $('lj-fila').textContent = fmt.format(todas.reduce((a, l) => a + (l.fila ?? 0), 0));
    $('lj-fila').nextElementSibling.textContent = semSinal
      ? `${semSinal} ${semSinal === 1 ? 'loja sem sinal: fila pendente de sync' : 'lojas sem sinal: filas pendentes de sync'}`
      : 'eventos aguardando envio';
    // Linhas fixas, só as células mudam: o clique não se perde na atualização de 500 ms.
    const corpo = $('lj-tabela').tBodies[0];
    if (corpo.rows.length !== todas.length) {
      corpo.innerHTML = todas.map((l) => `<tr data-loja="${l.id}" tabindex="0">${'<td></td>'.repeat(6)}</tr>`).join('');
    }
    todas.forEach((l, i) => {
      const tr = corpo.rows[i];
      tr.classList.toggle('sel', l.id === lojaSel);
      const celulas = [
        `<b>${esc(l.nome)}</b><small>${esc(l.cidade)}</small>`,
        chipEstado(l.estado),
        fmt.format(l.vendas),
        textoFila(l.fila),
        relativo(l.sync),
        l.real ? '<span class="tag-vivo">ao vivo</span>' : '<span class="selo-sim">simulação</span>',
      ];
      celulas.forEach((html, j) => { if (tr.cells[j].innerHTML !== html) tr.cells[j].innerHTML = html; });
      tr.cells[2].className = tr.cells[3].className = 'num';
      if (l.fila === null || (l.fila > 0 && l.estado !== 'saudavel')) tr.cells[3].classList.add('ambar');
    });

    const l = todas.find((x) => x.id === lojaSel);
    $('lj-d-nome').textContent = l.nome;
    $('lj-d-selo').innerHTML = l.real ? '<span class="tag-vivo">ao vivo</span>' : '<span class="selo-sim">simulação</span>';
    $('lj-d-cidade').textContent = l.cidade;
    $('lj-d-estado').textContent = NOMES[l.estado] ?? l.estado;
    $('lj-d-estado').style.color = CORES[l.estado];
    $('lj-d-pares').innerHTML = [
      ['PDVs', l.real ? (pdv ? `1 · ${pdv.caixa} conectado` : 'nenhum PDV aberto') : l.pdvs], ['Vendas', fmt.format(l.vendas)], ['Fila', textoFila(l.fila)], ['Última sync', relativo(l.sync)],
      ['Banco local', 'SQLite + outbox'], ['Modo', l.real ? ultimo.modo : 'automatico'],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
    const serie = l.serie.length ? l.serie : [0];
    const max = Math.max(1, ...serie);
    const pts = linha(serie.length > 1 ? serie : [0, 0], 300, 70, max, 4);
    // Sem sinal, a nuvem não recebe as vendas por segundo: o gráfico fica vazio até a loja sincronizar.
    $('lj-d-graf').innerHTML = l.fila === null
      ? grade(300, 70, 2)
      : `${grade(300, 70, 2)}<polyline points="${pts} 300,70 0,70" class="g-area"/><polyline points="${pts}" class="g-linha"/>`;
    const fora = l.real ? ultimo.kryptonita.queda !== null : l.estado === 'degradado' || l.estado === 'offline';
    const acao = $('lj-d-acao');
    acao.textContent = l.real ? (fora ? 'Restaurar a nuvem (real)' : 'Derrubar a nuvem (real)') : fora ? 'Restaurar conexão' : 'Simular queda';
    acao.className = fora ? '' : 'perigo';
    if (!pode('nuvem')) acao.classList.add('sem-permissao');
    acao.disabled = !l.real && (l.estado === 'recuperando' || l.estado === 'sincronizando');
    $('lj-d-nota').textContent = l.real
      ? (l.fila === null ? 'Sem sinal: as vendas da loja chegam na próxima sincronização. ' : '') + 'Ação real: usa a mesma rota do Simulador (Kryptonita).'
      : fora ? 'Sem sinal: a loja segue vendendo em contingência; as vendas chegam na próxima sincronização.' : 'Derruba só a conexão desta loja simulada.';
  }

  $('lj-tabela').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-loja]');
    if (tr) { lojaSel = tr.dataset.loja; mostrarLojas(); }
  });
  $('lj-tabela').addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-loja]');
    if (tr && e.key === 'Enter') { lojaSel = tr.dataset.loja; mostrarLojas(); }
  });
  $('lj-d-acao').addEventListener('click', async () => {
    const l = LOJAS.find((x) => x.id === lojaSel);
    if (l.real) {
      const fora = ultimo.kryptonita.queda !== null;
      try {
        await api(fora ? '/api/nuvem/restaurar' : '/api/nuvem/derrubar', fora ? {} : { tipo: mem.prefs.queda });
        auditar(fora ? 'Restaurou a nuvem (Lojas)' : 'Derrubou a nuvem (Lojas)');
      } catch (erro) { toast(erro.message, 'erro'); }
      return;
    }
    const agora = Date.now();
    if (l.estado === 'degradado' || l.estado === 'offline') {
      l.estado = 'recuperando'; l.voltaEm = agora;
      auditar(`Restaurou a conexão de ${l.nome} (simulação)`);
    } else {
      l.estado = 'degradado'; l.quedaEm = agora;
      auditar(`Simulou queda em ${l.nome}`);
    }
    mostrarLojas();
  });

  // ================================================================ SINCRONIZAÇÃO
  const NOS = {
    saudavel: [110, 50], degradado: [330, 50], offline: [550, 50],
    sincronizando: [220, 170], recuperando: [440, 170],
  };
  const ARESTAS = [
    ['saudavel', 'degradado'], ['degradado', 'saudavel'], ['degradado', 'offline'], ['degradado', 'sincronizando'],
    ['offline', 'recuperando'], ['recuperando', 'offline'], ['recuperando', 'sincronizando'],
    ['sincronizando', 'saudavel'], ['sincronizando', 'degradado'],
  ];
  const MW = 78, MH = 22; // meia largura e meia altura dos nós
  function desenharMaquina(atual) {
    const pares = new Set(ARESTAS.map(([a, b]) => `${a}>${b}`));
    let svg = '<defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#3b6fd1"/></marker><marker id="seta-viva" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#7dd3fc"/></marker></defs>';
    for (const [a, b] of ARESTAS) {
      const [x1, y1] = NOS[a]; const [x2, y2] = NOS[b];
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy); const ux = dx / len, uy = dy / len;
      const off = pares.has(`${b}>${a}`) ? 7 : 0; // ida e volta lado a lado
      const ox = -uy * off, oy = ux * off;
      const c = Math.min(MW / Math.abs(ux || 1e-9), MH / Math.abs(uy || 1e-9)) + 4; // borda do retângulo
      const ax = x1 + ux * c + ox, ay = y1 + uy * c + oy, bx = x2 - ux * c + ox, by = y2 - uy * c + oy;
      const viva = ultimaTransicao && ultimaTransicao.de === a && ultimaTransicao.para === b;
      svg += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" class="m-aresta ${viva ? 'viva' : ''}" marker-end="url(#${viva ? 'seta-viva' : 'seta'})"/>`;
    }
    for (const [nome, [x, y]] of Object.entries(NOS)) {
      const ativo = nome === atual;
      svg += `<g class="m-no ${ativo ? 'ativo' : ''}" style="--c:${CORES[nome]}" transform="translate(${x} ${y})"><rect x="${-MW}" y="${-MH}" width="${MW * 2}" height="${MH * 2}" rx="11"/><text y="5">${NOMES[nome]}</text></g>`;
    }
    $('maquina').innerHTML = svg;
  }

  function mostrarSync() {
    const s = ultimo;
    const fora = s.kryptonita.queda !== null;
    $('pp-op-v').textContent = fmt.format(s.local.vendas);
    $('pp-local-v').textContent = fmt.format(s.local.eventos);
    $('pp-local-r').textContent = s.visao?.semSinal
      ? 'última posição conhecida · pendente sync'
      : `eventos · ${fmt.format(s.local.pendentes)} pendentes`;
    $('pp-sync-v').textContent = NOMES[s.estado] ?? s.estado;
    $('pp-sync-v').style.color = CORES[s.estado];
    $('pp-sync-r').textContent = s.modo === 'automatico' ? 'modo automático' : s.modo === 'manual' ? 'modo manual' : 'local forçado';
    $('pp-val-v').textContent = s.nuvem ? fmt.format(s.nuvem.eventos) : '—';
    $('pp-nuvem-v').textContent = fora ? 'fora do ar' : s.nuvem ? fmt.format(s.nuvem.vendas) : 'sem resposta';
    $('pp-nuvem').classList.toggle('fora', fora || !s.nuvem);
    const enviando = !fora && s.local.pendentes > 0;
    $('pl-1').className = `liga ${s.geracao?.ativa ? 'fluindo' : ''}`;
    for (const id of ['pl-2', 'pl-3', 'pl-4']) $(id).className = `liga ${fora ? 'cortada' : enviando ? 'fluindo' : ''}`;
    $('pp-local').classList.toggle('acumulando', s.visao?.semSinal === true);

    desenharMaquina(s.estado);
    const modo = { automatico: ['Automático', 'verde'], manual: ['Manual', 'ambar'], 'local-forcado': ['Local forçado', 'vermelho'] }[s.modo] ?? [s.modo, ''];
    $('sm-modo').textContent = modo[0];
    $('sm-modo').className = `chip ${modo[1]}`;
    $('sm-falhas').textContent = s.falhasSeguidas > 3 ? '3+' : s.falhasSeguidas;
    $('sm-falhas-b').style.width = `${Math.min(100, (s.falhasSeguidas / 3) * 100)}%`;
    $('sm-sucessos').textContent = s.sucessosSeguidos > 5 ? '5+' : s.sucessosSeguidos;
    $('sm-sucessos-b').style.width = `${Math.min(100, (s.sucessosSeguidos / 5) * 100)}%`;

    // Vazão: últimos 90 s.
    const ac = porSegundo.map((p) => p.aceitos);
    const pe = porSegundo.map((p) => p.pendentes);
    const maxA = Math.max(5, ...ac), maxP = Math.max(5, ...pe);
    const pA = linha(ac, 600, 150, maxA), pP = linha(pe, 600, 150, maxP);
    $('vz-graf').innerHTML = `${grade(600, 150)}${pA ? `<polyline points="${pA} 600,150 0,150" class="g-area"/><polyline points="${pA}" class="g-linha"/>` : ''}${pP ? `<polyline points="${pP}" class="g-linha ambar"/>` : ''}`;
    const atual = porSegundo.at(-1)?.aceitos ?? 0;
    $('vz-atual').textContent = `${fmt.format(Math.round(atual))} eventos/s agora · pico ${fmt.format(Math.round(Math.max(0, ...ac)))}`;

    $('lotes').innerHTML = lotes.length === 0
      ? '<li class="vazio">Nenhum lote enviado desde que o painel abriu.</li>'
      : lotes.map((l) => `<li><span class="ok-mini">✓</span><span>seq ${fmt.format(l.de)}–${fmt.format(l.ate)}</span><b>${fmt.format(l.ate - l.de + 1)} eventos</b><span class="nota">confirmado</span><time>${hora(l.t)}</time></li>`).join('');

    const b = s.bloqueio;
    $('sync-bloqueio').className = `bloqueio ${b ? 'ativo' : ''}`;
    $('sync-bloqueio').innerHTML = b
      ? `<b>Fila bloqueada</b> · motivo: ${esc(b.motivo)}${b.seq ? ` (seq ${esc(b.seq)})` : ''}${b.status ? ` · HTTP ${esc(b.status)}` : ''} — o evento suspeito aguarda análise.`
      : '<b>Fila livre</b> · nenhum evento suspeito bloqueado.';
  }

  // ================================================================ ARMAZENAMENTO
  const hashFalso = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  if (!Array.isArray(mem.backups) || mem.backups.length === 0) {
    const hoje = new Date(); hoje.setHours(3, 0, 0, 0);
    if (hoje > new Date()) hoje.setDate(hoje.getDate() - 1);
    mem.backups = Array.from({ length: 7 }, (_, i) => ({
      t: hoje.getTime() - i * 86_400_000, tipo: i === 6 ? 'completo' : 'incremental',
      mb: Math.round(i === 6 ? 41_200 : sorteio(780, 1450)), seg: Math.round(i === 6 ? 1820 : sorteio(95, 210)),
      hash: hashFalso(), estado: 'verificado',
    }));
  }
  const tamanho = (mb) => (mb >= 1024 ? `${(mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB` : `${fmt.format(Math.round(mb))} MB`);

  function mostrarArmaz() {
    const s = ultimo;
    $('ar-eventos').textContent = fmt.format(s.local.eventos);
    $('ar-vendas').textContent = fmt.format(s.local.vendas);
    const kb = s.local.eventos * 0.9;
    $('ar-tam').textContent = kb > 1024 ? `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${fmt.format(Math.round(kb))} KB`;
    const u = mem.backups[0];
    $('ar-ultimo').textContent = relativoLongo(u.t);
    $('ar-ultimo-sub').textContent = `${u.tipo} · ${tamanho(u.mb)} · ${u.estado}`;
    $('bk-tabela').tBodies[0].innerHTML = mem.backups.slice(0, 7).map((b) => `
      <tr><td>${dataHora(b.t)}</td><td>${b.tipo}</td><td class="num">${tamanho(b.mb)}</td><td class="num">${duracao(b.seg * 1000)}</td>
      <td><code>${b.hash}…</code></td><td><span class="chip-estado" style="--c:${b.estado === 'verificado' ? '#34d399' : '#fbbf24'}">${b.estado}</span></td></tr>`).join('');
  }
  function relativoLongo(t) {
    const h = Math.round((Date.now() - t) / 3_600_000);
    return h < 1 ? 'agora há pouco' : h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
  }

  async function progresso(rotulo, ms) {
    const barra = $('bk-barra'), prog = $('bk-prog');
    barra.hidden = false;
    for (const id of ['bk-agora', 'bk-verificar']) $(id).disabled = true;
    const passos = 25;
    for (let i = 1; i <= passos; i++) {
      prog.style.width = `${(i / passos) * 100}%`;
      $('bk-status').textContent = `${rotulo} ${Math.round((i / passos) * 100)}%`;
      await espera(ms / passos);
    }
    barra.hidden = true; prog.style.width = '0';
    for (const id of ['bk-agora', 'bk-verificar']) $(id).disabled = false;
  }
  $('bk-agora').addEventListener('click', async () => {
    await progresso('Copiando banco local e outbox para o backup protegido…', 3500);
    mem.backups.unshift({ t: Date.now(), tipo: 'manual', mb: Math.round(sorteio(820, 1300)), seg: Math.round(sorteio(60, 140)), hash: hashFalso(), estado: 'verificado' });
    mem.backups.length = Math.min(mem.backups.length, 30);
    $('bk-status').textContent = 'Backup concluído e verificado (simulação).';
    auditar('Executou backup manual (simulação)');
    toast('Backup concluído e verificado.', 'bom');
    mostrarArmaz(); mostrarPontos();
  });
  $('bk-verificar').addEventListener('click', async () => {
    await progresso('Recalculando o SHA-256 de cada backup…', 2600);
    $('bk-status').textContent = `${mem.backups.length} backups conferidos: todos íntegros (simulação).`;
    auditar('Verificou a integridade dos backups (simulação)');
    toast('Integridade conferida: nenhum backup alterado.', 'bom');
  });

  // ================================================================ SEGURANÇA
  function mostrarSeguranca() {
    const s = ultimo;
    const controles = [
      [true, 'vivo', 'API do LAB protegida', 'Todo POST exige o cabeçalho X-Continuum; sem ele, 403. Uma página qualquer não aciona o LAB.'],
      [true, 'vivo', 'Só na própria máquina', `O LAB escuta em ${esc(location.host)}, sem porta aberta para a rede.`],
      [true, 'vivo', 'Eventos validados um a um', 'Tipo em minúsculas com hífen, dados em JSON puro: nada é alterado em silêncio.'],
      [!s.bloqueio, 'vivo', s.bloqueio ? 'Fila bloqueada por evento suspeito' : 'Bloqueio de sync suspeito pronto', s.bloqueio ? `Motivo: ${esc(s.bloqueio.motivo)}. Os demais eventos aguardam a análise.` : 'Um lote recusado é dividido até isolar o evento culpado.'],
      [s.sync.rodando && s.kryptonita.rodando, 'vivo', 'Processos do LAB no ar', s.sync.rodando && s.kryptonita.rodando ? 'Sync Engine e Kryptonita rodando.' : 'Um processo parou: veja o terminal do LAB.'],
      [true, 'sim', 'Backup isolado da produção', 'Cópia imutável por 90 dias, fora da rede da loja.'],
      [true, 'sim', 'Acesso por perfil', `Perfil ativo: ${PERFIS[mem.perfil].nome}.`],
    ];
    $('controles').innerHTML = controles.map(([ok, origem, titulo, texto]) => `
      <li class="${ok ? '' : 'falha'}"><span class="ok"></span><div><b>${titulo}</b> ${origem === 'vivo' ? '<span class="tag-vivo">ao vivo</span>' : '<span class="selo-sim">simulação</span>'}<div class="sub">${texto}</div></div></li>`).join('');
  }
  function mostrarMatriz() {
    const cab = `<thead><tr><th>Permissão</th>${Object.entries(PERFIS).map(([id, p]) => `<th class="${id === mem.perfil ? 'atual' : ''}">${p.curto}</th>`).join('')}</tr></thead>`;
    const corpo = Object.entries(PERMS).map(([perm, nome]) => `<tr><td>${nome}</td>${Object.entries(PERFIS).map(([id, p]) => `<td class="${id === mem.perfil ? 'atual' : ''}">${p.perms.includes(perm) ? '<span class="sim-ok">✓</span>' : '<span class="nao">—</span>'}</td>`).join('')}</tr>`).join('');
    $('matriz').innerHTML = cab + `<tbody><tr><td>Ver o painel</td>${Object.keys(PERFIS).map((id) => `<td class="${id === mem.perfil ? 'atual' : ''}"><span class="sim-ok">✓</span></td>`).join('')}</tr>${corpo}</tbody>`;
  }
  function mostrarAuditoria() {
    const corpo = $('auditoria').tBodies[0];
    corpo.innerHTML = mem.auditoria.length === 0
      ? '<tr class="vazio-linha"><td colspan="4">Nenhuma ação registrada ainda.</td></tr>'
      : mem.auditoria.slice(0, 60).map((a) => `<tr><td>${hora(a.t)}</td><td>${esc(PERFIS[a.perfil]?.sigla ?? a.perfil)}</td><td>${esc(a.acao)}</td><td><span class="chip-estado" style="--c:${a.resultado === 'negado' ? '#f87171' : a.resultado === 'falhou' ? '#fbbf24' : '#34d399'}">${esc(a.resultado)}</span></td></tr>`).join('');
  }
  function trocarPerfil(id) {
    if (!PERFIS[id] || id === mem.perfil) return;
    mem.perfil = id;
    auditar(`Trocou para o perfil ${PERFIS[id].nome}`);
    aplicarPerfil();
    salvar();
    toast(`Agora você vê o painel como: ${PERFIS[id].nome}.`);
  }
  for (const id of ['perfil', 'cfg-perfil']) {
    $(id).innerHTML = Object.entries(PERFIS).map(([k, p]) => `<option value="${k}">${p.nome}</option>`).join('');
    $(id).addEventListener('change', (e) => trocarPerfil(e.target.value));
  }

  // Bisseção: mesmo algoritmo do Sync Engine (#montarLote / lote-recusado), em câmera lenta.
  let bisRodando = false;
  $('bis-rodar').addEventListener('click', async () => {
    if (bisRodando) return;
    bisRodando = true;
    $('bis-rodar').disabled = true;
    const N = 64, base = 4001 + Math.floor(Math.random() * 500);
    const culpado = base + Math.floor(Math.random() * N);
    const barra = $('bis-barra');
    barra.innerHTML = Array.from({ length: N }, (_, i) => `<span data-i="${i}"></span>`).join('');
    const celulas = [...barra.children];
    const log = $('bis-log');
    log.innerHTML = '';
    const anotar = (html, cls = '') => { const li = document.createElement('li'); li.className = cls; li.innerHTML = html; log.append(li); log.scrollTop = log.scrollHeight; };
    const pintar = (de, ate, cls) => { for (let i = de; i <= ate; i++) celulas[i - base].className = cls; };
    auditar('Simulou sync suspeito (bisseção)');

    let inicio = base, suspeitos = null, envios = 0;
    pintar(base, base + N - 1, 'enviando');
    anotar(`Lote seq ${base}–${base + N - 1} (${N} eventos) enviado…`);
    await espera(700);
    while (true) {
      const limite = suspeitos === null ? N : Math.max(1, Math.floor(suspeitos / 2));
      const fim = Math.min(inicio + limite - 1, base + N - 1);
      envios++;
      if (envios > 1) { pintar(inicio, fim, 'enviando'); anotar(`Reenvia seq ${inicio}–${fim} (${fim - inicio + 1})…`); await espera(650); }
      if (culpado >= inicio && culpado <= fim) {
        if (fim === inicio) {
          pintar(inicio, inicio, 'culpado');
          anotar(`<b>seq ${culpado} isolado e bloqueado</b> (400): vai para outbox_falhas; alerta.fila-bloqueada registrado.`, 'ruim');
          break;
        }
        pintar(inicio, fim, 'suspeito');
        anotar(`Nuvem recusou (400). ${fim - inicio + 1} suspeitos: dividir ao meio.`, 'ruim');
        suspeitos = fim - inicio + 1;
      } else {
        pintar(inicio, fim, 'aceito');
        anotar(`Nuvem confirmou seq ${inicio}–${fim}.`, 'bom');
        suspeitos = suspeitos === null ? null : suspeitos - (fim - inicio + 1);
        inicio = fim + 1;
        if (suspeitos !== null && suspeitos <= 0) suspeitos = null;
      }
      await espera(550);
    }
    const restantes = base + N - 1 - culpado;
    if (restantes > 0) {
      pintar(culpado + 1, base + N - 1, 'parado');
      anotar(`${restantes} eventos depois dele aguardam a análise: a ordem nunca é quebrada.`);
    }
    anotar(`${envios} envios para achar 1 evento em ${N}: ${N - 1 - restantes} já estão na nuvem.`, 'bom');
    bisRodando = false;
    $('bis-rodar').disabled = false;
  });

  // ================================================================ RECUPERAÇÃO
  function mostrarRecuperacao() {
    const s = ultimo;
    const eps = mem.episodios;
    if (s.visao?.semSinal) {
      $('rc-perda').textContent = 'pendente';
      $('rc-perda').className = 'kpi-valor ambar';
      $('rc-perda-sub').textContent = 'loja sem sinal: a conferência acontece quando ela reconectar';
    } else if (s.nuvem) {
      const falta = s.local.eventos - s.nuvem.eventos;
      if (falta === 0) { $('rc-perda').textContent = '0 eventos'; $('rc-perda').className = 'kpi-valor verde'; $('rc-perda-sub').textContent = 'nuvem igual à loja, evento por evento'; }
      else { $('rc-perda').textContent = '0 perdidos'; $('rc-perda').className = 'kpi-valor ambar'; $('rc-perda-sub').textContent = `${fmt.format(falta)} eventos na outbox, aguardando envio`; }
    } else { $('rc-perda').textContent = '—'; $('rc-perda-sub').textContent = 'nuvem sem resposta: fila guardada na loja'; }
    $('rc-det').textContent = seg(eps[0]?.deteccao);
    $('rc-rec').textContent = seg(eps[0]?.recuperacao);
    $('rc-quedas').textContent = eps.length;
    $('rc-off').textContent = fmt.format(eps.reduce((a, e) => a + (e.vendas ?? 0), 0));
    const corpo = $('rc-hist').tBodies[0];
    const assinatura = `${eps.length}:${eps[0]?.inicio ?? 0}`;
    if (corpo.dataset.assinatura !== assinatura) {
      corpo.dataset.assinatura = assinatura;
      corpo.innerHTML = eps.length === 0
        ? '<tr class="vazio-linha"><td colspan="6">Derrube a nuvem (ou rode o teste) para medir a primeira queda.</td></tr>'
        : eps.slice(0, 20).map((e) => `<tr><td>${dataHora(e.inicio)}</td><td>${e.tipo === '503' ? 'Erro 503' : 'Corte'}</td><td class="num">${seg(e.deteccao)}</td><td class="num">${seg(e.recuperacao)}</td><td class="num">${fmt.format(e.vendas ?? 0)}</td><td class="num">${fmt.format(e.pico ?? 0)}</td></tr>`).join('');
    }
  }

  function mostrarPontos() {
    const pontos = mem.backups.slice(0, 4);
    $('rc-pontos').innerHTML = pontos.map((b, i) => `
      <li><div><b>${dataHora(b.t)}</b><span class="sub">${b.tipo} · ${tamanho(b.mb)} · <code>${b.hash}</code></span></div>
      <button type="button" class="secundario" data-ponto="${i}" data-perm="backup">Restaurar</button></li>`).join('');
    aplicarPerfil();
  }
  $('rc-pontos').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-ponto]');
    if (!b) return;
    const ponto = mem.backups[Number(b.dataset.ponto)];
    const ok = await confirmar('Restaurar ponto de restauração',
      `Restaurar o backup de ${dataHora(ponto.t)} em um ambiente isolado para conferência? A operação da loja não é interrompida. (simulação)`, 'Restaurar');
    if (!ok) return;
    b.disabled = true;
    const original = b.textContent;
    for (const etapa of ['Verificando hash…', 'Copiando…', 'Conferindo…']) { b.textContent = etapa; await espera(900); }
    b.textContent = original; b.disabled = false;
    auditar(`Restaurou o ponto de ${dataHora(ponto.t)} em ambiente isolado (simulação)`);
    toast('Ponto restaurado no ambiente isolado e conferido: íntegro.', 'bom');
  });

  // Teste automatizado: usa só rotas reais do LAB e espera os estados reais.
  let testeAtivo = null;
  const PASSOS = [
    ['base', 'Ponto de partida: SAUDÁVEL, sem geração em andamento'],
    ['vendas', 'Gerar vendas na loja'],
    ['derrubar', 'Derrubar a nuvem'],
    ['offline', 'Detectar a queda (OFFLINE)'],
    ['continua', 'Loja continua vendendo; a fila cresce'],
    ['restaurar', 'Restaurar a nuvem'],
    ['saudavel', 'Voltar ao SAUDÁVEL com a fila zerada'],
    ['conferir', 'Conferir: nuvem igual à loja'],
  ];
  function passo(id, situacao, detalhe = '') {
    const li = $('rt-passos').querySelector(`[data-passo="${id}"]`);
    li.className = situacao;
    if (detalhe) li.querySelector('.det').textContent = detalhe;
  }
  class Cancelado extends Error {}
  function iniciarTeste() {
    let resolverEspera = null;
    let condicao = null;
    let cancelado = false;
    const t = {
      aoAtualizar(s) { if (condicao && condicao(s)) { const r = resolverEspera; condicao = resolverEspera = null; r(s); } },
      aguardar(cond, limiteMs, rotulo) {
        if (cancelado) return Promise.reject(new Cancelado());
        if (ultimo && cond(ultimo)) return Promise.resolve(ultimo);
        return new Promise((res, rej) => {
          condicao = cond; resolverEspera = res;
          setTimeout(() => { if (resolverEspera === res) { condicao = resolverEspera = null; rej(new Error(`tempo esgotado: ${rotulo}`)); } }, limiteMs);
          t.rejeitar = rej;
        });
      },
      cancelar() { cancelado = true; condicao = null; resolverEspera = null; t.rejeitar?.(new Cancelado()); },
      get cancelado() { return cancelado; },
    };
    return t;
  }

  async function rodarTeste(qtd, ritmo, tipo) {
    $('rt-passos').innerHTML = PASSOS.map(([id, txt]) => `<li data-passo="${id}"><span class="pmarca"></span><span>${txt}</span><span class="det"></span></li>`).join('');
    $('rt-resultado').hidden = true;
    $('rt-iniciar').disabled = true; $('rt-cancelar').disabled = false;
    const t = testeAtivo = iniciarTeste();
    const r = { qtd, ritmo, tipo, inicio: Date.now() };
    auditar(`Iniciou teste de recuperação (${qtd} vendas, ${tipo})`);
    let atual = 'base';
    try {
      passo('base', 'rodando');
      await t.aguardar((s) => s.estado === 'saudavel' && s.kryptonita.queda === null && !s.geracao?.ativa, 60_000, 'estado SAUDÁVEL');
      const v0 = ultimo.localReal.vendas;
      passo('base', 'feito', `${fmt.format(v0)} vendas antes`);

      atual = 'vendas'; passo('vendas', 'rodando');
      await api('/api/vendas', { quantidade: qtd, ritmo });
      await t.aguardar((s) => s.localReal.vendas > v0, 10_000, 'primeiras vendas');
      passo('vendas', 'feito', `${fmt.format(qtd)} a ${ritmo}/s`);
      await espera(1500);
      if (t.cancelado) throw new Cancelado();

      atual = 'derrubar'; passo('derrubar', 'rodando');
      await api('/api/nuvem/derrubar', { tipo });
      const tQueda = Date.now();
      const vQueda = ultimo.localReal.vendas;
      passo('derrubar', 'feito', tipo === '503' ? 'erro 503' : 'conexão cortada');

      atual = 'offline'; passo('offline', 'rodando');
      await t.aguardar((s) => s.estado === 'offline', 45_000, 'OFFLINE');
      r.deteccao = Date.now() - tQueda;
      passo('offline', 'feito', seg(r.deteccao));

      atual = 'continua'; passo('continua', 'rodando');
      const vOff = ultimo.localReal.vendas;
      // Espera a geração terminar (ou 8 s) para mostrar a fila crescendo.
      await Promise.race([t.aguardar((s) => !s.geracao?.ativa, 120_000, 'fim da geração'), espera(8000)]);
      if (t.cancelado) throw new Cancelado();
      r.vendasQueda = ultimo.localReal.vendas - vQueda;
      r.pico = ultimo.localReal.pendentes;
      if (ultimo.localReal.vendas <= vOff && r.vendasQueda === 0) throw new Error('a loja não registrou vendas durante a queda');
      passo('continua', 'feito', `${fmt.format(r.vendasQueda)} vendas offline · fila ${fmt.format(r.pico)}`);

      atual = 'restaurar'; passo('restaurar', 'rodando');
      await api('/api/nuvem/restaurar');
      const tVolta = Date.now();
      passo('restaurar', 'feito');

      atual = 'saudavel'; passo('saudavel', 'rodando');
      await t.aguardar((s) => s.estado === 'saudavel' && s.localReal.pendentes === 0 && !s.geracao?.ativa, 180_000, 'SAUDÁVEL com fila zerada');
      r.recuperacao = Date.now() - tVolta;
      passo('saudavel', 'feito', seg(r.recuperacao));

      atual = 'conferir'; passo('conferir', 'rodando');
      await espera(800);
      const s = ultimo;
      if (!s.nuvem) throw new Error('nuvem sem resposta na conferência');
      const iguais = s.nuvem.eventos === s.localReal.eventos && s.nuvem.vendas === s.localReal.vendas;
      if (!iguais) throw new Error(`divergência: loja ${s.localReal.eventos} eventos / nuvem ${s.nuvem.eventos}`);
      passo('conferir', 'feito', `${fmt.format(s.localReal.vendas)} vendas e ${fmt.format(s.localReal.eventos)} eventos nos dois lados`);
      r.ok = true;
      r.total = Date.now() - r.inicio;
      $('rt-resultado').className = 'resultado bom';
      $('rt-resultado').innerHTML = `<b>Aprovado.</b> Queda detectada em ${seg(r.deteccao)}, de volta ao SAUDÁVEL em ${seg(r.recuperacao)} depois da nuvem voltar. ${fmt.format(r.vendasQueda)} vendas feitas offline, nenhuma perdida. Duração total: ${duracao(r.total)}.`;
      auditar('Teste de recuperação aprovado');
      toast('Teste de recuperação aprovado: nada se perdeu.', 'bom');
    } catch (erro) {
      passo(atual, 'falhou', erro instanceof Cancelado ? 'cancelado' : erro.message);
      r.ok = false; r.erro = erro instanceof Cancelado ? 'cancelado' : erro.message;
      $('rt-resultado').className = 'resultado falha';
      $('rt-resultado').innerHTML = erro instanceof Cancelado
        ? '<b>Teste cancelado.</b> Se a nuvem ficou fora, ela foi restaurada.'
        : `<b>Teste interrompido.</b> ${esc(erro.message)}`;
      auditar(`Teste de recuperação: ${r.erro}`, 'falhou');
      if (ultimo?.kryptonita.queda !== null) await api('/api/nuvem/restaurar').catch(() => {});
    } finally {
      $('rt-resultado').hidden = false;
      mem.testes.unshift(r); mem.testes.length = Math.min(mem.testes.length, 20);
      testeAtivo = null;
      $('rt-iniciar').disabled = false; $('rt-cancelar').disabled = true;
      salvar();
    }
  }
  $('rt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (testeAtivo) return;
    const qtd = Number($('rt-qtd').value), ritmo = Number($('rt-ritmo').value), tipo = $('rt-tipo').value;
    const ok = await confirmar('Iniciar teste de recuperação',
      `O teste roda no LAB real: gera ${fmt.format(qtd)} vendas, derruba a nuvem (${tipo === '503' ? 'erro 503' : 'corte de conexão'}) e depois restaura. Leva cerca de ${Math.max(20, Math.round(qtd / ritmo) + 15)} s.`, 'Iniciar teste');
    if (ok) void rodarTeste(qtd, ritmo, tipo);
  });
  $('rt-cancelar').addEventListener('click', async () => {
    if (!testeAtivo) return;
    testeAtivo.cancelar();
    await api('/api/vendas/parar').catch(() => {});
  });

  // ================================================================ RELATÓRIOS
  const media = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  function mostrarRelatorios() {
    const s = ultimo;
    const am = mem.amostras;
    const e = mem.estados;
    $('rl-periodo').textContent = `Desde ${new Date(mem.inicio).toLocaleString('pt-BR')} · acompanhado por ${duracao(e.__total ?? 0)} neste navegador`;
    const v0 = am[0]?.vl ?? s.local.vendas;
    $('rl-vendas').textContent = fmt.format(s.local.vendas);
    $('rl-vendas-sub').textContent = `+${fmt.format(Math.max(0, s.local.vendas - v0))} no período · ${s.nuvem ? fmt.format(s.nuvem.vendas) : '—'} na nuvem`;
    const total = e.__total ?? 0;
    const fora = e.__nuvemFora ?? 0;
    const disp = total > 0 ? 100 - (fora / total) * 100 : 100;
    $('rl-disp-nuvem').textContent = `${disp.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    $('rl-disp-nuvem').className = `kpi-valor ${disp >= 99 ? 'verde' : disp >= 90 ? 'ambar' : 'vermelho'}`;
    $('rl-disp-nuvem-sub').textContent = `fora por ${duracao(fora)} no total`;
    const eps = mem.episodios;
    $('rl-det').textContent = seg(media(eps.map((x) => x.deteccao)));
    $('rl-quedas').textContent = `${eps.length} ${eps.length === 1 ? 'queda medida' : 'quedas medidas'}`;
    $('rl-rec').textContent = seg(media(eps.map((x) => x.recuperacao)));

    // Gráfico loja × nuvem, com faixas vermelhas onde a nuvem esteve fora.
    const W = 600, H = 170;
    const pts = am.length >= 2 ? am : [{ vl: s.local.vendas, vn: s.nuvem?.vendas ?? 0, q: 0 }, { vl: s.local.vendas, vn: s.nuvem?.vendas ?? 0, q: 0 }];
    const minV = Math.min(...pts.map((p) => Math.min(p.vl, p.vn ?? p.vl)));
    const maxV = Math.max(minV + 10, ...pts.map((p) => p.vl));
    const esc2 = (v) => v - minV;
    const passoX = W / (pts.length - 1);
    let faixas = '';
    pts.forEach((p, i) => { if (p.q) faixas += `<rect x="${(i * passoX - passoX / 2).toFixed(1)}" y="0" width="${passoX.toFixed(1)}" height="${H}" class="g-fora"/>`; });
    const pl = linha(pts.map((p) => esc2(p.vl)), W, H, maxV - minV);
    const pn = linha(pts.map((p) => esc2(p.vn ?? minV)), W, H, maxV - minV);
    $('rl-graf').innerHTML = `${faixas}${grade(W, H)}<polyline points="${pl} ${W},${H} 0,${H}" class="g-area"/><polyline points="${pl}" class="g-linha"/><polyline points="${pn}" class="g-linha verde"/>`;

    // Tempo em cada estado.
    const ordem = ['saudavel', 'degradado', 'offline', 'recuperando', 'sincronizando'];
    const soma = ordem.reduce((a, k) => a + (e[k] ?? 0), 0) || 1;
    $('rl-estados').innerHTML = ordem.map((k) => `<span style="width:${((e[k] ?? 0) / soma) * 100}%;background:${CORES[k]}" title="${NOMES[k]}"></span>`).join('');
    $('rl-estados-leg').innerHTML = ordem.map((k) => `<li><i style="background:${CORES[k]}"></i>${NOMES[k]}<b>${duracao(e[k] ?? 0)}</b><span>${(((e[k] ?? 0) / soma) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></li>`).join('');

    const testesOk = mem.testes.filter((t) => t.ok).length;
    const offline = eps.reduce((a, x) => a + (x.vendas ?? 0), 0);
    $('rl-resumo').textContent =
      `A loja registrou ${fmt.format(s.local.vendas)} vendas e ${fmt.format(s.local.eventos)} eventos. ` +
      (eps.length === 0
        ? 'Nenhuma queda da nuvem foi medida neste período. '
        : `A nuvem caiu ${eps.length} ${eps.length === 1 ? 'vez' : 'vezes'}; a queda foi detectada em ${seg(media(eps.map((x) => x.deteccao)))} em média e o sistema voltou ao SAUDÁVEL em ${seg(media(eps.map((x) => x.recuperacao)))}. ${fmt.format(offline)} vendas foram feitas offline. `) +
      (s.visao?.semSinal
        ? 'Neste momento a loja está sem sinal; as vendas do período chegam na próxima sincronização. '
        : s.nuvem && s.nuvem.eventos === s.local.eventos ? 'Hoje a nuvem tem exatamente os mesmos eventos da loja: nenhuma perda. ' : `Há ${fmt.format(s.local.pendentes)} eventos na fila, guardados na loja. `) +
      (mem.testes.length ? `${testesOk} de ${mem.testes.length} testes de recuperação aprovados.` : '');
  }

  $('rl-imprimir').addEventListener('click', () => { auditar('Imprimiu o relatório'); window.print(); });
  $('rl-csv').addEventListener('click', () => {
    const linhas = [['hora', 'estado', 'vendas_loja', 'vendas_nuvem', 'fila', 'nuvem_fora']];
    for (const a of mem.amostras) linhas.push([new Date(a.t).toISOString(), a.e, a.vl, a.vn ?? '', a.p, a.q]);
    linhas.push([]);
    linhas.push(['inicio_queda', 'tipo', 'deteccao_ms', 'recuperacao_ms', 'vendas_offline', 'pico_fila']);
    for (const e of mem.episodios) linhas.push([new Date(e.inicio).toISOString(), e.tipo, e.deteccao ?? '', e.recuperacao ?? '', e.vendas ?? 0, e.pico ?? 0]);
    const csv = '﻿' + linhas.map((l) => l.join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `continuum-relatorio-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    auditar('Exportou o relatório em CSV');
  });

  // ================================================================ CONFIGURAÇÕES
  let editandoModoCfg = false;
  function mostrarConfig() {
    const s = ultimo;
    if (!editandoModoCfg) for (const r of document.querySelectorAll('input[name="cfg-modo"]')) r.checked = r.value === s.modo;
    for (const card of document.querySelectorAll('.modo-card')) card.classList.toggle('ativo', card.querySelector('input').value === s.modo);
    const p = s.proposta;
    $('cfg-proposta').textContent = p === null ? 'Nenhuma transição proposta.' : `Proposta: ${NOMES[p.de] ?? p.de} → ${NOMES[p.para] ?? p.para} (${p.motivo})`;
    $('cfg-confirmar').disabled = p === null;
    $('cfg-endereco').textContent = location.host || '—';
  }
  $('cfg-modos').addEventListener('change', async (e) => {
    if (e.target.name !== 'cfg-modo') return;
    editandoModoCfg = true;
    try {
      await api('/api/modo', { modo: e.target.value });
      auditar(`Modo alterado para ${e.target.value}`);
      toast(`Modo alterado: ${e.target.closest('label').querySelector('b').textContent}.`, 'bom');
    } catch (erro) { toast(erro.message, 'erro'); auditar(`Alterar modo: ${erro.message}`, 'falhou'); }
    editandoModoCfg = false;
  });
  $('cfg-confirmar').addEventListener('click', async () => {
    try { await api('/api/confirmar'); auditar('Confirmou transição (Configurações)'); } catch (erro) { toast(erro.message, 'erro'); }
  });

  // Preferências: valem para os campos do Simulador e para o tipo de queda do cabo.
  function aplicarPrefs() {
    $('cfg-queda').value = mem.prefs.queda;
    $('cfg-qtd').value = mem.prefs.qtd;
    $('cfg-ritmo').value = mem.prefs.ritmo;
    $('tipo-queda').value = mem.prefs.queda;
    $('quantidade').value = mem.prefs.qtd;
    $('ritmo').value = mem.prefs.ritmo;
    $('rt-tipo').value = mem.prefs.queda;
  }
  for (const [id, chave, num] of [['cfg-queda', 'queda', false], ['cfg-qtd', 'qtd', true], ['cfg-ritmo', 'ritmo', true]]) {
    $(id).addEventListener('change', () => {
      const v = num ? Number($(id).value) : $(id).value;
      if (num && (!Number.isFinite(v) || v < 1)) return;
      mem.prefs[chave] = v;
      aplicarPrefs(); salvar();
      $('cfg-nota').textContent = 'Preferência salva neste navegador.';
    });
  }
  $('cfg-limpar').addEventListener('click', async () => {
    const ok = await confirmar('Limpar histórico local', 'Apaga deste navegador as quedas medidas, a auditoria, as amostras do relatório e os testes. O LAB e os bancos não são afetados.', 'Limpar', true);
    if (!ok) return;
    const { perfil, prefs, backups } = mem;
    mem = { ...PADRAO(), perfil, prefs, backups };
    salvar();
    mostrarAuditoria();
    toast('Histórico local apagado.');
  });

  // ================================================================ PDV (executável à parte)
  // O PDV grava no mesmo banco da loja; aqui só se lê o resumo dele, de outra porta.
  let pdv = null; // { caixa, vendas, totalCentavos, ultima, fila, porta } (lido do PDV, na loja)
  let pdvPorta = null;
  let ultimaVendaPdv = null;
  // O Monitor fica na nuvem: com a loja sem sinal, ele não recebe as vendas do caixa.
  // pdvVisto congela na última posição sincronizada; na volta, avisa quantas chegaram.
  let pdvVisto = null;
  let vendasPdvAntesDaQueda = null;
  async function consultarPdv(porta) {
    const r = await fetch(`http://127.0.0.1:${porta}/api/status`, { cache: 'no-store', signal: AbortSignal.timeout(700) });
    if (!r.ok) throw new Error(String(r.status));
    const s = await r.json();
    if (typeof s.caixa !== 'string') throw new Error('não é o PDV');
    return { ...s, porta };
  }
  async function acompanharPdv() {
    const antes = pdv;
    pdv = null;
    for (const porta of pdvPorta !== null ? [pdvPorta] : [3100, 3101, 3102, 3103, 3104]) {
      try { pdv = await consultarPdv(porta); pdvPorta = porta; break; } catch { /* próxima */ }
    }
    if (pdv === null) pdvPorta = null;
    const semSinal = ultimo?.visao?.semSinal === true;
    if (!semSinal) {
      if (!antes && pdv) window.registrarAtividade?.(`PDV conectado: ${pdv.caixa}`, 'acao');
      if (antes && !pdv) window.registrarAtividade?.('PDV fechado', 'acao');
      // A loja reconectou: as vendas feitas sem conexão chegam juntas.
      if (pdv && vendasPdvAntesDaQueda !== null) {
        const chegaram = pdv.vendas - vendasPdvAntesDaQueda;
        if (chegaram > 0) window.registrarAtividade?.(`Chegaram ${fmt.format(chegaram)} vendas do ${pdv.caixa} feitas sem conexão`, 'sincronizando');
      }
      vendasPdvAntesDaQueda = null;
      pdvVisto = pdv;
    } else if (vendasPdvAntesDaQueda === null && pdvVisto) {
      vendasPdvAntesDaQueda = pdvVisto.vendas;
    }
    const numero = pdv?.ultima?.numero ?? null;
    if (pdv && numero !== null && numero !== ultimaVendaPdv) {
      // Venda a venda só com sinal; sem sinal, a nuvem não fica sabendo.
      if (ultimaVendaPdv !== null && !semSinal) {
        window.registrarAtividade?.(`Venda ${pdv.ultima.codigo} · ${real(pdv.ultima.totalCentavos)} no ${pdv.caixa}`, 'acao');
      }
      ultimaVendaPdv = numero;
    }
    const el = $('extras-pdv');
    if (el) el.textContent = pdvVisto ? `${pdvVisto.caixa}: ${fmt.format(pdvVisto.vendas)} vendas${semSinal ? ' (última sync)' : ''}` : '';
    mostrarMonitorPdv(semSinal);
  }

  const real = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const FORMAS_PDV = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix' };
  function mostrarMonitorPdv(semSinal = false) {
    const chipEl = $('mp-chip');
    if (!chipEl) return;
    const pdv = pdvVisto; // o que a nuvem conhece do caixa
    if (!pdv) {
      chipEl.textContent = 'PDV fechado';
      chipEl.className = 'chip';
      $('mp-lista').innerHTML = '<li class="vazio">Abra o pdv-continuum.exe para ver as vendas do caixa aqui.</li>';
      $('mp-rodape').textContent = '';
      return;
    }
    chipEl.textContent = semSinal ? `${pdv.caixa} · sem sinal` : `${pdv.caixa} conectado`;
    chipEl.className = semSinal ? 'chip ambar' : 'chip verde';
    const html = (pdv.ultimas ?? []).length === 0
      ? '<li class="vazio">Nenhuma venda no caixa ainda.</li>'
      : pdv.ultimas.map((v) => `<li data-codigo="${esc(v.codigo)}" title="Clique para validar">
          <code>${esc(v.codigo)}</code><time>${hora(Date.parse(v.ocorridoEm))}</time>
          <b>${real(v.totalCentavos)}</b><span class="mp-forma">${esc(FORMAS_PDV[v.pagamento?.forma] ?? '—')}</span>
          <span class="chip-estado" style="--c:${v.situacao === 'nuvem' ? '#34d399' : '#fbbf24'}">${v.situacao === 'nuvem' ? 'na nuvem' : 'na fila'}</span></li>`).join('');
    const lista = $('mp-lista');
    if (lista.dataset.html !== html) { lista.innerHTML = html; lista.dataset.html = html; }
    $('mp-rodape').textContent = semSinal
      ? `Loja sem sinal · última posição recebida: ${fmt.format(pdv.vendas)} vendas · as vendas do caixa chegam na próxima sincronização`
      : `${fmt.format(pdv.vendas)} vendas · ${real(pdv.totalCentavos)} no caixa · fila da loja: ${fmt.format(pdv.fila)}`;
  }

  async function validarCodigo(codigo) {
    const caixaRes = $('mp-resultado');
    caixaRes.hidden = false;
    if (!pdv) {
      caixaRes.className = 'mp-resultado invalida';
      caixaRes.innerHTML = '<b>PDV fechado.</b> A validação consulta o banco da loja pelo PDV: abra o pdv-continuum.exe.';
      return;
    }
    caixaRes.className = 'mp-resultado';
    caixaRes.textContent = 'Consultando…';
    try {
      const r = await fetch(`http://127.0.0.1:${pdv.porta}/api/pdv/consulta/${encodeURIComponent(codigo.trim())}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      const v = await r.json();
      const semSinal = ultimo?.visao?.semSinal === true;
      // Sem sinal, a nuvem só conhece as vendas que já chegaram até ela.
      if (semSinal && (v.valida ? v.situacao !== 'nuvem' : /Não existe/.test(v.motivo))) {
        caixaRes.className = 'mp-resultado';
        caixaRes.innerHTML = `<b>⏳ Pendente de sincronização</b><span>A loja está sem sinal e esta venda ainda não chegou à nuvem. Ela será validada quando a loja sincronizar.</span>`;
        return;
      }
      if (!v.valida) {
        caixaRes.className = 'mp-resultado invalida';
        caixaRes.innerHTML = `<b>✕ Venda não validada</b><span>${esc(v.motivo)}</span>`;
        auditar(`Validou código ${v.codigo}: inválido`, 'negado');
        return;
      }
      const itens = v.itens.map((i) => `${i.quantidade}× ${esc(i.nome)}`).join(', ');
      const pag = v.pagamento ? ` · ${esc(FORMAS_PDV[v.pagamento.forma] ?? v.pagamento.forma)}${v.pagamento.trocoCentavos ? `, troco ${real(v.pagamento.trocoCentavos)}` : ''}` : '';
      caixaRes.className = 'mp-resultado valida';
      caixaRes.innerHTML = `<b>✓ Venda válida · ${esc(v.codigo)}</b>
        <span class="mp-valor">${real(v.totalCentavos)}</span>
        <span>Venda nº ${fmt.format(v.numero)} · ${new Date(v.ocorridoEm).toLocaleString('pt-BR')}${pag}</span>
        <span>${itens}</span>
        <span>${esc(v.origem)} · ${v.situacao === 'nuvem' ? `na nuvem desde ${hora(Date.parse(v.sincronizadoEm))}` : 'gravada na loja, aguardando a nuvem'}</span>`;
      auditar(`Validou a venda ${v.codigo}`);
    } catch {
      caixaRes.className = 'mp-resultado invalida';
      caixaRes.innerHTML = '<b>Sem resposta do PDV.</b> Tente de novo.';
    }
  }
  $('mp-form').addEventListener('submit', (e) => { e.preventDefault(); if ($('mp-codigo').value.trim()) void validarCodigo($('mp-codigo').value); });
  $('mp-lista').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-codigo]');
    if (!li) return;
    $('mp-codigo').value = li.dataset.codigo;
    void validarCodigo(li.dataset.codigo);
  });
  setInterval(() => void acompanharPdv(), 1500);
  void acompanharPdv();

  // ---------------------------------------------------------------- início
  aplicarPrefs();
  mostrarAuditoria();
  mostrarPontos();
  aplicarPerfil();
  telaAtual = location.hash.slice(1) || 'dashboard';
})();
