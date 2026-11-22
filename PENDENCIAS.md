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

## 2. Próximo passo

1. **Aprovar (ou ajustar) o visual do Passo 0.2:** rodar `.\dev vitrine` e conferir os temas escuro e
   claro, a faixa de estado, os cartões, os chips, os botões, a paleta e a tipografia.
2. **Passo 0.3 · Regras básicas** (pacote `dominio`): dinheiro em centavos, validação de CPF, CNPJ e
   EAN (trazidos de `OLD/app/comum/documentos.js`) e o código da venda
   `NOMELOJAREDUZIDO-00000-ABCD`, com testes. Seguir o ritual da seção 5: explicar antes, esperar o OK.
3. Depois: Passo 0.4 (contratos dos eventos) e a Fase 1 (PDV sozinho), conforme `docs/05-plano-do-mvp.md`.

## 3. Como rodar

O projeto exige **Node 26**.

```powershell
.\dev instalar    # baixa as ferramentas (npm install)
.\dev versao      # deve mostrar v26.x
.\dev testar      # testes automáticos (hoje: 6 passando)
.\dev verificar   # tipos do TypeScript (hoje: nenhum erro)
.\dev vitrine     # vitrine da interface em http://localhost:5173
```

- O `dev.cmd` (Windows) usa o Node 26 portátil de `OLD/runtime/node`. Essa pasta **não vai para o git**
  (é grande e não é código nosso). Num clone novo, instale o Node 26 e use `npm run testar`,
  `npm run verificar` e `npm run vitrine` direto (também funciona em Linux e na nuvem).
- O sistema antigo roda com `OLD\iniciar-continuum.exe` e `OLD\pdv-continuum.exe`, que também ficam
  fora do git (executáveis de ~100 MB). Para regerar o PDV antigo: `OLD\runtime\node\node.exe OLD\app\comum\montar-exe.js pdv`.

## 4. Decisões e pontos em aberto

| # | Ponto | Situação |
|---|---|---|
| 1 | Dígito do caixa no código da venda | Proposta adotada até decisão contrária: o primeiro dígito do número indica o caixa (`MERCBAIRRO-10123-ABCD`). Alternativa: letra do caixa (`MERCBAIRRO-A-00123-ABCD`) |
| 2 | Contato da landing page | Falta definir e-mail ou WhatsApp para o botão "Agendar demonstração" |
| 3 | Código-fonte original (TypeScript) | Não disponível; a lógica será reconstruída a partir de `OLD/app/dist`, pacote a pacote (decisão 4 da arquitetura) |
| 4 | NFC-e | Fora do MVP; confirmar com contador a obrigação por estado (MEI x ME) |
| 5 | Hospedagem | Opção A (camadas gratuitas) no desenvolvimento; opção B (VPS no Brasil) com os primeiros clientes |
| 6 | Ícone dos executáveis | Depende do pacote `resedit` (dependência de desenvolvimento) |

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
