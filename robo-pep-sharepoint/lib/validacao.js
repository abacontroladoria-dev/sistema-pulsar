/**
 * Documento e nome: as três funções que decidem se um dado da planilha é
 * confiável o bastante para ir ao banco como chave de busca.
 *
 * O CPF da aba "Pacientes" é digitado à mão. Um dígito trocado quase sempre
 * quebra o dígito verificador — é a primeira barreira, antes de qualquer
 * consulta. Não é a única: um CPF errado que por acaso é válido e pertence a
 * outro paciente só é pego no banco, pela conferência de nome e de Grade.
 */

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '')

/**
 * CPF: devolve os 11 dígitos quando o verificador bate, senão null.
 *
 * Célula numérica do Excel perde o zero à esquerda (01234567890 vira
 * 1234567890), por isso completa até 11 antes de validar.
 */
function normalizarCpf(valor) {
  let d = soDigitos(valor)
  if (!d) return null
  if (d.length < 11) d = d.padStart(11, '0')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null

  const dv = (base) => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  if (dv(d.slice(0, 9)) !== Number(d[9])) return null
  if (dv(d.slice(0, 10)) !== Number(d[10])) return null
  return d
}

/** CNPJ: devolve os 14 dígitos quando o verificador bate, senão null. */
function normalizarCnpj(valor) {
  let d = soDigitos(valor)
  if (!d) return null
  if (d.length < 14) d = d.padStart(14, '0')
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return null

  const dv = (base) => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i]
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  if (dv(d.slice(0, 12)) !== Number(d[12])) return null
  if (dv(d.slice(0, 13)) !== Number(d[13])) return null
  return d
}

/**
 * Mesmo mapa de `public.normalizar_nome_paciente` (migration 20260817190000):
 * sem acento, sem pontuação, minúsculo, espaço colapsado. Aqui só serve para
 * casar a pasta com a linha da própria planilha do prestador; a comparação
 * com o cadastro do Pulsar é feita no banco, pela função oficial.
 */
function normalizarNome(nome) {
  const s = String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return s || null
}

module.exports = { normalizarCpf, normalizarCnpj, normalizarNome, soDigitos }
