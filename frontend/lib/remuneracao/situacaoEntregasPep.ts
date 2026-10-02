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
export type EvidenciaDoMes = { prestador_nome: string; paciente_nome: string | null; sigla: string | null; padrao: string | null }

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
    for (const item of itens) {
      if (item.tipo_registro === "GERAL") {
        const esperado = item.periodicidade === "semanal" ? dados.semanasEsperadas : (item.qtd_referencia_mes ?? 1)
        esperadasRec += esperado
        naPasta += Math.min(esperado, contar(item.sigla, null))
      } else {
        const esperado = item.qtd_referencia_mes ?? 1
        for (const p of a.pacientes) {
          esperadasRec += esperado
          naPasta += Math.min(esperado, contar(item.sigla, p))
        }
      }
    }
    const vencidas = situacao.get(a.nome)?.semestraisVencidas ?? 0
    const esperadas = esperadasRec + vencidas
    return {
      nome: a.nome,
      esperadas,
      naPasta,
      faltam: Math.max(0, esperadas - naPasta),
      foraDoPadrao: mine.filter(e => e.padrao === "fora").length,
    }
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
    const pacientes = new Set(a.pacientes)
    for (const plano of dados.planos) {
      if (!pacientes.has(plano.paciente_nome) || !semestrais.has(plano.item_id)) continue
      if (plano.competencia_planejada > competencia) continue
      const inicio = somarMeses(plano.competencia_planejada, -5)
      const feitas = entreguesPorPacienteItem.get(`${plano.paciente_nome}\u0000${plano.item_id}`) ?? []
      if (!feitas.some(c => c >= inicio)) semestraisVencidas++
    }

    const sugestoesEsperando = dados.sugestoes.filter(s => s.prestador_nome === a.nome && sugestaoEsperaPessoa(s)).length

    const conf = dados.conferencias.find(c => c.prestador_nome === a.nome)
    const mexeuDepois = !!conf && (porPrestador.get(a.nome) ?? []).some(r => Date.parse(r.updated_at) > Date.parse(conf.conferido_em))
    saida.set(a.nome, {
      unidadesFaltando,
      semestraisVencidas,
      sugestoesEsperando,
      conferido: conf && !mexeuDepois ? { por: conf.conferido_por_nome, em: conf.conferido_em } : null,
      conferenciaInvalidada: !!conf && mexeuDepois,
    })
  }
  return saida
}
