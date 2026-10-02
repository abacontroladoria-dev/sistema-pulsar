// Situação das ENTREGAS de cada analista no mês — o que a Visão geral de
// Entregas PEP mostra como status (pedido de 02/10/2026).
//
// Antes o status dizia se o sistema já tinha gravado um cálculo
// (pep_apuracao_mensal): só abrir a página do analista mudava "Não aberto"
// para "Parcial". Agora ele diz o que as PESSOAS já fizeram, e sai dos dados:
//
//   Faltam entregas ..... item esperado sem entrega, ou sugestão esperando uma pessoa
//   Entregas completas .. tudo o que era esperado foi entregue; ninguém conferiu
//   Conferido ........... uma pessoa clicou "Marcar como conferido" (pep_conferencia_mensal)
//   Liberado ............ todos os valores do mês liberados para pagamento
//
// PURO: recebe os dados já lidos. Não toca em banco.

import type { PepCatalogoItem } from "@/types/pep"

export type RegistroSituacao = {
  prestador_nome: string
  paciente_nome: string | null
  item_id: string
  status: "pendente" | "entregue"
  quantidade_entregue: number | null
  updated_at: string
}

export type PlanoSituacao = { paciente_nome: string; item_id: string; competencia_planejada: string }

/** Entrega semestral já feita (qualquer mês do ciclo). */
export type EntregaSemestralSituacao = { paciente_nome: string; item_id: string; competencia: string }

/** Sugestão do robô SharePoint (sp_pep_itens com status 'sugerido'). */
export type SugestaoSituacao = { prestador_nome: string; padrao: string | null; robo_obs: string | null }

export type ConferenciaMes = { prestador_nome: string; conferido_em: string; conferido_por_nome: string | null }

export type DadosSituacao = {
  catalogo: PepCatalogoItem[]
  registros: RegistroSituacao[]
  planos: PlanoSituacao[]
  entregasSemestrais: EntregaSemestralSituacao[]
  sugestoes: SugestaoSituacao[]
  conferencias: ConferenciaMes[]
  /** Unidades semanais esperadas no mês (Supervisão e Estudo): 3 ou 4. */
  semanasEsperadas: number
}

export type SituacaoEntregasAnalista = {
  /** Unidades recorrentes esperadas e ainda não entregues. */
  unidadesFaltando: number
  /** Semestrais com o mês planejado vencido e sem entrega no ciclo. */
  semestraisVencidas: number
  /** As mesmas semestrais vencidas, por item do catálogo (item_id → quantas). */
  semestraisPorItem: Record<string, number>
  /** Sugestões do robô esperando uma pessoa. */
  sugestoesEsperando: number
  /** Conferência que vale: ninguém mexeu nas entregas depois dela. */
  conferido: { por: string | null; em: string } | null
  /** Houve conferência, mas uma entrega mudou depois: perdeu a validade. */
  conferenciaInvalidada: boolean
}

export function somarMeses(competencia: string, meses: number): string {
  const [a, m] = competencia.split("-").map(Number)
  const d = new Date(a, m - 1 + meses, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Sugestão que ainda espera uma pessoa: o robô não vai entregá-la sozinho. */
export const sugestaoEsperaPessoa = (s: Pick<SugestaoSituacao, "padrao" | "robo_obs">) =>
  s.padrao !== "ok" || !!s.robo_obs

/** Evidência do mês na pasta do SharePoint (sp_pep_itens, sem as apagadas). */
export type EvidenciaDoMes = { prestador_nome: string; paciente_nome: string | null; sigla: string | null; padrao: string | null; competencia?: string | null }

export type EsperadasAnalista = {
  nome: string
  /** Evidências esperadas no mês: unidades recorrentes + semestrais vencidas. */
  esperadas: number
  /** Esperadas que já estão na pasta no padrão de nome (nunca passa do esperado de cada item). */
  naPasta: number
  /** Esperadas que ainda não estão na pasta. */
  faltam: number
  /** Evidências do mês que a pasta tem mas que ferem o padrão de nome: não contam. */
  foraDoPadrao: number
  /** O mesmo, por sigla do item (STC, TAP, PIC...). */
  porSigla: Record<string, { esperadas: number; naPasta: number }>
}

/**
 * Quantas evidências se ESPERAM no mês × quantas estão na pasta. A mesma
 * regra do PDF por prestador (relatorioPrestador.ts): STC/ETC uma por semana
 * do mês, TAP 2, TOP 1 por paciente, e cada semestral vencida conta 1.
 * "Na pasta" só conta nome no padrão (padrao = 'ok'), no máximo o esperado
 * de cada item e paciente. Fora do padrão e repetido não entram.
 */
export function evidenciasEsperadasPorAnalista(
  analistas: { nome: string; pacientes: string[] }[],
  dados: DadosSituacao,
  evidencias: EvidenciaDoMes[],
  competencia: string,
): EsperadasAnalista[] {
  const situacao = situacaoEntregasPorAnalista(analistas, dados, competencia)
  const itens = dados.catalogo.filter(i => i.ativo && i.classe === "recorrente")
  return analistas.map(a => {
    const mine = evidencias.filter(e => e.prestador_nome === a.nome && e.sigla)
    const contar = (sigla: string, paciente: string | null) =>
      mine.filter(e => e.sigla === sigla && (e.paciente_nome ?? null) === paciente && e.padrao === "ok").length
    let esperadasRec = 0
    let naPasta = 0
    const porSigla: Record<string, { esperadas: number; naPasta: number }> = {}
    const somar = (sigla: string, esperadas: number, na: number) => {
      const c = porSigla[sigla] ?? { esperadas: 0, naPasta: 0 }
      porSigla[sigla] = { esperadas: c.esperadas + esperadas, naPasta: c.naPasta + na }
    }
    for (const item of itens) {
      if (item.tipo_registro === "GERAL") {
        const esperado = item.periodicidade === "semanal" ? dados.semanasEsperadas : (item.qtd_referencia_mes ?? 1)
        const na = Math.min(esperado, contar(item.sigla, null))
        esperadasRec += esperado
        naPasta += na
        somar(item.sigla, esperado, na)
      } else {
        const esperado = item.qtd_referencia_mes ?? 1
        for (const p of a.pacientes) {
          const na = Math.min(esperado, contar(item.sigla, p))
          esperadasRec += esperado
          naPasta += na
          somar(item.sigla, esperado, na)
        }
      }
    }
    const sit = situacao.get(a.nome)
    const vencidas = sit?.semestraisVencidas ?? 0
    // Semestral vencida = esperada e sem entrega: conta no esperado, nunca na pasta.
    for (const [itemId, n] of Object.entries(sit?.semestraisPorItem ?? {})) {
      const sigla = dados.catalogo.find(c => c.id === itemId)?.sigla
      if (sigla) somar(sigla, n, 0)
    }
    const esperadas = esperadasRec + vencidas
    return {
      nome: a.nome,
      esperadas,
      naPasta,
      faltam: Math.max(0, esperadas - naPasta),
      foraDoPadrao: mine.filter(e => e.padrao === "fora").length,
      porSigla,
    }
  })
}

export type EsperadasPorEntrega = { sigla: string; nome: string; esperadas: number; naPasta: number; faltam: number }

/** Soma de todos os analistas, por tipo de entrega, na ordem do catálogo (STC, ETC, TAP, TOP...). */
export function esperadasPorEntrega(analistas: EsperadasAnalista[], catalogo: PepCatalogoItem[]): EsperadasPorEntrega[] {
  const total = new Map<string, { esperadas: number; naPasta: number }>()
  for (const a of analistas) {
    for (const [sigla, v] of Object.entries(a.porSigla)) {
      const c = total.get(sigla) ?? { esperadas: 0, naPasta: 0 }
      total.set(sigla, { esperadas: c.esperadas + v.esperadas, naPasta: c.naPasta + v.naPasta })
    }
  }
  return catalogo.filter(i => i.ativo && total.has(i.sigla)).map(i => {
    const v = total.get(i.sigla)!
    return { sigla: i.sigla, nome: i.nome, esperadas: v.esperadas, naPasta: v.naPasta, faltam: Math.max(0, v.esperadas - v.naPasta) }
  })
}

export function situacaoEntregasPorAnalista(
  analistas: { nome: string; pacientes: string[] }[],
  dados: DadosSituacao,
  competencia: string,
): Map<string, SituacaoEntregasAnalista> {
  const itens = dados.catalogo.filter(i => i.ativo)
  const recorrentes = itens.filter(i => i.classe === "recorrente")
  const semestrais = new Map(itens.filter(i => i.classe === "semestral").map(i => [i.id, i]))
  const entregue = (r: RegistroSituacao | undefined) => r?.quantidade_entregue ?? (r?.status === "entregue" ? 1 : 0)

  const registrosDe = new Map<string, RegistroSituacao>()
  const porPrestador = new Map<string, RegistroSituacao[]>()
  for (const r of dados.registros) {
    registrosDe.set(`${r.prestador_nome}\u0000${r.paciente_nome ?? ""}\u0000${r.item_id}`, r)
    const l = porPrestador.get(r.prestador_nome) ?? []
    l.push(r)
    porPrestador.set(r.prestador_nome, l)
  }
  const entreguesPorPacienteItem = new Map<string, string[]>()
  for (const e of dados.entregasSemestrais) {
    const k = `${e.paciente_nome}\u0000${e.item_id}`
    entreguesPorPacienteItem.set(k, [...(entreguesPorPacienteItem.get(k) ?? []), e.competencia])
  }

  const saida = new Map<string, SituacaoEntregasAnalista>()
  for (const a of analistas) {
    let unidadesFaltando = 0
    for (const item of recorrentes) {
      if (item.tipo_registro === "GERAL") {
        const esperado = item.periodicidade === "semanal" ? dados.semanasEsperadas : (item.qtd_referencia_mes ?? 1)
        unidadesFaltando += Math.max(0, esperado - entregue(registrosDe.get(`${a.nome}\u0000\u0000${item.id}`)))
      } else {
        const esperado = item.qtd_referencia_mes ?? 1
        for (const p of a.pacientes) {
          unidadesFaltando += Math.max(0, esperado - entregue(registrosDe.get(`${a.nome}\u0000${p}\u0000${item.id}`)))
        }
      }
    }

    // Semestral vencida: o mês planejado já chegou e não há entrega no ciclo
    // (5 meses antes do planejado até hoje — a mesma janela do robô).
    let semestraisVencidas = 0
    const semestraisPorItem: Record<string, number> = {}
    const pacientes = new Set(a.pacientes)
    for (const plano of dados.planos) {
      if (!pacientes.has(plano.paciente_nome) || !semestrais.has(plano.item_id)) continue
      if (plano.competencia_planejada > competencia) continue
      const inicio = somarMeses(plano.competencia_planejada, -5)
      const feitas = entreguesPorPacienteItem.get(`${plano.paciente_nome}\u0000${plano.item_id}`) ?? []
      if (!feitas.some(c => c >= inicio)) { semestraisVencidas++; semestraisPorItem[plano.item_id] = (semestraisPorItem[plano.item_id] ?? 0) + 1 }
    }

    const sugestoesEsperando = dados.sugestoes.filter(s => s.prestador_nome === a.nome && sugestaoEsperaPessoa(s)).length

    const conf = dados.conferencias.find(c => c.prestador_nome === a.nome)
    const mexeuDepois = !!conf && (porPrestador.get(a.nome) ?? []).some(r => Date.parse(r.updated_at) > Date.parse(conf.conferido_em))
    saida.set(a.nome, {
      unidadesFaltando,
      semestraisVencidas,
      semestraisPorItem,
      sugestoesEsperando,
      conferido: conf && !mexeuDepois ? { por: conf.conferido_por_nome, em: conf.conferido_em } : null,
      conferenciaInvalidada: !!conf && mexeuDepois,
    })
  }
  return saida
}

/** O que a visão do ano precisa (diferente do mês: não depende de entregas já registradas). */
export type DadosAno = {
  catalogo: PepCatalogoItem[]
  /** Planejamentos semestrais ativos cujo mês planejado cai no ano. */
  planos: PlanoSituacao[]
  /** Semanas esperadas de Supervisão e Estudo em cada mês ('AAAA-MM' → 3 ou 4). */
  semanasPorMes: Record<string, number>
}

/**
 * Tudo o que se espera no ANO, por analista: as recorrentes de cada um dos 12
 * meses (STC/ETC pelas semanas do mês, TAP e TOP por paciente) e cada semestral
 * planejada para o ano (1 por planejamento). "Na pasta" segue a regra do mês:
 * só nome no padrão, no máximo o esperado de cada item/paciente/mês; a
 * semestral conta 1 se há evidência no padrão no ciclo (5 meses antes do mês
 * planejado em diante). Usa os pacientes da Grade que a tela tem (os do mês
 * aberto) em todos os meses.
 */
export function esperadasDoAno(
  analistas: { nome: string; pacientes: string[] }[],
  dados: DadosAno,
  evidencias: EvidenciaDoMes[],
  ano: number,
): EsperadasAnalista[] {
  const itens = dados.catalogo.filter(i => i.ativo)
  const recorrentes = itens.filter(i => i.classe === "recorrente")
  const semestrais = new Map(itens.filter(i => i.classe === "semestral").map(i => [i.id, i]))
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`)

  return analistas.map(a => {
    const mine = evidencias.filter(e => e.prestador_nome === a.nome && e.sigla)
    const ok = (sigla: string, paciente: string | null, filtro: (c: string) => boolean) =>
      mine.filter(e => e.sigla === sigla && (e.paciente_nome ?? null) === paciente && e.padrao === "ok" && !!e.competencia && filtro(e.competencia))
    const porSigla: Record<string, { esperadas: number; naPasta: number }> = {}
    const somar = (sigla: string, esperadas: number, na: number) => {
      const c = porSigla[sigla] ?? { esperadas: 0, naPasta: 0 }
      porSigla[sigla] = { esperadas: c.esperadas + esperadas, naPasta: c.naPasta + na }
    }
    for (const mes of meses) {
      for (const item of recorrentes) {
        if (item.tipo_registro === "GERAL") {
          const esperado = item.periodicidade === "semanal" ? (dados.semanasPorMes[mes] ?? 4) : (item.qtd_referencia_mes ?? 1)
          somar(item.sigla, esperado, Math.min(esperado, ok(item.sigla, null, c => c === mes).length))
        } else {
          const esperado = item.qtd_referencia_mes ?? 1
          for (const p of a.pacientes) somar(item.sigla, esperado, Math.min(esperado, ok(item.sigla, p, c => c === mes).length))
        }
      }
    }
    const pacientes = new Set(a.pacientes)
    for (const plano of dados.planos) {
      const item = semestrais.get(plano.item_id)
      if (!item || !pacientes.has(plano.paciente_nome) || !plano.competencia_planejada.startsWith(`${ano}-`)) continue
      const inicio = somarMeses(plano.competencia_planejada, -5)
      somar(item.sigla, 1, ok(item.sigla, plano.paciente_nome, c => c >= inicio).length > 0 ? 1 : 0)
    }
    const esperadas = Object.values(porSigla).reduce((t, v) => t + v.esperadas, 0)
    const naPasta = Object.values(porSigla).reduce((t, v) => t + v.naPasta, 0)
    return {
      nome: a.nome, esperadas, naPasta, faltam: Math.max(0, esperadas - naPasta),
      foraDoPadrao: mine.filter(e => e.padrao === "fora" && !!e.competencia?.startsWith(`${ano}-`)).length,
      porSigla,
    }
  })
}
