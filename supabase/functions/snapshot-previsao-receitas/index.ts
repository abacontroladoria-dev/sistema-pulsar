// Etapa 4 da evolução da Previsão de Receitas: snapshot diário.
//
// Roda a mesma lógica de "Por paciente" (calcularSessoesMensaisPorConvenio em
// frontend/lib/cronograma/faturamentoProjecao.ts) sobre as sessões REAIS do
// mês, gravando um retrato por sessão em previsao_receitas_historico com
// snapshot_data = hoje. Portado pra Deno de forma autocontida (sem import
// cross-função) — ver comentário PORTED abaixo em cada trecho copiado do
// frontend, e manter em sincronia se a lógica de origem mudar.
//
// Diferente de sync-grade-csv, esta function NÃO chama a API do TiTa — só lê
// dados já sincronizados em csv_grades_profissionais/fila_autorizacoes e
// grava o retrato. Isso mantém o tempo de execução bem abaixo do timeout de
// 150s da Supabase mesmo processando o mês inteiro (ver
// project_sync_grade_csv_deploy_drift_fix na memória do projeto pro histórico
// desse limite).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const PAGE = 1000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

// ─── PORTED de frontend/lib/cronograma/gradeService.ts (fixMojibake) ────────
const MOJIBAKE_RE = /[Â-Ã][-¿]/
function fixMojibake(s: string | null | undefined): string {
  const str = s ?? ""
  if (!str || !MOJIBAKE_RE.test(str)) return str
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(str, c => c.charCodeAt(0) & 0xff))
  } catch {
    return str
  }
}

// ─── PORTED de frontend/lib/remuneracao/constants.ts + pacientes.ts ─────────
const NOMES_FALSOS = ["Notificação Prévia", "Horário Bloqueado", "Ainda não selecionado", "Horário Reservado"]
const IDS_FAVORECIDOS_FALSOS = [
  "17795", "18565", "19196", "20471", "20472", "20473",
  "20475", "20476", "20477", "20478", "20479", "20725",
  "Ainda não selecionado",
]
const PACIENTES_FICTICIOS_POR_ID: Record<string, string> = {
  "17795": "Notificação Prévia", "18565": "Horário Administrativo", "19196": "Horário Bloqueado",
  "20471": "Alinhamento Sandra", "20472": "Alinhamento Gracielle", "20473": "Alinhamento Amanda",
  "20475": "Supervisor Severino Junior", "20476": "Supervisora Michelle Brasil",
  "20477": "Supervisora Susane Vitória", "20478": "Supervisora Beatriz Paiva",
  "20479": "Supervisora Fernanda Lima", "20725": "Paciente Teste Sanderson",
}
const NOMES_FALSOS_PREFIXOS = ["Supervisor", "Supervisora", "Alinhamento", "Paciente Teste"]
const ETA_ADMIN_NOMES = ["Horário Administrativo"]

function isFakePatient(nome: string | null | undefined, idFavorecido?: string | null): boolean {
  const id = String(idFavorecido ?? "").replace(/\s+/g, " ").trim()
  if (id && (IDS_FAVORECIDOS_FALSOS.some(f => id === f) || Object.prototype.hasOwnProperty.call(PACIENTES_FICTICIOS_POR_ID, id))) return true
  if (!nome) return false
  const n = String(nome).replace(/\s+/g, " ").trim()
  if (!n) return false
  if (NOMES_FALSOS.some(f => n.includes(f))) return true
  if (ETA_ADMIN_NOMES.some(f => n.includes(f))) return true
  if (NOMES_FALSOS_PREFIXOS.some(p => n.startsWith(p))) return true
  return false
}

// ─── PORTED de frontend/lib/cronograma/constants.ts ─────────────────────────
function normTxt(s: string | null | undefined): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}
const EXIB_ID = { PSICOLOGIA_ABA: 2271 } as const

// MEMORIAL SAÚDE LTDA encerrou e toda a carteira migrou para ASSIM Saúde (ver
// mesmo fato em scripts/importar-favorecidos-tita.js), mas o backup XLS de
// Jan-Mar/2026 ainda traz o nome antigo do convênio nas sessões. Sem este
// alias, cronograma_convenio_valores (só tem regra pra "ASSIM Saúde") nunca
// resolve preço pra essas sessões — medido: 99,5% do "sem_valor" de Jan-Mar
// era exatamente isto (17.869 de ~17.870 linhas), e 9 de 10 pacientes
// amostrados sob MEMORIAL no histórico já estão cadastrados como ASSIM Saúde
// hoje. Aplicado ANTES da resolução de preço e do agrupamento por convênio,
// pra essas sessões caírem no mesmo bucket de "ASSIM Saúde" do resto do ano.
const CONVENIO_ALIAS_HISTORICO: Record<string, string> = {
  "MEMORIAL SAÚDE LTDA": "ASSIM Saúde",
}
const PROCESSO_DIAGNOSTICO_IDS = new Set([2268, 2695, 2270])
const PROCESSO_DIAGNOSTICO_NAMES = new Set(["Avaliação Neuropsicológica", "Psiquiatra/Neurologista", "Triagem"])

// ─── PORTED de frontend/lib/cronograma/helpers.ts ───────────────────────────
function cleanTxt(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim()
}

// ─── PORTED de frontend/lib/cronograma/convenioValoresTypes.ts ──────────────
const TERAPIAS_PACOTE_IDS = new Set([2268, 2695])

type ConvenioValor = {
  convenio_nome: string; terapia_id: number | null; terapia_nome: string | null
  criterio_aba: "com_aba" | "sem_aba" | null; valor_sessao: number | null
}
type ConvenioValorPaciente = {
  convenio_nome: string; paciente_id: number | null; paciente_nome: string; valor_sessao: number | null
}
type ConvenioPacoteAvaliacao = { convenio_nome: string; terapia_id: number; valor_a_vista: number }

type AgendaSalaRow = {
  id: string; origem: string | null
  tita_agendamento_id: number | null; paciente_id: number | null; paciente_nome: string | null
  convenio_nome: string | null; terapia_id: number | null; terapia_nome: string | null
  terapia_exibicao_id: number | null; terapia_exibicao_nome: string | null
  hora_inicial: string | null; status_agendamento: string | null; data: string | null
}

// ─── PORTED de frontend/lib/cronograma/pacientesDashboard.ts ────────────────
function isAgendadoAtivo(r: AgendaSalaRow): boolean {
  const status = cleanTxt(r.status_agendamento).toLowerCase()
  const paciente = cleanTxt(r.paciente_nome)
  if (!status.includes("agendado") || !paciente) return false
  if (isFakePatient(paciente, r.paciente_id !== null && r.paciente_id !== undefined ? String(r.paciente_id) : null)) return false
  return true
}

function isTerapiaDiagnostico(r: AgendaSalaRow): boolean {
  if (r.terapia_id !== null && r.terapia_id !== undefined) return PROCESSO_DIAGNOSTICO_IDS.has(r.terapia_id)
  if (r.terapia_exibicao_id !== null && r.terapia_exibicao_id !== undefined) return PROCESSO_DIAGNOSTICO_IDS.has(r.terapia_exibicao_id)
  const acao = cleanTxt(r.terapia_nome)
  if (acao) return PROCESSO_DIAGNOSTICO_NAMES.has(acao)
  return PROCESSO_DIAGNOSTICO_NAMES.has(cleanTxt(r.terapia_exibicao_nome))
}

// ─── PORTED de frontend/lib/cronograma/faturamentoProjecao.ts ───────────────
type OrigemValor = "paciente" | "criterio_aba" | "terapia" | "geral" | "pacote_avaliacao" | "sem_valor"

function normEq(a: string, b: string): boolean {
  return normTxt(a) === normTxt(b)
}

function pacienteKey(pacienteId: number | null, paciente: string): string {
  return pacienteId !== null ? `id:${pacienteId}` : `nome:${normTxt(paciente)}`
}

function resolverValorSessao(
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
  params: { convenio: string; pacienteId: number | null; paciente: string; terapiaId: number | null; terapiaNome: string; temPsicologiaAba: boolean },
): { valor: number | null; origem: OrigemValor } {
  const { convenio, pacienteId, paciente, terapiaId, terapiaNome, temPsicologiaAba } = params

  const excecao = excecoesPaciente.find(e => {
    if (!normEq(e.convenio_nome, convenio)) return false
    if (e.paciente_id !== null) return pacienteId !== null && e.paciente_id === pacienteId
    return normEq(e.paciente_nome, paciente)
  })
  if (excecao && excecao.valor_sessao !== null) return { valor: excecao.valor_sessao, origem: "paciente" }

  const criterioEsperado = temPsicologiaAba ? "com_aba" : "sem_aba"
  const regraCriterioAba = regrasGerais.find(r => r.criterio_aba === criterioEsperado && normEq(r.convenio_nome, convenio))
  if (regraCriterioAba && regraCriterioAba.valor_sessao !== null) return { valor: regraCriterioAba.valor_sessao, origem: "criterio_aba" }

  const regraTerapia = regrasGerais.find(r => {
    if (!normEq(r.convenio_nome, convenio)) return false
    if (r.terapia_id !== null) return terapiaId !== null && r.terapia_id === terapiaId
    return !!r.terapia_nome && normEq(r.terapia_nome, terapiaNome)
  })
  if (regraTerapia && regraTerapia.valor_sessao !== null) return { valor: regraTerapia.valor_sessao, origem: "terapia" }

  const regraGeral = regrasGerais.find(r => r.terapia_id === null && !r.terapia_nome && r.criterio_aba === null && normEq(r.convenio_nome, convenio))
  if (regraGeral && regraGeral.valor_sessao !== null) return { valor: regraGeral.valor_sessao, origem: "geral" }

  return { valor: null, origem: "sem_valor" }
}

interface SessaoSnapshot {
  agendamentoId: number | null
  pacienteId: number | null
  pacienteNome: string
  terapiaId: number | null
  terapiaNome: string
  data: string
  horaInicial: string | null
  valor: number | null
  origem: OrigemValor
  emFalta: boolean
}

/** Sessões (por convênio) de um segmento — mesma lógica de agregarSegmento em faturamentoProjecao.ts, mas sem porDia/porTerapia/pacotesTerapia (não usados no histórico por sessão). */
function sessoesPorConvenio(
  rows: AgendaSalaRow[],
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
  pacotesAvaliacao: ConvenioPacoteAvaliacao[],
  pacientesComAba: Set<string>,
  faltasSet: Set<number>,
  faltasPorGradeId: Set<string>,
): Map<string, SessaoSnapshot[]> {
  const porConvenio = new Map<string, SessaoSnapshot[]>()

  rows.forEach(r => {
    const data = cleanTxt(r.data)
    const dow = data ? new Date(`${data}T12:00:00`).getDay() : NaN
    if (!Number.isFinite(dow) || dow < 1 || dow > 5) return

    const convenioBruto = cleanTxt(r.convenio_nome) || "Não informado"
    const convenio = CONVENIO_ALIAS_HISTORICO[convenioBruto] ?? convenioBruto
    const pacienteId = r.paciente_id ?? null
    const paciente = cleanTxt(r.paciente_nome)
    const terapiaId = r.terapia_id ?? r.terapia_exibicao_id ?? null
    const terapiaNome = cleanTxt(r.terapia_nome) || cleanTxt(r.terapia_exibicao_nome) || "Não informado"
    const temPsicologiaAba = pacientesComAba.has(pacienteKey(pacienteId, paciente))

    const resolvido = resolverValorSessao(regrasGerais, excecoesPaciente, { convenio, pacienteId, paciente, terapiaId, terapiaNome, temPsicologiaAba })
    const { valor } = resolvido
    // origem/pacoteSemRegistro seguem o mesmo cálculo de agregarSegmento (só
    // usados lá pra bucket de agregação "sem valor" — aqui o valor por sessão
    // fica igual ao resolvido, sem null-out extra, pra bater exatamente com
    // o que "Por paciente" mostra ao vivo).
    const origem: OrigemValor = terapiaId !== null && TERAPIAS_PACOTE_IDS.has(terapiaId) ? "pacote_avaliacao" : resolvido.origem

    const agendamentoId = r.tita_agendamento_id ?? null

    // Bifurcação por origem da sessão: 'backup_xls' (Jan-Jun/2026, seed do
    // backup XLS) nunca tem tita_agendamento_id, então a falta vem de
    // faltas_historico_csv (backfill do relatório do Órbita), casada pelo
    // uuid da própria sessão. 'tita_csv' (API viva, >= 2026-08-05) continua
    // exatamente como antes, via fila_autorizacoes. Uma sessão é só uma das
    // duas origens — nunca as duas —, então não há risco de contar a mesma
    // falta duas vezes. NÃO "corrigir" isto pra usar tita_agendamento_id
    // também no backup_xls: esse id não existe nessas linhas por construção
    // (o backup nunca trouxe o id do agendamento, ver scripts/lib/backup-grade.js).
    const emFalta = r.origem === "backup_xls"
      ? faltasPorGradeId.has(r.id)
      : agendamentoId !== null && faltasSet.has(agendamentoId)

    if (!porConvenio.has(convenio)) porConvenio.set(convenio, [])
    porConvenio.get(convenio)!.push({
      agendamentoId, pacienteId, pacienteNome: paciente || "Não informado",
      terapiaId, terapiaNome, data, horaInicial: cleanTxt(r.hora_inicial) || null,
      valor, origem,
      emFalta,
    })
  })

  return porConvenio
}

function calcularSessoesMensaisPorConvenio(
  rowsMesInteiro: AgendaSalaRow[],
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
  pacotesAvaliacao: ConvenioPacoteAvaliacao[],
  faltasSet: Set<number>,
  faltasPorGradeId: Set<string>,
): { multidisciplinar: Map<string, SessaoSnapshot[]>; processoDiagnostico: Map<string, SessaoSnapshot[]> } {
  const ativos = rowsMesInteiro.filter(isAgendadoAtivo)

  const pacientesComAba = new Set<string>()
  ativos.forEach(r => {
    if (r.terapia_exibicao_id !== EXIB_ID.PSICOLOGIA_ABA) return
    pacientesComAba.add(pacienteKey(r.paciente_id ?? null, cleanTxt(r.paciente_nome)))
  })

  const rowsMultidisciplinar = ativos.filter(r => !isTerapiaDiagnostico(r))
  const rowsDiagnostico = ativos.filter(isTerapiaDiagnostico)

  return {
    multidisciplinar: sessoesPorConvenio(rowsMultidisciplinar, regrasGerais, excecoesPaciente, pacotesAvaliacao, pacientesComAba, faltasSet, faltasPorGradeId),
    processoDiagnostico: sessoesPorConvenio(rowsDiagnostico, [], [], pacotesAvaliacao, pacientesComAba, faltasSet, faltasPorGradeId),
  }
}

// ─── Fetch helpers (Supabase) ────────────────────────────────────────────────

async function pageAll<T>(sb: ReturnType<typeof createClient>, table: string, select: string, apply: (q: any) => any): Promise<T[]> {
  const all: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await apply(sb.from(table).select(select).range(from, from + PAGE - 1))
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as T[]
    all.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}

function mesInteiroRange(ano: number, mes: number): { inicio: string; fim: string } {
  const inicio = new Date(Date.UTC(ano, mes - 1, 1)).toISOString().slice(0, 10)
  const fim = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10)
  return { inicio, fim }
}

/**
 * Esta função só deve ser chamada pelo cron (net.http_post com o token do
 * Vault) — nunca por um usuário comum do app, mesmo autenticado. Diferente
 * das funções admin-* (que resolvem o usuário e checam usuarios.role), aqui
 * quem chama não é uma pessoa, é o próprio job — então a checagem certa é o
 * "role" do JWT em si (claim "role"), não a identidade de um usuário: só um
 * JWT cujo claim role === "service_role" (ou seja, quem já possui a
 * SUPABASE_SERVICE_ROLE_KEY) passa. Um usuário comum logado tem role
 * "authenticated" no token, e a anon key tem role "anon" — ambos são
 * rejeitados. Isso fecha o achado da revisão de segurança de 2026-07-28:
 * antes, qualquer JWT válido (inclusive de um usuário sem privilégio
 * nenhum) conseguia invocar esta function e sobrescrever/"fechar"
 * indevidamente o histórico financeiro.
 */
function chamadorEhServiceRole(req: Request): boolean {
  const auth = req.headers.get("authorization") || ""
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return false
  try {
    const payloadB64 = token.split(".")[1]
    const payloadJson = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
    const payload = JSON.parse(payloadJson) as { role?: string }
    return payload.role === "service_role"
  } catch {
    return false
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  if (!chamadorEhServiceRole(req)) return json({ error: "forbidden" }, 403)

  const body = await req.json().catch(() => ({})) as { competencia?: string; fechamento?: boolean }
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
  const snapshotData = hoje.toISOString().slice(0, 10)

  let ano: number, mes: number
  if (body.competencia && /^\d{4}-\d{2}$/.test(body.competencia)) {
    ;[ano, mes] = body.competencia.split("-").map(Number)
  } else {
    ano = hoje.getFullYear()
    mes = hoje.getMonth() + 1
  }
  const competencia = `${ano}-${String(mes).padStart(2, "0")}`
  const { inicio, fim } = mesInteiroRange(ano, mes)

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  try {
    const AGENDA_FIELDS = "id, origem, tita_agendamento_id, paciente_id, paciente_nome, convenio_nome, terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome, hora_inicial, status_agendamento, data"
    // vw_grade_base é o ponto único de leitura da grade (migration 20260806110000);
    // no frontend o equivalente é lib/grade/fonte.ts, que não dá para importar aqui
    // (Deno). A view já garante `ativo` — versionamento da grade
    // (migration 20260805160000): o sync não apaga mais, inativa a versão antiga e
    // insere a nova, e sem esse filtro uma sessão remarcada entraria duas vezes no
    // snapshot e inflaria a previsão de receita do mês.
    //
    // "base" e não "atendimentos" porque esta consulta não recorta unidade e
    // devolve status_agendamento adiante — o mesmo alcance de antes.
    const linhasRaw = await pageAll<AgendaSalaRow>(sb, "vw_grade_base", AGENDA_FIELDS, q => q.gte("data", inicio).lte("data", fim).order("data"))
    const linhas = linhasRaw
      .map(r => ({
        ...r,
        paciente_nome: fixMojibake(r.paciente_nome),
        convenio_nome: fixMojibake(r.convenio_nome),
        terapia_nome: fixMojibake(r.terapia_nome),
        terapia_exibicao_nome: fixMojibake(r.terapia_exibicao_nome),
      }))
      .filter(r => !isFakePatient(r.paciente_nome, r.paciente_id !== null ? String(r.paciente_id) : null))

    const regrasGerais = await pageAll<ConvenioValor>(sb, "cronograma_convenio_valores", "convenio_nome, terapia_id, terapia_nome, criterio_aba, valor_sessao", q => q)
    const excecoesPaciente = await pageAll<ConvenioValorPaciente>(sb, "cronograma_convenio_valores_paciente", "convenio_nome, paciente_id, paciente_nome, valor_sessao", q => q)
    const pacotesAvaliacao = await pageAll<ConvenioPacoteAvaliacao>(sb, "cronograma_convenio_pacote_avaliacao", "convenio_nome, terapia_id, valor_a_vista", q => q)

    const faltasRows = await pageAll<{ tita_agendamento_id: number }>(
      sb, "fila_autorizacoes", "tita_agendamento_id",
      q => q.eq("status", "falta").is("falta_revertida_em", null).not("tita_agendamento_id", "is", null)
        .gte("data_atendimento", inicio).lte("data_atendimento", fim),
    )
    const faltasSet = new Set(faltasRows.map(r => Number(r.tita_agendamento_id)))

    // Fonte 2, só para sessões origem='backup_xls' (Jan-Jun/2026 e até
    // 2026-08-04): faltas_historico_csv, backfill importado do relatório
    // "relatorio_faltas_detalhado" do Órbita. presenca_bool=false
    // decide sozinho — sem filtrar por tipo_falta/motivo, igual ao critério
    // real de fila_autorizacoes.status='falta' (que também não filtra por
    // tipo, ver 20260908100200_falta_da_unidade_fora_da_assiduidade.sql).
    const faltasHistoricoRows = await pageAll<{ csv_grade_id: string }>(
      sb, "faltas_historico_csv", "csv_grade_id",
      q => q.eq("presenca_bool", false).not("csv_grade_id", "is", null)
        .gte("data_agendamento", inicio).lte("data_agendamento", fim),
    )
    const faltasPorGradeId = new Set(faltasHistoricoRows.map(r => r.csv_grade_id))

    const { multidisciplinar, processoDiagnostico } = calcularSessoesMensaisPorConvenio(
      linhas, regrasGerais, excecoesPaciente, pacotesAvaliacao, faltasSet, faltasPorGradeId,
    )

    const registros: Record<string, unknown>[] = []
    const achatar = (segmento: string, porConvenio: Map<string, SessaoSnapshot[]>) => {
      for (const [convenio, sessoes] of porConvenio) {
        for (const s of sessoes) {
          registros.push({
            snapshot_data: snapshotData,
            competencia,
            segmento,
            convenio_nome: convenio,
            tita_agendamento_id: s.agendamentoId,
            paciente_id: s.pacienteId,
            paciente_nome: s.pacienteNome,
            terapia_id: s.terapiaId,
            terapia_nome: s.terapiaNome,
            data_sessao: s.data,
            hora_inicial: s.horaInicial,
            valor: s.valor,
            origem_valor: s.origem,
            em_falta: s.emFalta,
          })
        }
      }
    }
    achatar("multidisciplinar", multidisciplinar)
    achatar("processo_diagnostico", processoDiagnostico)

    // Idempotente: se essa function já rodou hoje pra essa competência, substitui.
    const { error: delError } = await sb
      .from("previsao_receitas_historico")
      .delete()
      .eq("snapshot_data", snapshotData)
      .eq("competencia", competencia)
    if (delError) throw new Error(`delete: ${delError.message}`)

    for (let i = 0; i < registros.length; i += 500) {
      const { error } = await sb.from("previsao_receitas_historico").insert(registros.slice(i, i + 500))
      if (error) throw new Error(`insert: ${error.message}`)
    }

    // ─── Resumo mensal (1 linha por competência) ────────────────────────────
    // 'parcial' nas execuções diárias normais (mês corrente, ainda em
    // andamento) e 'fechado' na execução de fechamento (job separado, alguns
    // dias depois do mês virar — dá tempo de faltas atrasadas entrarem antes
    // do número virar "final"). Dedução só soma no segmento multidisciplinar,
    // mesmo critério do resto do sistema (Processo Diagnóstico é cobrado em
    // bloco/pacote, uma falta pontual não reduz nada).
    const pacientesUnicos = new Set<string>()
    let sessoesMes = 0, faltasMes = 0, receitaSemDeducao = 0, deducaoFalta = 0
    for (const r of registros) {
      sessoesMes += 1
      pacientesUnicos.add(pacienteKey(r.paciente_id as number | null, cleanTxt(r.paciente_nome as string)))
      if (r.em_falta) faltasMes += 1
      if (typeof r.valor === "number") {
        receitaSemDeducao += r.valor
        if (r.em_falta && r.segmento === "multidisciplinar") deducaoFalta += r.valor
      }
    }

    const { error: resumoError } = await sb.from("previsao_receitas_historico_resumo").upsert({
      competencia,
      status: body.fechamento ? "fechado" : "parcial",
      snapshot_data: snapshotData,
      sessoes_mes: sessoesMes,
      faltas_mes: faltasMes,
      pacientes_unicos: pacientesUnicos.size,
      receita_sem_deducao: receitaSemDeducao,
      deducao_falta: deducaoFalta,
      receita_com_deducao: receitaSemDeducao - deducaoFalta,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "competencia" })
    if (resumoError) throw new Error(`resumo: ${resumoError.message}`)

    return json({ ok: true, competencia, snapshotData, fechamento: !!body.fechamento, totalSessoes: registros.length, totalLinhasAgenda: linhas.length })
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500)
  }
})
