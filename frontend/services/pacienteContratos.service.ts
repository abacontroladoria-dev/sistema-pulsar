import { getSupabaseClient } from "@/lib/supabase/client"
import type { TipoContrato } from "@/lib/contratos/status"
import type { AutorizacoesImagem } from "@/lib/contratos/documento/montarDados"
import type { ContratoPaciente, EventoContrato, SignatarioContrato } from "@/types/contratosPaciente"

// Contratos do paciente — aba "Contratos" da ficha.
//
// Leitura direta das tabelas (RLS: cadastros_pacientes OU status_contratos);
// escrita do status SÓ pelas RPCs da migration 20261008160000 — o banco nem
// concede UPDATE a authenticated.
//
// SEM arquivo: o contrato do paciente não guarda PDF nenhum (pedido do
// usuário, 09/10/2026) — o documento vive na D4Sign (fase 3).
//
// Toda escrita devolve a linha gravada, e retorno vazio é FALHA — a defesa
// contra a escrita barrada que não gera erro (mesma regra de
// pacienteDisponibilidade.service.ts).

const supabase = getSupabaseClient()

export const MSG_MIGRACAO_PENDENTE =
  "Os contratos do paciente ainda não estão ativos no banco (migração pendente). Peça a aplicação de 20261008160000_pacientes_contratos.sql e 20261009160000_pacientes_contratos_documento.sql."

/**
 * Tabela/função inexistente. O localhost aponta para o banco de PRODUÇÃO: a
 * aba precisa sobreviver ao intervalo entre o merge e a aplicação da migration
 * mostrando um aviso, sem quebrar a ficha.
 */
function ehMigracaoPendente(erro: { code?: string } | null): boolean {
  // 42703: coluna inexistente — a tabela é de 20261008160000, mas as colunas
  // do documento (numero, valores…) só chegam com 20261009160000.
  return !!erro && ["42P01", "42703", "42883", "PGRST202", "PGRST205"].includes(erro.code ?? "")
}

function mensagemDeErro(erro: { code?: string; message?: string }, padrao: string): string {
  if (ehMigracaoPendente(erro)) return MSG_MIGRACAO_PENDENTE
  // As RPCs levantam mensagens em português (permissão, transição, datas).
  if ((erro.code === "42501" || erro.code === "22023" || erro.code === "P0002") && erro.message) return erro.message
  if (erro.code === "23514") {
    if (erro.message?.includes("datas")) return "A data de vencimento precisa ser igual ou depois da data de início."
    if (erro.message?.includes("valores")) return "Valor e sessão avulsa precisam ser maiores que zero, e o limite de sessões entre 1 e 100."
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
  "id, paciente_id, tipo, numero, data_inicio, data_vencimento, status, assinado_em, origem_assinatura, " +
  "d4sign_documento_uuid, link_expira_em, observacao, valor_total, sessoes_max, valor_sessao_avulsa, " +
  "contrato_vinculado_id, autorizacoes_imagem, criado_por_nome, criado_em, atualizado_em"

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

/**
 * Quem TEM contrato, para a listagem de pacientes: `id_paciente` de todo
 * paciente com ao menos um contrato `ativo = true` e não cancelado — qualquer
 * status de assinatura, qualquer vigência. É a EXISTÊNCIA do registro, não se
 * ele está valendo (vigência é outro eixo, ver lib/contratos/status.ts).
 *
 * Uma leitura só para a base inteira (nunca uma por paciente), paginada porque
 * o PostgREST corta em 1.000 linhas sem erro. Falha LANÇA: um Set vazio por
 * erro seria lido como "ninguém tem contrato".
 */
export async function getPacientesComContrato(): Promise<Set<number>> {
  const com = new Set<number>()
  const TAMANHO = 1000
  for (let de = 0; ; de += TAMANHO) {
    const { data, error } = await supabase
      .from("pacientes_contratos")
      .select("id, paciente_id")
      .eq("ativo", true)
      .neq("status", "cancelado")
      .order("id", { ascending: true })
      .range(de, de + TAMANHO - 1)
    if (error) falhar(error, "Não foi possível consultar os contratos.")
    const linhas = (data ?? []) as unknown as { paciente_id: number }[]
    for (const l of linhas) com.add(Number(l.paciente_id))
    if (linhas.length < TAMANHO) break
  }
  return com
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
  /** No Termo de Uso de Imagem o banco troca pelo vencimento do contrato vinculado. */
  dataVencimento: string
  observacao: string | null
  valorTotal: number | null
  sessoesMax: number | null
  valorSessaoAvulsa: number | null
  contratoVinculadoId: number | null
  autorizacoesImagem: AutorizacoesImagem | null
}

function parametrosRpc(d: DadosContrato) {
  return {
    p_tipo: d.tipo,
    p_data_inicio: d.dataInicio,
    p_data_vencimento: d.dataVencimento,
    p_observacao: d.observacao,
    p_valor_total: d.valorTotal,
    p_sessoes_max: d.sessoesMax,
    p_valor_sessao_avulsa: d.valorSessaoAvulsa,
    p_contrato_vinculado_id: d.contratoVinculadoId,
    p_autorizacoes_imagem: d.autorizacoesImagem,
  }
}

export async function criarContrato(pacienteId: number, d: DadosContrato): Promise<ContratoPaciente> {
  const { data, error } = await supabase.rpc("contratos_criar", { p_paciente_id: pacienteId, ...parametrosRpc(d) })
  if (error) falhar(error, "Não foi possível criar o contrato.")
  return linhaOuFalha(data, "a criação")
}

export async function editarRascunho(id: number, d: DadosContrato): Promise<ContratoPaciente> {
  const { data, error } = await supabase.rpc("contratos_editar_rascunho", { p_id: id, ...parametrosRpc(d) })
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

// ─── Documento (rotas /api/contratos/*) ──────────────────────────────────────

export type DocumentoContrato =
  | { ok: true; arquivo: Blob; nomeArquivo: string }
  | { ok: false; mensagem: string; pendencias: string[] }

/** O .docx preenchido com o cadastro de agora. Cadastro incompleto devolve as pendências. */
export async function buscarDocumentoContrato(id: number): Promise<DocumentoContrato> {
  let r: Response
  try {
    r = await fetch(`/api/contratos/${id}/documento/`, { cache: "no-store" })
  } catch {
    return { ok: false, mensagem: "Sem conexão com o servidor.", pendencias: [] }
  }
  if (!r.ok) {
    const corpo = (await r.json().catch(() => null)) as { mensagem?: string; pendencias?: string[] } | null
    return {
      ok: false,
      mensagem: corpo?.mensagem ?? "Não foi possível gerar o documento.",
      pendencias: corpo?.pendencias ?? [],
    }
  }
  const disposicao = r.headers.get("Content-Disposition") ?? ""
  const nome = /filename\*=UTF-8''([^;]+)/.exec(disposicao)?.[1]
  return { ok: true, arquivo: await r.blob(), nomeArquivo: nome ? decodeURIComponent(nome) : `contrato-${id}.docx` }
}

export type ValoresPadraoNeuro = {
  /** Pacote Particular, à vista. */
  valor: number | null
  /** Valor por sessão Particular (sessão avulsa excedente). */
  avulsa: number | null
}

/** Valores padrão do contrato de Avaliação Neuropsicológica, pelas tabelas do Cronograma. Falha = tudo null. */
export async function buscarValoresPadraoNeuro(): Promise<ValoresPadraoNeuro> {
  const vazio = { valor: null, avulsa: null }
  try {
    const r = await fetch("/api/contratos/valor-sugerido/", { cache: "no-store" })
    if (!r.ok) return vazio
    const corpo = (await r.json()) as { valor?: number | null; avulsa?: number | null }
    const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : null)
    return { valor: n(corpo.valor), avulsa: n(corpo.avulsa) }
  } catch {
    return vazio
  }
}
