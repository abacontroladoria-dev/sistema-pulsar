import "server-only"
import { supabaseService } from "@/lib/supabase/service"
import { maskCpf, onlyDigits } from "@/lib/remuneracao/formatacao"
import type { ColunasDisponibilidade } from "@/lib/disponibilidadePaciente"

// Leituras do formulário público /disponibilidade-paciente, sempre com
// service_role (a página roda sem sessão). Quem chama são os dois handlers em
// app/api/disponibilidade-paciente/*; nada daqui pode ir para o navegador sem
// passar pela whitelist de campos de cada handler.

export const COLUNAS_CONTEUDO =
  "frequenta_escola, escola_inicio, escola_fim, " +
  "seg_inicio, seg_fim, ter_inicio, ter_fim, qua_inicio, qua_fim, " +
  "qui_inicio, qui_fim, sex_inicio, sex_fim"

/**
 * Pacientes ativos com este CPF. Pode haver mais de um: `pacientes.cpf` NÃO é
 * unique (o TiTa já teve o mesmo CPF em cadastros duplicados), e a tela deixa
 * escolher. Teto baixo de propósito — é a busca do próprio filho.
 *
 * Procura o CPF só com dígitos e também mascarado: o cadastro grava dígitos,
 * mas linhas antigas podem ter vindo com pontuação.
 */
export async function pacientesPorCpf(cpf: string): Promise<{ id_paciente: number; nome: string }[]> {
  const digitos = onlyDigits(cpf)
  const { data, error } = await supabaseService
    .from("pacientes")
    .select("id_paciente, nome")
    .in("cpf", [digitos, maskCpf(digitos)])
    .eq("ativo", true)
    .eq("ficticio", false)
    .order("nome")
    .limit(3)

  if (error) throw error
  return (data ?? []) as { id_paciente: number; nome: string }[]
}

export type EstadoFormulario = {
  /** `aberto`: pode enviar (nunca enviou, ou dentro do prazo). `travado`: prazo vencido. */
  estado: "aberto" | "travado"
  prazo: string | null
  ultimoEnvioEm: string | null
  /** Versão atual, para o formulário vir preenchido. Só existe quando aberto. */
  valoresAtuais: ColunasDisponibilidade | null
}

export async function estadoDoFormulario(pacienteId: number): Promise<EstadoFormulario> {
  const [prazo, versao] = await Promise.all([
    supabaseService
      .from("pacientes_disponibilidade_prazo")
      .select("prazo_edicao_ate")
      .eq("paciente_id", pacienteId)
      .maybeSingle(),
    supabaseService
      .from("pacientes_disponibilidade_versoes")
      .select(`criado_em, ${COLUNAS_CONTEUDO}`)
      .eq("paciente_id", pacienteId)
      .order("numero_versao", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (prazo.error) throw prazo.error
  if (versao.error) throw versao.error

  const prazoAte = (prazo.data as { prazo_edicao_ate: string | null } | null)?.prazo_edicao_ate ?? null
  const travado = prazoAte !== null && new Date(prazoAte).getTime() <= Date.now()
  const linha = versao.data as (ColunasDisponibilidade & { criado_em: string }) | null

  let valoresAtuais: ColunasDisponibilidade | null = null
  if (!travado && linha) {
    // Whitelist explícita: nada de quem preencheu, telefone ou observação. O
    // pai que abre o link não deve ver o nome e o telefone que a mãe digitou.
    const { criado_em: _ignorado, ...conteudo } = linha
    void _ignorado
    valoresAtuais = conteudo
  }

  return {
    estado: travado ? "travado" : "aberto",
    prazo: prazoAte,
    ultimoEnvioEm: linha?.criado_em ?? null,
    valoresAtuais,
  }
}
