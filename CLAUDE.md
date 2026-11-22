# Continuum · instruções para o Claude Code

Leia `PENDENCIAS.md` primeiro: diz onde o desenvolvimento parou e qual é o próximo passo.

## O projeto

Plataforma Local First de PDV e gestão para microempresas. Peças (aprovadas em `docs/01-arquitetura.md`):
**Continuum Central** (nuvem, equipe Continuum: monitora e parametriza todos os clientes), **ERP do
cliente** (nuvem, um por negócio, domínio próprio), **agente da loja** e **PDV instalado** (Electron,
vende sem internet e sem rede). Essência: a venda é gravada localmente primeiro, nada se perde, e os
pontos de venda são monitorados abertamente.

## Como trabalhar (obrigatório)

O lead do projeto (Eluan Jesus) não programa: desenvolve com IA e quer **aprender acompanhando**.

1. Antes de qualquer mudança (arquivo, CSS, tabela, dependência), explique **o quê, onde e por quê**
   em português simples e **espere o OK**.
2. Faça **um passo por vez** do plano `docs/05-plano-do-mvp.md`; não encadeie passos no automático.
3. Depois, mostre o resultado (o que mudou, como conferir) e explique o que se aprendeu.
4. Marque o progresso em `docs/05-plano-do-mvp.md` e em `PENDENCIAS.md`.
5. Responda e escreva documentos em português do Brasil.

## Regras técnicas

- Stack: TypeScript estrito, Node 26, npm workspaces (`pacotes/*`), Vitest, React + Vite,
  PostgreSQL na nuvem, SQLite local. SQL escrito à mão, sem ORM.
- Imports com extensão `.ts`/`.tsx` (o Node 26 executa TypeScript direto).
- Visual: só pelos tokens de `pacotes/interface/src/tokens/tokens.css` (nunca cor fixa nas telas).
  Tema escuro para Central e PDV; claro para o ERP. Nomes de tokens em português.
- Regras de negócio herdadas do OLD: venda nunca é editada nem apagada (cancelamento é estorno);
  saldo de estoque é a soma das movimentações; dinheiro em centavos inteiros; IDs UUID v7; venda e
  evento na outbox na mesma transação.
- Nada carregado da internet em tempo de execução (ADR 013 do OLD): tudo empacotado.
- `OLD/` é referência: não editar `OLD/app/dist`. A lógica do OLD é reconstruída em TypeScript dentro
  de `pacotes/`, arquivo por arquivo, explicando ao lead.

## Comandos

`npm run testar` · `npm run verificar` · `npm run vitrine` (no Windows: `.\dev testar` etc.)
