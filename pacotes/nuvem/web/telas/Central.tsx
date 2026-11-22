// Continuum Central (tema escuro): a Equipe cadastra clientes (UC01) e parametriza o ERP de cada um (UC02).
import { Botao, Cartao, Chip } from '@continuum/interface';
import { Activity, Building2, LogOut, Plus, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api.ts';
import type { ClienteResumo, DetalheDoCliente, Eu } from '../api.ts';
import { MonitorAoVivo } from './Monitor.tsx';

const formatarDocumento = (tipo: string, d: string) =>
  tipo === 'CNPJ' ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;

export function Central({ eu, aoSair }: { eu: Eu; aoSair: () => void }) {
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [aberto, setAberto] = useState<string | 'novo' | null>(null);
  const [aba, setAba] = useState<'monitor' | 'clientes'>('monitor');
  const [aviso, setAviso] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    api
      .clientes()
      .then((r) => setClientes(r.clientes))
      .catch((e: Error) => setAviso(e.message));
  }, []);
  useEffect(recarregar, [recarregar]);

  return (
    <>
      <header className="cabecalho">
        <div className="marca">
          <strong>
            CONTINUUM <span>CENTRAL</span>
          </strong>
          <small>{eu.nome}</small>
        </div>
        <div className="abas abas-topo" role="tablist" aria-label="Seções do Central">
          <button type="button" role="tab" aria-selected={aba === 'monitor'} onClick={() => setAba('monitor')}>
            <Activity aria-hidden="true" /> Monitor ao vivo
          </button>
          <button type="button" role="tab" aria-selected={aba === 'clientes'} onClick={() => setAba('clientes')}>
            <Building2 aria-hidden="true" /> Clientes
          </button>
        </div>
        <div className="acoes">
          <Botao
            icone={<Plus aria-hidden="true" />}
            onClick={() => {
              setAba('clientes');
              setAberto('novo');
            }}
          >
            Novo cliente
          </Botao>
          <Botao variante="secundario" icone={<LogOut aria-hidden="true" />} onClick={aoSair}>
            Sair
          </Botao>
        </div>
      </header>
      {aba === 'monitor' && (
        <main className="conteudo">
          <MonitorAoVivo />
        </main>
      )}
      {aba === 'clientes' && (
      <main className="conteudo duas-colunas">
        <Cartao titulo={`Clientes (${clientes.length})`} icone={<Building2 aria-hidden="true" />}>
          {aviso !== null && <p className="aviso">{aviso}</p>}
          <ul className="lista" aria-label="Clientes">
            {clientes.map((c) => (
              <li key={c.id}>
                <button type="button" className={aberto === c.id ? 'item selecionado' : 'item'} onClick={() => setAberto(c.id)}>
                  <span className="nome">{c.nome_fantasia ?? c.nome}</span>
                  <small>
                    {c.tipo_documento} {formatarDocumento(c.tipo_documento, c.documento)} · {c.dominio}
                  </small>
                  <span className="etiquetas">
                    <Chip tom={c.situacao === 'ativo' ? 'sucesso' : 'erro'}>{c.situacao}</Chip>
                    <Chip tom="neutro" ponto={false}>
                      {c.lojas} loja(s) · {c.caixas_ativos} caixa(s)
                    </Chip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Cartao>
        {aberto === 'novo' && (
          <NovoCliente
            aoCriar={(id) => {
              recarregar();
              setAberto(id);
            }}
          />
        )}
        {aberto !== null && aberto !== 'novo' && <DetalheCliente key={aberto} id={aberto} aoMudar={recarregar} />}
        {aberto === null && (
          <Cartao titulo="Selecione um cliente">
            <p className="suave">Escolha um cliente na lista para ver e parametrizar o ERP dele, ou cadastre um novo.</p>
          </Cartao>
        )}
      </main>
      )}
    </>
  );
}

function NovoCliente({ aoCriar }: { aoCriar: (id: string) => void }) {
  const [f, setF] = useState({
    documento: '',
    nome: '',
    nomeFantasia: '',
    segmento: 'mercearia',
    dominio: '',
    nomeReduzido: '',
    nomeLoja: '',
    donoNome: '',
    donoEmail: '',
    donoSenha: '',
    regraEstoque: 'bloquear',
    limiteDescontoPct: '10',
    largura: '80',
  });
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  function enviar(e: FormEvent) {
    e.preventDefault();
    api
      .cadastrarCliente({
        documento: f.documento,
        nome: f.nome,
        nomeFantasia: f.nomeFantasia,
        segmento: f.segmento,
        dominio: f.dominio,
        loja: { nomeReduzido: f.nomeReduzido, nome: f.nomeLoja || f.nomeFantasia || f.nome },
        dono: { nome: f.donoNome, email: f.donoEmail, senha: f.donoSenha },
        parametros: {
          regraEstoque: f.regraEstoque,
          limiteDescontoPct: Number(f.limiteDescontoPct),
          comprovante: { cabecalho: [f.nomeFantasia || f.nome], largura: Number(f.largura) },
        },
      })
      .then((r) => aoCriar(r.id))
      .catch((erro: Error) => setAviso(erro.message));
  }

  return (
    <Cartao titulo="Novo cliente">
      <form className="formulario" onSubmit={enviar}>
        <fieldset>
          <legend>Empresa</legend>
          <label>
            CNPJ ou CPF (MEI)
            <input {...campo('documento')} required />
          </label>
          <label>
            Razão social ou nome
            <input {...campo('nome')} required />
          </label>
          <label>
            Nome fantasia
            <input {...campo('nomeFantasia')} />
          </label>
          <label>
            Segmento
            <select {...campo('segmento')}>
              <option value="mercearia">Mercearia</option>
              <option value="padaria">Padaria</option>
              <option value="conveniencia">Conveniência</option>
              <option value="hortifruti">Hortifrúti</option>
              <option value="farmacia">Farmácia</option>
              <option value="outro">Outro</option>
            </select>
          </label>
          <label>
            Domínio do ERP
            <input {...campo('dominio')} placeholder="mercearia.continuum.app" required />
          </label>
        </fieldset>
        <fieldset>
          <legend>Primeira loja</legend>
          <label>
            Nome reduzido (vai no código da venda)
            <input {...campo('nomeReduzido')} placeholder="MERCBAIRRO" maxLength={10} required />
          </label>
          <label>
            Nome da loja
            <input {...campo('nomeLoja')} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Dono (primeiro acesso ao ERP)</legend>
          <label>
            Nome
            <input {...campo('donoNome')} required />
          </label>
          <label>
            E-mail
            <input type="email" {...campo('donoEmail')} required />
          </label>
          <label>
            Senha inicial (8+ caracteres, letras e números)
            <input type="password" {...campo('donoSenha')} required />
          </label>
        </fieldset>
        <Parametros f={f} campo={campo} />
        {aviso !== null && (
          <p className="aviso" role="alert">
            {aviso}
          </p>
        )}
        <Botao type="submit" icone={<Plus aria-hidden="true" />}>
          Cadastrar cliente
        </Botao>
      </form>
    </Cartao>
  );
}

type Campo = (k: never) => { value: string; onChange: (e: { target: { value: string } }) => void };

function Parametros({ campo }: { f: Record<string, string>; campo: Campo }) {
  const c = campo as unknown as (k: string) => { value: string; onChange: (e: { target: { value: string } }) => void };
  return (
    <fieldset>
      <legend>Parâmetros do ERP</legend>
      <label>
        Venda sem estoque
        <select {...c('regraEstoque')}>
          <option value="bloquear">Bloquear a venda</option>
          <option value="permitir_alerta">Permitir com alerta (caixa sem rede)</option>
        </select>
      </label>
      <label>
        Desconto sem supervisor, até (%)
        <input type="number" min={0} max={100} {...c('limiteDescontoPct')} />
      </label>
      <label>
        Bobina do comprovante
        <select {...c('largura')}>
          <option value="80">80 mm</option>
          <option value="58">58 mm</option>
        </select>
      </label>
    </fieldset>
  );
}

function DetalheCliente({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const [d, setD] = useState<DetalheDoCliente | null>(null);
  const [f, setF] = useState({ regraEstoque: 'bloquear', limiteDescontoPct: '10', largura: '80' });
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api
      .cliente(id)
      .then((r) => {
        setD(r);
        setF({ regraEstoque: r.parametros.regra_estoque, limiteDescontoPct: String(r.parametros.limite_desconto_pct), largura: String(r.parametros.comprovante.largura ?? 80) });
      })
      .catch((e: Error) => setAviso(e.message));
  }, [id]);
  useEffect(carregar, [carregar]);

  if (d === null) return <Cartao titulo="Carregando…">{aviso !== null && <p className="aviso">{aviso}</p>}</Cartao>;
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  function salvar(e: FormEvent) {
    e.preventDefault();
    if (d === null) return;
    api
      .parametrizar(id, {
        regraEstoque: f.regraEstoque,
        limiteDescontoPct: Number(f.limiteDescontoPct),
        comprovante: { ...d.parametros.comprovante, largura: Number(f.largura) },
      })
      .then((r) => {
        setSalvo(`Parâmetros salvos (versão ${r.versao}). Os caixas do cliente recebem na próxima sincronização.`);
        setAviso(null);
        carregar();
      })
      .catch((erro: Error) => setAviso(erro.message));
  }

  const suspenso = d.cliente.situacao === 'suspenso';
  return (
    <Cartao
      titulo={d.cliente.nome_fantasia ?? d.cliente.nome}
      acao={<Chip tom={suspenso ? 'erro' : 'sucesso'}>{d.cliente.situacao}</Chip>}
    >
      <dl className="dados">
        <dt>Razão social</dt>
        <dd>{d.cliente.nome}</dd>
        <dt>{d.cliente.tipo_documento}</dt>
        <dd>{formatarDocumento(d.cliente.tipo_documento, d.cliente.documento)}</dd>
        <dt>Domínio</dt>
        <dd>{d.cliente.dominio}</dd>
        <dt>Lojas</dt>
        <dd>{d.lojas.map((l) => l.nome_reduzido).join(', ')}</dd>
        <dt>Usuários</dt>
        <dd>{d.usuarios.map((u) => `${u.nome} (${u.perfil})`).join(', ')}</dd>
      </dl>
      <form className="formulario" onSubmit={salvar}>
        <Parametros f={f} campo={campo as unknown as Campo} />
        {aviso !== null && (
          <p className="aviso" role="alert">
            {aviso}
          </p>
        )}
        {salvo !== null && <p className="ok">{salvo}</p>}
        <div className="botoes">
          <Botao type="submit" icone={<Save aria-hidden="true" />}>
            Salvar parâmetros (versão {d.parametros.versao})
          </Botao>
          <Botao
            variante={suspenso ? 'secundario' : 'perigo'}
            onClick={() =>
              void api
                .mudarSituacao(id, suspenso ? 'ativo' : 'suspenso')
                .then(() => {
                  carregar();
                  aoMudar();
                })
                .catch((erro: Error) => setAviso(erro.message))
            }
          >
            {suspenso ? 'Reativar cliente' : 'Suspender cliente'}
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
