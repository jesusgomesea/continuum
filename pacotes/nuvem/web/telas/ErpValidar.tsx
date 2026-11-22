// ERP · Validar venda pelo código (Passo 2.5, UC19): confere se um comprovante é verdadeiro.
import { formatarReais } from '@continuum/dominio';
import { Botao, Cartao, Chip } from '@continuum/interface';
import { BadgeCheck, Search } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { pedir } from '../api.ts';

type Resultado =
  | { valida: false; motivo: string }
  | {
      valida: true;
      codigo: string;
      ocorridoEm: string;
      liquidoCentavos: number;
      trocoCentavos: number;
      itens: { nome: string; quantidade: number; precoUnitarioCentavos: number }[];
      pagamentos: { forma: string; valorCentavos: number }[];
      cancelada: { motivo: string; canceladaEm: string } | null;
    };

export function ErpValidar() {
  const [codigo, setCodigo] = useState('');
  const [r, setR] = useState<Resultado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function conferir(e: FormEvent) {
    e.preventDefault();
    pedir<Resultado>('GET', `/v1/erp/vendas/validar?codigo=${encodeURIComponent(codigo)}`)
      .then((x) => {
        setR(x);
        setAviso(null);
      })
      .catch((erro: Error) => setAviso(erro.message));
  }

  return (
    <div className="duas-colunas">
      <Cartao titulo="Código do comprovante" icone={<BadgeCheck aria-hidden="true" />}>
        <form className="linha-form" onSubmit={conferir}>
          <label>
            Código (como impresso no comprovante)
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="MERCBAIRRO-10123-ABCD" required />
          </label>
          <Botao type="submit" icone={<Search aria-hidden="true" />}>
            Conferir
          </Botao>
        </form>
        {aviso !== null && <p className="aviso">{aviso}</p>}
      </Cartao>
      {r !== null &&
        (r.valida ? (
          <Cartao titulo={r.codigo} acao={<Chip tom={r.cancelada === null ? 'sucesso' : 'erro'}>{r.cancelada === null ? 'Venda verdadeira' : 'Cancelada'}</Chip>}>
            <p className="numero-grande">{formatarReais(r.liquidoCentavos)}</p>
            <p className="suave">{new Date(r.ocorridoEm).toLocaleString('pt-BR')}</p>
            {r.cancelada !== null && <p className="aviso">Cancelada (estorno): {r.cancelada.motivo}</p>}
            <table className="tabela">
              <tbody>
                {r.itens.map((i, n) => (
                  <tr key={n}>
                    <td>{i.nome}</td>
                    <td>
                      {i.quantidade} × {formatarReais(i.precoUnitarioCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="suave">
              Pago: {r.pagamentos.map((p) => `${p.forma} ${formatarReais(p.valorCentavos)}`).join(' + ')}
              {r.trocoCentavos > 0 && ` · troco ${formatarReais(r.trocoCentavos)}`}
            </p>
          </Cartao>
        ) : (
          <Cartao titulo="Não confere" acao={<Chip tom="erro">Inválido</Chip>}>
            <p>{r.motivo}</p>
          </Cartao>
        ))}
    </div>
  );
}
