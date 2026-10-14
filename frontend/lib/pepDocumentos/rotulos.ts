import type { Tone } from '@/hooks/useToneColor'
import type { EstadoNome } from './nome'
import type { SituacaoAuditoria } from './situacao'
import type { RelacaoSemelhanca, RevisaoStatus, Veredito } from './tipos'

// Texto humano da conferência do conteúdo. Um lugar só: tela PEP, painel do
// robô e PDF falam a mesma língua.

export const VEREDITO: Record<Veredito | 'aguardando', { rotulo: string; explica: string }> = {
  bom: { rotulo: 'Está bom', explica: 'Passou em todas as conferências' },
  pode_conter_erros: { rotulo: 'Pode conter erros', explica: 'Algo suspeito: precisa de olho humano' },
  errado: { rotulo: 'Está errado', explica: 'Erro comprovado pelo trecho do documento' },
  ilegivel: { rotulo: 'Não foi possível ler', explica: 'O robô não conseguiu ler o texto: confira à mão' },
  aguardando: { rotulo: 'Aguardando leitura', explica: 'O robô ainda não leu este documento, ou a análise está na fila' },
}

/** Por que o robô não leu o texto (sp_pep_documentos.extracao_status). */
export const EXTRACAO_STATUS: Record<string, string> = {
  ok: 'Lido',
  sem_texto: 'PDF escaneado (imagem), sem texto',
  protegido: 'Arquivo com senha',
  corrompido: 'Arquivo corrompido',
  formato_nao_suportado: 'Formato que o robô não lê',
  grande_demais: 'Arquivo grande demais',
  erro: 'Falha ao ler (tenta de novo amanhã)',
}

export const RELACAO: Record<RelacaoSemelhanca, string> = {
  outro_paciente: 'de outro paciente',
  mesmo_paciente_outro_mes: 'do mesmo paciente, em outro mês',
  mesmo_mes: 'do mesmo mês',
  outro_mes: 'de outro mês',
  outro_prestador: 'de outro prestador',
  outro_item: 'de outro item do PEP',
}

export const REVISAO: Record<RevisaoStatus, string> = {
  pendente: 'Ninguém revisou',
  problema_confirmado: 'Problema confirmado',
  falso_positivo: 'Alarme falso',
  corrigido: 'Corrigido',
}

/** Siglas com régua de conteúdo para a IA (recebidas em 14/10/2026). */
export const SIGLAS_COM_REGUA = ['OE', 'ETC', 'PIC'] as const

// ── Auditoria de Documentos PEP (15/10/2026) ──────────────────────────────────

/** Situação na tela de auditoria (situacao.ts), em palavras. */
export const SITUACAO: Record<SituacaoAuditoria, { rotulo: string; explica: string }> = {
  nao_auditado: { rotulo: 'Lido, não auditado', explica: 'O robô leu o texto; ninguém pediu a auditoria ainda' },
  na_fila: { rotulo: 'Na fila', explica: 'Auditoria pedida: aparece em alguns minutos' },
  falhou: { rotulo: 'Auditoria falhou', explica: 'Algo deu errado ao auditar: peça de novo' },
  ilegivel: { rotulo: 'Não foi possível ler', explica: 'O robô não conseguiu ler o texto: confira à mão' },
  bom: { rotulo: 'Está bom', explica: 'Passou em todas as conferências' },
  pode_conter_erros: { rotulo: 'Pode conter erros', explica: 'Algo suspeito: precisa de olho humano' },
  errado: { rotulo: 'Está errado', explica: 'Erro comprovado pelo trecho do documento' },
}

/** Um tom = um significado (padrão da Auditoria de Evoluções, vocabulario.tsx). */
export const TOM_SITUACAO: Record<SituacaoAuditoria, Tone> = {
  nao_auditado: 'gray',
  na_fila: 'blue',
  falhou: 'purple',
  ilegivel: 'gray',
  bom: 'green',
  pode_conter_erros: 'amber',
  errado: 'red',
}

/** Ordem de leitura: o que pede ação primeiro. */
export const ORDEM_SITUACAO: SituacaoAuditoria[] = ['errado', 'pode_conter_erros', 'falhou', 'na_fila', 'nao_auditado', 'ilegivel', 'bom']

export const SIGLAS_PEP = ['STC', 'ETC', 'TAP', 'TOP', 'PIC', 'RT', 'OE'] as const

/** Nome de cada documento do PEP. */
export const NOMES_DOCUMENTO_PEP: Record<string, string> = {
  STC: 'Supervisão Técnica ABA do Caso (STC)',
  ETC: 'Estudo Técnico de Caso (ETC)',
  TAP: 'Treinamento de Aplicadores ABA (TAP)',
  TOP: 'Treinamento e Orientação Parental (TOP)',
  PIC: 'Plano Individualizado Comportamental (PIC)',
  RT: 'Relatório de Fechamento Técnico (RT)',
  OE: 'Orientação Escolar (OE)',
}

/** Etapa 1 — nome do arquivo (nome.ts). */
export const SITUACAO_NOME: Record<EstadoNome, { rotulo: string; tom: Tone }> = {
  ok: { rotulo: 'Nome no padrão', tom: 'green' },
  fora: { rotulo: 'Nome fora do padrão', tom: 'red' },
  repetido: { rotulo: 'Nome repetido', tom: 'amber' },
  rep: { rotulo: 'Reprogramação', tom: 'blue' },
  sem: { rotulo: 'Nome não conferido', tom: 'gray' },
}
export const ORDEM_NOME: EstadoNome[] = ['fora', 'repetido', 'rep', 'sem', 'ok']
