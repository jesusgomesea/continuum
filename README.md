# Continuum

**A operação trabalha. O CONTINUUM protege.**

Plataforma Local First de PDV e gestão para microempresas: a venda é gravada na loja primeiro,
sincronizada com a nuvem depois, e cada ponto de venda é acompanhado ao vivo. Nasceu como
**DATA HUB** (continuidade e proteção de dados) e evolui para um sistema integrado
servidor → clientes (PDV, Gestão e Monitor).

Sócios: **Eluan Jesus** (sócio · lead do projeto) e **Enzo Gomes** (sócio · idealizador).

> **Para continuar o desenvolvimento, leia [PENDENCIAS.md](PENDENCIAS.md).**

## Como a pasta está organizada

```
continuum-portatil/
├─ OLD/        Projeto anterior (LAB, Dashboard, PDV), intacto e funcionando.
│              Para rodar: OLD\iniciar-continuum.exe e depois OLD\pdv-continuum.exe
├─ pacotes/    O código do projeto novo (monorepo): dominio, contratos, sync, agente, pdv, nuvem, interface
├─ dev.cmd     Atalho de desenvolvimento (usa o Node 26 do OLD): .\dev versao | testar | verificar | instalar
├─ docs/       Documentos de projeto, etapa por etapa (01-arquitetura.md, ...)
├─ site/       Landing page do negócio (abrir site/index.html)
├─ METAS.md    O que falta desenvolver, em ordem de prioridade
└─ README.md   Este arquivo
```

O projeto novo será estruturado aqui na raiz, etapa por etapa, com cada decisão explicada e
aprovada antes de virar código.

## O que vem do OLD

- **Regras e conceitos**: outbox, máquina de estados, Sync Engine, validação evento a evento.
- **PDV**: venda, código da venda, contingência offline (com 20 testes).
- **Identidade visual**: azul royal e lilás do material de apresentação, painel escuro do produto.
- **Utilitários**: validação de CPF, CNPJ e EAN-13 (`OLD/app/comum/documentos.js`).

Ponto de atenção: o OLD tem só o backend já compilado (`OLD/app/dist`), sem o código-fonte em
TypeScript. Para a nova estrutura, o ideal é partir do repositório original do projeto.

## Próximas etapas

1. Arquitetura do protótipo final (servidor → clientes PDV, Gestão e Monitor)
2. Escalabilidade e framework do front-end, mantendo a cara do Continuum
3. Casos de uso, diagramas UML e modelo do banco de dados
4. MVP para microempresas: venda, comprovante (CNPJ ou CPF) e estoque

Repositório: https://github.com/jesusgomesea/continuum
