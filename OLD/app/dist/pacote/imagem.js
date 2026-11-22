import { crc32, deflateSync, inflateSync } from 'node:zlib';
export class PngNaoSuportadoError extends Error {
    constructor(motivo) {
        super(`PNG não suportado: ${motivo}`);
        this.name = 'PngNaoSuportadoError';
    }
}
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function lerPng(arquivo) {
    if (!arquivo.subarray(0, 8).equals(ASSINATURA_PNG))
        throw new PngNaoSuportadoError('não é um PNG');
    let largura = 0;
    let altura = 0;
    let canais = 3;
    const idat = [];
    for (let p = 8; p < arquivo.length;) {
        const tamanho = arquivo.readUInt32BE(p);
        const tipo = arquivo.toString('ascii', p + 4, p + 8);
        const dados = arquivo.subarray(p + 8, p + 8 + tamanho);
        if (tipo === 'IHDR') {
            largura = dados.readUInt32BE(0);
            altura = dados.readUInt32BE(4);
            const [profundidade, tipoCor, , , entrelacado] = [dados[8], dados[9], dados[10], dados[11], dados[12]];
            if (profundidade !== 8)
                throw new PngNaoSuportadoError(`${profundidade} bits por canal (só 8)`);
            if (tipoCor !== 2 && tipoCor !== 6)
                throw new PngNaoSuportadoError(`tipo de cor ${tipoCor} (só RGB e RGBA)`);
            if (entrelacado !== 0)
                throw new PngNaoSuportadoError('entrelaçado');
            canais = tipoCor === 6 ? 4 : 3;
        }
        else if (tipo === 'IDAT') {
            idat.push(dados);
        }
        else if (tipo === 'IEND') {
            break;
        }
        p += 12 + tamanho;
    }
    const filtrado = inflateSync(Buffer.concat(idat));
    const linha = largura * canais;
    const pixels = new Uint8Array(linha * altura);
    for (let y = 0; y < altura; y++) {
        const filtro = filtrado[y * (linha + 1)];
        const origem = y * (linha + 1) + 1;
        const destino = y * linha;
        for (let x = 0; x < linha; x++) {
            const bruto = filtrado[origem + x] ?? 0;
            const a = x >= canais ? (pixels[destino + x - canais] ?? 0) : 0;
            const b = y > 0 ? (pixels[destino - linha + x] ?? 0) : 0;
            const c = x >= canais && y > 0 ? (pixels[destino - linha + x - canais] ?? 0) : 0;
            const previsto = filtro === 0 ? 0 : filtro === 1 ? a : filtro === 2 ? b : filtro === 3 ? (a + b) >> 1 : filtro === 4 ? paeth(a, b, c) : -1;
            if (previsto < 0)
                throw new PngNaoSuportadoError(`filtro ${filtro} na linha ${y}`);
            pixels[destino + x] = (bruto + previsto) & 0xff;
        }
    }
    return { largura, altura, canais, pixels };
}
/** Pesos de cada pixel de origem para cada pixel de destino (média por área). */
function pesos(origem, destino) {
    const escala = origem / destino;
    return Array.from({ length: destino }, (_, d) => {
        const inicio = d * escala;
        const fim = inicio + escala;
        const lista = [];
        for (let s = Math.floor(inicio); s < Math.min(Math.ceil(fim), origem); s++) {
            const cobertura = Math.min(fim, s + 1) - Math.max(inicio, s);
            if (cobertura > 0)
                lista.push([s, cobertura / escala]);
        }
        return lista;
    });
}
/** Reduz para `largura` (a altura acompanha a proporção), pela média da área: sem serrilhado. */
export function reduzir(imagem, largura) {
    const altura = Math.max(1, Math.round((imagem.altura * largura) / imagem.largura));
    const { canais } = imagem;
    const px = pesos(imagem.largura, largura);
    const py = pesos(imagem.altura, altura);
    const horizontal = new Float64Array(largura * imagem.altura * canais);
    for (let y = 0; y < imagem.altura; y++) {
        for (let x = 0; x < largura; x++) {
            for (const [s, w] of px[x] ?? []) {
                for (let c = 0; c < canais; c++) {
                    horizontal[(y * largura + x) * canais + c] += (imagem.pixels[(y * imagem.largura + s) * canais + c] ?? 0) * w;
                }
            }
        }
    }
    const pixels = new Uint8Array(largura * altura * canais);
    for (let y = 0; y < altura; y++) {
        for (let x = 0; x < largura; x++) {
            for (let c = 0; c < canais; c++) {
                let soma = 0;
                for (const [s, w] of py[y] ?? [])
                    soma += (horizontal[(s * largura + x) * canais + c] ?? 0) * w;
                pixels[(y * largura + x) * canais + c] = Math.min(255, Math.max(0, Math.round(soma)));
            }
        }
    }
    return { largura, altura, canais, pixels };
}
/** Acrescenta o canal alfa (opaco), que o ícone do Windows espera. */
export function comAlfa(imagem) {
    if (imagem.canais === 4)
        return imagem;
    const pixels = new Uint8Array(imagem.largura * imagem.altura * 4);
    for (let i = 0, j = 0; i < imagem.pixels.length; i += 3, j += 4) {
        pixels[j] = imagem.pixels[i] ?? 0;
        pixels[j + 1] = imagem.pixels[i + 1] ?? 0;
        pixels[j + 2] = imagem.pixels[i + 2] ?? 0;
        pixels[j + 3] = 255;
    }
    return { ...imagem, canais: 4, pixels };
}
function bloco(tipo, dados) {
    const cabecalho = Buffer.alloc(8);
    cabecalho.writeUInt32BE(dados.length, 0);
    cabecalho.write(tipo, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([cabecalho.subarray(4), dados])) >>> 0, 0);
    return Buffer.concat([cabecalho, dados, crc]);
}
export function escreverPng(imagem) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(imagem.largura, 0);
    ihdr.writeUInt32BE(imagem.altura, 4);
    ihdr[8] = 8;
    ihdr[9] = imagem.canais === 4 ? 6 : 2;
    const linha = imagem.largura * imagem.canais;
    const filtrado = Buffer.alloc((linha + 1) * imagem.altura);
    for (let y = 0; y < imagem.altura; y++) {
        // Filtro "sub" (1): diferença para o pixel à esquerda, que comprime melhor que nenhum.
        filtrado[y * (linha + 1)] = 1;
        for (let x = 0; x < linha; x++) {
            const atual = imagem.pixels[y * linha + x] ?? 0;
            const esquerda = x >= imagem.canais ? (imagem.pixels[y * linha + x - imagem.canais] ?? 0) : 0;
            filtrado[y * (linha + 1) + 1 + x] = (atual - esquerda) & 0xff;
        }
    }
    return Buffer.concat([
        ASSINATURA_PNG,
        bloco('IHDR', ihdr),
        bloco('IDAT', deflateSync(filtrado, { level: 9 })),
        bloco('IEND', Buffer.alloc(0)),
    ]);
}
/** Lado do logo do painel (favicon e topo): nítido em tela com zoom de 200%. */
export const LADO_LOGO_PAINEL = 64;
/** Tamanhos do ícone do Windows (explorador, barra de tarefas, Alt+Tab, telas com zoom). */
export const LADOS_ICONE = [16, 24, 32, 48, 64, 128, 256];
/**
 * Um .ico com uma imagem PNG por tamanho (formato aceito desde o Windows Vista),
 * a partir de uma imagem quadrada de pelo menos 256 px.
 */
export function montarIco(imagem) {
    if (imagem.largura !== imagem.altura || imagem.largura < 256) {
        throw new PngNaoSuportadoError(`o ícone precisa de uma imagem quadrada de 256 px ou mais (recebida ${imagem.largura}×${imagem.altura})`);
    }
    const pngs = LADOS_ICONE.map((lado) => escreverPng(comAlfa(reduzir(imagem, lado))));
    const cabecalho = Buffer.alloc(6 + 16 * pngs.length);
    cabecalho.writeUInt16LE(0, 0);
    cabecalho.writeUInt16LE(1, 2); // 1 = ícone
    cabecalho.writeUInt16LE(pngs.length, 4);
    let deslocamento = cabecalho.length;
    pngs.forEach((png, i) => {
        const lado = LADOS_ICONE[i] ?? 0;
        const p = 6 + 16 * i;
        cabecalho[p] = lado >= 256 ? 0 : lado; // 0 quer dizer 256
        cabecalho[p + 1] = lado >= 256 ? 0 : lado;
        cabecalho.writeUInt16LE(1, p + 4); // planos
        cabecalho.writeUInt16LE(32, p + 6); // bits por pixel
        cabecalho.writeUInt32LE(png.length, p + 8);
        cabecalho.writeUInt32LE(deslocamento, p + 12);
        deslocamento += png.length;
    });
    return Buffer.concat([cabecalho, ...pngs]);
}
//# sourceMappingURL=imagem.js.map