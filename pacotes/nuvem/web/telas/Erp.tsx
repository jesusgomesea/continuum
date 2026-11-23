// O ERP do cliente (tema claro): menu lateral com o que o perfil pode e, na entrada, o painel do dono.
// No celular, o menu vira uma faixa com rolagem no topo.
import { Botao, Cartao } from '@continuum/interface';
import { AlertTriangle, BadgeCheck, BarChart3, LayoutDashboard, LogOut, MonitorSmartphone, Package, Store, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Eu } from '../api.ts';
import { ErpAlertas } from './ErpAlertas.tsx';
import { ErpCaixas } from './ErpCaixas.tsx';
import { ErpFechamentos } from './ErpFechamentos.tsx';
import { ErpLoja } from './ErpLoja.tsx';
import { ErpPainel } from './ErpPainel.tsx';
import { ErpProdutos } from './ErpProdutos.tsx';
import { ErpRelatorio } from './ErpRelatorio.tsx';
import { ErpUsuarios } from './ErpUsuarios.tsx';
import { ErpValidar } from './ErpValidar.tsx';

type Tela = 'painel' | 'relatorio' | 'produtos' | 'alertas' | 'fechamentos' | 'caixas' | 'validar' | 'usuarios' | 'loja';

/** Cada item do menu aparece se o perfil tem pelo menos uma das permissões. */
const MENU: { tela: Tela; titulo: string; icone: ReactNode; permissoes: string[] }[] = [
  { tela: 'painel', titulo: 'Painel', icone: <LayoutDashboard aria-hidden="true" />, permissoes: ['erp.relatorios.ver'] },
  { tela: 'relatorio', titulo: 'Vendas', icone: <BarChart3 aria-hidden="true" />, permissoes: ['erp.relatorios.ver'] },
  { tela: 'produtos', titulo: 'Produtos e estoque', icone: <Package aria-hidden="true" />, permissoes: ['erp.produtos.editar', 'erp.estoque.consultar'] },
  { tela: 'alertas', titulo: 'Alertas e compras', icone: <AlertTriangle aria-hidden="true" />, permissoes: ['erp.estoque.consultar'] },
  { tela: 'fechamentos', titulo: 'Fechamentos de caixa', icone: <Wallet aria-hidden="true" />, permissoes: ['erp.relatorios.ver'] },
  { tela: 'caixas', titulo: 'Caixas', icone: <MonitorSmartphone aria-hidden="true" />, permissoes: ['erp.caixas.ativar'] },
  { tela: 'validar', titulo: 'Validar venda', icone: <BadgeCheck aria-hidden="true" />, permissoes: ['erp.vendas.validar'] },
  { tela: 'usuarios', titulo: 'Usuários', icone: <Users aria-hidden="true" />, permissoes: ['erp.usuarios.gerenciar'] },
  { tela: 'loja', titulo: 'Loja, comprovante e PIN', icone: <Store aria-hidden="true" />, permissoes: ['erp.loja.configurar'] },
];

export function Erp({ eu, aoSair }: { eu: Eu; aoSair: () => void }) {
  const visiveis = MENU.filter((m) => m.permissoes.some((p) => eu.permissoes.includes(p)));
  const [tela, setTela] = useState<Tela | null>(visiveis[0]?.tela ?? null);
  const atual = visiveis.find((m) => m.tela === tela);

  return (
    <div className="erp">
      <aside className="lateral nao-imprimir" aria-label="Menu do ERP">
        <div className="marca">
          <strong>{eu.cliente?.nome_fantasia ?? eu.cliente?.nome}</strong>
          <small>{eu.cliente?.dominio}</small>
        </div>
        <nav>
          {visiveis.map((m) => (
            <button key={m.tela} type="button" className="item-menu" aria-current={tela === m.tela ? 'page' : undefined} onClick={() => setTela(m.tela)}>
              {m.icone}
              <span>{m.titulo}</span>
            </button>
          ))}
        </nav>
        <div className="quem">
          <small>
            {eu.nome} · {eu.perfil}
          </small>
          <Botao variante="fantasma" icone={<LogOut aria-hidden="true" />} onClick={aoSair}>
            Sair
          </Botao>
        </div>
      </aside>
      <main className="conteudo">
        {atual !== undefined && <h1>{atual.titulo}</h1>}
        {tela === 'painel' && <ErpPainel irPara={setTela} />}
        {tela === 'relatorio' && <ErpRelatorio />}
        {tela === 'produtos' && <ErpProdutos podeEditar={eu.permissoes.includes('erp.produtos.editar')} />}
        {tela === 'alertas' && <ErpAlertas abrirProduto={() => setTela('produtos')} />}
        {tela === 'fechamentos' && <ErpFechamentos />}
        {tela === 'caixas' && <ErpCaixas />}
        {tela === 'validar' && <ErpValidar />}
        {tela === 'usuarios' && <ErpUsuarios />}
        {tela === 'loja' && <ErpLoja />}
        {visiveis.length === 0 && (
          <Cartao titulo="Seu acesso é pelo caixa">
            <p className="suave">O seu perfil ({eu.perfil}) vende no PDV. As telas de gestão são do dono e do gerente.</p>
          </Cartao>
        )}
      </main>
    </div>
  );
}
