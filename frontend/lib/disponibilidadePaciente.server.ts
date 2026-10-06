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

/**
 * Teto do corpo dos POSTs públicos. O formulário inteiro tem menos de 1 KB; 16
 * KB é folga de sobra. Sem teto, `request.json()` aceitaria um corpo de vários
 * MB numa rota sem login — memória do processo por conta de quem quiser.
 */
export const LIMITE_CORPO_BYTES = 16 * 1024

/**
 * Lê o JSON do corpo com teto de tamanho. `null` = vazio, grande demais ou JSON
 * inválido — o handler responde com a mesma recusa genérica nos três casos.
 */
export async function lerJsonLimitado(request: Request): Promise<Record<string, unknown> | null> {
  const declarado = Number(request.headers.get("content-length") ?? "0")
  if (declarado > LIMITE_CORPO_BYTES) return null
  // O content-length pode faltar ou mentir (chunked): confere o que chegou.
  const texto = await request.text().catch(() => "")
  if (!texto || texto.length > LIMITE_CORPO_BYTES) return null
  try {
    const valor = JSON.parse(texto)
    return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * O CPF digitado é o deste paciente (ativo, não fictício)?
 *
 * Roda ANTES de qualquer outra leitura sobre o paciente no envio. Sem isso o
 * handler consultava a versão atual de um `paciente_id` qualquer (vindo do
 * navegador) e respondia "horário inválido" ou seguia adiante conforme o valor
 * gravado — um oráculo que deixava descobrir, um horário por vez, a
 * disponibilidade de qualquer paciente sem saber o CPF. A RPC reconfere no
 * banco; esta checagem existe para nada vazar antes dela.
 */
export async function cpfDoPacienteConfere(pacienteId: number, cpf: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("pacientes")
    .select("cpf")
    .eq("id_paciente", pacienteId)
    .eq("ativo", true)
    .eq("ficticio", false)
    .maybeSingle()

  if (error) throw error
  const cadastro = onlyDigits((data as { cpf: string | null } | null)?.cpf ?? "")
  return cadastro.length === 11 && cadastro === onlyDigits(cpf)
}
