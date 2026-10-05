import { getSupabaseClient } from "@/lib/supabase/client"
import type { ColunasDisponibilidade } from "@/lib/disponibilidadePaciente"

// Disponibilidade do paciente — aba "Disponibilidade" da ficha.
//
// Leitura direta das tabelas (RLS: usuario_tem_permissao('cadastros_pacientes'));
// escrita SÓ pelas RPCs da migration 20261005160000. Não existe insert/update
// direto aqui de propósito: o histórico é imutável e o banco nem concede GRANT
// de escrita a authenticated.
//
// As duas escritas devolvem o que gravaram, e a função trata retorno vazio como
// FALHA. É a defesa contra a escrita barrada que não gera erro (ver a memória do
// projeto sobre RLS em Ocupação de Salas): sem isto o botão diria "liberado" sem
// ter liberado nada.

const supabase = getSupabaseClient()

export type OrigemDisponibilidade = "formulario" | "equipe" | "importacao_orbita"

export type VersaoDisponibilidade = ColunasDisponibilidade & {
  id: number
  paciente_id: number
  numero_versao: number
  origem: OrigemDisponibilidade
  preenchido_por_nome: string | null
  preenchido_por_parentesco: string | null
  preenchido_por_telefone: string | null
  telefone_confere: boolean | null
  registrado_por_usuario: string | null
  registrado_por_nome: string | null
  sem_alteracao: boolean
  observacao: string | null
  criado_em: string
}

export type LiberacaoEdicao = {
  id: number
  paciente_id: number
  liberado_por: string
  liberado_por_nome: string | null
  liberado_em: string
  prazo_ate: string
}

export type DisponibilidadePaciente = {
  /** Da mais nova para a mais antiga. A primeira é a atual. */
  versoes: VersaoDisponibilidade[]
  liberacoes: LiberacaoEdicao[]
  /** `null` = o responsável nunca enviou pelo link (formulário aberto). */
  prazoEdicaoAte: string | null
}

/** Mensagem que a tela mostra quando a migration ainda não foi aplicada. */
export const MSG_MIGRACAO_PENDENTE =
  "A disponibilidade ainda não está ativa no banco (migração pendente). Peça a aplicação de 20261005160000_pacientes_disponibilidade.sql."

/**
 * Tabela/função inexistente. O localhost aponta para o banco de PRODUÇÃO, então
 * a tela precisa sobreviver ao intervalo entre o merge do código e a aplicação
 * da migration — sem isto a aba inteira quebraria.
 */
function ehMigracaoPendente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  return ["42P01", "42883", "PGRST202", "PGRST205"].includes(erro.code ?? "")
}

function mensagemDeErro(erro: { code?: string; message?: string }, padrao: string): string {
  if (ehMigracaoPendente(erro)) return MSG_MIGRACAO_PENDENTE
  // Os textos das RPCs já vêm em português ("Sem permissão para…").
  if (erro.code === "42501" && erro.message) return erro.message
  if (erro.code === "23514") return "Algum horário está inválido (o fim precisa ser depois do início)."
  return padrao
}

export class ErroDisponibilidade extends Error {
  constructor(
    mensagem: string,
    readonly migracaoPendente = false
  ) {
    super(mensagem)
  }
}

const COLUNAS_VERSAO =
  "id, paciente_id, numero_versao, frequenta_escola, escola_inicio, escola_fim, " +
  "seg_inicio, seg_fim, ter_inicio, ter_fim, qua_inicio, qua_fim, " +
  "qui_inicio, qui_fim, sex_inicio, sex_fim, sab_inicio, sab_fim, " +
  "origem, preenchido_por_nome, preenchido_por_parentesco, preenchido_por_telefone, " +
  "telefone_confere, registrado_por_usuario, registrado_por_nome, sem_alteracao, " +
  "observacao, criado_em"

export async function buscarDisponibilidade(pacienteId: number): Promise<DisponibilidadePaciente> {
  const [versoes, liberacoes, prazo] = await Promise.all([
    supabase
      .from("pacientes_disponibilidade_versoes")
      .select(COLUNAS_VERSAO)
      .eq("paciente_id", pacienteId)
      .order("numero_versao", { ascending: false }),
    supabase
      .from("pacientes_disponibilidade_liberacoes")
      .select("id, paciente_id, liberado_por, liberado_por_nome, liberado_em, prazo_ate")
      .eq("paciente_id", pacienteId)
      .order("liberado_em", { ascending: false }),
    supabase
      .from("pacientes_disponibilidade_prazo")
      .select("prazo_edicao_ate")
      .eq("paciente_id", pacienteId)
      .maybeSingle(),
  ])

  const erro = versoes.error ?? liberacoes.error ?? prazo.error
  if (erro) {
    throw new ErroDisponibilidade(
      mensagemDeErro(erro, "Não foi possível consultar a disponibilidade."),
      ehMigracaoPendente(erro)
    )
  }

  return {
    // `as unknown as`: os tipos gerados do Supabase não acompanham migrations novas.
    versoes: (versoes.data ?? []) as unknown as VersaoDisponibilidade[],
    liberacoes: (liberacoes.data ?? []) as unknown as LiberacaoEdicao[],
    prazoEdicaoAte: (prazo.data as { prazo_edicao_ate: string | null } | null)?.prazo_edicao_ate ?? null,
  }
}

export type DadosEdicaoEquipe = ColunasDisponibilidade & {
  /** Quem da família passou a informação (opcional na edição interna). */
  preenchido_por_nome: string | null
  preenchido_por_parentesco: string | null
  observacao: string | null
}

/** Grava uma NOVA versão (origem = equipe). Nunca sobrescreve a anterior. */
export async function salvarDisponibilidadeEquipe(
  pacienteId: number,
  dados: DadosEdicaoEquipe
): Promise<VersaoDisponibilidade> {
  const { data, error } = await supabase.rpc("disponibilidade_salvar_equipe", {
    p_paciente_id: pacienteId,
    p_dados: dados,
  })

  if (error) {
    throw new ErroDisponibilidade(
      mensagemDeErro(error, "Não foi possível salvar a disponibilidade."),
      ehMigracaoPendente(error)
    )
  }

  const linha = data as unknown as VersaoDisponibilidade | null
  if (!linha || typeof linha.numero_versao !== "number") {
    throw new ErroDisponibilidade("O banco não confirmou a gravação. Recarregue e confira o histórico.")
  }

  return linha
}

/**
 * Botão "Liberar edição por 48h". Devolve o novo prazo (ISO). Sem prazo na
 * resposta é falha, mesmo sem erro do banco.
 */
export async function liberarEdicaoResponsavel(pacienteId: number): Promise<string> {
  const { data, error } = await supabase.rpc("disponibilidade_liberar_edicao", {
    p_paciente_id: pacienteId,
  })

  if (error) {
    throw new ErroDisponibilidade(
      mensagemDeErro(error, "Não foi possível liberar a edição."),
      ehMigracaoPendente(error)
    )
  }

  const prazo = typeof data === "string" ? data : null
  if (!prazo || Number.isNaN(new Date(prazo).getTime()) || new Date(prazo).getTime() <= Date.now()) {
    throw new ErroDisponibilidade("O banco não confirmou o novo prazo. Recarregue e tente de novo.")
  }

  return prazo
}
