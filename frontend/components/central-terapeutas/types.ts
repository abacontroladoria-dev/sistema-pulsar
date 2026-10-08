import type { AtendimentoTerapeutico } from '@/services/central-terapeutas.service'

export type ControleFilters = {
  data: string
  busca: string
  horario: string
  unidade: string
  terapia: string
  statusFiltro: string[]
}

export type ControleTerapeuticoItem = AtendimentoTerapeutico

export type StatusDisponibilidadeGrupo =
  | 'pendente'
  | 'disponivel'
  | 'indisponivel'
  | 'parcial'
  | 'substituido'

export type GrupoTerapeutaMobile = {
  terapeuta: string
  terapia: string
  terapiaExibicao?: string
  unidade: string
  sala: string
  primeiroHorario: string
  status: StatusDisponibilidadeGrupo
  substituto?: string
  ultimaAlteracaoPor?: string | null
  ultimaAlteracaoEm?: string | null
  atendimentos: ControleTerapeuticoItem[]
  /** Todas as sessões caem em feriado/ponto facultativo: ninguém faltou. */
  unidadeFechada?: boolean
}
