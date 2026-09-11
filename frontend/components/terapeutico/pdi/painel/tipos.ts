/**
 * O recorte de status do "PDI — Painel por Analista". É uma CHAVE de
 * `ResumoExecutivoPdi`/`LinhaAnalista` de propósito: o mesmo valor lê o número
 * do card (`resumo[recorte]`) e filtra a lista (`linha[recorte] === 0`), então
 * não há como o card e o filtro discordarem sobre o que "atrasados" significa.
 *
 * `totalPacientes` é o "sem recorte" — a população inteira do painel.
 */
export type RecortePainel =
  | "totalPacientes"
  | "atrasados"
  | "proximoPrazo"
  | "emAndamento"
  | "aguardandoImplementacao"

/**
 * A marca de "este é o recorte ativo", UMA só para os três caminhos de entrada
 * (cards do topo, fatias da Distribuição, seletor de Status).
 *
 * Antes eram três: `ring-2 ring-offset-2 ring-ring` nos cards e `bg-muted` nas
 * barras. Dois problemas. O `bg-muted` sobre `bg-card` é uma diferença quase
 * nula — a lateral nunca confirmava ser a origem do filtro. E `ring-ring` é a
 * cor do FOCO: usada também para seleção, quem navega por teclado não
 * distinguia "estou aqui" de "isto está ligado", sobrando só o `aria-pressed`,
 * que não é visível. O anel volta a ser exclusivo do foco.
 */
export const SELECIONADO = "border-primary bg-primary/5"
