import { getSupabaseClient } from "@/lib/supabase/client"
import { buscarGrade, fixMojibake } from "@/lib/grade/fonte"
import { isFakePatient } from "@/lib/remuneracao/pacientes"
import { PACS_BLOQUEIO_ADMIN, normTxt } from "@/lib/cronograma/constants"
import { normalizarDiasDisponiveis, normalizarHorariosCustomizados } from "@/lib/cronograma/salasTypes"
import type { Sala, SalaInput, AgendaSalaRow, AlocacaoSala, AlocacaoInput, SalaStatus, SalaTerapiaExclusiva, SalaTerapiaExclusivaInput } from "@/lib/cronograma/salasTypes"
import { registrarAuditoriaSala } from "@/services/salasAuditoria.service"

const TABLE = "cronograma_salas"
const ALOCACOES_TABLE = "cronograma_salas_alocacoes"

/**
 * Traduz o que a RLS devolve quando NEGA uma escrita — porque o que chega aqui
 * não fala de permissão nenhuma.
 *
 * Policy que não autoriza UPDATE/DELETE não levanta exceção: a linha deixa de
 * casar o filtro e a operação "termina bem" tendo afetado 0 linhas. Com
 * `.select().single()` em cima, quem reclama é o PostgREST, e sobre o FORMATO da
 * resposta — PGRST116, "Cannot coerce the result to a single JSON object". Era
 * exatamente essa a mensagem que aparecia no rodapé dos modais desta tela
 * (relatado em 2026-08-27 por uma usuária de papel 'rp', com leitura liberada e
 * escrita não). Em DELETE é ainda mais silencioso: não há erro algum, o registro
 * só não desaparece.
 *
 * INSERT é o único caso em que o Postgres fala: WITH CHECK reprovado vira 42501.
 *
 * Isto continua valendo depois da correção de RLS de 20260827120100: Núcleos,
 * Status e Exclusividade de terapia seguem restritos a admin/diretoria por
 * decisão de produto, então esse caminho é alcançável por quem tem a tela.
 */
const CODIGOS_ESCRITA_NEGADA = new Set(["PGRST116", "42501"])

/**
 * `antes` é o registro lido imediatamente antes da escrita — todas as funções de
 * update/delete daqui já o buscam para a trilha de auditoria. Ele é o que evita
 * chutar o diagnóstico: se a leitura passou e a escrita casou 0 linhas, é
 * permissão. Se nem ele veio, o registro pode ter sumido no meio do caminho.
 */
function erroDeEscritaNegada(acao: string, antes: unknown): Error {
  return antes != null
    ? new Error(`Você não tem permissão para ${acao}. Peça a um administrador para liberar esse acesso.`)
    : new Error(`Não foi possível ${acao}: o registro não existe mais (pode ter sido alterado por outra pessoa) ou você não tem permissão para isso.`)
}

/** Relança o erro de uma escrita já traduzido quando ele é de permissão, e cru quando é qualquer outra coisa. */
function lancarErroDeEscrita(error: { code?: string; message: string }, acao: string, antes?: unknown): never {
  if (error.code && CODIGOS_ESCRITA_NEGADA.has(error.code)) throw erroDeEscritaNegada(acao, antes)
  throw new Error(error.message)
}

/** Normaliza `dias_disponiveis` de uma linha crua vinda do banco — ver comentário em normalizarDiasDisponiveis (salasTypes.ts). */
function normalizarSala(row: Sala): Sala {
  return {
    ...row,
    dias_disponiveis: normalizarDiasDisponiveis(row.dias_disponiveis),
    horarios_customizados: normalizarHorariosCustomizados(row.horarios_customizados),
  }
}

export async function listarSalas(): Promise<Sala[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .order("unidade_nome")

  if (error) throw new Error(error.message)
  const salas = ((data ?? []) as Sala[]).map(normalizarSala)
  return salas.sort((a, b) =>
    a.unidade_nome.localeCompare(b.unidade_nome)
    || a.numero_sala.localeCompare(b.numero_sala, undefined, { numeric: true, sensitivity: "base" }),
  )
}

export async function criarSala(input: SalaInput): Promise<Sala> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from(TABLE)
    .insert({ ...input, status: input.status ?? "operacional" })
    .select("*")
    .single()

  if (error) lancarErroDeEscrita(error, "cadastrar salas")
  const sala = normalizarSala(data as Sala)
  await registrarAuditoriaSala({
    tabela: "sala", registroId: sala.id, acao: "criar",
    unidadeNome: sala.unidade_nome, salaNome: sala.nome_exibicao, depois: sala,
  })
  return sala
}

export async function atualizarSala(id: string, input: Partial<SalaInput>): Promise<Sala> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(TABLE).select("*").eq("id", id).maybeSingle()
  const { data, error } = await sb
    .from(TABLE)
    .update(input)
    .eq("id", id)
    .select("*")
    .single()

  if (error) lancarErroDeEscrita(error, "editar esta sala", antes)
  const sala = normalizarSala(data as Sala)
  await registrarAuditoriaSala({
    tabela: "sala", registroId: sala.id, acao: "editar",
    unidadeNome: sala.unidade_nome, salaNome: sala.nome_exibicao, antes: antes ?? null, depois: sala,
  })
  return sala
}

export async function arquivarSala(id: string): Promise<void> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(TABLE).select("*").eq("id", id).maybeSingle()
  // `.select("id")` não é enfeite: sem ele um DELETE barrado pela RLS não
  // devolve erro nem linha, e a tela recarregaria com a sala ainda lá, sem
  // dizer nada a quem clicou em Excluir.
  const { data: apagadas, error } = await sb.from(TABLE).delete().eq("id", id).select("id")
  if (error) lancarErroDeEscrita(error, "excluir esta sala", antes)
  if ((apagadas ?? []).length === 0) throw erroDeEscritaNegada("excluir esta sala", antes)
  await registrarAuditoriaSala({
    tabela: "sala", registroId: id, acao: "excluir",
    unidadeNome: (antes as Sala | null)?.unidade_nome ?? null,
    salaNome: (antes as Sala | null)?.nome_exibicao ?? null,
    antes: antes ?? null,
  })
}

export async function bloquearSala(id: string, bloquear: boolean): Promise<Sala> {
  return atualizarSala(id, { status: bloquear ? "bloqueada" : "operacional" })
}

/**
 * Terapias que um profissional específico de fato realiza — do histórico real
 * de atendimento (`csv_grades_profissionais` via vw_grade_base) mais os slots
 * 'Livre' que a agenda já reservou pra ele, mesmo sem atendimento algum ainda.
 * Usado para restringir a lista de terapias do modal de alocação ao que essa
 * pessoa realmente faz, em vez de mostrar todas as terapias da clínica.
 */
/** Cache em memória por sessão de página — `csv_grades_profissionais` só muda 1x/dia (sync noturno), então reabrir o modal pro mesmo profissional não precisa repetir a consulta. */
const cacheTerapiasDoProfissional = new Map<string, Promise<string[]>>()

export function buscarTerapiasDoProfissional(profissionalNome: string, profissionalId?: number | null): Promise<string[]> {
  const chave = profissionalId != null ? `id:${profissionalId}` : `nome:${normTxt(profissionalNome)}`
  const cache = cacheTerapiasDoProfissional.get(chave)
  if (cache) return cache
  const promessa = buscarTerapiasDoProfissionalSemCache(profissionalNome, profissionalId)
  cacheTerapiasDoProfissional.set(chave, promessa)
  promessa.catch(() => cacheTerapiasDoProfissional.delete(chave))
  return promessa
}

async function buscarTerapiasDoProfissionalSemCache(profissionalNome: string, profissionalId?: number | null): Promise<string[]> {
  const nome = profissionalNome.trim()
  if (!nome) return []
  const data = await buscarGrade<Record<string, unknown>>({
    campos: "terapia_exibicao_nome, terapia_nome, paciente_nome, paciente_id, status_agendamento",
    fonte: "base",
    // Filtra por profissional_id quando disponível: usa o índice existente
    // (profissional_id, data) em vez de um ilike de nome sem índice, que
    // varre a tabela inteira (~150 mil linhas) a cada seleção de profissional.
    refinar: q => profissionalId != null ? q.eq("profissional_id", profissionalId) : q.ilike("profissional_nome", nome),
    // Esta é a única consulta da grade sem recorte de data, e o teto de 2.000 só
    // não truncava porque a tabela cobria 3 meses. Com o histórico de Jan–Jun
    // semeado ela passa a truncar — e sem ORDER BY o corte seria arbitrário,
    // deixando a lista de terapias instável entre chamadas. Ordenar por data desc
    // torna o corte determinístico e mantém o recorte no que a pessoa faz mais
    // recentemente.
    //
    // `id` não é enfeite: o teto de 2.000 são DUAS páginas de 1.000, e `data`
    // sozinha não é única — 25 profissionais passam de 1.000 linhas (máx. 1.871),
    // então a fronteira entre as páginas cai no meio de um grupo de mesma data.
    // Sem desempate estável a segunda página pode repetir ou PULAR linha, e a
    // terapia pulada some do dropdown de alocação.
    ordem: [{ coluna: "data", desc: true }, { coluna: "id" }],
    limite: 2000,
  })
  // 'Livre' (slot aberto, sem paciente marcado ainda) é o único status cujo
  // paciente_nome SEMPRE vem como o placeholder "Ainda não selecionado" —
  // medido em produção: as 10.879 linhas 'Livre' da grade, sem exceção. Não é
  // ruído: é um profissional real com um horário aberto numa terapia real,
  // exatamente o caso da Andréa Aparecida Borges de Oliveira (2026-08-27) — só
  // tinha slots 'Livre', nenhum atendimento no histórico ainda, e por isso
  // sumia inteira do filtro abaixo, fazendo o modal cair pra lista completa da
  // clínica em vez de mostrar só "Terapia Ocupacional".
  //
  // Sessão de paciente fictício/administrativo de verdade (Horário
  // Administrativo, Notificação Prévia, blocos de Supervisor etc. — mesmo
  // isFakePatient já usado em buscarLinhasAgendaParaSalas) tem status
  // diferente de 'Livre', e aí sim precisa continuar fora: o campo de terapia
  // dela não é uma terapia real ("Operações Clínicas", "Apoio Operacional").
  const nomes = data
    .filter(r => r.status_agendamento === "Livre" || !isFakePatient(r.paciente_nome as string | null, r.paciente_id !== null ? String(r.paciente_id) : null))
    // terapia_exibicao_nome só é preenchida quando existe paciente confirmado
    // (a "exibição" reflete o atendimento marcado) — numa linha 'Livre' ela
    // também vem como o placeholder "Ainda não selecionado", igual ao
    // paciente. terapia_nome é o que a sala/agenda reserva pra aquele slot e
    // está sempre presente, então é ele que carrega o sinal aqui.
    .map(r => fixMojibake(r.status_agendamento === "Livre" ? (r.terapia_nome as string | null) : (r.terapia_exibicao_nome as string | null) || (r.terapia_nome as string | null)))
    .map(t => t.trim())
    .filter(Boolean)
  return [...new Set(nomes)].sort()
}

export interface NucleoCadastrado {
  id: string
  nome: string
}

const NUCLEOS_TABLE = "cronograma_nucleos"

/** Núcleos cadastrados (tabela própria, não mais derivado das salas existentes) — usado no select do formulário de sala e na tela de gerenciamento. */
export async function listarNucleos(): Promise<NucleoCadastrado[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(NUCLEOS_TABLE).select("id, nome").order("nome")
  if (error) throw new Error(error.message)
  return (data ?? []) as NucleoCadastrado[]
}

export async function criarNucleo(nome: string): Promise<NucleoCadastrado> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(NUCLEOS_TABLE).insert({ nome: nome.trim() }).select("id, nome").single()
  if (error) lancarErroDeEscrita(error, "criar núcleos")
  const nucleo = data as NucleoCadastrado
  await registrarAuditoriaSala({ tabela: "nucleo", registroId: nucleo.id, acao: "criar", nucleoNome: nucleo.nome, depois: nucleo })
  return nucleo
}

/** Renomear propaga automaticamente pra todas as salas que usam esse núcleo (FK ON UPDATE CASCADE). */
export async function renomearNucleo(id: string, nome: string): Promise<NucleoCadastrado> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(NUCLEOS_TABLE).select("id, nome").eq("id", id).maybeSingle()
  const { data, error } = await sb.from(NUCLEOS_TABLE).update({ nome: nome.trim() }).eq("id", id).select("id, nome").single()
  if (error) lancarErroDeEscrita(error, "renomear núcleos", antes)
  const nucleo = data as NucleoCadastrado
  await registrarAuditoriaSala({ tabela: "nucleo", registroId: nucleo.id, acao: "editar", nucleoNome: nucleo.nome, antes: antes ?? null, depois: nucleo })
  return nucleo
}

/** Falha (FK ON DELETE RESTRICT) se alguma sala ainda usa esse núcleo — relança "EM_USO" pra UI oferecer mover as salas antes. */
export async function excluirNucleo(id: string): Promise<void> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(NUCLEOS_TABLE).select("id, nome").eq("id", id).maybeSingle()
  const { data: apagados, error } = await sb.from(NUCLEOS_TABLE).delete().eq("id", id).select("id")
  if (error) {
    if (error.code === "23503") throw new Error("EM_USO")
    lancarErroDeEscrita(error, "excluir núcleos", antes)
  }
  if ((apagados ?? []).length === 0) throw erroDeEscritaNegada("excluir núcleos", antes)
  await registrarAuditoriaSala({
    tabela: "nucleo", registroId: id, acao: "excluir",
    nucleoNome: (antes as NucleoCadastrado | null)?.nome ?? null, antes: antes ?? null,
  })
}

/** Move todas as salas de um núcleo para outro (usado antes de excluir um núcleo em uso) — registra 1 entrada de auditoria com a contagem movida. */
export async function moverSalasParaNucleo(deId: string, deNome: string, paraNome: string): Promise<number> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(TABLE).update({ nucleo: paraNome }).eq("nucleo", deNome).select("id")
  if (error) throw new Error(error.message)
  const qtd = (data ?? []).length
  await registrarAuditoriaSala({
    tabela: "nucleo", registroId: deId, acao: "editar", nucleoNome: deNome,
    motivo: `${qtd} sala(s) movida(s) do núcleo "${deNome}" para "${paraNome}".`,
  })
  return qtd
}

/** Paleta fixa de cores do módulo Cronograma (ver components/cronograma/ui/tones.ts) — status usa só essas 6, nunca cor livre. */
export type StatusTone = "green" | "amber" | "blue" | "purple" | "red" | "slate"

export interface StatusLabel {
  codigo: SalaStatus
  label: string
  label_curto: string
  tone: StatusTone
}

const STATUS_LABELS_TABLE = "cronograma_status_labels"

/**
 * Rótulos + cor dos status de sala — tabela própria com CRUD livre (mesmo
 * padrão de cronograma_nucleos). "operacional" é o único código especial: o
 * cálculo de ocupação (capacidadeProjetadaSala, statusDoSlot) trata "qualquer
 * status != operacional" genericamente como fora de operação, então
 * "operacional" nunca pode ser excluído (ver excluirStatusLabel).
 */
export async function listarStatusLabels(): Promise<StatusLabel[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(STATUS_LABELS_TABLE).select("codigo, label, label_curto, tone")
  if (error) throw new Error(error.message)
  return (data ?? []) as StatusLabel[]
}

/** Gera um código estável a partir do rótulo (minúsculo, sem acento, espaços viram "_") pra usar como chave primária/valor de cronograma_salas.status. */
function slugificarCodigoStatus(label: string): string {
  return label
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export async function criarStatusLabel(input: { label: string; label_curto: string; tone: StatusTone }): Promise<StatusLabel> {
  const sb = getSupabaseClient()
  const base = slugificarCodigoStatus(input.label) || "status"
  let codigo = base
  for (let sufixo = 2; ; sufixo++) {
    const { data: existente } = await sb.from(STATUS_LABELS_TABLE).select("codigo").eq("codigo", codigo).maybeSingle()
    if (!existente) break
    codigo = `${base}_${sufixo}`
  }
  const { data, error } = await sb
    .from(STATUS_LABELS_TABLE)
    .insert({ codigo, label: input.label.trim(), label_curto: input.label_curto.trim(), tone: input.tone })
    .select("codigo, label, label_curto, tone")
    .single()
  if (error) lancarErroDeEscrita(error, "criar status de sala")
  const statusLabel = data as StatusLabel
  await registrarAuditoriaSala({ tabela: "status_label", registroId: codigo, acao: "criar", depois: statusLabel })
  return statusLabel
}

/** "operacional" nunca pode ser excluído (motor de ocupação inteiro depende dele existir). Os demais falham (FK ON DELETE RESTRICT) se alguma sala ainda usa esse status — relança "EM_USO" pra UI oferecer mover as salas antes. */
export async function excluirStatusLabel(codigo: SalaStatus): Promise<void> {
  if (codigo === "operacional") {
    throw new Error("O status Operacional não pode ser excluído — o cálculo de ocupação depende dele.")
  }
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(STATUS_LABELS_TABLE).select("codigo, label, label_curto, tone").eq("codigo", codigo).maybeSingle()
  const { data: apagados, error } = await sb.from(STATUS_LABELS_TABLE).delete().eq("codigo", codigo).select("codigo")
  if (error) {
    if (error.code === "23503") throw new Error("EM_USO")
    lancarErroDeEscrita(error, "excluir status de sala", antes)
  }
  if ((apagados ?? []).length === 0) throw erroDeEscritaNegada("excluir status de sala", antes)
  await registrarAuditoriaSala({ tabela: "status_label", registroId: codigo, acao: "excluir", antes: antes ?? null })
}

/** Move todas as salas de um status para outro (usado antes de excluir um status em uso) — registra 1 entrada de auditoria com a contagem movida. */
export async function moverSalasParaStatus(deCodigo: SalaStatus, paraCodigo: SalaStatus): Promise<number> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(TABLE).update({ status: paraCodigo }).eq("status", deCodigo).select("id")
  if (error) throw new Error(error.message)
  const qtd = (data ?? []).length
  await registrarAuditoriaSala({
    tabela: "status_label", registroId: deCodigo, acao: "editar",
    motivo: `${qtd} sala(s) movida(s) do status "${deCodigo}" para "${paraCodigo}".`,
  })
  return qtd
}

export async function atualizarStatusLabel(codigo: SalaStatus, input: { label: string; label_curto: string; tone: StatusTone }): Promise<StatusLabel> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(STATUS_LABELS_TABLE).select("codigo, label, label_curto, tone").eq("codigo", codigo).maybeSingle()
  const { data, error } = await sb
    .from(STATUS_LABELS_TABLE)
    .update({ label: input.label.trim(), label_curto: input.label_curto.trim(), tone: input.tone })
    .eq("codigo", codigo)
    .select("codigo, label, label_curto, tone")
    .single()
  if (error) lancarErroDeEscrita(error, "editar status de sala", antes)
  const statusLabel = data as StatusLabel
  await registrarAuditoriaSala({ tabela: "status_label", registroId: codigo, acao: "editar", antes: antes ?? null, depois: statusLabel })
  return statusLabel
}

// ─── ALOCAÇÕES (planejamento de sala — não escreve na TiTa) ──────────────────

export async function listarAlocacoes(): Promise<AlocacaoSala[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(ALOCACOES_TABLE).select("*")
  if (error) throw new Error(error.message)
  return (data ?? []) as AlocacaoSala[]
}

/** Nome de exibição da sala, pra denormalizar na trilha de auditoria sem exigir join na leitura do histórico. */
async function nomeDaSala(salaId: string): Promise<string | null> {
  const sb = getSupabaseClient()
  const { data } = await sb.from(TABLE).select("nome_exibicao").eq("id", salaId).maybeSingle()
  return (data as { nome_exibicao: string } | null)?.nome_exibicao ?? null
}

export async function criarAlocacao(input: AlocacaoInput): Promise<AlocacaoSala> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(ALOCACOES_TABLE).insert(input).select("*").single()
  if (error) lancarErroDeEscrita(error, "alocar sessões nesta tela")
  const alocacao = data as AlocacaoSala
  await registrarAuditoriaSala({
    tabela: "alocacao", registroId: alocacao.id, acao: "criar",
    salaNome: await nomeDaSala(alocacao.sala_id), profissionalNome: alocacao.profissional_nome,
    terapiaNome: alocacao.terapia_nome, diaSemana: alocacao.dow, turno: alocacao.turno, depois: alocacao,
  })
  return alocacao
}

/** Atualiza uma alocação existente (usado tanto para "mover" — muda sala/dia/turno — quanto para editar profissional/terapia). */
export async function atualizarAlocacao(id: string, input: Partial<AlocacaoInput>): Promise<AlocacaoSala> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(ALOCACOES_TABLE).select("*").eq("id", id).maybeSingle()
  const { data, error } = await sb.from(ALOCACOES_TABLE).update(input).eq("id", id).select("*").single()
  if (error) lancarErroDeEscrita(error, "editar ou mover esta alocação", antes)
  const alocacao = data as AlocacaoSala
  await registrarAuditoriaSala({
    tabela: "alocacao", registroId: alocacao.id, acao: "editar",
    salaNome: await nomeDaSala(alocacao.sala_id), profissionalNome: alocacao.profissional_nome,
    terapiaNome: alocacao.terapia_nome, diaSemana: alocacao.dow, turno: alocacao.turno,
    antes: antes ?? null, depois: alocacao,
  })
  return alocacao
}

export async function excluirAlocacao(id: string): Promise<void> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(ALOCACOES_TABLE).select("*").eq("id", id).maybeSingle()
  const { data: apagadas, error } = await sb.from(ALOCACOES_TABLE).delete().eq("id", id).select("id")
  if (error) lancarErroDeEscrita(error, "excluir esta alocação", antes)
  if ((apagadas ?? []).length === 0) throw erroDeEscritaNegada("excluir esta alocação", antes)
  const alocacaoAntes = antes as AlocacaoSala | null
  await registrarAuditoriaSala({
    tabela: "alocacao", registroId: id, acao: "excluir",
    salaNome: alocacaoAntes ? await nomeDaSala(alocacaoAntes.sala_id) : null,
    profissionalNome: alocacaoAntes?.profissional_nome ?? null, terapiaNome: alocacaoAntes?.terapia_nome ?? null,
    diaSemana: alocacaoAntes?.dow ?? null, turno: alocacaoAntes?.turno ?? null, antes: antes ?? null,
  })
}

// ─── EXCLUSIVIDADE DE SALAS POR TERAPIA ──────────────────────────────────────

const EXCLUSIVIDADE_TERAPIA_TABLE = "cronograma_salas_terapias_exclusivas"

export async function listarExclusividadesTerapia(): Promise<SalaTerapiaExclusiva[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(EXCLUSIVIDADE_TERAPIA_TABLE).select("*").order("terapia_nome")
  if (error) throw new Error(error.message)
  return (data ?? []) as SalaTerapiaExclusiva[]
}

export async function criarExclusividadeTerapia(input: SalaTerapiaExclusivaInput): Promise<SalaTerapiaExclusiva> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(EXCLUSIVIDADE_TERAPIA_TABLE).insert(input).select("*").single()
  if (error) lancarErroDeEscrita(error, "criar exclusividades de terapia")
  const exclusividade = data as SalaTerapiaExclusiva
  await registrarAuditoriaSala({
    tabela: "exclusividade_terapia", registroId: exclusividade.id, acao: "criar",
    salaNome: await nomeDaSala(exclusividade.sala_id), terapiaNome: exclusividade.terapia_nome, depois: exclusividade,
  })
  return exclusividade
}

/** Só o `modo` é editável — sala e terapia definem a identidade da linha (trocar exige excluir e criar outra). */
export async function atualizarModoExclusividadeTerapia(id: string, modo: SalaTerapiaExclusivaInput["modo"]): Promise<SalaTerapiaExclusiva> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(EXCLUSIVIDADE_TERAPIA_TABLE).select("*").eq("id", id).maybeSingle()
  const { data, error } = await sb.from(EXCLUSIVIDADE_TERAPIA_TABLE).update({ modo }).eq("id", id).select("*").single()
  if (error) lancarErroDeEscrita(error, "editar exclusividades de terapia", antes)
  const exclusividade = data as SalaTerapiaExclusiva
  await registrarAuditoriaSala({
    tabela: "exclusividade_terapia", registroId: exclusividade.id, acao: "editar",
    salaNome: await nomeDaSala(exclusividade.sala_id), terapiaNome: exclusividade.terapia_nome,
    antes: antes ?? null, depois: exclusividade,
  })
  return exclusividade
}

export async function excluirExclusividadeTerapia(id: string): Promise<void> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(EXCLUSIVIDADE_TERAPIA_TABLE).select("*").eq("id", id).maybeSingle()
  const { data: apagadas, error } = await sb.from(EXCLUSIVIDADE_TERAPIA_TABLE).delete().eq("id", id).select("id")
  if (error) lancarErroDeEscrita(error, "excluir exclusividades de terapia", antes)
  if ((apagadas ?? []).length === 0) throw erroDeEscritaNegada("excluir exclusividades de terapia", antes)
  const exclusividadeAntes = antes as SalaTerapiaExclusiva | null
  await registrarAuditoriaSala({
    tabela: "exclusividade_terapia", registroId: id, acao: "excluir",
    salaNome: exclusividadeAntes ? await nomeDaSala(exclusividadeAntes.sala_id) : null,
    terapiaNome: exclusividadeAntes?.terapia_nome ?? null, antes: antes ?? null,
  })
}

export interface ProfissionalOpcao {
  id: number | null
  nome: string
}

/**
 * Lista TODOS os profissionais distintos de csv_grades_profissionais — carregada
 * uma vez ao abrir o modal de alocação, pra a lista já vir disponível antes de
 * digitar (filtro é feito no cliente conforme o usuário digita, sem round-trip
 * ao banco por tecla — ver AlocarSessaoModal). Inclui o `profissional_id` (chave
 * estável, não muda se o nome for editado na TiTa) — usado para gravar a
 * alocação com o ID, não só o nome, e viabilizar o cruzamento por ID na aba
 * Regularizações.
 */
/**
 * Usa vw_cronograma_profissionais_salas (DISTINCT já feito no banco) em vez
 * de paginar csv_grades_profissionais inteira (54 mil+ linhas para ~120
 * profissionais distintos) — ver comentário na migration que criou a view.
 */
export async function listarTodosProfissionaisSalas(): Promise<ProfissionalOpcao[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from("vw_cronograma_profissionais_salas")
    .select("profissional_id, profissional_nome")

  if (error) throw new Error(error.message)
  const porNome = new Map<string, ProfissionalOpcao>()
  ;(data ?? []).forEach(r => {
    const nome = fixMojibake(r.profissional_nome as string).trim()
    if (!nome) return
    if (!porNome.has(nome)) porNome.set(nome, { id: (r.profissional_id as number | null) ?? null, nome })
  })
  return [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome))
}

const AGENDA_FIELDS = [
  "tita_agendamento_id", "paciente_id", "paciente_nome", "convenio_nome", "unidade_nome", "sala_nome",
  "profissional_nome", "profissional_id", "terapia_id", "terapia_nome", "terapia_exibicao_id", "terapia_exibicao_nome",
  "dia_semana", "hora_inicial", "hora_final", "status_agendamento", "data",
].join(", ")

/** Busca linhas de agendamento do período, para cruzar com o cadastro de salas. */
export async function buscarLinhasAgendaParaSalas(dataInicio: string, dataFim: string): Promise<AgendaSalaRow[]> {
  // Fonte "base" sem recorte: a ocupação de salas conta tanto o horário
  // ocupado quanto o slot 'Livre', e não se restringe à unidade 280.
  const all = await buscarGrade<AgendaSalaRow>({
    campos: AGENDA_FIELDS,
    fonte: "base",
    de: dataInicio,
    ate: dataFim,
    // `id` fecha a ordenação: um mês inteiro passa de 1.000 linhas e portanto
    // pagina, e (data, hora_inicial) tem empate de sobra — sem desempate único
    // a paginação pode repetir ou pular sessão.
    ordem: [{ coluna: "data" }, { coluna: "hora_inicial" }, { coluna: "id" }],
  })

  return all
    .map(r => ({
      ...r,
      paciente_nome: fixMojibake(r.paciente_nome),
      convenio_nome: fixMojibake(r.convenio_nome),
      unidade_nome: fixMojibake(r.unidade_nome),
      sala_nome: fixMojibake(r.sala_nome),
      profissional_nome: fixMojibake(r.profissional_nome),
      terapia_nome: fixMojibake(r.terapia_nome),
      terapia_exibicao_nome: fixMojibake(r.terapia_exibicao_nome),
    }))
    // Pacientes fictícios/administrativos (Horário Administrativo, Notificação
    // Prévia, Supervisor(a), etc. — ver isFakePatient em
    // lib/remuneracao/pacientes.ts) não são atendimento real e não devem contar
    // como ocupação de sala nem aparecer em "Terapias mais frequentes".
    //
    // 'Livre' é a exceção: TODO slot 'Livre' tem paciente_nome = "Ainda não
    // selecionado" por design (agenda aberta, sem paciente marcado ainda) —
    // não é ruído, é o profissional real com um horário real reservado. Barrar
    // esse status aqui também apagava a linha antes mesmo dela chegar em
    // calcularSlotsDaSala, que já sabe separar "tem Livre" de "tem Agendado"
    // (ver semCruzamentoCsv/livrePorProfissionalId em lib/cronograma/salas.ts)
    // — sem isso o card ficava preso em "Alocação sem sessão"/"sem cruzamento
    // no CSV" mesmo pro profissional com agenda aberta de verdade (caso da
    // Andréa Aparecida Borges de Oliveira, 2026-08-27).
    //
    // Os dois outros consumidores desta função (calcularDashboardPacientes via
    // isAgendadoAtivo, enriquecerComDeducaoFalta/calcularSessoesMensaisPorConvenio
    // também via isAgendadoAtivo) já reaplicam o próprio filtro de
    // status_agendamento="agendado" antes de contar qualquer coisa — não
    // dependem deste filtro pra excluir 'Livre', então soltar essa exceção
    // aqui não vaza slot aberto pra "Terapias mais frequentes" nem pra Previsão
    // de Receitas.
    .filter(r => r.status_agendamento === "Livre" || !isFakePatient(r.paciente_nome, r.paciente_id !== null ? String(r.paciente_id) : null))
}

/**
 * Sessões de "Horário Administrativo"/"Horário Bloqueado" no período — mesmos
 * placeholders excluídos de `buscarLinhasAgendaParaSalas` acima (não são
 * atendimento real), mas usados em RegularizacoesView (ver
 * calcularRegularizacoes) só para não sinalizar como "está na Ocupação de
 * Salas, mas não está no TiTa" uma alocação que cobre um bloqueio desses.
 */
export async function buscarTurnosBloqueioAdministrativo(dataInicio: string, dataFim: string): Promise<AgendaSalaRow[]> {
  const all = await buscarGrade<AgendaSalaRow>({
    campos: AGENDA_FIELDS,
    fonte: "base",
    de: dataInicio,
    ate: dataFim,
    ordem: [{ coluna: "data" }, { coluna: "hora_inicial" }, { coluna: "id" }],
  })

  return all
    .map(r => ({ ...r, paciente_nome: fixMojibake(r.paciente_nome), profissional_nome: fixMojibake(r.profissional_nome) }))
    .filter(r => r.paciente_nome != null && PACS_BLOQUEIO_ADMIN.has(r.paciente_nome))
}