// Etapa 1 da Auditoria de Documentos PEP: o NOME do arquivo (15/10/2026).
// A regra é a do banco (sp_pep_ler_nome_padrao + sp_pep_aplicar_padrao, em
// sp_pep_itens.padrao/padrao_motivo), espelhada em lib/roboSharepoint/padraoNome.ts:
//
//   Geral (STC, ETC) ........ SIGLA-NN-MMAAAA            STC-01-092026
//   Paciente ................ SIGLA-PACIENTE-MMAAAA      PIC-JOAO SILVA-092026
//   TAP (quinzenal) ......... TAP-NN-PACIENTE-MMAAAA     TAP-01-JOAO SILVA-092026
//   Reprogramação ........... REP-SIGLA-PACIENTE-MMAAAA  REP-PIC-JOAO SILVA-092026
//
// Sem o motivo gravado (lista antiga), recalcula com a mesma regra em TS.

import { lerNomePadrao } from '@/lib/roboSharepoint/padraoNome'
import { MOTIVOS_PADRAO, nomeEsperado } from '@/lib/roboSharepoint/rotulos'

export type EstadoNome = 'ok' | 'fora' | 'repetido' | 'rep' | 'sem'

export type ItemParaNome = {
  nome: string
  sigla: string | null
  competencia: string | null
  paciente_nome: string | null
  paciente_pasta_nome?: string | null
  padrao: string | null
  padrao_motivo?: string | null
  nome_seq?: string | null
}

export type SituacaoNome = {
  estado: EstadoNome
  /** Código do motivo (MOTIVOS_PADRAO), quando fora do padrão. */
  motivo: string | null
  /** O motivo em uma frase. */
  texto: string
  /** O nome que o arquivo deveria ter (quando fora do padrão ou repetido). */
  esperado: string | null
}

const GERAL = new Set(['STC', 'ETC'])

export function situacaoNome(item: ItemParaNome): SituacaoNome {
  const sigla = (item.sigla ?? '').toUpperCase()
  const tipo = GERAL.has(sigla) ? 'GERAL' : 'POR_PACIENTE'
  const paciente = item.paciente_nome ?? item.paciente_pasta_nome ?? null
  const seq = Number(item.nome_seq ?? 1) || 1
  const esperado = () => nomeEsperado(sigla || null, tipo === 'GERAL' ? null : paciente, item.competencia, seq)

  switch (item.padrao) {
    case 'ok':
      return { estado: 'ok', motivo: null, texto: 'Segue o modelo de nome', esperado: null }
    case 'rep':
      return { estado: 'rep', motivo: null, texto: 'Reprogramação (REP-): registre na matriz semestral', esperado: null }
    case 'duplicado':
      return { estado: 'repetido', motivo: 'repetido', texto: MOTIVOS_PADRAO.repetido, esperado: esperado() }
    case 'fora': {
      const motivo = item.padrao_motivo ?? lerNomePadrao(item.nome, sigla, tipo).erro ?? 'formato_desconhecido'
      return { estado: 'fora', motivo, texto: MOTIVOS_PADRAO[motivo] ?? 'Nome fora do padrão', esperado: esperado() }
    }
    default:
      return { estado: 'sem', motivo: null, texto: 'O robô ainda não conferiu o nome', esperado: null }
  }
}
