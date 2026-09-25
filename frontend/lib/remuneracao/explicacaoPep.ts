// Explicação da PEP apurada de UM paciente — o "por que deu R$ 86,67 de
// R$ 133,34" da coluna "PEP apurada" em Entregas PEP.
//
// PURO. Não recalcula nada: lê a linha já gravada em pep_apuracao_mensal
// (ajuste_recorrentes / ajuste_semestrais item a item, saldo, devolução) e só
// a traduz, com nome do item e quantidade faltando, a partir do catálogo. A
// conta mostrada é a mesma de calcularPEPPaciente (calculoPEP.ts):
//
//   líquido = max(0, V − recorrentes − semestrais − saldo anterior) + devolução
//
// e o "o que falta para 100%" é V − líquido, separado no que uma entrega ainda
// recupera (itens deste mês) e no que não depende de entrega (saldo de meses
// anteriores).

import type { PepApuracaoMensal, PepCatalogoItem } from "@/types/pep"

export type LinhaExplicacaoPep = {
  tipo: "recorrente" | "semestral" | "saldoAnterior" | "devolucao"
  /** Sigla do item (ex.: "STC"); vazio para saldo/devolução. */
  sigla: string
  nome: string
  /** Item GERAL: vale para todos os pacientes do analista, não só este. */
  geral: boolean
  /** Recorrente: quantas unidades faltaram e de quantas esperadas. */
  faltantes?: number
  esperadas?: number
  /** Fração de V (0.15 = 15%). */
  percentual?: number
  /** Sempre positivo; `tipo` diz se desconta ou soma. */
  valor: number
}

export type ExplicacaoPep = {
  potencial: number
  liquido: number
  /** Descontos na ordem: recorrentes, semestrais, saldo anterior; depois devolução (soma). */
  linhas: LinhaExplicacaoPep[]
  /** V − líquido. */
  faltaPara100: number
  /** Parte de faltaPara100 que entregar os itens deste mês recupera. */
  recuperavelComEntregas: number
  /** O líquido bateu no piso zero: o excedente vira desconto do mês seguinte. */
  saldoParaProximoMes: number
  modoTeste: boolean
  liberado: boolean
}

const CENTAVO = 0.005

export function explicarPepPaciente(
  r: Pick<PepApuracaoMensal,
    | "valor_bruto" | "valor_liquido" | "ajuste_recorrentes" | "ajuste_semestrais"
    | "saldo_remanescente_anterior" | "saldo_remanescente_novo" | "devolucao_valor"
    | "modo_teste" | "estado">,
  catalogo: PepCatalogoItem[],
  semanasCalendario: number,
): ExplicacaoPep {
  const porCodigo = new Map(catalogo.map(i => [i.codigo, i]))
  const potencial = Number(r.valor_bruto) || 0
  const liquido = Number(r.valor_liquido) || 0
  const linhas: LinhaExplicacaoPep[] = []

  for (const a of r.ajuste_recorrentes ?? []) {
    const valor = Number(a.valor) || 0
    if (valor <= CENTAVO) continue // item entregue por completo: não pesa
    const item = porCodigo.get(a.itemCodigo)
    const esperadas = item
      ? item.periodicidade === "semanal" ? semanasCalendario : (item.qtd_referencia_mes ?? 1)
      : undefined
    // percentual = faltantes × (peso ÷ esperadas) → faltantes = percentual × esperadas ÷ peso
    const faltantes = item && esperadas && item.peso_mensal > 0
      ? Math.round((a.percentual * esperadas) / item.peso_mensal)
      : undefined
    linhas.push({
      tipo: "recorrente",
      sigla: item?.sigla ?? a.itemCodigo,
      nome: item?.nome ?? a.itemCodigo,
      geral: item?.tipo_registro === "GERAL",
      faltantes, esperadas,
      percentual: a.percentual,
      valor,
    })
  }

  for (const a of r.ajuste_semestrais ?? []) {
    const valor = Number(a.valor) || 0
    if (valor <= CENTAVO) continue
    const item = porCodigo.get(a.itemCodigo)
    linhas.push({
      tipo: "semestral",
      sigla: item?.sigla ?? a.itemCodigo,
      nome: item?.nome ?? a.itemCodigo,
      geral: false,
      percentual: a.percentual,
      valor,
    })
  }

  const saldoAnterior = Number(r.saldo_remanescente_anterior) || 0
  if (saldoAnterior > CENTAVO) {
    linhas.push({ tipo: "saldoAnterior", sigla: "", nome: "Saldo negativo de meses anteriores", geral: false, valor: saldoAnterior })
  }
  const devolucao = Number(r.devolucao_valor) || 0
  if (devolucao > CENTAVO) {
    linhas.push({ tipo: "devolucao", sigla: "", nome: "Devolução de desconto já aplicado (semestral entregue)", geral: false, valor: devolucao })
  }

  const modoTeste = !!r.modo_teste
  const faltaPara100 = Math.max(0, potencial - liquido)
  // Quanto sobe se todos os itens do mês forem entregues: a mesma fórmula sem
  // os ajustes. Não é a soma dos ajustes — com saldo anterior alto o piso zero
  // engole parte (ou tudo) do que a entrega devolveria.
  const liquidoSemAjustes = Math.max(0, potencial - saldoAnterior) + devolucao
  const recuperavel = modoTeste ? 0 : Math.max(0, liquidoSemAjustes - liquido)

  return {
    potencial,
    liquido,
    linhas,
    faltaPara100,
    recuperavelComEntregas: Math.min(recuperavel, faltaPara100),
    saldoParaProximoMes: Number(r.saldo_remanescente_novo) || 0,
    modoTeste,
    liberado: r.estado === "liberado",
  }
}
