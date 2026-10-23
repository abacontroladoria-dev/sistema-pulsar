// Catálogo de terapias (public.cadastro_terapias — ver
// supabase/migrations/20261006120000_cadastro_terapias.sql).

export type TipoTerapia = "terapia" | "procedimento"

/** Ver supabase/migrations/20261023180000_cadastro_terapias_modalidade_e_fila.sql. */
export type ModalidadeTerapia = "clinica" | "at_externo" | "terceirizada"

export type CadastroTerapia = {
  id: number
  nome: string
  tipo: TipoTerapia
  /** Sempre "#RRGGBB" em maiúsculas (o gatilho normaliza). */
  cor_hex: string
  tita_terapia_id: number | null
  /** Chave do ícone (lib/cadastros/iconesTerapia.tsx). null = estrelinhas. */
  icone: string | null
  /** Só "clinica" tem unidade e entra no rateio por unidade. */
  modalidade: ModalidadeTerapia
  /** false = a terapia não passa pela /solicitar (fora do ROL ou do ciclo de autorização). */
  exige_presenca_fila: boolean
  ativo: boolean
  atualizado_em: string
}

export type CadastroTerapiaEdit = {
  nome: string
  tipo: TipoTerapia
  cor_hex: string
  icone: string | null
  modalidade: ModalidadeTerapia
  exige_presenca_fila: boolean
}

export const TIPO_TERAPIA_LABEL: Record<TipoTerapia, string> = {
  terapia: "Terapia",
  procedimento: "Procedimento",
}

export const MODALIDADE_TERAPIA_LABEL: Record<ModalidadeTerapia, string> = {
  clinica: "Clínica",
  at_externo: "AT Externo",
  terceirizada: "Terceirizada",
}
