// O ERP do cliente (tema claro): o menu mostra só o que o perfil pode (Passo 2.2).
// As telas de cada item chegam nos Passos 2.4 (loja, produtos, estoque) e 2.5 (caixas, relatórios, validar venda).
import { Botao, Cartao } from '@continuum/interface';
import { ArrowLeft, BadgeCheck, BarChart3, Boxes, LogOut, MonitorSmartphone, Package, Store, Users } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Eu } from '../api.ts';
import { ErpCaixas } from './ErpCaixas.tsx';
import { ErpLoja } from './ErpLoja.tsx';
import { ErpProdutos } from './ErpProdutos.tsx';
import { ErpRelatorio } from './ErpRelatorio.tsx';
import { ErpValidar } from './ErpValidar.tsx';

type Tela = 'inicio' | 'produtos' | 'loja' | 'caixas' | 'relatorio' | 'validar';

const ITENS: { acao: string; titulo: string; texto: string; icone: ReactNode; passo: string; tela?: Tela }[] = [
  { acao: 'erp.loja.configurar', titulo: 'Loja e comprovante', texto: 'Nome reduzido, endereço e o que sai impresso.', icone: <Store aria-hidden="true" />, passo: '2.4', tela: 'loja' },
  { acao: 'erp.produtos.editar', titulo: 'Produtos e preços', texto: 'Cadastrar produto, código de barras, alterar preço.', icone: <Package aria-hidden="true" />, passo: '2.4', tela: 'produtos' },
  { acao: 'erp.estoque.movimentar', titulo: 'Estoque', texto: 'Entrada, ajuste com motivo e o kardex de cada produto.', icone: <Boxes aria-hidden="true" />, passo: '2.4', tela: 'produtos' },
  { acao: 'erp.caixas.ativar', titulo: 'Caixas', texto: 'Gerar o código de ativação de um caixa novo.', icone: <MonitorSmartphone aria-hidden="true" />, passo: '2.5', tela: 'caixas' },
  { acao: 'erp.relatorios.ver', titulo: 'Relatórios de venda', texto: 'Vendas do dia, por forma de pagamento.', icone: <BarChart3 aria-hidden="true" />, passo: '2.5', tela: 'relatorio' },
  { acao: 'erp.vendas.validar', titulo: 'Validar venda', texto: 'Conferir um comprovante pelo código.', icone: <BadgeCheck aria-hidden="true" />, passo: '2.5', tela: 'validar' },
  { acao: 'erp.usuarios.gerenciar', titulo: 'Usuários', texto: 'Quem acessa o ERP e o caixa.', icone: <Users aria-hidden="true" />, passo: 'P1' },
];

export function Erp({ eu, aoSair }: { eu: Eu; aoSair: () => void }) {
  const [tela, setTela] = useState<Tela>('inicio');
  // Supervisor consulta o estoque sem editar: vê os produtos, sem os formulários.
  const podeVerProdutos = eu.permissoes.includes('erp.estoque.consultar');
  const visiveis = ITENS.filter((i) => eu.permissoes.includes(i.acao) || (i.tela === 'produtos' && podeVerProdutos && i.acao === 'erp.estoque.movimentar'));
  return (
    <>
      <header className="cabecalho">
        <div className="marca">
          <strong>{eu.cliente?.nome_fantasia ?? eu.cliente?.nome}</strong>
          <small>
            ERP · {eu.cliente?.dominio} · {eu.nome} ({eu.perfil})
          </small>
        </div>
        <div className="acoes">
          {tela !== 'inicio' && (
            <Botao variante="secundario" icone={<ArrowLeft aria-hidden="true" />} onClick={() => setTela('inicio')}>
              Início
            </Botao>
          )}
          <Botao variante="secundario" icone={<LogOut aria-hidden="true" />} onClick={aoSair}>
            Sair
          </Botao>
        </div>
      </header>
      <main className="conteudo">
        {tela === 'produtos' && (
          <>
            <h1>Produtos e estoque</h1>
            <ErpProdutos podeEditar={eu.permissoes.includes('erp.produtos.editar')} />
          </>
        )}
        {tela === 'loja' && (
          <>
            <h1>Loja e comprovante</h1>
            <ErpLoja />
          </>
        )}
        {tela === 'caixas' && (
          <>
            <h1>Caixas</h1>
            <ErpCaixas />
          </>
        )}
        {tela === 'relatorio' && (
          <>
            <h1>Relatório de vendas</h1>
            <ErpRelatorio />
          </>
        )}
        {tela === 'validar' && (
          <>
            <h1>Validar venda</h1>
            <ErpValidar />
          </>
        )}
        {tela === 'inicio' && <h1>Olá, {eu.nome}</h1>}
        {tela !== 'inicio' ? null : visiveis.length === 0 ? (
          <Cartao titulo="Seu acesso é pelo caixa">
            <p className="suave">O seu perfil ({eu.perfil}) vende no PDV. As telas de gestão são do dono e do gerente.</p>
          </Cartao>
        ) : (
          <div className="grade-cartoes" aria-label="O que você pode fazer">
            {visiveis.map((i) => (
              <Cartao key={i.acao} titulo={i.titulo} icone={i.icone}>
                <p className="suave">{i.texto}</p>
                {i.tela !== undefined ? (
                  <Botao variante="secundario" onClick={() => setTela(i.tela ?? 'inicio')}>
                    Abrir
                  </Botao>
                ) : (
                  <small className="em-breve">Chega no Passo {i.passo}</small>
                )}
              </Cartao>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
