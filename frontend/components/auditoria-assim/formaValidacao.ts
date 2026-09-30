/**
 * Formas de validação da presença do beneficiário na ASSIM. A recepção escolhe
 * no modal do robô (`OPCOES_VALIDACAO` em robo-autorizador/rpa.js) e o texto
 * chega literal em `fila_autorizacoes.forma_autorizacao`.
 *
 * Duas delas deixam papel para conferir depois: o token (filipeta) e o erro de
 * reconhecimento facial. Daí a conferência valer para as duas.
 */

export const LABEL_ERRO_FACIAL = 'Erro no Reconhecimento Facial'

/** Texto de sucesso genérico da auditoria — o único que a forma substitui. */
export const OBS_CONFIRMADA = 'Autorização confirmada pela ASSIM'

/** Tolerante a acento e caixa: não depende de como a opção foi gravada. */
export function erroReconhecimentoFacial(forma: string | null | undefined) {
  return /reconhecimento\s+facial/i.test(forma ?? '')
}

/** `3-BENEFICIARIO SEM CELULAR`: também sai papel sem número (20260930100000). */
export const LABEL_SEM_CELULAR = 'Beneficiário sem celular'

export function beneficiarioSemCelularForma(forma: string | null | undefined) {
  return /sem\s+celular/i.test(forma ?? '')
}

/**
 * De-para de EXIBIÇÃO da forma de validação. Só troca a palavra na tela — o
 * valor gravado continua o de `OPCOES_VALIDACAO` (rpa.js:407-414).
 *
 * Por que não renomear na origem: 'Biometria' está em 4.264 linhas de
 * `fila_autorizacoes` e é escrito por duas fontes independentes — o modal do
 * robô (a recepção escolhe da lista) e `forma_validacao_do_biofacial()`, que
 * foi construída para devolver EXATAMENTE os rótulos daquela lista. Renomear
 * ali obrigaria a um UPDATE de retroativo + deploy do rpa.js nas 11 máquinas da
 * frota, e deixaria o banco com dois nomes para o mesmo fato durante a
 * transição. A tela é o único lugar onde o nome precisa ser mais claro.
 *
 * Quem casa por TEXTO não passa por aqui, de propósito: `get_tokens_mensal`
 * filtra `forma_autorizacao ILIKE '%reconhecimento facial%'` no SQL, e
 * `erroReconhecimentoFacial` acima testa o valor cru. Este de-para é a última
 * milha, aplicada na renderização.
 */
const ROTULO_EXIBICAO: Record<string, string> = {
  Biometria: 'Biometria Facial',
}

/** Rótulo para mostrar ao operador. Valor desconhecido passa intacto. */
export function rotuloForma(forma: string | null | undefined): string | null {
  if (!forma) return null
  const chave = forma.trim()
  return ROTULO_EXIBICAO[chave] ?? chave
}
