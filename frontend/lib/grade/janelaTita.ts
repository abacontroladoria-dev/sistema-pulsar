import { hojeBrasilia, somarDias } from "@/lib/disponibilidadeProfissional"
import { inicioDaSemana } from "@/lib/grade/motor"

/**
 * Janela padrão do "Importar do TiTa" da Grade: segunda da semana atual até o
 * fim do mês seguinte (o que o sync do TiTa cobre), no máximo 120 dias.
 */
export function janelaImportacaoTita(hoje = hojeBrasilia()): { inicio: string; fim: string } {
  const inicio = somarDias(inicioDaSemana(hoje), 1)
  const [a, m] = hoje.split("-").map(Number)
  const fimMesSeguinte = new Date(Date.UTC(a, m + 1, 0)).toISOString().slice(0, 10)
  const limite = somarDias(inicio, 120)
  return { inicio, fim: fimMesSeguinte < limite ? fimMesSeguinte : limite }
}

/**
 * Janela que o "Carregar do TiTa" relê AO VIVO antes de importar a agenda: de
 * hoje até a sexta da primeira semana completa (segunda a sexta) do mês
 * seguinte. Decisão do usuário em 20/10/2026: a carga tem de trazer o que
 * está no TiTa agora, não o retrato do sync das 02:00. O resto da janela de
 * importação segue com a cópia das 02:00 (no máximo 1 dia de atraso).
 *
 * Ex.: hoje 20/10/2026 → novembro começa num domingo, a primeira semana
 * completa é 02–06/11, então a janela é 20/10 → 06/11.
 */
export function janelaReleituraTita(hoje = hojeBrasilia()): { inicio: string; fim: string } {
  const [a, m] = hoje.split("-").map(Number)
  const dia1 = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10)
  // getUTCDay: 0 = domingo, 1 = segunda. Dias até a primeira segunda (inclusive o dia 1).
  const dow = new Date(`${dia1}T00:00:00Z`).getUTCDay()
  const primeiraSegunda = somarDias(dia1, (8 - dow) % 7)
  return { inicio: hoje, fim: somarDias(primeiraSegunda, 4) }
}
