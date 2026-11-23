# Continuum · como instalar e colocar para rodar

Três instaladores, na pasta `instaladores/` (gere com `npm run instaladores`, ou `.\dev instaladores`).
Cada um já traz tudo o que precisa: **não é preciso instalar Node, banco de dados nem nada antes**.
A instalação é por usuário (não pede senha de administrador), cria atalhos na área de trabalho e no menu
Iniciar e aparece em "Aplicativos instalados" do Windows para desinstalar.

| Instalador | O que é | Onde instalar |
|---|---|---|
| `Continuum-Nuvem-Setup.exe` | ERP do cliente e Continuum Central, com o banco PostgreSQL embutido | No computador da demonstração (no produto final, a nuvem fica num servidor na internet: Passo 4.2) |
| `Continuum-PDV-Setup.exe` | O caixa | Em cada computador de caixa |
| `Continuum-Agente-Setup.exe` | O agente da loja (junta os caixas da loja) | Num computador da loja que fica ligado; liga sozinho junto com o Windows |

> O Windows pode mostrar "O Windows protegeu o computador" (SmartScreen) porque os instaladores ainda
> não têm assinatura digital. Clique em **Mais informações → Executar assim mesmo**. A assinatura entra
> com o certificado da empresa (pendência no `PENDENCIAS.md`).
>
> Na primeira vez que a Nuvem ou o Agente abrem, o Windows pergunta se libera o acesso pela rede:
> libere em **redes privadas**, para os caixas de outros computadores alcançarem.

## Formato MEI (um caixa só): Nuvem + PDV

1. Instale e abra o **Continuum Nuvem**. Na aba "ERP do meu negócio", entre como a dona
   (`dono@mercbairro.com.br` / `mercado2026`, acesso de demonstração).
2. Em **Produtos e preços**, cadastre os produtos e dê **entrada** no estoque.
3. Em **Caixas → Novo caixa**, anote o **código de ativação** (vale 24 horas).
4. Instale e abra o **Continuum PDV**. Em "Ativar este caixa", informe o endereço do ERP
   (`http://localhost:5175` no mesmo computador, ou `http://IP-DO-COMPUTADOR-DA-NUVEM:5175` em outro) e o código.
5. Abra o caixa e venda. A venda aparece no **Relatório de vendas** do ERP em segundos; preço mudado no
   ERP chega ao caixa em até 5 segundos.
6. Na aba **Equipe Continuum** (`equipe@continuum.app` / `continuum2026`), o **Monitor ao vivo** mostra o caixa.
7. Feche a Nuvem: o PDV mostra OFFLINE e **continua vendendo**. Abra a Nuvem de novo: tudo sobe, sem duplicar.

## Formato loja (vários caixas): Agente + PDVs

- Instale o **Continuum Agente** num computador da loja e o **Continuum PDV** em cada caixa.
- Em cada caixa, crie o arquivo `agente.txt` em `%APPDATA%\Continuum PDV\` com o endereço do agente
  (ex.: `http://192.168.0.10:5180`). O painel do agente mostra os caixas ao vivo.
- **Ainda falta:** o agente repassar as vendas para a nuvem (ponto 9 do `PENDENCIAS.md`). Por enquanto,
  para ver as vendas no ERP, use o formato MEI.

## Começar do zero

Feche o programa e apague a pasta de dados dele: `%APPDATA%\Continuum PDV`, `%APPDATA%\Continuum Nuvem`
ou `%APPDATA%\Continuum Agente`. Desinstalar não apaga os dados (para não perder vendas por engano).

## Para quem desenvolve

`npm run instaladores` gera os três (cerca de 6 minutos). Separados: `npm run nuvem:exe`,
`npm run pdv:exe`, `npm run agente:exe` (cada um gera o instalador e a versão portátil em
`pacotes/*/dist/executavel/`).
