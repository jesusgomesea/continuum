// Teste de queda no terminal (npm run teste-de-queda): o relatório "nada se perdeu", como no LAB do OLD.
import { rodarTesteDeQueda } from '../src/teste-de-queda.ts';

const reais = (n: number) => n.toLocaleString('pt-BR');
console.log('Continuum · Teste de queda (caixas → agente da loja)\n');
const r = await rodarTesteDeQueda({
  caixas: 3,
  vendasPorCaixa: 60,
  chanceDeFalha: 0.4,
  vendasNaQuedaTotal: 20,
  aoProgredir: (m) => console.log(`  ${m}`),
});
console.log('');
console.log(`Vendas feitas:          ${reais(r.vendas)} (${r.canceladas} canceladas por estorno)`);
console.log(`Eventos nas filas:      ${reais(r.eventos)}`);
console.log(`Falhas provocadas:      ${r.falhasProvocadas.derrubar} conexões derrubadas, ${r.falhasProvocadas['perder-resposta']} respostas perdidas, ${r.falhasProvocadas.indisponivel} "indisponível"`);
console.log(`Fila zerada em:         ${r.segundosAteEsvaziar} s depois da volta da rede`);
for (const c of r.caixas) {
  console.log(`Caixa ${c.caixa.slice(-6)}:          ${c.eventosNoCaixa} no caixa, ${c.eventosNoAgente} no agente${c.divergencias.length ? ` · ${c.divergencias.join('; ')}` : ' · igual'}`);
}
console.log('');
console.log(r.aprovado ? 'APROVADO: nada se perdeu, nada duplicou.' : 'REPROVADO: há divergências (veja acima).');
process.exit(r.aprovado ? 0 : 1);
