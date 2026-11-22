import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
export class ZipNaoSuportadoError extends Error {
    constructor(arquivo, motivo) {
        super(`${arquivo}: ${motivo}`);
        this.name = 'ZipNaoSuportadoError';
    }
}
const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;
const LIMITE_32 = 0xffffffff;
function ler(fd, posicao, tamanho) {
    const buffer = Buffer.alloc(tamanho);
    let lidos = 0;
    while (lidos < tamanho) {
        const n = readSync(fd, buffer, lidos, tamanho - lidos, posicao + lidos);
        if (n === 0)
            break;
        lidos += n;
    }
    return buffer.subarray(0, lidos);
}
/** Lista as entradas pelo diretório central (o fim do arquivo). */
export function listarZip(arquivo) {
    const fd = openSync(arquivo, 'r');
    try {
        const tamanho = statSync(arquivo).size;
        // O registro de fim tem 22 bytes mais um comentário de até 65.535.
        const cauda = ler(fd, Math.max(0, tamanho - 22 - 65_535), Math.min(tamanho, 22 + 65_535));
        let fim = -1;
        for (let i = cauda.length - 22; i >= 0; i--) {
            if (cauda.readUInt32LE(i) === ASSINATURA_FIM) {
                fim = i;
                break;
            }
        }
        if (fim < 0)
            throw new ZipNaoSuportadoError(arquivo, 'não é um zip (registro de fim não encontrado)');
        const total = cauda.readUInt16LE(fim + 10);
        const tamanhoCentral = cauda.readUInt32LE(fim + 12);
        const inicioCentral = cauda.readUInt32LE(fim + 16);
        if (total === 0xffff || inicioCentral === LIMITE_32)
            throw new ZipNaoSuportadoError(arquivo, 'zip64 não suportado');
        const central = ler(fd, inicioCentral, tamanhoCentral);
        const entradas = [];
        let p = 0;
        for (let i = 0; i < total; i++) {
            if (central.readUInt32LE(p) !== ASSINATURA_CENTRAL)
                throw new ZipNaoSuportadoError(arquivo, 'diretório central corrompido');
            const tamanhoNome = central.readUInt16LE(p + 28);
            const tamanhoExtra = central.readUInt16LE(p + 30);
            const tamanhoComentario = central.readUInt16LE(p + 32);
            entradas.push({
                nome: central.toString('utf8', p + 46, p + 46 + tamanhoNome),
                metodo: central.readUInt16LE(p + 10),
                crc: central.readUInt32LE(p + 16),
                tamanhoCompactado: central.readUInt32LE(p + 20),
                tamanho: central.readUInt32LE(p + 24),
                deslocamento: central.readUInt32LE(p + 42),
            });
            p += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
        }
        return entradas;
    }
    finally {
        closeSync(fd);
    }
}
/** Conteúdo de uma entrada, conferido pelo CRC-32. */
export function lerEntrada(arquivo, entrada) {
    const fd = openSync(arquivo, 'r');
    try {
        const local = ler(fd, entrada.deslocamento, 30);
        if (local.readUInt32LE(0) !== ASSINATURA_LOCAL)
            throw new ZipNaoSuportadoError(arquivo, `cabeçalho local inválido em ${entrada.nome}`);
        const inicio = entrada.deslocamento + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        const compactado = ler(fd, inicio, entrada.tamanhoCompactado);
        let dados;
        if (entrada.metodo === 0)
            dados = compactado;
        else if (entrada.metodo === 8)
            dados = inflateRawSync(compactado);
        else
            throw new ZipNaoSuportadoError(arquivo, `método ${entrada.metodo} não suportado em ${entrada.nome}`);
        if (dados.length !== entrada.tamanho || crc32(dados) >>> 0 !== entrada.crc) {
            throw new ZipNaoSuportadoError(arquivo, `${entrada.nome} corrompido (tamanho ou CRC não confere)`);
        }
        return dados;
    }
    finally {
        closeSync(fd);
    }
}
/**
 * Extrai as entradas cujo nome passa no filtro; `destinoDe` diz onde gravar
 * cada uma (null pula). Recusa nomes que escapariam da pasta (`..`).
 */
export function extrairZip(arquivo, destinoDe) {
    let extraidos = 0;
    for (const entrada of listarZip(arquivo)) {
        if (entrada.nome.endsWith('/'))
            continue;
        if (entrada.nome.split('/').includes('..'))
            throw new ZipNaoSuportadoError(arquivo, `caminho inseguro: ${entrada.nome}`);
        const destino = destinoDe(entrada.nome);
        if (destino === null)
            continue;
        mkdirSync(path.dirname(destino), { recursive: true });
        const dados = lerEntrada(arquivo, entrada);
        const fd = openSync(destino, 'w');
        try {
            writeSync(fd, dados);
        }
        finally {
            closeSync(fd);
        }
        extraidos++;
    }
    return extraidos;
}
function arquivosDe(pasta) {
    const lista = [];
    for (const item of readdirSync(pasta, { withFileTypes: true })) {
        const caminho = path.join(pasta, item.name);
        if (item.isDirectory())
            lista.push(...arquivosDe(caminho));
        else if (item.isFile())
            lista.push(caminho);
    }
    return lista.sort();
}
/** Data e hora no formato do DOS, usado pelo zip. */
function dataDos(data) {
    return {
        hora: (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2),
        dia: ((Math.max(data.getFullYear(), 1980) - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
    };
}
/**
 * Compacta a pasta inteira num zip; dentro dele, tudo fica sob `prefixo/`.
 * Devolve quantas entradas gravou.
 */
export function escreverZip(pasta, arquivo, prefixo) {
    const arquivos = arquivosDe(pasta);
    if (arquivos.length >= 0xffff)
        throw new ZipNaoSuportadoError(arquivo, 'entradas demais para zip sem zip64');
    const fd = openSync(arquivo, 'w');
    const centrais = [];
    let posicao = 0;
    const escrever = (buffer) => {
        writeSync(fd, buffer);
        posicao += buffer.length;
    };
    try {
        for (const caminho of arquivos) {
            const nome = Buffer.from(`${prefixo}/${path.relative(pasta, caminho).split(path.sep).join('/')}`, 'utf8');
            const dados = readFileSync(caminho);
            const compactado = deflateRawSync(dados, { level: 9 });
            const [metodo, corpo] = compactado.length < dados.length ? [8, compactado] : [0, dados];
            const crc = crc32(dados) >>> 0;
            const { hora, dia } = dataDos(statSync(caminho).mtime);
            if (posicao >= LIMITE_32 || dados.length >= LIMITE_32)
                throw new ZipNaoSuportadoError(arquivo, 'passou de 4 GB: zip64 não suportado');
            const local = Buffer.alloc(30);
            local.writeUInt32LE(ASSINATURA_LOCAL, 0);
            local.writeUInt16LE(20, 4); // versão necessária: 2.0
            local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
            local.writeUInt16LE(metodo, 8);
            local.writeUInt16LE(hora, 10);
            local.writeUInt16LE(dia, 12);
            local.writeUInt32LE(crc, 14);
            local.writeUInt32LE(corpo.length, 18);
            local.writeUInt32LE(dados.length, 22);
            local.writeUInt16LE(nome.length, 26);
            local.writeUInt16LE(0, 28);
            const central = Buffer.alloc(46);
            central.writeUInt32LE(ASSINATURA_CENTRAL, 0);
            central.writeUInt16LE(20, 4);
            central.writeUInt16LE(20, 6);
            central.writeUInt16LE(0x0800, 8);
            central.writeUInt16LE(metodo, 10);
            central.writeUInt16LE(hora, 12);
            central.writeUInt16LE(dia, 14);
            central.writeUInt32LE(crc, 16);
            central.writeUInt32LE(corpo.length, 20);
            central.writeUInt32LE(dados.length, 24);
            central.writeUInt16LE(nome.length, 28);
            central.writeUInt32LE(posicao, 42);
            centrais.push(central, nome);
            escrever(local);
            escrever(nome);
            escrever(corpo);
        }
        const inicioCentral = posicao;
        for (const parte of centrais)
            escrever(parte);
        const fim = Buffer.alloc(22);
        fim.writeUInt32LE(ASSINATURA_FIM, 0);
        fim.writeUInt16LE(arquivos.length, 8);
        fim.writeUInt16LE(arquivos.length, 10);
        fim.writeUInt32LE(posicao - inicioCentral, 12);
        fim.writeUInt32LE(inicioCentral, 16);
        escrever(fim);
    }
    finally {
        closeSync(fd);
    }
    return arquivos.length;
}
//# sourceMappingURL=zip.js.map