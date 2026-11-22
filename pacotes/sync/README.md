# @continuum/sync

**Fila (outbox), Sync Engine e máquina de estados.**

- A fila em que nada sai sem confirmação
- O envio em ordem, em lotes, com nova tentativa progressiva
- Os estados SAUDÁVEL, DEGRADADO, OFFLINE, RECUPERANDO e SINCRONIZANDO

Reconstruído a partir do OLD. Usado nos dois elos: caixa → agente e agente → nuvem.

Arquitetura: `docs/01-arquitetura.md` · Plano: `docs/05-plano-do-mvp.md`
