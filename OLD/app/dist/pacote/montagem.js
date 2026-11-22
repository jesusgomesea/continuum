import path from 'node:path';
/** Versões fixas: a mesma do Node dos testes e o PostgreSQL 18 do desenvolvimento. */
export const NODE = {
    nome: 'node-v26.13.0-win-x64.zip',
    url: 'https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip',
    // Confere com https://nodejs.org/dist/v26.13.0/SHASUMS256.txt
    sha256: 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a',
};
export const POSTGRES = {
    nome: 'postgresql-18.7-1-windows-x64-binaries.zip',
    url: 'https://get.enterprisedb.com/postgresql/postgresql-18.7-1-windows-x64-binaries.zip',
    // A EDB não publica o hash: este é o do download de 17/11/2026.
    sha256: 'ead0bbc27fb678fa24dcf86b738981323042abd073c744103bf7f3aed23f9a33',
};
/**
 * Runtime do Visual C++ que o PostgreSQL do zip importa (o ICU usa msvcp140) e
 * que o zip não traz. Copiado da máquina que monta, ao lado dos binários
 * (instalação local ao aplicativo, permitida pela Microsoft).
 */
export const RUNTIME_VC = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
/** Do zip do PostgreSQL: só o servidor e as ferramentas de linha de comando. */
export function destinoPostgres(nome, pastaPostgres) {
    const m = /^pgsql\/(bin|lib|share)\/(.+)$/.exec(nome);
    if (m === null)
        return null;
    const [, pasta = '', resto = ''] = m;
    // wxWidgets e StackBuilder são do instalador gráfico; testplug é de teste.
    if (pasta === 'bin' && /^(wx.*\.dll|stackbuilder\.exe|testplug\.dll)$/i.test(resto))
        return null;
    if (/\.pdb$/i.test(resto))
        return null;
    return path.join(pastaPostgres, pasta, ...resto.split('/'));
}
//# sourceMappingURL=montagem.js.map