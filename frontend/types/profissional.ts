// Cadastro de Profissionais (public.profissionais — ver
// supabase/migrations/20261006130000_profissionais.sql).

export type OrigemProfissional = "tita" | "manual"

export type Profissional = {
  id: number
  tita_profissional_id: number | null
  origem: OrigemProfissional
  nome: string
  cpf: string | null
  email: string | null
  celular: string | null
  tipo_registro: string | null
  uf_registro: string | null
  codigo_registro: string | null
  cbo: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  terapia_focal_id: number | null
  ativo: boolean
  observacoes: string | null
  /** Último retrato da TiTa — referência para mostrar divergência, não é o cadastro. */
  dados_tita: Partial<Record<CampoTita, string>> | null
  sincronizado_tita_em: string | null
  criado_em: string
  atualizado_em: string
}

/**
 * O que a LISTA carrega de cada profissional: sem endereço, e-mail,
 * observações nem retrato da TiTa — dado pessoal só sai do banco na ficha, um
 * profissional por vez. CPF fica (a busca é por ele, e o "Novo profissional"
 * avisa CPF repetido).
 */
export type ProfissionalLista = Pick<
  Profissional,
  | "id" | "tita_profissional_id" | "origem" | "nome" | "cpf" | "celular"
  | "tipo_registro" | "uf_registro" | "codigo_registro" | "cbo" | "terapia_focal_id" | "ativo"
>

/** Campos que a importação da TiTa conhece (chaves de dados_tita). */
export type CampoTita =
  | "nome"
  | "cpf"
  | "celular"
  | "cbo"
  | "codigo_registro"
  | "tipo_registro"
  | "uf_registro"

/** O que a tela pode gravar (espelha os GRANTs de coluna da migration). */
export type ProfissionalEdit = Pick<
  Profissional,
  | "nome" | "cpf" | "email" | "celular"
  | "tipo_registro" | "uf_registro" | "codigo_registro" | "cbo"
  | "cep" | "logradouro" | "numero" | "complemento" | "bairro" | "cidade" | "uf"
  | "terapia_focal_id" | "ativo" | "observacoes"
>

/** Uma terapia do profissional, juntando o que está habilitado e o que a grade TiTa mostra. */
export type TerapiaDoProfissional = {
  nome: string
  cor: string
  /** Id no catálogo; null quando a grade usa um nome que o catálogo não tem. */
  terapiaId: number | null
  habilitada: boolean
  /** Horários na grade TiTa (últimos 90 dias em diante). 0 = não aparece na grade. */
  horariosGrade: number
}

export type ResultadoImportacao = {
  novos: number
  vinculados_por_cpf: number
  atualizados: number
  terapias_vinculadas: number
  vistos_na_tita: number
}

/** Siglas mais comuns de conselho; a lista do campo soma os valores que vierem da TiTa. */
export const TIPOS_REGISTRO = [
  "CRP", "CREFITO", "CREFONO", "CRFa", "CRM", "CREF", "CRN", "CRO", "COREN", "CRESS", "ABPp", "Outro",
]

/** Identificador exibido: o id da TiTa quando há vínculo (é o que a equipe conhece), senão o do Pulsar. */
export function idExibicaoProfissional(p: Pick<Profissional, "id" | "tita_profissional_id">): string {
  return p.tita_profissional_id ? String(p.tita_profissional_id) : `P${p.id}`
}
