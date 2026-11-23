@echo off
rem Atalho de desenvolvimento do Continuum.
rem O projeto exige o Node 26. O Node 26 portatil do OLD nao traz o npm, entao
rem usamos o npm da maquina, colocando o Node 26 na frente do PATH.
rem
rem   dev versao      mostra a versao do Node em uso (deve ser 26)
rem   dev testar      roda os testes automaticos
rem   dev verificar   confere os tipos do TypeScript em todos os pacotes
rem   dev pdv         abre o PDV no navegador (http://localhost:5174)
rem   dev agente      liga o agente da loja (painel em http://localhost:5180)
rem   dev nuvem       liga a API da nuvem e o PostgreSQL local (porta 5190)
rem   dev erp         telas do Central e do ERP no navegador (http://localhost:5175)
rem   dev instaladores gera os 3 instaladores (Nuvem, PDV, Agente) na pasta instaladores
rem   dev instalar    baixa as ferramentas de desenvolvimento (npm install)
setlocal
set "RAIZ=%~dp0"
set "PATH=%RAIZ%OLD\runtime\node;%PATH%"
if "%~1"=="" (
  echo uso: dev ^<comando^>    ex.: dev versao ^| dev testar ^| dev verificar ^| dev instalar
  exit /b 1
)
if /i "%~1"=="instalar" (
  call npm install
  exit /b %errorlevel%
)
call npm run --silent %*
exit /b %errorlevel%
