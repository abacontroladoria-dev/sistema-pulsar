// Nome de terapia como a recepção o conhece. Só exibição: o valor gravado na
// fila (terapia_nome / terapia_falta) continua o do TiTa, que é a chave
// operacional.
//
// Operações Clínicas (2279) só chega à /solicitar quando é Entrevista Inicial
// com paciente real (migration 20261013120000) — o TiTa não manda esse nome em
// campo nenhum, então a tela traduz.
const ROTULOS: Record<string, string> = {
  'operações clínicas': 'Entrevista Inicial',
}

export function rotuloTerapia(nome: string | null | undefined): string {
  const t = (nome || '').trim()
  return ROTULOS[t.toLowerCase()] ?? t
}

export function rotuloTerapias(nomes: (string | null)[] | null | undefined): string {
  return (nomes || []).map(rotuloTerapia).filter(Boolean).join(' + ')
}
