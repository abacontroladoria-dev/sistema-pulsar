import { getSupabaseClient } from "@/lib/supabase/client"
import type { TipoContrato } from "@/lib/contratos/status"
import type { ContratoPaciente, EventoContrato, SignatarioContrato } from "@/types/contratosPaciente"

// Contratos do paciente — aba "Contratos" da ficha.
//
// Leitura direta das tabelas (RLS: cadastros_pacientes OU status_contratos);
// escrita do status SÓ pelas RPCs da migration 20261008160000 — o banco nem
// concede UPDATE a authenticated. Arquivo (PDF) vai e volta pelas rotas
// /api/contratos/[id]/*, que usam a service_role depois de conferir a
// permissão: o bucket `contratos-pacientes` não tem policy para o navegador.
//
// Toda escrita devolve a linha gravada, e retorno vazio é FALHA — a defesa
// contra a escrita barrada que não gera erro (mesma regra de
// pacienteDisponibilidade.service.ts).

const supabase = getSupabaseClient()

export const MSG_MIGRACAO_PENDENTE =
  "Os contratos do paciente ainda não estão ativos no banco (migração pendente). Peça a aplicação de 20261008160000_pacientes_contratos.sql."

/**
 * Tabela/função inexistente. O localhost aponta para o banco de PRODUÇÃO: a
 * aba precisa sobreviver ao intervalo entre o merge e a aplicação da migration
 * mostrando um aviso, sem quebrar a ficha.
 */
function ehMigracaoPendente(erro: { code?: string } | null): boolean {
  return !!erro && ["42P01", "42883", "PGRST202", "PGRST205"].includes(erro.code ?? "")
}

function mensagemDeErro(erro: { code?: string; message?: string }, padrao: string): string {
  if (ehMigracaoPendente(erro)) return MSG_MIGRACAO_PENDENTE
  // As RPCs levantam mensagens em português (permissão, transição, datas).
  if ((erro.code === "42501" || erro.code === "22023" || erro.code === "P0002") && erro.message) return erro.message
  if (erro.code === "23514") {
    if (erro.message?.includes("datas")) return "A data de vencimento precisa ser igual ou depois da data de início."
    return "Algum campo está fora do permitido."
  }
  return padrao
}

export class ErroContratos extends Error {
  constructor(
    mensagem: string,
    readonly migracaoPendente = false,
  ) {
    super(mensagem)
  }
}

function falhar(erro: { code?: string; message?: string }, padrao: string): never {
  throw new ErroContratos(mensagemDeErro(erro, padrao), ehMigracaoPendente(erro))
}

const COLUNAS_CONTRATO =
  "id, paciente_id, tipo, data_inicio, data_vencimento, status, assinado_em, origem_assinatura, " +
  "arquivo_original_path, arquivo_original_nome, arquivo_assinado_path, d4sign_documento_uuid, " +
  "link_expira_em, observacao, criado_por_nome, criado_em, atualizado_em"

export type ContratosDoPaciente = {
  /** Mais recentes primeiro (início desc, id desc). Só `ativo = true`. */
  contratos: ContratoPaciente[]
  /** Por contrato, do mais novo para o mais antigo. */
  eventos: Map<number, EventoContrato[]>
  signatarios: Map<number, SignatarioContrato[]>
}

export async function buscarContratosDoPaciente(pacienteId: number): Promise<ContratosDoPaciente> {
  const { data, error } = await supabase
    .from("pacientes_contratos")
    .select(COLUNAS_CONTRATO)
    .eq("paciente_id", pacienteId)
    .eq("ativo", true)
    .order("data_inicio", { ascending: false })
    .order("id", { ascending: false })
  if (error) falhar(error, "Não foi possível consultar os contratos.")

  // `as unknown as`: os tipos gerados do Supabase não acompanham migrations novas.
  const contratos = (data ?? []) as unknown as ContratoPaciente[]
  const eventos = new Map<number, EventoContrato[]>()
  const signatarios = new Map<number, SignatarioContrato[]>()
  if (contratos.length === 0) return { contratos, eventos, signatarios }

  const ids = contratos.map((c) => c.id)
  const [ev, sig] = await Promise.all([
    supabase
      .from("pacientes_contratos_eventos")
      .select("id, contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_nome, criado_em, criado_em_brasilia")
      .in("contrato_id", ids)
      .order("id", { ascending: false }),
    supabase
      .from("pacientes_contratos_signatarios")
      .select("id, contrato_id, responsavel_id, nome, status, assinado_em, link_enviado_em, envios")
      .in("contrato_id", ids)
      .order("id", { ascending: true }),
  ])
  if (ev.error) falhar(ev.error, "Não foi possível consultar o histórico dos contratos.")
  if (sig.error) falhar(sig.error, "Não foi possível consultar os signatários.")

  for (const e of (ev.data ?? []) as unknown as EventoContrato[]) {
    const lista = eventos.get(e.contrato_id) ?? []
    lista.push(e)
    eventos.set(e.contrato_id, lista)
  }
  for (const s of (sig.data ?? []) as unknown as SignatarioContrato[]) {
    const lista = signatarios.get(s.contrato_id) ?? []
    lista.push(s)
    signatarios.set(s.contrato_id, lista)
  }
  return { contratos, eventos, signatarios }
}

function linhaOuFalha(data: unknown, acao: string): ContratoPaciente {
  const linha = data as ContratoPaciente | null
  if (!linha || typeof linha.id !== "number") {
    throw new ErroContratos(`O banco não confirmou ${acao}. Recarregue e confira o histórico do contrato.`)
  }
  return linha
}

export type DadosContrato = {
  tipo: TipoContrato
  dataInicio: string
  dataVencimento: string
  observacao: string | null
}

export async function criarContrato(pacienteId: number, d: DadosContrato): Promise<ContratoPaciente> {
  const { data, error } = await supabase.rpc("contratos_criar", {
    p_paciente_id: pacienteId,
    p_tipo: d.tipo,
    p_data_inicio: d.dataInicio,
    p_data_vencimento: d.dataVencimento,
    p_observacao: d.observacao,
  })
  if (error) falhar(error, "Não foi possível criar o contrato.")
  return linhaOuFalha(data, "a criação")
}

export async function editarRascunho(id: number, d: DadosContrato): Promise<ContratoPaciente> {
  const { data, error } = await supabase.rpc("contratos_editar_rascunho", {
    p_id: id,
    p_tipo: d.tipo,
    p_data_inicio: d.dataInicio,
    p_data_vencimento: d.dataVencimento,
    p_observacao: d.observacao,
  })
  if (error) falhar(error, "Não foi possível salvar o contrato.")
  return linhaOuFalha(data, "a edição")
}

export async function marcarAssinadoManual(id: number, assinadoEm: string): Promise<ContratoPaciente> {
  const { data, error } = await supabase.rpc("contratos_marcar_assinado_manual", {
    p_id: id,
    p_assinado_em: assinadoEm,
  })
  if (error) falhar(error, "Não foi possível marcar o contrato como assinado.")
  const linha = linhaOuFalha(data, "a assinatura")
  if (linha.status !== "assinado") throw new ErroContratos("O banco não confirmou a assinatura. Recarregue e confira.")
  return linha
}

export async function cancelarContrato(id: number, motivo: string): Promise<ContratoPaciente> {
  const { data, error } = await supabase.rpc("contratos_cancelar", { p_id: id, p_motivo: motivo })
  if (error) falhar(error, "Não foi possível cancelar o contrato.")
  const linha = linhaOuFalha(data, "o cancelamento")
  if (linha.status !== "cancelado") throw new ErroContratos("O banco não confirmou o cancelamento. Recarregue e confira.")
  return linha
}

// ─── Arquivo (rotas de API) ──────────────────────────────────────────────────

/** Limite do bucket (20261008160000). Conferido aqui para o erro sair antes do upload. */
export const TAMANHO_MAXIMO_PDF = 10 * 1024 * 1024

async function lerErroDaRota(resposta: Response, padrao: string): Promise<string> {
  try {
    const corpo = await resposta.json()
    if (typeof corpo?.mensagem === "string") return corpo.mensagem
  } catch {
    /* corpo não-JSON: cai no padrão */
  }
  return `${padrao} (HTTP ${resposta.status})`
}

export async function enviarArquivoOriginal(contratoId: number, arquivo: File): Promise<ContratoPaciente> {
  if (arquivo.type !== "application/pdf") throw new ErroContratos("Envie o contrato em PDF.")
  if (arquivo.size > TAMANHO_MAXIMO_PDF) throw new ErroContratos("O PDF passa de 10 MB.")

  const corpo = new FormData()
  corpo.append("arquivo", arquivo)
  // Barra no fim: `trailingSlash: true` no next.config.
  const resposta = await fetch(`/api/contratos/${contratoId}/arquivo/`, { method: "POST", body: corpo })
  if (!resposta.ok) throw new ErroContratos(await lerErroDaRota(resposta, "Não foi possível enviar o PDF"))
  const json = await resposta.json()
  return linhaOuFalha(json?.contrato, "o envio do PDF")
}

/** URL assinada (5 minutos) do PDF. Abre numa aba nova; não guardar. */
export async function urlDoArquivo(contratoId: number, qual: "original" | "assinado"): Promise<string> {
  const resposta = await fetch(`/api/contratos/${contratoId}/download/?qual=${qual}`, { cache: "no-store" })
  if (!resposta.ok) throw new ErroContratos(await lerErroDaRota(resposta, "Não foi possível abrir o PDF"))
  const json = await resposta.json()
  if (typeof json?.url !== "string") throw new ErroContratos("O servidor não devolveu o link do PDF.")
  return json.url
}
