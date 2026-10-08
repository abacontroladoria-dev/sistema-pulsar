// Filtro, indicadores e ordenação da tela Status Contratos. Puro: roda no
// cliente sobre a lista inteira (molde: lib/laudos/filtros.ts).
//
// Regra que não pode quebrar: o NÚMERO de um card de indicador e o tamanho da
// lista ao clicar nele são o mesmo — o card É o filtro. Por isso os dois saem
// do mesmo predicado (PREDICADO_RECORTE).
//
// Os indicadores contam PACIENTES, não contratos: a tela é uma grade de cartões
// por paciente. Os recortes se sobrepõem de propósito (um paciente com Terapias
// assinado e Avaliação vencida aparece nos dois) — não são fatias de um todo.

import { cobreHoje, type TipoContrato } from "./status"
import type { ItemStatusContratos, ResumoContrato } from "@/types/contratosPaciente"

export const RECORTES = [
  "todos",
  "sem_contrato",
  "rascunho",
  "aguardando",
  "assinado_vigente",
  "a_vencer",
  "vencido",
  "recusado_expirado",
] as const
export type RecorteContratos = (typeof RECORTES)[number]

export const RECORTE_LABEL: Record<RecorteContratos, string> = {
  todos: "Todos",
  sem_contrato: "Sem contrato",
  rascunho: "Rascunho",
  aguardando: "Aguardando assinatura",
  assinado_vigente: "Assinado vigente",
  a_vencer: "A vencer (30 dias)",
  vencido: "Vencido",
  recusado_expirado: "Recusado / expirado",
}

export const RECORTE_DICA: Record<RecorteContratos, string> = {
  todos: "Todos os pacientes do filtro.",
  sem_contrato:
    "Paciente com agendamento na grade do TiTa e sem contrato de Terapias valendo hoje (recusado e link expirado não contam como contrato).",
  rascunho: "Contrato criado no Pulsar e ainda não enviado nem assinado.",
  aguardando: "Enviado para assinatura e ainda sem resposta.",
  assinado_vigente: "Assinado e valendo hoje (inclui os que vencem nos próximos 30 dias).",
  a_vencer: "Vence nos próximos 30 dias.",
  vencido: "O contrato atual já passou da data de vencimento.",
  recusado_expirado: "O responsável recusou, ou o link de assinatura venceu sem assinatura.",
}

export type SituacaoPacienteContrato = "ativo" | "inativo"

export type FiltrosContratos = {
  busca: string
  recorte: RecorteContratos
  /** Vazio = todos os tipos. */
  tipos: Set<TipoContrato>
  /** Vazio = todos os convênios. */
  convenios: Set<string>
  situacoes: Set<SituacaoPacienteContrato>
  /** Só pacientes com agendamento na grade do TiTa. */
  soNaGrade: boolean
}

export function filtrosIniciais(): FiltrosContratos {
  return {
    busca: "",
    recorte: "todos",
    tipos: new Set(),
    convenios: new Set(),
    situacoes: new Set<SituacaoPacienteContrato>(["ativo"]),
    soNaGrade: false,
  }
}

/** Os contratos do paciente que o filtro de tipo deixa contar. */
export function contratosConsiderados(item: ItemStatusContratos, tipos: Set<TipoContrato>): ResumoContrato[] {
  return tipos.size === 0 ? item.contratos : item.contratos.filter((c) => tipos.has(c.tipo))
}

const morto = (c: ResumoContrato) => c.status === "recusado" || c.status === "expirado"

export const PREDICADO_RECORTE: Record<
  RecorteContratos,
  (item: ItemStatusContratos, cs: ResumoContrato[]) => boolean
> = {
  todos: () => true,
  // Decisão 5 do plano: a pergunta é sempre sobre TERAPIAS, qualquer que seja
  // o filtro de tipo — é o contrato sem o qual a criança não deveria estar na
  // grade.
  sem_contrato: (item) =>
    item.naGrade && !item.contratos.some((c) => c.tipo === "terapias" && !morto(c) && cobreHoje(c.vigencia)),
  rascunho: (_i, cs) => cs.some((c) => c.status === "rascunho"),
  aguardando: (_i, cs) => cs.some((c) => c.status === "enviado" || c.status === "aguardando_assinatura"),
  assinado_vigente: (_i, cs) => cs.some((c) => c.status === "assinado" && cobreHoje(c.vigencia)),
  a_vencer: (_i, cs) => cs.some((c) => c.vigencia === "a_vencer" && !morto(c)),
  vencido: (_i, cs) => cs.some((c) => c.vigencia === "vencido"),
  recusado_expirado: (_i, cs) => cs.some(morto),
}

/** Minúsculo, sem acento — para a busca casar "Joao" com "João". */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

/** Tudo menos o recorte: é a base que os indicadores contam. */
export function filtrarBase(itens: ItemStatusContratos[], f: FiltrosContratos): ItemStatusContratos[] {
  const termo = normalizar(f.busca)
  return itens.filter((item) => {
    if (!f.situacoes.has(item.ativo ? "ativo" : "inativo")) return false
    if (f.soNaGrade && !item.naGrade) return false
    if (f.convenios.size > 0 && !(item.convenio && f.convenios.has(item.convenio))) return false
    if (termo && !normalizar(item.nome).includes(termo) && String(item.pacienteId) !== termo) return false
    return true
  })
}

function casaRecorte(item: ItemStatusContratos, f: FiltrosContratos): boolean {
  const cs = contratosConsiderados(item, f.tipos)
  // Com tipo escolhido, "Todos" mostra quem TEM contrato daquele tipo — senão
  // o filtro de tipo não mudaria nada na lista. "Sem contrato" é a exceção:
  // é justamente quem não tem.
  if (f.recorte === "todos" && f.tipos.size > 0) return cs.length > 0
  return PREDICADO_RECORTE[f.recorte](item, cs)
}

export function contarKpis(itens: ItemStatusContratos[], f: FiltrosContratos): Record<RecorteContratos, number> {
  const base = filtrarBase(itens, f)
  const contagem = Object.fromEntries(RECORTES.map((r) => [r, 0])) as Record<RecorteContratos, number>
  for (const item of base) {
    for (const r of RECORTES) if (casaRecorte(item, { ...f, recorte: r })) contagem[r]++
  }
  return contagem
}

export function aplicar(itens: ItemStatusContratos[], f: FiltrosContratos): ItemStatusContratos[] {
  return filtrarBase(itens, f)
    .filter((item) => casaRecorte(item, f))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
}

export function opcoesDeConvenio(itens: ItemStatusContratos[]): string[] {
  return [...new Set(itens.map((i) => i.convenio).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  )
}

/**
 * O vencimento que importa no cartão: o mais próximo que ainda não passou; sem
 * nenhum, o mais recente que já passou. Recusado/expirado não entram — não
 * chegaram a valer.
 */
export function proximoVencimento(cs: ResumoContrato[]): ResumoContrato | null {
  const vivos = cs.filter((c) => !morto(c))
  const futuros = vivos.filter((c) => c.vigencia !== "vencido").sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))
  if (futuros.length > 0) return futuros[0]
  const passados = vivos.sort((a, b) => b.dataVencimento.localeCompare(a.dataVencimento))
  return passados[0] ?? null
}
