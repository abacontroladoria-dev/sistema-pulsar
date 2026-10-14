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
