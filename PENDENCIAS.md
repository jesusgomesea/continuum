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
   - Ainda não feito (fica para depois): chave de idempotência da venda (clique duplo), PIN do supervisor
     (a tela confere e informa "autorizado"), e identidade/parâmetros chegando pela ativação (Passo 3.1).
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
   - Ainda simplificado: a autorização do supervisor é uma caixa de marcar (o PIN vem depois); não há
     atalhos de teclado além do Enter.
8. **Passo 1.5 · PDV instalado e comprovante** (Electron, impressão 58/80 mm), conforme o plano.

## 3. Como rodar

O projeto exige **Node 26**.

```powershell
.\dev instalar    # baixa as ferramentas (npm install)
.\dev versao      # deve mostrar v26.x
.\dev testar      # testes automáticos (hoje: 136 passando)
.\dev verificar   # tipos do TypeScript (hoje: nenhum erro)
.\dev vitrine     # vitrine da interface em http://localhost:5173
.\dev pdv         # o PDV no navegador em http://localhost:5174
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
