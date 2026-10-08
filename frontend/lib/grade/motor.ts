import { deMin, horaCurta, paraMin, sessoesDaFaixa, somarDias, dataBR } from "@/lib/disponibilidadeProfissional"
import type {
  AgendamentoGrade, BloqueioGrade, ConflitoGrade, DiaGrade, DisponibilidadePacienteGrade, EstadoHorario,
  FaixaGrade, FeriadoGrade, HorarioGrade, ProfissionalGrade, ResumoGrade, SerieGrade,
} from "@/types/grade"

// Motor da Grade: lógica pura (sem React, sem Supabase). A partir da
// disponibilidade (faixas com capacidade), das sessões, dos bloqueios e dos
// feriados, monta cada horário do dia com o seu estado:
//   disponível · parcial (1 de 3) · lotado · bloqueado · fora da grade · inativo.
// Semana de DOMINGO a SÁBADO. Datas "AAAA-MM-DD" no calendário de Brasília.

export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const
export const DIAS_NOMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"] as const
const DIAS_PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"] as const
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const

// ── Datas ─────────────────────────────────────────────────────────────────────

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(iso: string): number {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}

/** Domingo da semana da data. */
export const inicioDaSemana = (iso: string) => somarDias(iso.slice(0, 10), -diaDaSemana(iso))

/** As 7 datas da semana, de domingo a sábado. */
export function semanaDe(iso: string): string[] {
  const ini = inicioDaSemana(iso)
  return Array.from({ length: 7 }, (_, i) => somarDias(ini, i))
}

/** Semanas (domingo–sábado) que cobrem o mês da data: 4 a 6 linhas de 7 datas. */
export function semanasDoMes(iso: string): string[][] {
  const primeiro = `${iso.slice(0, 7)}-01`
  const mes = iso.slice(0, 7)
  const semanas: string[][] = []
  let ini = inicioDaSemana(primeiro)
  while (semanas.length < 6) {
    const s = Array.from({ length: 7 }, (_, i) => somarDias(ini, i))
    if (!s.some(d => d.startsWith(mes))) break
    semanas.push(s)
    ini = somarDias(ini, 7)
  }
  return semanas
}

/** "05 – 11 de outubro de 2026" / "28 de setembro – 04 de outubro de 2026". */
export function rotuloSemana(datas: string[]): string {
  const a = datas[0], b = datas[datas.length - 1]
  const [aa, am, ad] = a.split("-").map(Number)
  const [ba, bm, bd] = b.split("-").map(Number)
  const dd = (n: number) => String(n).padStart(2, "0")
  if (aa === ba && am === bm) return `${dd(ad)} – ${dd(bd)} de ${MESES[bm - 1]} de ${ba}`
  if (aa === ba) return `${dd(ad)} de ${MESES[am - 1]} – ${dd(bd)} de ${MESES[bm - 1]} de ${ba}`
  return `${dd(ad)}/${dd(am)}/${aa} – ${dd(bd)}/${dd(bm)}/${ba}`
}

export function rotuloMes(iso: string): string {
  const [a, m] = iso.split("-").map(Number)
  return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} de ${a}`
}

export function rotuloDia(iso: string): string {
  return `${DIAS_NOMES[diaDaSemana(iso)]}, ${dataBR(iso)}`
}

const sobrepoe = (aIni: number, aFim: number, bIni: number, bFim: number) => aIni < bFim && bIni < aFim

// ── Disponibilidade ───────────────────────────────────────────────────────────

/** Faixas que valem para o profissional naquela data (versão vigente no dia, dia ativo). */
export function faixasDoDia(faixas: FaixaGrade[], profissionalId: number, data: string): FaixaGrade[] {
  const dow = diaDaSemana(data)
  const iso = dow === 0 ? 7 : dow // faixas usam 1 = segunda … 6 = sábado
  return faixas
    .filter(f =>
      f.profissional_id === profissionalId &&
      f.dia_semana === iso &&
      f.dias_ativos.includes(iso) &&
      data >= f.vigente_de &&
      (f.vigente_ate === null || data <= f.vigente_ate))
    .sort((a, b) => paraMin(a.hora_inicio) - paraMin(b.hora_inicio))
}

/** Feriado (integral ou na janela parcial) ou bloqueio que fecha o horário. */
export function fechamento(
  data: string,
  inicio: string,
  fim: string,
  profissionalId: number,
  feriado: FeriadoGrade | null,
  bloqueios: BloqueioGrade[],
): HorarioGrade["fechado"] {
  const ini = paraMin(inicio), f = paraMin(fim)
  if (feriado && feriado.data === data) {
    if (feriado.tipo === "integral" || !feriado.horario_inicio
        || sobrepoe(ini, f, paraMin(feriado.horario_inicio), paraMin(feriado.horario_fim || "23:59"))) {
      return { motivo: feriado.nome, origem: "feriado" }
    }
  }
  const dow = diaDaSemana(data)
  for (const b of bloqueios) {
    if (b.profissional_id !== profissionalId || b.situacao !== "ativo") continue
    if (data < b.data_inicio || (b.data_fim !== null && data > b.data_fim)) continue
    if (b.dias_semana && !b.dias_semana.includes(dow)) continue
    if (b.hora_inicio && b.hora_fim && !sobrepoe(ini, f, paraMin(b.hora_inicio), paraMin(b.hora_fim))) continue
    return { motivo: b.motivo, origem: "bloqueio", bloqueioId: b.id }
  }
  return null
}

const estadoPorOcupacao = (n: number, cap: number): EstadoHorario =>
  n === 0 ? "disponivel" : n < cap ? "parcial" : "lotado"

/**
 * O dia de um profissional: os horários da disponibilidade (com ocupação) e as
 * sessões que não caem em horário nenhum (fora da grade). Depois da saída do
 * profissional não há horário livre; as sessões mantidas aparecem como inativo
 * ("precisa de reposição").
 */
export function montarDia(args: {
  profissional: Pick<ProfissionalGrade, "id" | "data_saida">
  data: string
  faixas: FaixaGrade[]
  agendamentos: AgendamentoGrade[]
  bloqueios: BloqueioGrade[]
  feriado: FeriadoGrade | null
}): DiaGrade {
  const { profissional: p, data } = args
  const feriado = args.feriado && args.feriado.data === data ? args.feriado : null
  const inativo = p.data_saida !== null && data >= p.data_saida
  const doDia = args.agendamentos
    .filter(a => a.profissional_id === p.id && a.data === data && a.situacao === "agendado")
    .sort((a, b) => paraMin(a.hora_inicio) - paraMin(b.hora_inicio))

  const horarios: HorarioGrade[] = []
  const usados = new Set<string>()

  if (!inativo) {
    for (const f of faixasDoDia(args.faixas, p.id, data)) {
      const inicios = sessoesDaFaixa({
        inicio: horaCurta(f.hora_inicio),
        fim: horaCurta(f.hora_fim),
        duracao: f.duracao_min,
        intervaloAtivo: f.intervalo_ativo,
        intervaloInicio: horaCurta(f.intervalo_inicio),
        intervaloFim: horaCurta(f.intervalo_fim),
      })
      for (const inicio of inicios) {
        const fim = deMin(paraMin(inicio) + f.duracao_min)
        const ocupados = doDia.filter(a => sobrepoe(paraMin(a.hora_inicio), paraMin(a.hora_fim), paraMin(inicio), paraMin(fim)))
        ocupados.forEach(a => usados.add(a.id))
        const fechado = fechamento(data, inicio, fim, p.id, feriado, args.bloqueios)
        horarios.push({
          data, inicio, fim,
          capacidade: f.capacidade ?? 1,
          ocupados,
          estado: fechado ? "bloqueado" : estadoPorOcupacao(ocupados.length, f.capacidade ?? 1),
          terapias: f.terapias,
          local: { id: f.local_id, nome: f.local_nome, unidade: f.unidade_nome },
          fechado,
        })
      }
    }
  }

  // Sessões sem horário de disponibilidade: agrupadas pelo início.
  const restantes = new Map<string, AgendamentoGrade[]>()
  for (const a of doDia) {
    if (usados.has(a.id)) continue
    const k = horaCurta(a.hora_inicio)
    restantes.set(k, [...(restantes.get(k) ?? []), a])
  }
  for (const [inicio, ocupados] of restantes) {
    const fim = horaCurta(ocupados.reduce((m, a) => (paraMin(a.hora_fim) > paraMin(m) ? a.hora_fim : m), ocupados[0].hora_fim))
    horarios.push({
      data, inicio, fim,
      capacidade: ocupados.length,
      ocupados,
      estado: inativo ? "inativo" : "fora_da_grade",
      terapias: [],
      local: ocupados[0].sala_nome ? { id: ocupados[0].local_id ?? "", nome: ocupados[0].sala_nome, unidade: ocupados[0].unidade_nome } : null,
      fechado: fechamento(data, inicio, fim, p.id, feriado, args.bloqueios),
    })
  }

  // Horário fechado no dia todo sem faixa (bloqueio de dia inteiro em dia sem
  // grade) não vira linha: a coluna do dia mostra o feriado.
  horarios.sort((a, b) => paraMin(a.inicio) - paraMin(b.inicio) || a.estado.localeCompare(b.estado))
  return { data, feriado, inativo, horarios }
}

/** Os dias de um período para um profissional. */
export function montarPeriodo(args: {
  profissional: Pick<ProfissionalGrade, "id" | "data_saida">
  datas: string[]
  faixas: FaixaGrade[]
  agendamentos: AgendamentoGrade[]
  bloqueios: BloqueioGrade[]
  feriados: FeriadoGrade[]
}): DiaGrade[] {
  const porData = new Map(args.feriados.map(f => [f.data, f]))
  return args.datas.map(data => montarDia({ ...args, data, feriado: porData.get(data) ?? null }))
}

// ── Resumo ────────────────────────────────────────────────────────────────────

export function resumir(dias: DiaGrade[]): ResumoGrade {
  let disponiveis = 0, agendados = 0, bloqueados = 0, reposicao = 0, vagas = 0, ocupadasNaGrade = 0
  for (const d of dias) {
    for (const h of d.horarios) {
      agendados += h.ocupados.length
      if (h.estado === "bloqueado") { bloqueados++; continue }
      if (h.estado === "inativo") { reposicao += h.ocupados.length; continue }
      if (h.estado === "fora_da_grade") continue
      vagas += h.capacidade
      ocupadasNaGrade += Math.min(h.ocupados.length, h.capacidade)
      disponiveis += Math.max(0, h.capacidade - h.ocupados.length)
    }
  }
  return { disponiveis, agendados, bloqueados, reposicao, ocupacao: vagas ? ocupadasNaGrade / vagas : null }
}

// ── Paciente ──────────────────────────────────────────────────────────────────

const CHAVE_DIA = ["", "seg", "ter", "qua", "qui", "sex", "sab"] as const

/**
 * Janela que a família informou para o dia (sem sábado — regra de
 * lib/disponibilidadePaciente.ts). null = sem informação ou não vem nesse dia.
 */
export function janelaDoPaciente(disp: DisponibilidadePacienteGrade | null, data: string): { inicio: string; fim: string } | null {
  if (!disp) return null
  const dow = diaDaSemana(data)
  if (dow === 0 || dow === 6) return null
  const k = CHAVE_DIA[dow]
  const ini = disp[`${k}_inicio` as const], fim = disp[`${k}_fim` as const]
  return ini && fim ? { inicio: horaCurta(ini), fim: horaCurta(fim) } : null
}

/** A família informou disponibilidade e a sessão cai fora dela. */
export function foraDaJanelaDoPaciente(disp: DisponibilidadePacienteGrade | null, a: Pick<AgendamentoGrade, "data" | "hora_inicio" | "hora_fim">): boolean {
  if (!disp) return false
  const j = janelaDoPaciente(disp, a.data)
  if (!j) return true
  return paraMin(a.hora_inicio) < paraMin(j.inicio) || paraMin(a.hora_fim) > paraMin(j.fim)
}

/** A sessão é de profissional que já saiu (mantida para reposição). */
export function precisaReposicao(a: Pick<AgendamentoGrade, "data" | "profissional_id">, profissionais: Map<number, Pick<ProfissionalGrade, "data_saida">>): boolean {
  const p = profissionais.get(a.profissional_id)
  return !!p?.data_saida && a.data >= p.data_saida
}

// ── Textos ────────────────────────────────────────────────────────────────────

export function descreverSerie(s: Pick<SerieGrade,
  "frequencia" | "intervalo_semanas" | "dia_semana" | "hora_inicio" | "hora_fim" | "data_inicio" | "data_fim" | "total_sessoes" | "situacao" | "encerrada_a_partir">): string {
  const hora = `${horaCurta(s.hora_inicio)}–${horaCurta(s.hora_fim)}`
  if (s.frequencia === "unica") return `Sessão única em ${dataBR(s.data_inicio)}, ${hora}`
  const quando = s.intervalo_semanas === 1
    ? `Toda ${DIAS_NOMES[s.dia_semana].toLowerCase()}`.replace("Toda sábado", "Todo sábado").replace("Toda domingo", "Todo domingo")
    : `A cada ${s.intervalo_semanas} semanas, às ${DIAS_PLURAL[s.dia_semana]}`
  const fim = s.situacao === "encerrada" && s.encerrada_a_partir
    ? ` · encerrada a partir de ${dataBR(s.encerrada_a_partir)}`
    : s.total_sessoes ? ` · ${s.total_sessoes} sessões, até ${dataBR(s.data_fim)}`
    : s.data_fim ? ` · até ${dataBR(s.data_fim)}`
    : " · contínua"
  return `${quando}, ${hora} · desde ${dataBR(s.data_inicio)}${fim}`
}

export const ROTULO_CONFLITO: Record<ConflitoGrade, string> = {
  passado: "data passada",
  profissional_inativo: "profissional inativo",
  paciente_inativo: "paciente inativo",
  paciente_alta: "paciente de alta",
  feriado: "feriado",
  bloqueio: "horário bloqueado",
  fora_da_disponibilidade: "fora da disponibilidade do profissional",
  terapia_fora_da_faixa: "terapia não oferecida nesse horário",
  lotado: "horário lotado",
  paciente_ocupado: "paciente já tem sessão nesse horário",
}

export const ROTULO_ESTADO: Record<EstadoHorario, string> = {
  disponivel: "Disponível",
  parcial: "Parcial",
  lotado: "Agendado",
  bloqueado: "Bloqueado",
  fora_da_grade: "Fora da grade",
  inativo: "Precisa de reposição",
}

/** "1 de 3 livres" / "Livre" / "Lotado". */
export function rotuloVagas(h: Pick<HorarioGrade, "capacidade" | "ocupados">): string {
  const livres = Math.max(0, h.capacidade - h.ocupados.length)
  if (h.capacidade === 1) return livres ? "Livre" : "Agendado"
  return livres ? `${livres} de ${h.capacidade} livres` : `${h.capacidade} de ${h.capacidade}`
}
