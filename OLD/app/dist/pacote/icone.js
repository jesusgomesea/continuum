import { readFileSync, writeFileSync } from 'node:fs';
import * as ResEdit from 'resedit';
/**
 * Troca o ícone de um .exe do Windows (ADR 014). Usado só na montagem do
 * pacote, numa cópia do node.exe, antes de gerar o lançador com --build-sea:
 * o executável único herda o ícone do node.exe que o gera. Dependência de
 * desenvolvimento aprovada para isso: resedit (MIT), JavaScript puro.
 */
export function trocarIcone(exe, ico) {
    // O node.exe oficial é assinado; a assinatura deixa de valer com qualquer mudança
    // (o --build-sea já a invalidaria), então é descartada.
    const executavel = ResEdit.NtExecutable.from(readFileSync(exe), { ignoreCert: true });
    const recursos = ResEdit.NtExecutableResource.from(executavel);
    const grupos = ResEdit.Resource.IconGroupEntry.fromEntries(recursos.entries);
    const grupo = grupos[0];
    if (grupo === undefined)
        throw new Error(`${exe} não tem grupo de ícones para trocar`);
    const icones = ResEdit.Data.IconFile.from(ico).icons.map((item) => item.data);
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(recursos.entries, grupo.id, grupo.lang, icones);
    recursos.outputResource(executavel);
    writeFileSync(exe, Buffer.from(executavel.generate()));
}
//# sourceMappingURL=icone.js.map