import type { StatusRiscoEvolucao } from './auditoriaEvolucoes'

/**
 * Critérios da auditoria de evoluções — a régua que o setor terapêutico calibra.
 *
 * DIVISÃO FUNDAMENTAL desta feature: o que está aqui é CONTEÚDO (editável por
 * humano); o schema JSON da resposta da IA é CONTRATO (constante em prompts.ts,
 * nunca vem do banco). Se o contrato virasse conteúdo, uma edição inocente
 * quebraria o parser.
 */

/**
 * As 4 chaves do checklist são CONGELADAS: existem em ChecklistPerguntas, na
 * coluna `checklist_perguntas` (jsonb) e no schema que a IA devolve. Mudar para
 * 5 perguntas é alteração de código, não de configuração — por isso a UI edita
 * rótulo e descrição, nunca a chave.
 */
export const CHAVES_PILARES = ['chegou', 'objetivo', 'recursos', 'reacao_saida'] as const
export type ChavePilar = (typeof CHAVES_PILARES)[number]

/**
 * Congeladas pelo CHECK de `auditoria_evolucoes.status_risco`. Editável é só a
 * descrição de cada uma — ou seja, ONDE fica a fronteira entre elas.
 */
export const CHAVES_STATUS_RISCO = ['sem_risco', 'risco_especifico', 'risco_relevante'] as const

export interface PilarCriterio {
  chave: ChavePilar
  /** Rótulo curto, usado na UI do checklist. Ex.: "Estado na chegada". */
  rotulo: string
  /** O que a IA deve procurar no texto para considerar o pilar atendido. */
  descricao: string
}

export interface RegraEspecifica {
  titulo: string
  texto: string
}

export interface GrupoTermosProibidos {
  categoria: string
  termos: string[]
}

export interface DescricaoStatusRisco {
  chave: StatusRiscoEvolucao
  descricao: string
}

export interface CriteriosAuditoria {
  /** Parágrafo que abre o system prompt e define o papel da IA. */
  abertura: string
  conferencia_estrutural: string[]
  pilares: PilarCriterio[]
  regras_especificas: RegraEspecifica[]
  termos_proibidos: GrupoTermosProibidos[]
  status_risco: DescricaoStatusRisco[]
}

/** Uma linha de `auditoria_criterios_versoes` — append-only, nunca sofre UPDATE. */
export interface VersaoCriteriosAuditoria {
  id: string
  versao: number
  conteudo: CriteriosAuditoria
  publicado_por: string | null
  publicado_por_nome: string
  publicado_em: string
  nota_publicacao: string | null
}
