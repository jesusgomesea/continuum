import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escreverPng, LADO_LOGO_PAINEL, lerPng, reduzir } from '../pacote/imagem.js';
/**
 * `npm run logo`: gera o src/painel/logo.png (favicon e logo do topo do painel)
 * a partir do assets/logo.png, em tamanho pequeno para servir do LAB sem
 * internet (ADR 013). Rodar de novo quando o logo mudar; o teste
 * test/pacote/imagem.test.ts confere que os dois estão em sincronia.
 */
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const origem = path.join(raiz, 'assets', 'logo.png');
const destino = path.join(raiz, 'src', 'painel', 'logo.png');
const png = escreverPng(reduzir(lerPng(readFileSync(origem)), LADO_LOGO_PAINEL));
writeFileSync(destino, png);
process.stdout.write(`${destino}: ${LADO_LOGO_PAINEL}×${LADO_LOGO_PAINEL}, ${png.length} bytes\n`);
//# sourceMappingURL=logo.js.map