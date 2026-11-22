// "Venda finalizada": aparece por cima da tela de venda com o código do comprovante, o total,
// os pagamentos e o troco em destaque (o que o operador precisa devolver ao cliente).
import type { Venda } from '@continuum/dominio';
import { Botao } from '@continuum/interface';
import { CircleCheck } from 'lucide-react';
import { useEffect } from 'react';
import { NOMES_FORMA, reais } from '../comum.tsx';

export function VendaFinalizada({ venda, aoFechar }: { venda: Venda; aoFechar: () => void }) {
  // Enter ou Esc fecham e voltam para uma nova venda.
  useEffect(() => {
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aoFechar]);

  return (
    <div className="fundo-modal">
      <section className="painel finalizada" role="dialog" aria-modal="true" aria-labelledby="titulo-finalizada">
        <header>
          <CircleCheck aria-hidden="true" className="icone-ok" />
          <h2 id="titulo-finalizada">Venda finalizada</h2>
        </header>
        <p className="codigo-grande" data-testid="codigo-venda">
          {venda.codigo}
        </p>
        <p className="total-grande">{reais(venda.liquidoCentavos)}</p>
        <dl className="totais">
          {venda.descontoCentavos > 0 && (
            <div>
              <dt>Desconto</dt>
              <dd>{reais(venda.descontoCentavos)}</dd>
            </div>
          )}
          {venda.pagamentos.map((p) => (
            <div key={p.id}>
              <dt>{NOMES_FORMA[p.forma]}</dt>
              <dd>{reais(p.valorCentavos)}</dd>
            </div>
          ))}
          <div className="troco-grande">
            <dt>Troco</dt>
            <dd data-testid="troco">{reais(venda.trocoCentavos)}</dd>
          </div>
        </dl>
        <p className="suave">Gravada no caixa. Segue para a loja e a nuvem pela fila, mesmo sem internet agora.</p>
        <Botao largo onClick={aoFechar} autoFocus>
          Nova venda (Enter)
        </Botao>
      </section>
    </div>
  );
}
