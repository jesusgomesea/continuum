# Estado do MVP (21/11/2026)

## Pronto e testado (20 testes: `runtime\node\node.exe --test app\pdv\testes\`)
- **Dashboard** (`iniciar-continuum.exe`): 9 telas + Monitor do PDV (validação de venda pelo código).
- **PDV** (`pdv-continuum.exe`, abrir DEPOIS do Continuum): venda com regras do LAB, cupom,
  tela "Venda finalizada" com código `CX01-000000-XXXX`, valor, pagamento e troco, contingência
  offline (cupom amarelo → verde quando sincroniza).
- Gerar exe de novo: `runtime\node\node.exe app\comum\montar-exe.js pdv`

## Em andamento (NÃO ligado ao app)
- `caixa-v3-operacao-de-caixa.js` + `banco-caixa.js`: abertura/fechamento de caixa, sangria,
  suprimento, desconto (PIN supervisor 1234 acima de 10%), CPF/CNPJ, pagamento misto, estorno.
  Falta: rotas na `app/pdv/servidor.js`, telas no `app/pdv/web/`, `iniciar-pdv.js` abrir o
  `dados/pdv/pdv.db`, testes, e o Monitor do Dashboard ler `pagamentos` (lista).
- Pronto para usar: `app/comum/documentos.js` (CPF/CNPJ/EAN), `app/comum/processo.js`, `app/comum/montar-exe.js`.
- **ERP**: só planejado. A nuvem aceita só 4 tipos de evento; dados do ERP (NF-e, lotes,
  fornecedores) vão num banco próprio `dados/erp/erp.db`, estoque pelas regras do LAB.
