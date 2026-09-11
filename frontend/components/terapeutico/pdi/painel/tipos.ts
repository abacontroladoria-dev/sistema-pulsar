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
