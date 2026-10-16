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
