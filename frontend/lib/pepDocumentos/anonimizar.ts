// LGPD: o que sai para a OpenAI. Um documento da PEP traz muito mais dado
// pessoal que uma evolução (responsáveis, escola, nascimento, medicação), e a
// auditoria de evoluções só mascara dois nomes. Aqui:
//
//   1. Campos de pessoa ("Responsável:", "Escola:", "Psicóloga:", "Mãe:"…):
//      o VALOR vira "[NOME PREENCHIDO]" — a IA sabe que está preenchido,
//      sem saber o nome. Valor que é o próprio modelo ("nome do paciente",
//      "Fulano", "[nome]", "____") fica como está: é isso que ela deve apontar.
//   2. Data de nascimento → "[DATA PREENCHIDA]".
//   3. Nome do paciente (cadastro, pasta, nome do arquivo) e do analista, em
//      qualquer lugar do texto → "[PACIENTE]" / "[PROFISSIONAL]".
//   4. CPF, telefone, e-mail e números longos (carteirinha, CNS).
//
// O que NÃO dá para garantir: um nome solto no meio de uma frase ("a mãe,
// Carla, relatou…") que não está em nenhum campo nem no cadastro. Esse é o
// risco que sobra — registrado em docs/PLANO_PEP_VALIDACAO_DOCUMENTOS.md.

import { mascararNome } from '@/lib/auditoria/auditorEngine'
import { normalizar, rotuloValor, valorVazio } from './texto'

export const MARCADOR_PACIENTE = '[PACIENTE]'
export const MARCADOR_PROFISSIONAL = '[PROFISSIONAL]'
export const MARCADOR_NOME = '[NOME PREENCHIDO]'
export const MARCADOR_DATA = '[DATA PREENCHIDA]'

/** Rótulos cujo valor é nome de pessoa ou instituição. Chave normalizada, começo. */
const ROTULOS_DE_PESSOA = /^(nome|paciente|crianca|aprendiz|cliente|beneficiario|responsave(l|is)|mae|pai|genitor|cuidador|escola|instituicao|representante|professor|coordena|supervis|psicolog|analista|terapeuta|profissional|aplicador|acompanhante|at\b|medic|neuro|psiquiatra|pediatra|fonoaudiolog|terapeuta ocupacional|equipe|participante|assinatura)/

const VALOR_DO_MODELO = /^(nome( do paciente| da crianca| completo)?|paciente|responsavel|escola|fulano( de tal)?|ciclano|beltrano|x+|a definir)$/

export function anonimizarDocumento(texto: string, nomes: {
  pacientes: (string | null | undefined)[]
  profissionais: (string | null | undefined)[]
}): string {
  const linhas = texto.split('\n').map(linha => {
    const rv = rotuloValor(linha.trim())
    if (!rv || valorVazio(rv.valor)) return linha
    const valorNormal = normalizar(rv.valor)
    const doModelo = VALOR_DO_MODELO.test(valorNormal) || /[[\]_]/.test(rv.valor)
    if (doModelo) return linha
    if (/nascimento/.test(rv.chave)) return `${rv.rotulo}: ${MARCADOR_DATA}`
    if (ROTULOS_DE_PESSOA.test(rv.chave)) return `${rv.rotulo}: ${MARCADOR_NOME}`
    return linha
  })
  let saida = linhas.join('\n')
  // Nome completo antes do primeiro nome (mascararNome já faz nessa ordem).
  for (const n of nomes.pacientes) saida = mascararNome(saida, n ?? undefined, MARCADOR_PACIENTE)
  for (const n of nomes.profissionais) saida = mascararNome(saida, n ?? undefined, MARCADOR_PROFISSIONAL)
  return saida
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]')
    .replace(/(\(?\b\d{2}\)?\s?)?\b9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]')
    .replace(/\b\d{11,}\b/g, '[NUMERO]')
}
