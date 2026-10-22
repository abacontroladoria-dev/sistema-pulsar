import toast from "react-hot-toast"

import { getSupabaseClient } from "@/lib/supabase/client"
import { getUsuarioAtual } from "@/lib/supabase/usuarioAtual"
import { camposAlterados, resumoAlteracao, type NomesDeIds } from "@/lib/cadastros/auditoriaFormat"
import type {
  EntidadeAuditada,
  EntradaAuditoria,
  RegistroAuditoria,
} from "@/types/auditoria"

// Ver supabase/migrations/20260826120000_create_cadastros_auditoria.sql.

const TABLE = "cadastros_auditoria"

const COLUNAS = [
  "id",
  "tabela",
  "registro_id",
  "acao",
  "paciente_id",
  "paciente_nome",
  "convenio_nome",
  "alvo_nome",
  "antes",
  "depois",
  "resumo",
  "motivo",
  "usuario_id",
  "usuario_nome",
  "criado_em",
  "criado_em_brasilia",
].join(",")

/**
 * Avisa que a trilha falhou, sem derrubar a ação.
 *
 * Existe por causa de um bug de semanas: o CHECK de `tabela` em produção não
 * conhecia 'laudo' nem 'alta_individualidade' (a migration que os acrescentava
 * nunca foi aplicada), então TODO insert de trilha vindo das abas Laudo e Altas
 * era rejeitado pelo banco — e morria aqui, em console.error, sem ninguém ver.
 * Descoberto só quando o usuário estranhou uma exclusão de alta que não
 * aparecia no histórico. Ver 20260826140300.
 *
 * O toast é discreto e não bloqueia: a ação principal DEU CERTO, o que falhou
 * foi o registro dela. Mas silêncio total já provou que esconde regressão.
 */
function avisarFalhaDeTrilha(detalhe: unknown): void {
  console.error("Erro ao registrar auditoria de cadastro:", detalhe)
  toast(
    "A alteração foi salva, mas não entrou no histórico. Avise o suporte.",
    { icon: "⚠️", duration: 6000, id: "falha-trilha-cadastros" }
  )
}

/**
 * Registra uma entrada na trilha.
 *
 * NUNCA lança e nunca devolve erro: auditoria não pode derrubar a ação
 * principal. Se o paciente foi salvo e a trilha falhou, o certo é o paciente
 * continuar salvo. Mesma decisão de salasAuditoria.service.ts — mas, diferente
 * de antes, a falha agora aparece (ver avisarFalhaDeTrilha).
 */
/**
 * Nome dos ids que aparecem na trilha (hoje: `plano_saude_id` da ficha médica),
 * para o histórico mostrar "ASSIM Saúde" e não "18". Falha de leitura devolve
 * mapa vazio: o histórico cai no id cru em vez de não abrir.
 */
export async function nomesDeIds(
  entradas: { antes?: Record<string, unknown> | null; depois?: Record<string, unknown> | null }[]
): Promise<NomesDeIds> {
  const ids = new Set<number>()
  for (const e of entradas) {
    for (const lado of [e.antes, e.depois]) {
      const v = Number(lado?.plano_saude_id)
      if (Number.isInteger(v) && v > 0) ids.add(v)
    }
  }
  if (ids.size === 0) return {}
  try {
    // Import dinâmico: planosSaude → convenios.service → este arquivo fecharia um ciclo.
    const { getRotulosPlanosSaude } = await import("@/services/planosSaude.service")
    return { plano_saude_id: await getRotulosPlanosSaude([...ids]) }
  } catch {
    return {}
  }
}

export async function registrarAuditoria(entrada: EntradaAuditoria): Promise<void> {
  try {
    // Edição que não mudou nada não é evento. O salvar do detalhe do paciente
    // chama upsertPaciente em TODO save — inclusive quando só a ficha médica ou
    // os vínculos mudaram —, então sem esta guarda o histórico enche de linhas
    // "Nenhum campo alterado." e a trilha fica ilegível.
    if (
      entrada.acao === "editar" &&
      camposAlterados(entrada.tabela, entrada.antes ?? null, entrada.depois ?? null).length === 0
    ) {
      return
    }

    const supabase = getSupabaseClient()
    const usuario = await getUsuarioAtual()

    const { error } = await supabase.from(TABLE).insert({
      tabela: entrada.tabela,
      registro_id: String(entrada.registroId),
      acao: entrada.acao,
      paciente_id: entrada.pacienteId ?? null,
      paciente_nome: entrada.pacienteNome ?? null,
      convenio_nome: entrada.convenioNome ?? null,
      alvo_nome: entrada.alvoNome ?? null,
      antes: entrada.antes ?? null,
      depois: entrada.depois ?? null,
      // O resumo fica gravado pronto: com o nome do plano, não o id.
      resumo: resumoAlteracao(entrada, await nomesDeIds([entrada])),
      motivo: entrada.motivo ?? null,
      usuario_id: usuario.id,
      usuario_nome: usuario.nome,
    })

    if (error) avisarFalhaDeTrilha(error)
  } catch (e) {
    avisarFalhaDeTrilha(e)
  }
}

export type FiltrosAuditoria = {
  /** Restringe às entidades do módulo (Pacientes ou Convênios). */
  entidades?: EntidadeAuditada[]
  /** Trilha de um registro específico. */
  tabela?: EntidadeAuditada
  registroId?: string | number
  /** Cruza paciente + responsável + ficha médica de um paciente só. */
  pacienteId?: number
  pagina?: number
  limite?: number
}

export async function getAuditoria(filtros: FiltrosAuditoria = {}): Promise<{
  data: RegistroAuditoria[]
  total: number
  error: string | null
}> {
  const supabase = getSupabaseClient()
  const limite = filtros.limite ?? 30
  const pagina = filtros.pagina ?? 1

  let query = supabase
    .from(TABLE)
    .select(COLUNAS, { count: "exact" })
    .order("criado_em", { ascending: false })

  if (filtros.entidades?.length) query = query.in("tabela", filtros.entidades)
  if (filtros.tabela) query = query.eq("tabela", filtros.tabela)
  if (filtros.registroId !== undefined) {
    query = query.eq("registro_id", String(filtros.registroId))
  }
  if (filtros.pacienteId !== undefined) query = query.eq("paciente_id", filtros.pacienteId)

  const inicio = (pagina - 1) * limite
  query = query.range(inicio, inicio + limite - 1)

  const { data, error, count } = await query

  if (error) {
    console.error("Erro ao buscar auditoria de cadastros:", error)
    return { data: [], total: 0, error: error.message }
  }

  return {
    data: (data ?? []) as unknown as RegistroAuditoria[],
    total: count ?? 0,
    error: null,
  }
}

/**
 * Quem criou cada registro de uma entidade, num só round-trip — para exibir
 * "Criado por X" direto no card, sem abrir o histórico completo (que pode ter
 * muitas linhas de edição/exclusão/reativação misturadas).
 *
 * Devolve um mapa `registro_id -> { usuarioNome, criadoEm }`. Registros sem
 * linha `criar` na trilha (não deveria acontecer, mas a trilha é
 * best-effort — ver avisarFalhaDeTrilha) simplesmente não aparecem no mapa.
 */
export async function getCriadores(
  tabela: EntidadeAuditada,
  registroIds: (string | number)[]
): Promise<Record<string, { usuarioNome: string | null; criadoEm: string | null }>> {
  if (registroIds.length === 0) return {}

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select("registro_id, usuario_nome, criado_em, criado_em_brasilia")
    .eq("tabela", tabela)
    .eq("acao", "criar")
    .in("registro_id", registroIds.map(String))

  if (error || !data) {
    console.error("Erro ao buscar criadores da trilha:", error)
    return {}
  }

  const mapa: Record<string, { usuarioNome: string | null; criadoEm: string | null }> = {}
  for (const linha of data as { registro_id: string; usuario_nome: string | null; criado_em: string; criado_em_brasilia: string | null }[]) {
    mapa[linha.registro_id] = {
      usuarioNome: linha.usuario_nome,
      criadoEm: linha.criado_em_brasilia ?? linha.criado_em,
    }
  }
  return mapa
}
