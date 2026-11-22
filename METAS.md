# METAS — Continuum

Estado em 21/11/2026. Detalhes técnicos do que já foi escrito: `OLD/trabalho-em-andamento/LEIA-ME.md`.

> **Atenção:** o projeto atual foi movido para `OLD/`. Todos os caminhos abaixo (`app/...`, `runtime/...`,
> `trabalho-em-andamento/...`) agora ficam dentro de `OLD/`. Os comandos devem ser rodados de dentro de `OLD/`.

## Já pronto (MVP)
- [x] Dashboard com 9 telas e Monitor do PDV (validação de venda pelo código)
- [x] PDV separado (`pdv-continuum.exe`): venda, cupom, "Venda finalizada" com código, valor, pagamento e troco
- [x] Venda offline com a nuvem fora (cupom amarelo → verde quando sincroniza)
- [x] 20 testes do PDV passando (`runtime\node\node.exe --test app\pdv\testes\`)

## 1. PDV — terminar os ajustes (código escrito, falta ligar)
Arquivos prontos em `trabalho-em-andamento/` (`caixa-v3-operacao-de-caixa.js`, `banco-caixa.js`) e `app/comum/documentos.js`.
- [ ] Trocar `app/pdv/caixa.js` pela v3 e mover `banco-caixa.js` de volta para `app/pdv/`
- [ ] `iniciar-pdv.js`: abrir `dados/pdv/pdv.db` e migrar o histórico `.jsonl` antigo
- [ ] Rotas na `app/pdv/servidor.js`: abrir/fechar caixa, sangria, suprimento, relatório, cancelar venda; erros 409 (caixa fechado) e 403 (PIN)
- [ ] Operação de caixa: telas de abertura (operador + fundo de troco), sangria, suprimento e fechamento com conferência (quebra de caixa)
- [ ] Venda mais rápida: multiplicador `3*005`, leitura de EAN-13, desconto por item e na venda (PIN acima de 10%), CPF/CNPJ na nota
- [ ] Pagamento misto (dinheiro, débito, crédito, Pix), com troco só sobre o dinheiro
- [ ] Cancelamento por estorno: código + motivo + PIN do supervisor, só na sessão aberta, estoque volta por movimentação ESTORNO
- [ ] Monitor do Dashboard: ler `pagamentos` (lista), mostrar vendas canceladas e o caixa aberto/fechado com o operador
- [ ] Testes novos (sessão, sangria, fechamento, desconto, pagamento misto, estorno) e regerar o exe: `runtime\node\node.exe app\comum\montar-exe.js pdv`
- [ ] Trocar o PIN padrão (1234) por um PIN configurável

## 2. ERP de estoque (MVP simulado) — `erp-continuum.exe`, porta 3200
Regra-chave: a nuvem só aceita 4 eventos (produto criado/alterado, movimentação, venda). Os dados do ERP ficam em `dados/erp/erp.db`; o estoque passa pelas regras do LAB, com a NF e o lote no campo *motivo* da movimentação.
- [ ] Painel gerencial: faturamento, ticket médio, mais vendidos, estoque crítico, valor em estoque, lotes vencendo
- [ ] Produtos: cadastro, alteração de preço com controle de versão (tratar conflito), estoque mínimo, custo médio, margem
- [ ] Estoque: kardex por produto, entrada manual, ajuste de inventário com motivo
- [ ] Notas fiscais de entrada: importar o XML da NF-e (validar chave/DV, CNPJ, NF duplicada), conferir itens, vincular produto (de-para por fornecedor + EAN), lançar a entrada
- [ ] Gerador de NF simulada (fornecedores fictícios, itens com lote e validade)
- [ ] Lotes e validade: lote vindo da tag `<rastro>` da NF, alerta de vencimento, saldo por lote estimado (FEFO)
- [ ] Fornecedores: vindos das notas (CNPJ, total comprado, última compra)
- [ ] Gravação em ordem segura entre os dois bancos (nota "processando" → entrada no estoque → nota "lançada") com recuperação ao iniciar
- [ ] Gerar o exe (`montar-exe.js erp`), escrever os testes e integrar o ERP ao Dashboard

## 3. Futuro
- [ ] Leitura de DANFE em PDF/foto (OCR) para alimentar o estoque
- [ ] Consulta da NF-e pela chave na SEFAZ e manifestação do destinatário
- [ ] Backend: eventos novos na nuvem (venda cancelada, desconto, dados de NF/lote) para o faturamento da nuvem bater com o caixa
- [ ] Ícone do Continuum nos exes (instalar o `resedit`, dependência de desenvolvimento)
