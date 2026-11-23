// ERP · Usuários (UC16): quem acessa o ERP e o caixa, com o perfil de cada um. Só o dono gerencia.
// Ninguém se desativa nem troca o próprio perfil, e o negócio nunca fica sem um dono ativo.
import { Botao, Cartao, Chip } from '@continuum/interface';
import { KeyRound, Save, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { pedir } from '../api.ts';
import { TabelaDados } from '../componentes/Tabela.tsx';

interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: 'dono' | 'gerente' | 'supervisor' | 'operador';
  ativo: boolean;
}

export const PERFIS: { id: Usuario['perfil']; nome: string; texto: string }[] = [
  { id: 'dono', nome: 'Dono', texto: 'Tudo, inclusive usuários, loja e PIN.' },
  { id: 'gerente', nome: 'Gerente', texto: 'Produtos, estoque, caixas e relatórios.' },
  { id: 'supervisor', nome: 'Supervisor', texto: 'Consulta estoque e valida vendas.' },
  { id: 'operador', nome: 'Operador', texto: 'Vende no caixa.' },
];

export function ErpUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [eu, setEu] = useState('');
  const [escolhido, setEscolhido] = useState<string | 'novo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const carregar = useCallback(() => {
    pedir<{ usuarios: Usuario[]; eu: string }>('GET', '/v1/erp/usuarios')
      .then((r) => {
        setUsuarios(r.usuarios);
        setEu(r.eu);
      })
      .catch((e: Error) => setAviso(e.message));
  }, []);
  useEffect(carregar, [carregar]);
  const usuario = usuarios.find((u) => u.id === escolhido);

  return (
    <div className="duas-colunas">
      <Cartao
        titulo={`Usuários (${usuarios.filter((u) => u.ativo).length} ativos)`}
        icone={<Users aria-hidden="true" />}
        acao={
          <Botao icone={<UserPlus aria-hidden="true" />} onClick={() => setEscolhido('novo')}>
            Novo usuário
          </Botao>
        }
      >
        {aviso !== null && <p className="aviso">{aviso}</p>}
        <TabelaDados
          chave={(u) => u.id}
          linhas={usuarios}
          selecionada={escolhido}
          aoEscolher={(u) => setEscolhido(u.id)}
          colunas={[
            { titulo: 'Nome', valor: (u) => u.nome, mostrar: (u) => <>{u.nome}{u.id === eu && <small className="suave"> (você)</small>}</> },
            { titulo: 'E-mail', valor: (u) => u.email },
            { titulo: 'Perfil', valor: (u) => u.perfil, mostrar: (u) => PERFIS.find((p) => p.id === u.perfil)?.nome ?? u.perfil },
            { titulo: 'Situação', valor: (u) => (u.ativo ? 'ativo' : 'desativado'), mostrar: (u) => <Chip tom={u.ativo ? 'sucesso' : 'neutro'}>{u.ativo ? 'ativo' : 'desativado'}</Chip> },
          ]}
        />
      </Cartao>
      {escolhido === 'novo' && (
        <FormularioUsuario
          key="novo"
          aoSalvar={(id) => {
            carregar();
            setEscolhido(id);
          }}
        />
      )}
      {usuario !== undefined && <FormularioUsuario key={usuario.id} usuario={usuario} ehVoce={usuario.id === eu} aoSalvar={carregar} />}
      {escolhido === null && (
        <Cartao titulo="Perfis">
          <dl className="dados">
            {PERFIS.map((p) => (
              <div key={p.id} className="linha-dado">
                <dt>{p.nome}</dt>
                <dd>{p.texto}</dd>
              </div>
            ))}
          </dl>
        </Cartao>
      )}
    </div>
  );
}

function FormularioUsuario({ usuario, ehVoce = false, aoSalvar }: { usuario?: Usuario; ehVoce?: boolean; aoSalvar: (id: string) => void }) {
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [perfil, setPerfil] = useState<Usuario['perfil']>(usuario?.perfil ?? 'operador');
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true);
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  function salvar(e: FormEvent) {
    e.preventDefault();
    const pedido =
      usuario === undefined
        ? pedir<{ id: string }>('POST', '/v1/erp/usuarios', { nome, email, perfil, senha })
        : pedir('PUT', `/v1/erp/usuarios/${usuario.id}`, { nome, perfil, ativo, ...(senha === '' ? {} : { senha }) }).then(() => ({ id: usuario.id }));
    pedido
      .then((r) => {
        setMsg({ ok: true, texto: usuario === undefined ? 'Usuário criado. Passe o e-mail e a senha para a pessoa.' : 'Alterações salvas.' });
        setSenha('');
        aoSalvar(r.id);
      })
      .catch((erro: Error) => setMsg({ ok: false, texto: erro.message }));
  }

  return (
    <Cartao titulo={usuario === undefined ? 'Novo usuário' : usuario.nome} icone={usuario === undefined ? <UserPlus aria-hidden="true" /> : <KeyRound aria-hidden="true" />}>
      <form className="formulario" onSubmit={salvar}>
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>
        <label>
          E-mail (é o login)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={usuario !== undefined} />
        </label>
        <fieldset disabled={ehVoce}>
          <legend>Perfil</legend>
          {PERFIS.map((p) => (
            <label key={p.id} className="opcao">
              <input type="radio" name="perfil" checked={perfil === p.id} onChange={() => setPerfil(p.id)} />
              <span>
                <strong>{p.nome}</strong> <small className="suave">{p.texto}</small>
              </span>
            </label>
          ))}
          {usuario !== undefined && (
            <label className="opcao">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              <span>Ativo (desmarque para tirar o acesso na hora)</span>
            </label>
          )}
          {ehVoce && <small className="suave">Você não pode mudar o seu próprio perfil nem se desativar.</small>}
        </fieldset>
        <label>
          {usuario === undefined ? 'Senha inicial' : 'Nova senha (deixe em branco para manter)'}
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required={usuario === undefined} autoComplete="new-password" placeholder="8 ou mais, com letras e números" />
        </label>
        {msg !== null && <p className={msg.ok ? 'ok' : 'aviso'}>{msg.texto}</p>}
        <Botao type="submit" icone={<Save aria-hidden="true" />}>
          {usuario === undefined ? 'Criar usuário' : 'Salvar'}
        </Botao>
      </form>
    </Cartao>
  );
}
