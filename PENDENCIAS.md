# Pendências · onde paramos

> Atualizado em 21/11/2026. **Comece por aqui** para continuar o desenvolvimento.
> Sócios: Eluan Jesus (lead) e Enzo Gomes (idealizador).

## 1. Onde estamos

| Etapa | Documento | Situação |
|---|---|---|
| Landing page do negócio | `site/index.html` | ✅ Pronta (falta o contato real, ver seção 4) |
| Projeto anterior arquivado | `OLD/` | ✅ Movido e funcionando (20 testes do PDV passando) |
| Etapa 2 · Arquitetura | `docs/01-arquitetura.md` | ✅ Aprovada (v2) |
| Etapa 3 · Escalabilidade e front-end | `docs/02-escalabilidade-e-frontend.md` | ✅ Aprovada |
| Etapa 4 · Casos de uso e UML | `docs/03-casos-de-uso-e-uml.md` | ✅ Aprovada |
| Etapa 4 · Banco de dados | `docs/04-banco-de-dados.md` | ✅ Aprovada |
| Etapa 5 · Plano do MVP (21 passos) | `docs/05-plano-do-mvp.md` | ✅ Aprovado; em execução |
| **Passo 0.1** · Esqueleto do monorepo | `pacotes/*` | ✅ Concluído |
| **Passo 0.2** · Identidade visual e vitrine | `pacotes/interface` | 🟡 **Feito, aguardando aprovação do visual** |
| **Passo 0.3** · Regras básicas | `pacotes/dominio` | 🟡 **Feito, aguardando validação** (dinheiro, CPF/CNPJ/EAN, código da venda; 28 testes novos) |
| **Passo 0.4** · Contratos dos eventos | `pacotes/contratos` | 🟡 **Feito, aguardando validação** (8 tipos de evento + sinal de vida; 37 testes novos) |
| **Passo 1.1** · Regras de venda e estoque | `pacotes/dominio` | 🟡 **Feito, aguardando validação** (venda, desconto, pagamento, estoque, estorno; 32 testes novos) |
| **Passo 1.2** · Fila (outbox) e migrações | `pacotes/sync` | 🟡 **Feito, aguardando validação** (SQLite do Node, migrações numeradas, fila; 14 testes novos) |
| **Passo 1.3** · Banco e serviços do caixa | `pacotes/pdv` | 🟡 **Feito, aguardando validação** (`caixa.db` e um dia de caixa completo; 14 testes novos) |
| **Passo 1.4** · Telas do PDV | `pacotes/pdv/web` | 🟡 **Feito, aguardando validação** (abrir caixa, venda, venda finalizada, fechamento; `.\dev pdv`) |
| **Passo 1.5** · PDV instalado e comprovante | `pacotes/pdv/electron` | 🟡 **Feito, aguardando validação** (`pdv-continuum.exe` portátil; comprovante 58/80 mm e reimpressão) |
| **Passo 2.1** · Servidor e banco da nuvem | `pacotes/nuvem` | 🟡 **Feito, aguardando validação** (PostgreSQL 18 via npm; isolamento por cliente provado em teste) |
| **Passo 2.2** · Login e perfis | `pacotes/nuvem` | 🟡 **Feito, aguardando validação** (login do Central e do ERP; menu e API conforme o perfil) |
| **Passo 2.3** · Central: clientes | `pacotes/nuvem` | 🟡 **Feito, aguardando validação** (cadastrar cliente CNPJ/CPF, parametrizar, suspender) |
| **Passo 2.4** · ERP: loja e produtos | `pacotes/nuvem` | 🟡 **Feito, aguardando validação** (produtos, preço com versão, entrada, ajuste, kardex, loja e comprovante) |
| **Passo 2.5** · ERP: caixa e relatórios | `pacotes/nuvem` | 🟡 **Feito, aguardando validação** (código de ativação, desativar caixa, relatório do dia, validar comprovante) |
| **Passo 3.1** · Ativação do PDV | `pacotes/nuvem`, `pacotes/pdv` | 🟡 **Feito, aguardando validação** (código do ERP → credencial, loja, parâmetros, catálogo e saldo no caixa) |
| **Passo 3.2** · Subida (vendas → nuvem) | `pacotes/nuvem`, `pacotes/pdv` | 🟡 **Parcial, aguardando validação** (formato MEI: o caixa ativado envia direto à nuvem; falta agente → nuvem) |
| **Passo 3.3** · Descida (preços → caixa) | `pacotes/nuvem`, `pacotes/pdv` | 🟡 **Parcial, aguardando validação** (formato MEI: preço, produto novo e parâmetros chegam ao caixa em segundos) |
| **Passo 3.4** · Monitor ao vivo | `pacotes/nuvem` | 🟡 **Feito, aguardando validação** (Central vê cada caixa ao vivo; SEM SINAL depois de 45 s) |
| **Passo 3.5** · Executáveis para o teste de conexão | `pacotes/*/dist/executavel` | 🟡 **Feito, aguardando validação** (`nuvem-continuum.exe`, `pdv-continuum.exe`, `agente-continuum.exe`) |
| **Passo 4.2 (parte)** · Instaladores | `instaladores/` | 🟡 **Feito, aguardando validação** (Setup.exe da Nuvem, PDV e Agente; guia em `INSTALACAO.md`) |
| **Melhorias (23/11)** · PDV, ERP e Central | `pacotes/pdv`, `pacotes/nuvem` | 🟡 **Feito, aguardando validação** (busca e atalhos no PDV; painel, relatórios, usuários, PIN, compras, importação e fechamentos no ERP; monitor rico, ficha, cobrança e auditoria no Central) |
| **Adiantado do 3.2** · Sync Engine e agente da loja | `pacotes/sync`, `pacotes/agente` | 🟡 **Feito, aguardando validação** (caixa → agente pela rede, sem duplicar e sem perder; `agente-continuum.exe`) |

## 2. Próximo passo

1. **Aprovar (ou ajustar) o visual do Passo 0.2:** rodar `.\dev vitrine` e conferir os temas escuro e
   claro, a faixa de estado, os cartões, os chips, os botões, a paleta e a tipografia.
2. **Validar o Passo 0.3** (pacote `dominio`), feito em 21/11/2026:
   - `src/dinheiro.ts`: centavos inteiros, soma, preço × quantidade (meio centavo sobe),
     `formatarReais` (R$ 1.234,56) e `lerReais` (lê o valor digitado sem número quebrado);
   - `src/documentos.ts`: CPF, CNPJ e EAN-13 trazidos de `OLD/app/comum/documentos.js`, agora tipados;
   - `src/codigo-venda.ts`: `MERCBAIRRO-10123-ABCD` (caixa 1 a 9 no primeiro dígito, número com pelo
     menos 4 dígitos que cresce além de 9999, conferência = 4 últimos caracteres do UUID v7).
   - Conferir: `.\dev testar` (34 passando) e ler os testes em `pacotes/dominio/testes/`.
3. **Validar o Passo 0.4** (pacote `contratos`), feito em 21/11/2026:
   - `src/evento.ts`: a casca de todo evento (`id`, `seq`, `tipo`, `versao`, `ocorridoEm`, `dados`) e o
     cardápio dos 8 tipos, todos na versão 1: `produto.criado`, `produto.alterado`,
     `estoque.movimentacao-registrada`, `venda.registrada`, `venda.cancelada`, `caixa.aberto`,
     `caixa.movimentado`, `caixa.fechado`. `lerEvento` lança erro; `conferirEvento` devolve o problema (para a tela);
   - `src/eventos/*.ts`: os dados de cada tipo. A venda confere as contas (bruto = soma dos itens,
     líquido = bruto − desconto, pagamentos − troco = líquido, troco só em dinheiro) e o código com o id;
   - `src/sinal-de-vida.ts`: o heartbeat (estado, fila, caixa aberto, última venda, versão), fora da fila;
   - `src/leitura.ts`: os leitores pequenos, reconstruídos de `OLD/app/dist/cloud-api/leitura.js`.
   - Decisões para revisar: campo desconhecido é recusado (a versão nova do formato é o caminho para
     mudar); o tipo `DEVOLUCAO` do OLD saiu (devolução vira `ESTORNO`); quantidade vendida é inteira.
   - Conferir: `.\dev testar` (71 passando) e ler `pacotes/contratos/testes/`.
4. **Validar o Passo 1.1** (pacote `dominio`), feito em 21/11/2026:
   - `src/venda.ts`: `montarVenda` (preço do cadastro, estoque somado por produto, desconto com limite do
     cliente e supervisor acima dele, pagamento misto, troco só em dinheiro, CPF/CNPJ) e `cancelarVenda`
     (não altera a venda: gera o cancelamento e os ESTORNOS; só uma vez; só da sessão aberta);
   - `src/estoque.ts`: saldo como soma, entrada, ajuste (nunca deixa negativo) e a regra do cliente
     `bloquear` ou `permitir_alerta`; `src/id.ts`: UUID v7 feito à mão; `src/erros.ts`: as recusas com nome.
5. **Validar o Passo 1.2** (pacote `sync`): `src/banco.ts` (SQLite que vem no Node 26, transação com
   savepoint), `src/migracoes.ts` (numeradas, uma vez só, recusa migração antiga editada) e `src/fila.ts`
   (só entra evento que passa no contrato; seq nunca se repete; marca "sincronizado" uma vez; falha
   bloqueia a fila; limpeza dos confirmados após 90 dias). Teste "venda e evento juntos, ou nenhum".
6. **Validar o Passo 1.3** (pacote `pdv`): `src/banco/migracoes.ts` (as tabelas do documento 04 com
   gatilhos que impedem editar e apagar) e `src/caixa.ts` (ativar, parâmetros, receber produto, entrada,
   abrir caixa, vender, cancelar, sangria e suprimento, fechar com relatório). Roteiro em
   `pacotes/pdv/testes/dia-de-caixa.test.ts`.
   - Decisões para revisar: a sangria não pode passar do dinheiro na gaveta; o fechamento conta o troco
     como saída do dinheiro e exclui as vendas canceladas; venda recusada não gasta número.
   - Ainda não feito (fica para depois): identidade e parâmetros chegando pela ativação (Passo 3.1).
   - Conferir: `.\dev testar` (131 passando).
7. **Validar o Passo 1.4** (telas do PDV): rodar `.\dev pdv` e abrir http://localhost:5174.
   - O caixa novo se ativa sozinho como "MERCBAIRRO · Caixa 1" com 12 produtos de demonstração (60 de
     estoque cada), até existir a ativação pelo ERP (Passo 3.1). O banco fica em `dados/pdv/caixa.db`
     (fora do git); para começar do zero, feche o servidor e apague a pasta `dados/pdv`.
   - Telas (`pacotes/pdv/web/`): abrir caixa; venda (busca por nome ou código de barras, quantidade,
     desconto, CPF, pagamento misto, troco, últimas vendas com cancelamento); "Venda finalizada";
     fechamento (resumo, sangria e suprimento, contagem da gaveta).
   - Por baixo: `pacotes/pdv/src/servidor/` (API JSON do caixa, usada pelas telas). Diferença em relação
     ao documento 02: no navegador as telas falam com essa API local em vez da "ponte do Electron"; no
     Passo 1.5 o Electron hospeda a mesma API.
   - Atalhos de teclado: só o Enter, por enquanto.
8. **Validar o Passo 1.5** (PDV instalado): gerar com `npm run pdv:exe` (ou `.\dev pdv:exe`) e abrir
   `pacotes/pdv/dist/executavel/pdv-continuum.exe` (portátil, não precisa instalar; ~110 MB).
   - O programa liga o servidor do caixa só neste computador (127.0.0.1) e abre as telas numa janela
     própria. O banco fica em `%APPDATA%\Continuum PDV\caixa.db`; para começar do zero, feche o programa
     e apague esse arquivo. `npm run pdv:app` abre o programa sem gerar o .exe (mais rápido para testar).
   - Comprovante (`pacotes/pdv/src/comprovante.ts`): loja, itens, desconto, pagamentos, troco, CPF
     mascarado, data, caixa, operador e o código; "REIMPRESSÃO" e "VENDA CANCELADA" quando for o caso;
     bobina de 58 ou 80 mm conforme os parâmetros do cliente. Botão "Imprimir comprovante" na venda
     finalizada e botão de reimprimir nas últimas vendas. Sem impressora, aparece na tela.
   - Testado aqui: o .exe abre, vende e gera o comprovante. **Falta testar numa impressora térmica.**
   - Ainda não feito: ícone do Continuum no .exe e assinatura digital (ponto 6 da seção 4); modo
     quiosque (tela cheia travada); impressão direta sem a janela do Windows (ESC/POS).

### Feito na noite de 21 para 22/11 (trabalho automático, aguardando validação)

9. **Sync Engine** (`pacotes/sync/src/estados.ts`, `transporte.ts`, `motor.ts`, `recebimento.ts`),
   reconstruído do OLD: envia a fila em lotes, só marca o que o destino confirmou, tenta de novo com
   espera crescente, divide o lote para achar um evento torto (que bloqueia a fila), reenvia quando o
   destino perdeu dados, e a máquina de estados SAUDÁVEL → DEGRADADO → OFFLINE → RECUPERANDO →
   SINCRONIZANDO. O lado de quem recebe tem as mesmas regras do recebimento da nuvem do OLD.
10. **Agente da loja** (`pacotes/agente`): recebe a fila de cada caixa no `loja.db`, guarda o último
    sinal de vida e mostra um painel ao vivo com cada caixa (estado, fila, vendas, último sinal).
    `.\dev agente` (porta 5180, aberto na rede da loja) ou `npm run agente:exe` para o
    `agente-continuum.exe`. **Ainda não repassa para a nuvem** (falta o 2.1) e **não aplica o estoque da
    loja** (os produtos ainda não descem do ERP; cada caixa tem os seus de demonstração).
11. **PDV ligado ao agente**: o caixa envia a fila e o sinal de vida (a cada 15 s) para o agente; o topo
    da tela mostra a conexão e, se algo não vai bem, a faixa de estado (DEGRADADO, OFFLINE...). Sem
    agente, o caixa vende do mesmo jeito. Endereço do agente: `http://127.0.0.1:5180` por padrão; no
    PDV instalado, um arquivo `agente.txt` na pasta de dados (`%APPDATA%\Continuum PDV`) com outro
    endereço (ex.: `http://192.168.0.10:5180`) aponta para o agente de outro computador.
12. **Teste de conexão entre os executáveis, feito aqui:** `agente-continuum.exe` e `pdv-continuum.exe`
    abertos juntos; venda no PDV, fila zerada, conexão SAUDÁVEL e a venda no painel do agente.

13. **PIN do supervisor** (`pacotes/pdv/src/pin.ts`): desconto acima do limite e cancelamento pedem o
    PIN, conferido pelo caixa (a tela não consegue se autorizar sozinha). Guardado só como hash
    (scrypt), desce do ERP nos parâmetros (`pinSupervisorHash`); **enquanto o ERP não define, vale o PIN
    padrão 1234**, como no OLD.
14. **Clique duplo na venda**: cada tentativa de venda leva uma chave; a mesma chave de novo devolve a
    mesma venda, sem gravar outra nem baixar o estoque duas vezes (migração 4, `chaves_venda`).

15. **Teste de queda** (Kryptonita do OLD, `pacotes/sync/src/kryptonita.ts`; roteiro em
    `pacotes/agente/src/teste-de-queda.ts`): `npm run teste-de-queda` põe 3 caixas vendendo enquanto a
    rede derruba conexões, perde respostas e fica fora do ar, e confere caixa a caixa. Resultado desta
    noite: 180 vendas, 43 falhas provocadas, fila zerada 0,3 s depois da volta, **APROVADO: nada se
    perdeu, nada duplicou**. Uma versão menor roda junto com os testes automáticos.

16. **Segurança da nuvem, só as regras** (`pacotes/nuvem/src/seguranca.ts`, adiantando 2.2 e 2.5):
    senha só como hash (scrypt) e com regra mínima; sessão de login assinada (válida por 12 h); o que
    cada perfil pode fazer (Equipe Continuum, dono, gerente, supervisor, operador); código de ativação
    do caixa (`4F7K-92QX`, sem letras que confundem, vale 24 h, guardado só como hash) e a credencial do
    dispositivo (desativar o caixa corta o acesso na hora). **Falta ligar ao banco**, quando o 2.1 sair.

### Passo 2.1 · Servidor e banco da nuvem (22/11)

- PostgreSQL sem o `OLD/runtime` (não encontrado): pacote `@embedded-postgres/windows-x64` 18.6 (os
  programas do PostgreSQL 18, baixados pelo npm, só para desenvolvimento) + driver `pg` 8.23.1.
- `pacotes/nuvem/src/`: `postgres-local.ts` (liga o PostgreSQL de desenvolvimento), `banco.ts` (cada
  pedido diz ao banco "sou do cliente X"; papéis `continuum_app`, só o próprio cliente, e
  `continuum_central`, lê todos e não grava), `migracoes.ts` (as tabelas do documento 04 e o
  isolamento por Row Level Security), `servidor.ts` e `iniciar.ts` (`npm run nuvem`: banco na porta
  5433 com dados em `dados/nuvem`, servidor na 5190).
- Diferença do diagrama: **toda** tabela de cliente tem `cliente_id` (inclusive itens e pagamentos),
  para a regra do banco valer igual em todas.
- Provado em teste (`pacotes/nuvem/testes/isolamento.test.ts`, PostgreSQL de verdade): o cliente A
  não enxerga, não altera e não grava em nome do B; sem cliente informado não se vê nada; o Central
  lê tudo e não grava; venda não é editada nem apagada.

### Passos 2.2 e 2.3 · Login, perfis e Central (22/11)

- Rodar: `npm run erp` (ou `.\dev erp`) e abrir http://localhost:5175. Liga junto o PostgreSQL local e a
  API. Só a API, sem telas: `npm run nuvem` (porta 5190).
- **Acessos de demonstração** (criados no banco local na primeira vez, senhas só como hash):
  Central `equipe@continuum.app` / `continuum2026`; ERP `mercbairro.continuum.app`: dona
  `dono@mercbairro.com.br` / `mercado2026` e operador `caixa@mercbairro.com.br` / `caixa2026`.
- Login (`pacotes/nuvem/src/api.ts`): o ERP descobre o cliente pelo domínio acessado (em
  desenvolvimento, o domínio vai no formulário); sessão assinada num cookie protegido; o menu do ERP
  e a API mostram e aceitam só o que o perfil pode (o operador vê só "vender no caixa").
- Central (`pacotes/nuvem/src/central.ts` e `web/telas/Central.tsx`): cadastrar cliente (CNPJ ou CPF
  conferidos, segmento, domínio, primeira loja com nome reduzido, dono com senha inicial e os
  parâmetros), parametrizar (regra de estoque, limite de desconto, bobina) com versão nova e aviso na
  fila de descida para os caixas, suspender ou reativar. Tudo na auditoria.
- Decisão para revisar: o documento 04 diz que o Central **só lê**; o cadastro e a parametrização
  usam um acesso próprio da plataforma (`transacaoDaPlataforma`), sempre com auditoria.
- Os itens do menu do ERP (produtos, estoque, caixas, relatórios) ainda mostram "Chega no Passo 2.4/2.5".

### Passo 2.4 · ERP: loja e produtos (22/11)

- `pacotes/nuvem/src/erp.ts` e as telas `web/telas/ErpProdutos.tsx` e `ErpLoja.tsx` (entre como a dona).
- Produtos: cadastrar (código de barras EAN-13 conferido), alterar preço com **controle de versão**
  (quem editou uma versão antiga é avisado em vez de apagar a mudança do outro). Cada mudança entra na
  fila de descida para os caixas (Passo 3.3).
- Estoque: entrada (sempre positiva) e ajuste (com motivo; nunca deixa a loja negativa); o **kardex**
  mostra cada movimento com o saldo linha a linha (a venda aparece com o código do comprovante quando as
  vendas subirem, Passo 3.2).
- Loja e comprovante: nome, endereço e telefone da loja; cabeçalho e rodapé do comprovante (nova versão
  de parâmetros, avisada aos caixas). A largura da bobina continua com o Central.
- O supervisor vê os produtos e o estoque sem os formulários; o operador não vê.

### Passo 2.5 · ERP: caixa e relatórios (22/11)

- `pacotes/nuvem/src/erp-caixas.ts` e as telas `ErpCaixas.tsx`, `ErpRelatorio.tsx`, `ErpValidar.tsx`.
- Caixas: "Novo caixa" pega o próximo número livre da loja (1 a 9) e mostra o **código de ativação**
  (`4F7K-92QX`, vale 24 h, aparece uma vez só; no banco fica só o hash). Código novo para caixa ainda
  não ativado; **desativar** corta o acesso na hora (perda, roubo, troca). Também "Novo agente".
- Relatório do dia (horário de Brasília): total, descontos, canceladas, por forma de pagamento, troco,
  mais vendidos e por caixa. Fica zerado até as vendas subirem (Passo 3.2).
- Validar venda: procura pela loja, caixa e número e confere os 4 caracteres; diferencia "adulterado"
  de "ainda não sincronizado" (venda feita sem internet).
- Correções no caminho: o `pg_ctl start` travava o Node no Windows (resolvido); o servidor das telas
  reaproveita o PostgreSQL se ele ficou ligado; uma só nuvem por processo (o Vite reinicia sozinho).
  Para o servidor pegar mudanças no código da API, feche e abra o `npm run erp` de novo.

### Passo 3.1 · Ativação do PDV (22/11)

- Nuvem: `POST /v1/dispositivos/ativar` (`pacotes/nuvem/src/dispositivos.ts`) troca o código pela
  credencial (só o hash fica na nuvem) e devolve loja, número do caixa, parâmetros, catálogo e o saldo
  de cada produto na loja. O código deixa de valer; o caixa aparece "ativo" no ERP.
- PDV: **o caixa novo não se ativa mais sozinho**. Na primeira vez aparece "Ativar este caixa": endereço
  do ERP + código (gerado em ERP → Caixas → Novo caixa), ou "modo demonstração" (a loja de exemplo de
  antes, sem ERP). O envio ao agente só liga depois da ativação.
- O saldo da loja entra no caixa como "saldo da loja na ativação" **sem evento na fila** (ele já está na
  nuvem; subir de novo contaria em dobro).
- Testado de ponta a ponta (`pacotes/nuvem/testes/ativacao-do-pdv.test.ts`) e no navegador: produto
  cadastrado no ERP, caixa criado, PDV novo ativado pelo código e vendendo o café com o estoque da loja.
- Para testar: `npm run erp` (entre como a dona, Caixas → Novo caixa, anote o código) e, num PDV novo
  (`pdv-continuum.exe` com a pasta `%APPDATA%\Continuum PDV` vazia, ou `npm run pdv` com
  `dados/pdv` apagada), informe `http://localhost:5175` e o código.
- **Falta (próximos passos):** 3.2 subir as vendas para a nuvem (agente → nuvem, com a credencial),
  3.3 descer preços e parâmetros (a fila de descida já está sendo preenchida), 3.4 monitor ao vivo no
  Central, 3.5 executável da nuvem. O agente ainda é ativado só por endereço, sem código.

### Passo 3.2 · Subida das vendas para a nuvem, formato MEI (22/11)

- Nuvem (`pacotes/nuvem/src/recebimento.ts`): `POST /v1/origens/{caixa}/eventos` e
  `POST /v1/sinais-de-vida`, com a credencial da ativação. Mesmas regras de ordem e duplicidade do
  agente; cada fato vai para as tabelas do cliente (sessão, venda, itens, pagamentos, estoque,
  cancelamento, sangria). Caixa desativado é recusado e a fila dele para (sem perder nada).
- PDV (`destinoDaFila` em `pacotes/pdv/src/sincronizacao.ts`): com agente informado (agente.txt ou
  `CONTINUUM_AGENTE_URL`), a fila vai para o agente; **sem agente, um caixa ativado pelo ERP envia direto
  para a nuvem** (formato MEI: o PDV faz o papel do agente); modo demonstração vai para o agente local.
- Provado (`pacotes/nuvem/testes/subida.test.ts`): a venda feita no PDV aparece no relatório do ERP, no
  kardex (com o código do comprovante) e na validação; o cancelamento sobe e devolve o estoque; o sinal
  de vida mostra o caixa aberto; nada duplica.
- **Falta:** o agente repassar à nuvem a fila dos caixas de uma loja com vários caixas (ponto 9 da seção
  4: a nuvem precisa saber de qual caixa veio cada evento), e o agente ser ativado por código.

### Passo 3.3 · Descida de preços e parâmetros, formato MEI (22/11)

- Nuvem: `GET /v1/alteracoes?desde=N` (com a credencial) devolve, em ordem, o que mudou no cliente
  depois do nº N (produtos, preços, parâmetros) e guarda até onde cada caixa recebeu.
- PDV (`pacotes/pdv/src/descida.ts`): a cada 5 segundos pergunta "o que mudou?" e aplica (produto pela
  versão mais nova; parâmetros pela versão), avançando o próprio marcador numa transação só. Sem
  internet, segue com o que tem; na volta recebe tudo em ordem.
- Provado (`pacotes/nuvem/testes/descida.test.ts`): preço alterado no ERP, produto novo e parâmetros
  do Central (regra de estoque, desconto, bobina) chegam ao caixa; nada é aplicado duas vezes.
- **Corrigido em 22/11 (noite):** a entrada e o ajuste de estoque feitos no ERP não desciam para o
  caixa (só o saldo da ativação chegava). Agora descem também (migração 5 da nuvem, `estoque_desce`),
  com o mesmo id da nuvem e sem evento na fila, então não contam em dobro nem sobem de volta. Lançamentos
  feitos antes da correção não descem: para esses, ative o caixa de novo (o saldo vem na ativação).
- **Falta:** a descida passar pelo agente (loja com vários caixas) e o PIN do supervisor descer do ERP
  (hoje vale o padrão 1234).

### Passo 3.4 · Monitor ao vivo no Central (22/11)

- `GET /v1/central/monitor` (só a Equipe) e a aba **Monitor ao vivo** do Central (`web/telas/Monitor.tsx`),
  atualizando a cada 3 segundos: resumo (caixas ativos, saudáveis, pedem atenção, vendido hoje, eventos
  nas filas) e um cartão por caixa (cliente, loja, estado, último sinal, caixa aberto, fila, vendas do
  dia, versão). **SEM SINAL** quando o caixa fica 45 s sem mandar notícia.
- Conferido no navegador com a cadeia inteira: ERP (produto + caixa) → código → PDV ativado → venda →
  nuvem → monitor mostrando o caixa SAUDÁVEL com a venda do dia.
- Diferença do documento 02: o monitor atualiza por consulta a cada 3 s, não por WebSocket (mais simples;
  troca por WebSocket quando o número de caixas pedir).

### Passo 3.5 · Os três executáveis (22/11)

- Gerar: `npm run nuvem:exe`, `npm run pdv:exe`, `npm run agente:exe`. Ficam em
  `pacotes/nuvem|pdv|agente/dist/executavel/` (portáteis: não precisam instalar).
- **`nuvem-continuum.exe`** (~134 MB, com o PostgreSQL embutido): o ERP e o Central neste computador,
  em http://localhost:5175 (ouve também na rede local). Dados em `%APPDATA%\Continuum Nuvem`.
  Acessos de demonstração: os mesmos do `npm run erp` (seção dos Passos 2.2 e 2.3). Não abra junto com
  o `npm run erp` (mesma porta).
- **Teste de conexão feito aqui, só com os executáveis:** na nuvem, a dona cadastra um produto com
  estoque e cria o Caixa 1; o PDV novo é ativado com o código, recebe o produto, vende; a fila zera
  (SAUDÁVEL); a venda aparece no relatório do ERP e o caixa no monitor do Central.
- Roteiro para você: (1) abra o `nuvem-continuum.exe` e entre como a dona; Caixas → Novo caixa;
  anote o código. (2) abra o `pdv-continuum.exe` (com `%APPDATA%\Continuum PDV` vazia), informe
  `http://localhost:5175` e o código. (3) cadastre produtos e dê entrada no ERP: em até 5 s chegam ao
  PDV. (4) venda no PDV e veja no relatório do ERP. (5) entre como Equipe e veja o Monitor ao vivo.
  (6) feche a nuvem: o PDV mostra OFFLINE e continua vendendo; abra de novo e tudo sobe.
- O `agente-continuum.exe` funciona com o PDV (formato loja), mas **ainda não repassa à nuvem**.

### Teste de queda até a nuvem (22/11)

- `pacotes/nuvem/testes/queda-ate-a-nuvem.test.ts`: dois caixas ativados vendem (com cancelamentos)
  enquanto o Kryptonita derruba metade dos pedidos e depois deixa a nuvem totalmente fora do ar. Na
  volta: cada evento de cada caixa está no PostgreSQL uma vez só e em ordem, todas as vendas estão no
  ERP e o estoque da nuvem bate com o dos caixas. **Aprovado.**
- O teste achou um defeito no próprio Kryptonita (não repassava a credencial do caixa); corrigido.

### Instaladores (22/11, fim do dia)

- `npm run instaladores` gera `Continuum-Nuvem-Setup.exe`, `Continuum-PDV-Setup.exe` e
  `Continuum-Agente-Setup.exe` na pasta `instaladores/` (fora do git). Guia para leigos: `INSTALACAO.md`.
- Instalação por usuário, sem senha de administrador, com atalhos na área de trabalho e no menu Iniciar
  e desinstalador. Ícone do Continuum (ampliado do logo de 64 px: um logo em alta resolução deixa mais
  nítido). O agente instalado liga junto com o Windows.
- Testado aqui: os três instalaram em silêncio; a nuvem instalada gerou o código, o PDV instalado ativou,
  vendeu, a fila zerou e a venda apareceu no relatório; o agente respondeu; desinstalar e reinstalar ok.
  **Os três ficaram instalados neste computador** (atalhos na área de trabalho), com os dados ainda vazios.
- Falta: assinatura digital (o Windows mostra o aviso do SmartScreen) e a hospedagem da nuvem.

### Melhorias nas três frentes (23/11, pedido do lead: "faça tudo")

**PDV**
- **Busca rápida:**
  - por parte do nome, sem acento, ou pelo código de barras;
  - Enter lança o produto; "3*cafe" lança 3 de uma vez.
- **Atalhos de teclado:**
  - F2 quantidade, F4 pagamento, F6 venda em espera;
  - Esc tira o item selecionado; Delete tira o último item;
  - a legenda das teclas fica na tela.
- **Balança:**
  - lê a etiqueta de peso (`2 CCCC 0 PPPPPP D`) em `pacotes/pdv/src/balanca.ts`;
  - por enquanto só aceita quilos inteiros (ver "Falta" abaixo).
- **Pagamento:** notas rápidas (R$ 10, 20, 50, 100 e valor exato) e troco em destaque.
- **CPF do cliente:**
  - campo opcional, validado na hora;
  - sai no comprovante e sobe à nuvem no campo `documentoCliente`, que já existia.
- **Estoque na tela:** o saldo aparece em cada produto; baixo (até 5) em âmbar, zerado em vermelho.
- **Venda em espera:**
  - pausar uma venda e atender outro cliente;
  - fica numa tabela local (migração 5 do caixa) e não gera evento.
- **Visual:**
  - botões maiores para toque e total grande;
  - animação curta e bip (Web Audio, com botão para desligar);
  - faixa de conexão discreta quando está tudo bem.
- **PIN do supervisor:** o caixa aplica o PIN que vem do ERP, tanto na ativação quanto na descida.

**ERP**
- **Menu lateral:** vira uma faixa no celular.
- **Painel do dono (tela inicial):**
  - vendas de hoje comparadas com ontem e com o mesmo dia da semana passada;
  - ticket médio;
  - gráfico de 30 dias, movimento por hora e formas de pagamento;
  - mais vendidos, estoque baixo e caixas.
- **Vendas, relatório de qualquer período:**
  - atalhos de período: hoje, ontem, 7 dias, 30 dias e mês;
  - filtro por loja;
  - totais por dia, forma de pagamento, produto, caixa, hora e operador;
  - exporta Excel (CSV) e imprime ou salva em PDF.
- **Alertas e compras (UC20):**
  - estoque negativo para conferir;
  - produtos abaixo do mínimo;
  - lista de compras (repor até 2× o mínimo), exportável.
- **Fechamentos de caixa:** cada turno com fundo, vendas, sangrias e suprimentos, esperado × contado e sobra ou falta.
- **Usuários (UC16):**
  - criar usuários, trocar perfil, desativar e trocar senha;
  - ninguém se desativa, e o negócio nunca fica sem um dono ativo.
- **PIN do supervisor:**
  - definido em "Loja, comprovante e PIN";
  - desce aos caixas só como hash; recusa PIN fácil (1111, 1234…).
- **Importar produtos de planilha:**
  - aceita CSV do Excel ou células coladas, com modelo para baixar e prévia;
  - tudo ou nada: com qualquer linha errada, nada entra e a tela marca cada linha;
  - estoque inicial opcional.
- **Tabelas:** busca, ordenação por coluna e exportação.

**Central**
- **Monitor:**
  - faixa de estado com o veredito ("Tudo funcionando" ou "N caixa(s) fora do ar") e contadores;
  - caixas agrupados por cliente, com filtro "só com problema" e busca;
  - alertas: sem sinal, sem internet, fila acumulando (50 ou mais), conexão instável (3 ou mais quedas em 24 h), versão desatualizada e cliente suspenso;
  - linha do tempo de quedas e mudanças de estado (24 h);
  - **modo telão** para TV (Esc sai).
- **Ficha do cliente:**
  - caixas com quedas em 7 dias e versão;
  - vendas de 30 dias e contagem de produtos e usuários;
  - plano e cobrança;
  - auditoria do cliente.
- **Plano e cobrança:**
  - plano, mensalidade e dia de vencimento;
  - registrar o pagamento de um mês;
  - situação: em dia, vence logo ou atrasado;
  - **suspensão automática** depois de 10 dias de atraso, só para quem tem mensalidade e pagamento registrado;
  - pagar reativa na hora; a suspensão feita pela Equipe continua.
- **Auditoria:** quem mudou o quê e quando (Equipe, donos, caixas e o sistema), exportável.

**Por baixo**
- **Migração 6 da nuvem (`gestao_e_central`):**
  - PIN do supervisor;
  - plano e cobrança;
  - pagamentos do plano;
  - histórico de conexão: o sinal de vida grava quando o estado muda e quando o caixa volta depois de ficar sem sinal.
- **Rotas novas:** `pacotes/nuvem/src/erp-gestao.ts` e `central-gestao.ts`.
- **Componentes:** gráficos em SVG feitos à mão (sem biblioteca) e tabela com exportação, em `pacotes/nuvem/web/componentes/`.
- **Testes:** 246 passando (+30). Telas conferidas no navegador, no computador e no celular.

**Falta**
- **Venda por peso quebrado (ex.: 350 g):**
  - a quantidade é inteira em todo o sistema;
  - proposta: guardar produtos em kg como gramas;
  - isso mexe no domínio, no contrato e na nuvem, então precisa da decisão do lead.

### Próximos passos (depois de 23/11)

1. **Decidir o ponto 9 da seção 4** (como a nuvem sabe de qual caixa veio cada evento repassado pelo
   agente) e então: agente ativado por código, agente → nuvem (subida e descida) para lojas com
   vários caixas, e o teste de queda desse trecho.
2. Decidir a venda por peso quebrado (gramas) e implementar.
3. Passo 4.2 (hospedagem e assinatura digital, precisam de contas de vocês) e 4.3 (cliente piloto).
4. Validar tudo o que está 🟡 (inclusive as melhorias de 23/11).

## 3. Como rodar

O projeto exige **Node 26**.

```powershell
.\dev instalar    # baixa as ferramentas (npm install)
.\dev versao      # deve mostrar v26.x
.\dev testar      # testes automáticos (hoje: 246 passando)
.\dev verificar   # tipos do TypeScript (hoje: nenhum erro)
.\dev vitrine     # vitrine da interface em http://localhost:5173
.\dev pdv         # o PDV no navegador em http://localhost:5174
.\dev agente      # o agente da loja em http://localhost:5180 (o PDV envia para ele)
npm run pdv:exe   # gera pacotes/pdv/dist/executavel/pdv-continuum.exe
npm run agente:exe # gera pacotes/agente/dist/executavel/agente-continuum.exe
npm run teste-de-queda # derruba a rede entre caixas e agente e confere que nada se perdeu
.\dev erp         # Central e ERP no navegador em http://localhost:5175 (com o PostgreSQL local)
```

- O `dev.cmd` (Windows) usa o Node 26 portátil de `OLD/runtime/node`. Essa pasta **não vai para o git**
  (é grande e não é código nosso). Num clone novo, instale o Node 26 e use `npm run testar`,
  `npm run verificar` e `npm run vitrine` direto (também funciona em Linux e na nuvem).
- O sistema antigo roda com `OLD\iniciar-continuum.exe` e `OLD\pdv-continuum.exe`, que também ficam
  fora do git (executáveis de ~100 MB). Para regerar o PDV antigo: `OLD\runtime\node\node.exe OLD\app\comum\montar-exe.js pdv`.

## 4. Decisões e pontos em aberto

| # | Ponto | Situação |
|---|---|---|
| 1 | Dígito do caixa no código da venda | Proposta adotada até decisão contrária (já implementada no Passo 0.3): o primeiro dígito do número indica o caixa (`MERCBAIRRO-10123-ABCD`); o número tem no mínimo 4 dígitos e cresce depois de 9999 (`MERCBAIRRO-112345-ABCD`). Alternativa: letra do caixa (`MERCBAIRRO-A-00123-ABCD`) |
| 2 | Contato da landing page | Falta definir e-mail ou WhatsApp para o botão "Agendar demonstração" |
| 3 | Código-fonte original (TypeScript) | Não disponível; a lógica será reconstruída a partir de `OLD/app/dist`, pacote a pacote (decisão 4 da arquitetura) |
| 4 | NFC-e | Fora do MVP; confirmar com contador a obrigação por estado (MEI x ME) |
| 5 | Hospedagem | Opção A (camadas gratuitas) no desenvolvimento; opção B (VPS no Brasil) com os primeiros clientes |
| 6 | Ícone dos executáveis | Depende do pacote `resedit` (dependência de desenvolvimento) |
| 7 | Executáveis para testar a conexão | **Pedido do lead (21/11/2026):** ao final, um executável por aplicação (`pdv-continuum.exe`, `agente-continuum.exe`, `nuvem-continuum.exe` com ERP + Central). Entrou no plano como Passo 3.5. O PDV ganha o executável já no Passo 1.5 (sozinho, sem conexão) |
| 8 | PostgreSQL para a nuvem | ✅ Resolvido em 22/11: o `OLD/runtime` não foi encontrado; o PostgreSQL 18 vem pelo pacote `@embedded-postgres/windows-x64` (npm, só desenvolvimento) e o driver `pg` |
| 9 | Origem dos eventos repassados pelo agente | Quando o agente repassar à nuvem os eventos dos caixas, a nuvem precisa saber de qual caixa veio cada um (a venda não diz). Proposta: o envelope do evento ganha `origemId` (o caixa), mantendo o `id` original para não duplicar |

## 5. Como trabalhamos (combinado entre os sócios e o Claude)

O lead acompanha cada etapa para aprender e apresentar o projeto. Todo passo segue o ritual:

1. **Explicar antes:** o quê, em quais arquivos e por quê, em linguagem simples.
2. **Esperar o OK** do lead.
3. **Fazer só aquele passo.**
4. **Mostrar o resultado:** o que mudou, como conferir, o que aprendemos.
5. **Validar** e só então seguir.

Nada de encadear vários passos no automático.

## 6. Mapa do repositório

```
├─ PENDENCIAS.md   este arquivo (onde paramos)
├─ CLAUDE.md       instruções para o Claude Code (lidas automaticamente)
├─ README.md       o que é o projeto e como a pasta está organizada
├─ METAS.md        lista antiga de metas do PDV/ERP do OLD (referência; o plano atual é o docs/05)
├─ docs/           arquitetura, escalabilidade, casos de uso e UML, banco, plano do MVP
├─ pacotes/        o código novo (monorepo): dominio, contratos, sync, agente, pdv, nuvem, interface
├─ site/           landing page
├─ dev.cmd         atalho de desenvolvimento (Windows)
└─ OLD/            projeto anterior (sem dados nem runtime no git)
   ├─ app/dist/                backend compilado do LAB (base da reconstrução)
   ├─ app/src/painel/          Dashboard (Monitor) com as 9 telas
   ├─ app/pdv/                 PDV anterior + 20 testes
   ├─ app/comum/               CPF/CNPJ/EAN, processo, geração de executáveis
   └─ trabalho-em-andamento/   operação de caixa, desconto, pagamento misto, estorno (não ligados)
```
