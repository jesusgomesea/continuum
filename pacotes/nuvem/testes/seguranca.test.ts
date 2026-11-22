// Segurança da nuvem: senhas, sessão, perfis, ativação do caixa e credencial.
import { describe, expect, it } from 'vitest';
import {
  ativarDispositivo,
  credencialConfere,
  DURACAO_DA_SESSAO_MS,
  emitirSessao,
  gerarCodigoDeAtivacao,
  hashDaSenha,
  hashDoCodigo,
  lerSessao,
  normalizarCodigo,
  pode,
  senhaAceitavel,
  senhaConfere,
  VALIDADE_DO_CODIGO_MS,
} from '../src/seguranca.ts';
import type { Dispositivo } from '../src/seguranca.ts';

const SEGREDO = 'segredo-de-teste-do-servidor';

describe('senhas', () => {
  it('ficam guardadas só como hash, e conferem', () => {
    const hash = hashDaSenha('cafe2026');
    expect(hash).not.toContain('cafe2026');
    expect(senhaConfere('cafe2026', hash)).toBe(true);
    expect(senhaConfere('cafe2027', hash)).toBe(false);
    expect(hashDaSenha('cafe2026')).not.toBe(hash); // sal diferente a cada vez
  });

  it('senha fraca é recusada com a explicação', () => {
    expect(senhaAceitavel('abc12')).toMatch(/8 caracteres/);
    expect(senhaAceitavel('somenteletras')).toMatch(/letras e números/);
    expect(senhaAceitavel('12345678')).toMatch(/letras e números/);
    expect(senhaAceitavel('cafe2026')).toBeNull();
  });
});

describe('perfis', () => {
  it('cada perfil faz só o que pode', () => {
    expect(pode('equipe', 'central.clientes')).toBe(true);
    expect(pode('dono', 'central.clientes')).toBe(false); // cliente não mexe no Central
    expect(pode('dono', 'erp.caixas.ativar')).toBe(true);
    expect(pode('operador', 'erp.produtos.editar')).toBe(false);
    expect(pode('operador', 'pdv.vender')).toBe(true);
    expect(pode('operador', 'pdv.autorizar')).toBe(false);
    expect(pode('supervisor', 'pdv.autorizar')).toBe(true);
  });
});

describe('sessão', () => {
  const sessao = { usuarioId: 'u1', clienteId: 'c1', perfil: 'dono' as const };

  it('o crachá assinado volta com os mesmos dados', () => {
    const agora = Date.now();
    const token = emitirSessao(sessao, SEGREDO, agora);
    expect(lerSessao(token, SEGREDO, agora)).toMatchObject(sessao);
  });

  it('crachá alterado, com outro segredo ou vencido não vale', () => {
    const agora = Date.now();
    const token = emitirSessao(sessao, SEGREDO, agora);
    const [corpo, assinatura] = token.split('.');
    const falso = Buffer.from(JSON.stringify({ ...sessao, perfil: 'equipe', expiraEm: agora + 1e9 })).toString('base64url');
    expect(lerSessao(`${falso}.${assinatura}`, SEGREDO, agora)).toBeNull();
    expect(lerSessao(token, 'outro-segredo', agora)).toBeNull();
    expect(lerSessao(token, SEGREDO, agora + DURACAO_DA_SESSAO_MS + 1)).toBeNull();
    expect(lerSessao(`${corpo}`, SEGREDO, agora)).toBeNull();
    expect(lerSessao('lixo.lixo', SEGREDO, agora)).toBeNull();
  });
});

describe('ativação do caixa', () => {
  function pendente(codigo: string, agora: number): Dispositivo {
    return { situacao: 'pendente', codigoAtivacaoHash: hashDoCodigo(codigo, SEGREDO), codigoExpiraEm: agora + VALIDADE_DO_CODIGO_MS, credencialHash: null };
  }

  it('o código tem o formato 4F7K-92QX, sem letras que confundem', () => {
    for (let i = 0; i < 50; i++) expect(gerarCodigoDeAtivacao()).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(normalizarCodigo(' 4f7k 92qx ')).toBe('4F7K-92QX');
    expect(normalizarCodigo('4F7K-92Q0')).toBeNull(); // o zero não existe no alfabeto
  });

  it('código certo ativa o caixa e gera a credencial; o código não vale de novo', () => {
    const agora = Date.now();
    const codigo = gerarCodigoDeAtivacao();
    const r = ativarDispositivo(pendente(codigo, agora), codigo.toLowerCase(), SEGREDO, agora);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dispositivo.situacao).toBe('ativo');
    expect(r.dispositivo.codigoAtivacaoHash).toBeNull();
    expect(credencialConfere(r.dispositivo, r.credencial)).toBe(true);
    expect(credencialConfere(r.dispositivo, 'credencial-falsa')).toBe(false);
    expect(ativarDispositivo(r.dispositivo, codigo, SEGREDO, agora)).toMatchObject({ ok: false });
  });

  it('código errado ou vencido é recusado', () => {
    const agora = Date.now();
    const codigo = '4F7K-92QX';
    expect(ativarDispositivo(pendente(codigo, agora), '4F7K-92QY', SEGREDO, agora)).toMatchObject({ ok: false, motivo: expect.stringMatching(/inválido/) });
    expect(ativarDispositivo(pendente(codigo, agora), codigo, SEGREDO, agora + VALIDADE_DO_CODIGO_MS + 1)).toMatchObject({ ok: false, motivo: expect.stringMatching(/vencido/) });
  });

  it('caixa desativado (roubo, troca) perde o acesso na hora', () => {
    const agora = Date.now();
    const codigo = gerarCodigoDeAtivacao();
    const r = ativarDispositivo(pendente(codigo, agora), codigo, SEGREDO, agora);
    if (!r.ok) throw new Error('não ativou');
    expect(credencialConfere({ ...r.dispositivo, situacao: 'desativado' }, r.credencial)).toBe(false);
  });
});
