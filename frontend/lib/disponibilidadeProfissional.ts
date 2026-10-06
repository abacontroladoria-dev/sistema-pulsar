import type {
  FaixaGravada, FaixaRascunho, LocalDisponivel, OcupacaoLocal, RascunhoDisponibilidade, VersaoDisponibilidade,
} from "@/types/disponibilidadeProfissional"

// Lógica pura da disponibilidade do profissional (sem React, sem Supabase):
// sessões de cada faixa, validação espelho das RPCs, totais, conflitos de local,
// cópia de dia, preenchimento a partir da grade TiTa e diferenças entre versões.

export const DIAS_SEMANA = [
  { n: 1, curto: "Seg", nome: "Segunda-feira" },
  { n: 2, curto: "Ter", nome: "Terça-feira" },
  { n: 3, curto: "Qua", nome: "Quarta-feira" },
  { n: 4, curto: "Qui", nome: "Quinta-feira" },
  { n: 5, curto: "Sex", nome: "Sexta-feira" },
  { n: 6, curto: "Sáb", nome: "Sábado" },
] as const

export const DURACOES = [30, 40, 45, 50, 60] as const

export const nomeDia = (n: number) => DIAS_SEMANA.find(d => d.n === n)?.nome ?? `Dia ${n}`
export const curtoDia = (n: number) => DIAS_SEMANA.find(d => d.n === n)?.curto ?? String(n)

// ── Horas ─────────────────────────────────────────────────────────────────────

/** "08:40" ou "08:40:00" → 520. */
export function paraMin(h: string): number {
  const [hh, mm] = h.split(":").map(Number)
  return hh * 60 + (mm || 0)
}

/** 520 → "08:40". */
export function deMin(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/** "08:40:00" → "08:40". */
export const horaCurta = (h: string | null | undefined) => (h ? h.slice(0, 5) : "")

/** Horários de 06:00 a 21:00 de 10 em 10 — cobre todas as grades de 30/40/50/60 min a partir de hora cheia. */
export function opcoesHorario(passo = 10, de = 6 * 60, ate = 21 * 60): string[] {
  const out: string[] = []
  for (let m = de; m <= ate; m += passo) out.push(deMin(m))
  return out
}

// ── Sessões ───────────────────────────────────────────────────────────────────

/**
 * Inícios de sessão de uma faixa: de `inicio` em passos de `duracao`, sem entrar
 * no intervalo (a contagem recomeça no fim dele) e sem passar do `fim`.
 * 08:00–17:40 / 40 min / intervalo 12–13 → 08:00 … 11:20 e 13:00 … 17:00 (13).
 */
export function sessoesDaFaixa(f: Pick<FaixaRascunho, "inicio" | "fim" | "duracao" | "intervaloAtivo" | "intervaloInicio" | "intervaloFim">): string[] {
  const ini = paraMin(f.inicio), fim = paraMin(f.fim), dur = f.duracao
  if (!(fim > ini) || dur <= 0) return []
  const intIni = f.intervaloAtivo ? paraMin(f.intervaloInicio) : null
  const intFim = f.intervaloAtivo ? paraMin(f.intervaloFim) : null
  const out: string[] = []
  let t = ini
  while (t + dur <= fim && out.length < 200) {
    if (intIni !== null && intFim !== null && t < intFim && t + dur > intIni) {
      t = Math.max(t, intFim)
      continue
    }
    out.push(deMin(t))
    t += dur
  }
  return out
}

/** Minutos que sobram sem formar sessão (antes do intervalo e no fim). */
export function sobraDaFaixa(f: FaixaRascunho): number {
  const s = sessoesDaFaixa(f)
  if (!s.length) return 0
  const ini = paraMin(f.inicio), fim = paraMin(f.fim)
  const util = fim - ini - (f.intervaloAtivo ? Math.max(0, paraMin(f.intervaloFim) - paraMin(f.intervaloInicio)) : 0)
  return Math.max(0, util - s.length * f.duracao)
}

// ── Rascunho ↔ versão gravada ────────────────────────────────────────────────

let seq = 0
export const novaChave = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`

/** Faixa nova: o padrão da clínica (08:00–17:40, 40 min, intervalo 12–13). */
export function novaFaixa(dia: number, base?: Partial<FaixaRascunho>): FaixaRascunho {
  return {
    chave: novaChave(),
    dia,
    inicio: "08:00",
    fim: "17:40",
    duracao: 40,
    intervaloAtivo: true,
    intervaloInicio: "12:00",
    intervaloFim: "13:00",
    localId: null,
    terapias: [],
    ...base,
  }
}

export function rascunhoDeVersao(v: Pick<VersaoDisponibilidade, "dias_ativos" | "faixas"> | null): RascunhoDisponibilidade {
  if (!v) return { diasAtivos: [1, 2, 3, 4, 5], faixas: [] }
  return {
    diasAtivos: [...v.dias_ativos].sort(),
    faixas: [...v.faixas]
      .sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio))
      .map(f => faixaDeGravada(f)),
  }
}

export function faixaDeGravada(f: FaixaGravada): FaixaRascunho {
  return {
    chave: novaChave(),
    dia: f.dia_semana,
    inicio: horaCurta(f.hora_inicio),
    fim: horaCurta(f.hora_fim),
    duracao: f.duracao_min,
    intervaloAtivo: f.intervalo_ativo,
    intervaloInicio: horaCurta(f.intervalo_inicio) || "12:00",
    intervaloFim: horaCurta(f.intervalo_fim) || "13:00",
    localId: f.local_id,
    localNome: f.unidade_nome ? `${f.unidade_nome} · ${f.local_nome}` : f.local_nome,
    terapias: f.terapias.map(t => t.terapia_id).sort((a, b) => a - b),
  }
}

/** Corpo de `p_faixas` da RPC profissional_disponibilidade_criar_versao. */
export function faixasParaRpc(r: RascunhoDisponibilidade) {
  return [...r.faixas]
    .sort((a, b) => a.dia - b.dia || paraMin(a.inicio) - paraMin(b.inicio))
    .map((f, i) => ({
      dia_semana: f.dia,
      hora_inicio: f.inicio,
      hora_fim: f.fim,
      duracao_min: f.duracao,
      intervalo_ativo: f.intervaloAtivo,
      intervalo_inicio: f.intervaloAtivo ? f.intervaloInicio : null,
      intervalo_fim: f.intervaloAtivo ? f.intervaloFim : null,
      local_id: f.localId,
      terapias: f.terapias,
      ordem: i,
    }))
}

/**
 * Mesmo conteúdo (dias ligados + faixas), ignorando a ordem em que as faixas
 * foram montadas e as chaves internas do editor. É o que decide se "Salvar"
 * gera uma versão nova ou se não há nada a gravar.
 */
export function mesmoConteudo(a: RascunhoDisponibilidade, b: RascunhoDisponibilidade): boolean {
  const assinatura = (r: RascunhoDisponibilidade) =>
    JSON.stringify({
      dias: [...r.diasAtivos].sort((x, y) => x - y),
      faixas: faixasParaRpc(r).map(f => ({ ...f, ordem: 0, terapias: [...f.terapias].sort((x, y) => x - y) })),
    })
  return assinatura(a) === assinatura(b)
}

// ── Validação (espelho das RPCs + avisos que só a tela dá) ───────────────────

export type ResultadoValidacao = {
  erros: Map<string, string[]>
  avisos: Map<string, string[]>
  /** Erros que não são de uma faixa (ex.: nenhum dia ativo). */
  gerais: string[]
  bloqueia: boolean
}

export function validarRascunho(r: RascunhoDisponibilidade, habilitadas: Set<number>): ResultadoValidacao {
  const erros = new Map<string, string[]>()
  const avisos = new Map<string, string[]>()
  const gerais: string[] = []
  const add = (m: Map<string, string[]>, k: string, msg: string) => m.set(k, [...(m.get(k) ?? []), msg])

  if (r.faixas.length > 60) gerais.push("No máximo 60 faixas por versão.")
  const ativos = new Set(r.diasAtivos)
  if (!r.faixas.some(f => ativos.has(f.dia))) gerais.push("Ligue ao menos um dia com uma faixa de horário.")

  for (const f of r.faixas) {
    const ini = paraMin(f.inicio), fim = paraMin(f.fim)
    if (!(fim > ini)) add(erros, f.chave, "O fim precisa ser depois do início.")
    if (f.intervaloAtivo) {
      const ii = paraMin(f.intervaloInicio), ifm = paraMin(f.intervaloFim)
      if (!(ifm > ii)) add(erros, f.chave, "O intervalo precisa terminar depois de começar.")
      else if (ii < ini || ifm > fim) add(erros, f.chave, "O intervalo precisa ficar dentro da faixa.")
    }
    if (fim > ini && !sessoesDaFaixa(f).length) add(erros, f.chave, `Não cabe nenhuma sessão de ${f.duracao} min.`)
    if (!f.terapias.length) add(erros, f.chave, "Escolha ao menos uma terapia.")
    const fora = f.terapias.filter(t => !habilitadas.has(t))
    if (fora.length) add(erros, f.chave, "Há terapia que não está habilitada para o profissional.")
    if (!f.localId) add(erros, f.chave, "Escolha o local.")
    const sobra = fim > ini ? sobraDaFaixa(f) : 0
    if (sobra > 0) add(avisos, f.chave, `Sobram ${sobra} min sem formar sessão.`)
  }

  // Sobreposição entre faixas do mesmo dia (a RPC confere todas, ativas ou não).
  const porDia = new Map<number, FaixaRascunho[]>()
  for (const f of r.faixas) porDia.set(f.dia, [...(porDia.get(f.dia) ?? []), f])
  for (const lista of porDia.values()) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j]
        if (paraMin(a.inicio) < paraMin(b.fim) && paraMin(b.inicio) < paraMin(a.fim)) {
          add(erros, a.chave, `Cruza com a faixa ${b.inicio}–${b.fim}.`)
          add(erros, b.chave, `Cruza com a faixa ${a.inicio}–${a.fim}.`)
        }
      }
    }
  }

  return { erros, avisos, gerais, bloqueia: gerais.length > 0 || erros.size > 0 }
}

// ── Totais ────────────────────────────────────────────────────────────────────

export function totaisDaSemana(r: RascunhoDisponibilidade) {
  const ativos = new Set(r.diasAtivos)
  let sessoes = 0, minutos = 0
  const porDia = new Map<number, number>()
  const porTerapia = new Map<number, number>()
  for (const f of r.faixas) {
    if (!ativos.has(f.dia)) continue
    const n = sessoesDaFaixa(f).length
    sessoes += n
    minutos += n * f.duracao
    porDia.set(f.dia, (porDia.get(f.dia) ?? 0) + n)
    // Faixa com várias terapias: a sessão pode ser de qualquer uma — conta para todas.
    for (const t of f.terapias) porTerapia.set(t, (porTerapia.get(t) ?? 0) + n)
  }
  return { sessoes, minutos, porDia, porTerapia }
}

// ── Cópia de dia ──────────────────────────────────────────────────────────────

/** Substitui as faixas de `para` por cópias das de `de`; liga os dias de destino. */
export function copiarDia(r: RascunhoDisponibilidade, de: number, para: number[]): RascunhoDisponibilidade {
  const origem = r.faixas.filter(f => f.dia === de)
  const alvo = new Set(para.filter(d => d !== de))
  return {
    diasAtivos: [...new Set([...r.diasAtivos, ...alvo])].sort(),
    faixas: [
      ...r.faixas.filter(f => !alvo.has(f.dia)),
      ...[...alvo].flatMap(d => origem.map(f => ({ ...f, chave: novaChave(), dia: d, terapias: [...f.terapias] }))),
    ],
  }
}

// ── Conflitos de local ────────────────────────────────────────────────────────

const periodosCruzam = (a: { de: string; ate: string | null }, b: { de: string; ate: string | null }) =>
  a.de <= (b.ate ?? "9999-12-31") && b.de <= (a.ate ?? "9999-12-31")

/**
 * Para cada faixa: quem mais usa o mesmo local no mesmo dia e horário, nas
 * versões de OUTROS profissionais que valem no mesmo período.
 */
export function conflitosDeLocal(
  r: RascunhoDisponibilidade,
  periodo: { de: string; ate: string | null },
  ocupacoes: OcupacaoLocal[],
  locais: Map<string, LocalDisponivel>,
  nomeProfissional: (id: number) => string
): Map<string, { local: LocalDisponivel; outros: string[]; excedeu: boolean }> {
  const out = new Map<string, { local: LocalDisponivel; outros: string[]; excedeu: boolean }>()
  const ativos = new Set(r.diasAtivos)
  for (const f of r.faixas) {
    if (!f.localId || !ativos.has(f.dia)) continue
    const local = locais.get(f.localId)
    if (!local) continue
    const ini = paraMin(f.inicio), fim = paraMin(f.fim)
    const outros = new Map<number, string>()
    for (const o of ocupacoes) {
      if (o.local_id !== f.localId || o.dia_semana !== f.dia) continue
      if (!(paraMin(o.hora_inicio) < fim && ini < paraMin(o.hora_fim))) continue
      if (!periodosCruzam(periodo, { de: o.vigente_de, ate: o.vigente_ate })) continue
      outros.set(o.profissional_id, `${nomeProfissional(o.profissional_id)} (${horaCurta(o.hora_inicio)}–${horaCurta(o.hora_fim)})`)
    }
    if (!outros.size) continue
    const limite = local.capacidade === "unico" ? 1 : local.capacidade === "duplo" ? 2 : Infinity
    out.set(f.chave, { local, outros: [...outros.values()], excedeu: outros.size + 1 > limite })
  }
  return out
}

/** Sala com exclusividade OBRIGATÓRIA de outras terapias: avisa quais da faixa ficam de fora. */
export function foraDaExclusividade(local: LocalDisponivel, titaIdsDaFaixa: (number | null)[]): string[] | null {
  const obrig = local.exclusividades.filter(e => e.modo === "obrigatoria")
  if (!obrig.length) return null
  const permitidas = new Set(obrig.map(e => e.terapia_id))
  const fora = titaIdsDaFaixa.some(id => id === null || !permitidas.has(id))
  return fora ? obrig.map(e => e.terapia_nome) : null
}

// ── Preencher a partir da grade TiTa ─────────────────────────────────────────

export type HorarioGrade = {
  dia: number
  inicio: string
  fim: string
  terapias: number[]
  localId: string | null
  /** Nome cru do local na TiTa — vai para o aviso quando não casou. */
  salaTita: string | null
}

/**
 * Monta faixas a partir dos horários (Livre + Agendado) de uma semana da TiTa:
 * junta horários seguidos com o mesmo conjunto de terapias, o mesmo local e a
 * mesma duração; um buraco de até 2h entre dois blocos iguais vira intervalo.
 */
export function faixasDaGrade(horarios: HorarioGrade[]): { faixas: FaixaRascunho[]; salasSemCasamento: string[] } {
  const chaveGrupo = (h: HorarioGrade) => `${h.localId ?? `?${h.salaTita ?? ""}`}|${[...h.terapias].sort((a, b) => a - b).join(",")}`
  const semCasamento = new Set<string>()
  const faixas: FaixaRascunho[] = []

  for (const d of DIAS_SEMANA) {
    // Um horário por início (a TiTa pode repetir o mesmo slot em linhas diferentes).
    const doDia = [...new Map(horarios.filter(h => h.dia === d.n).map(h => [h.inicio, h])).values()]
      .sort((a, b) => paraMin(a.inicio) - paraMin(b.inicio))
    let atual: { f: FaixaRascunho; grupo: string; ultimoFim: number } | null = null

    const fechar = () => { if (atual) faixas.push(atual.f) }
    for (const h of doDia) {
      const dur = paraMin(h.fim) - paraMin(h.inicio)
      if (dur <= 0) continue
      if (!h.localId && h.salaTita) semCasamento.add(h.salaTita)
      const grupo = chaveGrupo(h)
      const ini = paraMin(h.inicio)
      if (atual && atual.grupo === grupo && atual.f.duracao === dur) {
        const buraco = ini - atual.ultimoFim
        if (buraco === 0) {
          atual.f.fim = h.fim
          atual.ultimoFim = paraMin(h.fim)
          continue
        }
        if (buraco > 0 && buraco <= 120 && !atual.f.intervaloAtivo) {
          atual.f.intervaloAtivo = true
          atual.f.intervaloInicio = deMin(atual.ultimoFim)
          atual.f.intervaloFim = h.inicio
          atual.f.fim = h.fim
          atual.ultimoFim = paraMin(h.fim)
          continue
        }
      }
      fechar()
      atual = {
        grupo,
        ultimoFim: paraMin(h.fim),
        f: novaFaixa(d.n, {
          inicio: h.inicio, fim: h.fim, duracao: dur, intervaloAtivo: false,
          localId: h.localId, terapias: [...h.terapias].sort((a, b) => a - b),
        }),
      }
    }
    fechar()
  }
  // Duração fora das opções da tela (ex.: 20 min) vira a mais próxima.
  for (const f of faixas) {
    if (!(DURACOES as readonly number[]).includes(f.duracao)) {
      f.duracao = [...DURACOES].sort((a, b) => Math.abs(a - f.duracao) - Math.abs(b - f.duracao))[0]
    }
  }
  return { faixas, salasSemCasamento: [...semCasamento] }
}

// ── Diferenças entre versões ──────────────────────────────────────────────────

export type Diferenca = { dia: number; tipo: "adicionada" | "removida" | "alterada" | "dia"; texto: string }

export function diferencasEntreVersoes(
  antes: RascunhoDisponibilidade,
  depois: RascunhoDisponibilidade,
  nomeTerapia: (id: number) => string,
  nomeLocal: (id: string | null) => string
): Diferenca[] {
  const out: Diferenca[] = []
  const desc = (f: FaixaRascunho) =>
    `${f.inicio}–${f.fim}${f.intervaloAtivo ? ` (intervalo ${f.intervaloInicio}–${f.intervaloFim})` : ""} · ${f.duracao} min · ${nomeLocal(f.localId)} · ${f.terapias.map(nomeTerapia).join(", ")}`
  const assinatura = (f: FaixaRascunho) => desc(f)

  for (const d of DIAS_SEMANA) {
    const a = antes.diasAtivos.includes(d.n), b = depois.diasAtivos.includes(d.n)
    if (a !== b) out.push({ dia: d.n, tipo: "dia", texto: b ? "Dia ligado" : "Dia desligado" })
    const fa = antes.faixas.filter(f => f.dia === d.n)
    const fb = depois.faixas.filter(f => f.dia === d.n)
    const restantesA = [...fa]
    for (const f of fb) {
      const igual = restantesA.findIndex(x => assinatura(x) === assinatura(f))
      if (igual >= 0) { restantesA.splice(igual, 1); continue }
      // Mesma hora de início = a "mesma" faixa alterada.
      const mesma = restantesA.findIndex(x => x.inicio === f.inicio)
      if (mesma >= 0) {
        out.push({ dia: d.n, tipo: "alterada", texto: `${desc(restantesA[mesma])} → ${desc(f)}` })
        restantesA.splice(mesma, 1)
      } else {
        out.push({ dia: d.n, tipo: "adicionada", texto: desc(f) })
      }
    }
    for (const f of restantesA) out.push({ dia: d.n, tipo: "removida", texto: desc(f) })
  }
  return out
}

// ── Datas (sempre no fuso de Brasília, exibidas dd/mm/aaaa) ──────────────────

export function hojeBrasilia(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora)
}

export function dataBR(iso: string | null | undefined): string {
  if (!iso) return ""
  const [a, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${a}`
}

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d + dias))
  return dt.toISOString().slice(0, 10)
}

/** "01/11/2026 → indeterminado" / "01/09/2026 → 31/10/2026". */
export const periodoBR = (de: string, ate: string | null) => `${dataBR(de)} → ${ate ? dataBR(ate) : "indeterminado"}`

// ── Resumo para o card ("Seg, Qua, Sex · manhã") ─────────────────────────────

/**
 * Dias com faixa (sequência de 3+ dias seguidos vira "Seg a Qui") e o turno:
 * manhã (algo antes do meio-dia), tarde (algo depois das 13h) ou os dois.
 * null quando nenhum dia ativo tem faixa.
 */
export function resumoSemana(
  diasAtivos: number[],
  faixas: { dia_semana: number; hora_inicio: string; hora_fim: string }[]
): string | null {
  const ativos = new Set(diasAtivos)
  const validas = faixas.filter(f => ativos.has(f.dia_semana))
  const dias = [...new Set(validas.map(f => f.dia_semana))].sort((a, b) => a - b)
  if (!dias.length) return null

  const grupos: number[][] = []
  for (const d of dias) {
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && d === ultimo[ultimo.length - 1] + 1) ultimo.push(d)
    else grupos.push([d])
  }
  const textoDias = grupos
    .flatMap(g => (g.length >= 3 ? [`${curtoDia(g[0])} a ${curtoDia(g[g.length - 1])}`] : g.map(curtoDia)))
    .join(", ")

  const manha = validas.some(f => paraMin(f.hora_inicio) < 12 * 60)
  const tarde = validas.some(f => paraMin(f.hora_fim) > 13 * 60)
  const turno = manha && tarde ? "Manhã e Tarde" : manha ? "Manhã" : "Tarde"
  return `${textoDias} · ${turno}`
}
