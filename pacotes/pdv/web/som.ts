// Som curto de confirmação ("bip") ao lançar um item, gerado na hora com Web Audio: nenhum arquivo
// de áudio, nada baixado. O operador pode desligar; a escolha fica guardada neste computador
// (localStorage). Se o navegador bloquear o localStorage ou o áudio, o caixa segue normalmente, sem som.

const CHAVE = 'continuum.pdv.som';

let contexto: AudioContext | null = null;

/** O som está ligado? (padrão: ligado). */
export function somLigado(): boolean {
  try {
    return window.localStorage.getItem(CHAVE) !== 'desligado';
  } catch {
    return true;
  }
}

export function guardarSom(ligado: boolean): void {
  try {
    window.localStorage.setItem(CHAVE, ligado ? 'ligado' : 'desligado');
  } catch {
    // sem localStorage: vale só até fechar a tela
  }
}

/** Toca o bip: 1 tom curto (agudo = item lançado; grave = recusa). */
export function bip(tipo: 'ok' | 'erro' = 'ok'): void {
  if (!somLigado()) return;
  try {
    contexto ??= new AudioContext();
    const agora = contexto.currentTime;
    const oscilador = contexto.createOscillator();
    const volume = contexto.createGain();
    oscilador.type = tipo === 'ok' ? 'sine' : 'square';
    oscilador.frequency.value = tipo === 'ok' ? 1320 : 220;
    const duracao = tipo === 'ok' ? 0.08 : 0.18;
    // Sobe e desce rápido o volume: sem o "clique" de ligar e desligar o som de uma vez.
    volume.gain.setValueAtTime(0.0001, agora);
    volume.gain.exponentialRampToValueAtTime(0.15, agora + 0.01);
    volume.gain.exponentialRampToValueAtTime(0.0001, agora + duracao);
    oscilador.connect(volume).connect(contexto.destination);
    oscilador.start(agora);
    oscilador.stop(agora + duracao + 0.02);
  } catch {
    // navegador sem áudio: segue sem som
  }
}
