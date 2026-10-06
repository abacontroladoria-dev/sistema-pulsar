// Catálogo de terapias (public.cadastro_terapias — ver
// supabase/migrations/20261006120000_cadastro_terapias.sql).

export type TipoTerapia = "terapia" | "procedimento"

export type CadastroTerapia = {
  id: number
  nome: string
  tipo: TipoTerapia
  /** Sempre "#RRGGBB" em maiúsculas (o gatilho normaliza). */
  cor_hex: string
  tita_terapia_id: number | null
  /** Chave do ícone (lib/cadastros/iconesTerapia.tsx). null = estrelinhas. */
  icone: string | null
  ativo: boolean
  atualizado_em: string
}

export type CadastroTerapiaEdit = {
  nome: string
  tipo: TipoTerapia
  cor_hex: string
  icone: string | null
}

export const TIPO_TERAPIA_LABEL: Record<TipoTerapia, string> = {
  terapia: "Terapia",
  procedimento: "Procedimento",
}
