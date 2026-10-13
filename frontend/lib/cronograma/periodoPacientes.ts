// ─── Período do Dashboard de Pacientes ───────────────────────────────────────
//
// Duas escolhas, em linguagem de quem usa a tela, guardadas na URL para o link
// ser compartilhável e o "Voltar" do navegador funcionar:
//
//   atual  (padrão, sem parâmetro) — botão "Semana": a semana de referência de
//          sempre (semanaCorrenteRange: 1ª seg–sex inteira do mês seguinte + sáb).
//   mes    ?mes=AAAA-MM            — botão "Mês completo": um mês inteiro.
//
// Houve uma 3ª escolha, intervalo livre de datas, retirada a pedido do usuário
// em 13/10/2026: três modos + seletor + rótulo confundiam mais do que ajudavam,
// e "um mês" já responde "quem estava ativo em tal época".
//
// Os limites vêm do que existe na grade, medido em 13/10/2026 na
// vw_grade_base (só leitura):
//   • a linha mais antiga é de 07/01/2026 — antes disso não há o que mostrar;
//   • o sync do modo "grade" vai até o fim do mês seguinte, então além dele o
//     mês viria vazio e pareceria "ninguém ativo".
// Volume medido por mês (sessões agendadas): de 13,6 mil a 18,4 mil, sem
// buraco — o histórico passado está congelado desde 05/08/2026
// (trg_congelar_grade_passada), então um mês passado é um retrato fiel.

export type ModoPeriodo = "atual" | "mes"

export interface PeriodoResolvido {
  modo: ModoPeriodo
  inicio: string
  fim: string
  /** "AAAA-MM-01" no modo mês (valor do DatePicker com apenasMes). */
  mes: string | null
  /** Por que o mês pedido foi recortado (ex.: janeiro/2026 começa no dia 7). */
  ajuste: string | null
}

/** Primeira data com sessões na grade — ver medição no cabeçalho. */
export const HISTORICO_INICIO = "2026-01-07"

const RE_MES = /^\d{4}-\d{2}$/

function iso(y: number, m0: number, d: number): string {
  const dt = new Date(y, m0, d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

export function fmtDataBR(data: string): string {
  const [y, m, d] = data.split("-")
  return `${d}/${m}/${y}`
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

/** "2026-09-01" → "Setembro de 2026". */
export function rotuloMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number)
  const nome = MESES[m - 1]
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${y}`
}

/** Último dia com grade sincronizada: fim do mês seguinte ao de hoje. */
export function historicoFim(hoje = new Date()): string {
  return iso(hoje.getFullYear(), hoje.getMonth() + 2, 0)
}

/** Mês corrente, "AAAA-MM-01" — abertura da escolha de mês. */
export function mesCorrente(hoje = new Date()): string {
  return iso(hoje.getFullYear(), hoje.getMonth(), 1)
}

/** "AAAA-MM-01" deslocado em N meses, ou null se sair da grade (setas ‹ ›). */
export function mesVizinho(mes: string, deslocamento: number): string | null {
  const [y, m] = mes.split("-").map(Number)
  const alvo = iso(y, m - 1 + deslocamento, 1)
  if (alvo.slice(0, 7) < HISTORICO_INICIO.slice(0, 7)) return null
  if (alvo.slice(0, 7) > historicoFim().slice(0, 7)) return null
  return alvo
}

/**
 * Lê o período da URL. Parâmetro inválido cai na agenda atual em vez de
 * quebrar a tela — o link pode ter sido digitado à mão.
 */
export function resolverPeriodo(
  params: { get(nome: string): string | null },
  agendaAtual: () => { inicio: string; fim: string },
): PeriodoResolvido {
  const mes = params.get("mes")
  if (mes && RE_MES.test(mes)) {
    const [y, m] = mes.split("-").map(Number)
    let inicio = iso(y, m - 1, 1)
    let fim = iso(y, m, 0)
    const avisos: string[] = []
    if (inicio < HISTORICO_INICIO) { inicio = HISTORICO_INICIO; avisos.push(`a agenda registrada começa em ${fmtDataBR(HISTORICO_INICIO)}`) }
    if (fim > historicoFim()) { fim = historicoFim(); avisos.push(`a agenda vai até ${fmtDataBR(fim)}`) }
    // Mês inteiramente fora da grade: volta para a agenda atual.
    if (inicio <= fim) {
      return { modo: "mes", inicio, fim, mes: `${mes}-01`, ajuste: avisos.length ? `Atenção: ${avisos.join("; ")}.` : null }
    }
  }
  const { inicio, fim } = agendaAtual()
  return { modo: "atual", inicio, fim, mes: null, ajuste: null }
}
