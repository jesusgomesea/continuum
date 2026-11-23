// Gera recursos/icone.png (256x256) e recursos/icone.ico a partir de site/logo.png, usando o Electron.
// Uso no PowerShell: $env:ICONE_ORIGEM="site/logo.png"; $env:ICONE_SAIDA="recursos"; node_modules/electron/dist/electron.exe recursos/gerar-icone.cjs
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(() => {
  try {
  const origem = process.env.ICONE_ORIGEM, saida = process.env.ICONE_SAIDA;
  const img = nativeImage.createFromPath(origem);
  const tamanhos = [256, 128, 64, 48, 32, 16];
  const pngs = tamanhos.map((t) => img.resize({ width: t, height: t, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(saida, 'icone.png'), pngs[0]);
  // ICO com as imagens em PNG dentro (formato aceito pelo Windows desde o Vista).
  const cabecalho = Buffer.alloc(6); cabecalho.writeUInt16LE(0, 0); cabecalho.writeUInt16LE(1, 2); cabecalho.writeUInt16LE(pngs.length, 4);
  let deslocamento = 6 + 16 * pngs.length;
  const entradas = pngs.map((p, i) => {
    const e = Buffer.alloc(16); const t = tamanhos[i];
    e.writeUInt8(t >= 256 ? 0 : t, 0); e.writeUInt8(t >= 256 ? 0 : t, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.length, 8); e.writeUInt32LE(deslocamento, 12); deslocamento += p.length; return e;
  });
  fs.writeFileSync(path.join(saida, 'icone.ico'), Buffer.concat([cabecalho, ...entradas, ...pngs]));
  } catch (e) { console.error(e); }
  app.exit(0);
});
