import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"

// Lista BÁSICA de pacientes (id, id do TiTa, nome, convênio e situação) para as
// telas que precisam saber QUEM é o paciente, mas não têm a permissão do
// cadastro (Pacientes): Grade, Ocupação Paciente, Indicadores → Alimentar BD,
// Connect.
//
// Desde a migration 20261019160100 o login comum não lê `public.pacientes`
// (CPF, endereço, responsável). A RPC `pacientes_lista_basica` (security
// definer, 20261019160000) confere se a pessoa tem a permissão de uma dessas
// telas e devolve só estas colunas.
//
// VOLTA AUTOMÁTICA: enquanto a RPC não existir no banco (migration pendente —
// localhost e produção usam o mesmo banco), lê a tabela direto com as mesmas
// colunas, como antes.

export type PacienteBasico = {
  id_paciente: number
  tita_paciente_id: number | null
  nome: string
  convenio_nome: string | null
  ativo: boolean
  ficticio: boolean
  falecido: boolean
  foto_path: string | null
}

const COLUNAS = "id_paciente, tita_paciente_id, nome, convenio_nome, ativo, ficticio, falecido, foto_path"
const PAGINA = 1000
/** Ids por chamada no caminho antigo (vão na URL). */
const BLOCO_URL = 200

type ErroPg = { message: string; code?: string }
type Resposta = { data: unknown[] | null; error: ErroPg | null }

export interface FiltroPacientesBasicos {
  /** `id_paciente` (PK do Pulsar). */
  ids?: number[]
  /** `tita_paciente_id` (id do TiTa, o da grade). */
  titaIds?: number[]
  /** Só os reais: sem fictício e sem falecido. Padrão: false. */
  somenteReais?: boolean
}

/** PostgREST corta em 1000 linhas sem erro: lê em páginas. */
async function lerTudo(montar: (de: number, ate: number) => PromiseLike<Resposta>): Promise<{ linhas: PacienteBasico[] } | { erro: ErroPg }> {
  const linhas: PacienteBasico[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1)
    if (error) return { erro: error }
    const lote = (data ?? []) as PacienteBasico[]
    linhas.push(...lote)
    if (lote.length < PAGINA) return { linhas }
  }
}

function blocos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Caminho antigo: a tabela direto (só funciona enquanto a leitura não foi fechada). */
async function lerDaTabela(f: FiltroPacientesBasicos): Promise<PacienteBasico[]> {
  const sb = getSupabaseClient()
  const consulta = (filtrar: (q: any) => any) => // eslint-disable-line @typescript-eslint/no-explicit-any
    lerTudo((de, ate) => {
      let q = sb.from("pacientes").select(COLUNAS)
      if (f.somenteReais) q = q.eq("ficticio", false).eq("falecido", false)
      return filtrar(q).order("nome").order("id_paciente").range(de, ate)
    })

  const partes: Awaited<ReturnType<typeof consulta>>[] = []
  if (f.ids == null && f.titaIds == null) {
    partes.push(await consulta(q => q))
  } else {
    for (const b of blocos(f.ids ?? [], BLOCO_URL)) partes.push(await consulta(q => q.in("id_paciente", b)))
    for (const b of blocos(f.titaIds ?? [], BLOCO_URL)) partes.push(await consulta(q => q.in("tita_paciente_id", b)))
  }

  const porId = new Map<number, PacienteBasico>()
  for (const p of partes) {
    if ("erro" in p) throw new Error(p.erro.message)
    for (const l of p.linhas) porId.set(l.id_paciente, l)
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id_paciente - b.id_paciente)
}

/**
 * Pacientes (todos, ou só os ids pedidos), ordenados por nome.
 * Lança erro com a mensagem do banco (inclusive "sem permissão").
 */
export async function listarPacientesBasicos(f: FiltroPacientesBasicos = {}): Promise<PacienteBasico[]> {
  // Lista de ids pedida, mas vazia: nada a buscar (sem isto viria o cadastro inteiro).
  if ((f.ids != null || f.titaIds != null) && (f.ids?.length ?? 0) + (f.titaIds?.length ?? 0) === 0) {
    return []
  }

  const sb = getSupabaseClient()
  const r = await lerTudo((de, ate) => {
    let q = sb.rpc("pacientes_lista_basica", {
      p_ids: f.ids ?? null,
      p_tita_ids: f.titaIds ?? null,
    })
    if (f.somenteReais) q = q.eq("ficticio", false).eq("falecido", false)
    return q.order("nome").order("id_paciente").range(de, ate)
  })

  if ("linhas" in r) return r.linhas
  if (ehMigrationPendente(r.erro)) return lerDaTabela(f)
  throw new Error(r.erro.message)
}
