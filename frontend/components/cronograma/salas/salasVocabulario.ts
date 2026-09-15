// salasVocabulario — o vocabulário VISUAL de Ocupação de Salas: que cor e que
// forma cada estado recebe. Camada 2 do padrão (docs/padrao-detalhamento-modal.md):
// a camada 1 (`lib/cronograma/salasView.ts`) decide QUAL é o estado; aqui se
// decide como ele APARECE; os componentes só desenham.
//
// Existe porque os mapas estavam copiados: `DIA_CLS` idêntico em SalaCard e
// SalaDetalheView, `SITUACAO_TONE` em AlocacaoDrawer e SalaProfissionaisTab — e
// os dois últimos com assinaturas diferentes (`Record<string, Tone>` com
// fallback `?? "slate"` num, `Record<SituacaoCelula, Tone>` no outro), então a
// versão frouxa aceitava calada uma situação inexistente. Três cópias de um
// mapa de cor é exatamente COMO a divergência acontece.
//
// ─── As duas regras que este arquivo existe para garantir ────────────────────
//
// 1. UM TOM, UM SIGNIFICADO — e agora entre componentes, não só dentro de cada
//    um. Antes, âmbar queria dizer quatro coisas (ocupação parcial do dia,
//    `sem-sessao`, "existem inconsistências", "filtro ligado") e rosa cinco
//    (conflito no dia, fundo da célula, borda do card, PREENCHIMENTO DA BARRA
//    de ocupação, erro de carga). Aqui:
//      • rosa  = conflito, e nada mais
//      • âmbar = precisa de atenção humana
//      • verde = saudável/cheio
//      • zero NÃO tem cor (ver a regra 2)
//
// 2. ZERO NÃO TEM COR. `livre` é ausência, não estado ruim nem bom: pintar de
//    verde diria "tudo certo" sobre uma sala vazia, e de vermelho diria que há
//    problema. Vira anel, nunca preenchimento.
//
// ─── Por que a forma também entra aqui ───────────────────────────────────────
//
// A cor da TERAPIA (`tCor`) e a cor da SITUAÇÃO são eixos semânticos
// diferentes, e antes usavam o mesmo dot redondo de 8px a ~40px de distância
// na mesma célula — impossível saber qual bolinha significa o quê. Terapia
// passa a ser QUADRADO arredondado, situação continua CÍRCULO. A forma carrega
// o eixo; a cor carrega o valor dentro do eixo.

import type { Tone } from "@/components/cronograma/ui/tones"
import type { NivelDia, SituacaoCelula } from "@/lib/cronograma/salasView"

/**
 * Bolinha de um dia no resumo semanal (card e detalhe usam a MESMA, em
 * tamanhos diferentes — o tamanho é do chamador, a cor é daqui).
 */
export const DIA_CLS: Record<NivelDia, string> = {
  conflito: "bg-rose-500",
  cheio: "bg-emerald-500",
  parcial: "bg-amber-400",
  // Zero não tem cor: anel, não preenchimento.
  livre: "bg-transparent ring-1 ring-inset ring-border",
  "fora-de-operacao": "bg-slate-300 dark:bg-slate-700",
  "sem-atendimento": "bg-transparent",
}

/**
 * Tom do StatusPill que nomeia uma situação por extenso (drawer, tabela de
 * profissionais). Tipado por `SituacaoCelula`, sem fallback: uma situação nova
 * quebra o build aqui, em vez de sair cinza calada em produção.
 */
export const SITUACAO_TONE: Record<SituacaoCelula, Tone> = {
  confirmada: "green",
  "agenda-aberta": "blue",
  "sem-sessao": "amber",
  conflito: "red",
  bloqueado: "slate",
  livre: "slate",
  indisponivel: "slate",
}

/**
 * Dot da legenda da grade semanal. Mesmas cores do `SITUACAO_TONE` acima, mas
 * como preenchimento sólido — um pill tonal de 8px seria ilegível.
 */
export const SITUACAO_DOT: Record<SituacaoCelula, string> = {
  confirmada: "bg-emerald-500",
  "agenda-aberta": "bg-sky-500",
  "sem-sessao": "bg-amber-400",
  conflito: "bg-rose-500",
  bloqueado: "bg-slate-400",
  livre: "bg-transparent ring-1 ring-inset ring-border",
  indisponivel: "bg-transparent",
}

/**
 * Cor do NOME do profissional dentro da célula — o único lugar onde o estado de
 * UMA alocação aparece (o fundo da célula é do slot inteiro).
 *
 * `confirmada` e `livre` ficam na cor normal de texto de propósito: o estado
 * saudável não precisa de cor, senão toda célula vira colorida e nenhuma chama
 * atenção.
 */
export const SITUACAO_NOME_CLS: Record<SituacaoCelula, string> = {
  confirmada: "text-foreground",
  "agenda-aberta": "text-sky-700 dark:text-sky-400",
  "sem-sessao": "text-amber-700 dark:text-amber-400",
  conflito: "text-rose-700 dark:text-rose-400",
  bloqueado: "text-muted-foreground",
  livre: "text-foreground",
  indisponivel: "text-muted-foreground",
}

/** O que o usuário pode encontrar numa célula preenchida — a legenda da grade. */
export const SITUACOES_LEGENDA: SituacaoCelula[] = [
  "confirmada", "agenda-aberta", "sem-sessao", "livre", "conflito", "bloqueado",
]

/**
 * Marcador de TERAPIA: quadrado arredondado, para nunca ser confundido com o
 * círculo que marca SITUAÇÃO. A cor vem de `tCor(nome)`, não daqui — este
 * módulo define a forma e o chamador passa o `style={{ background }}`.
 */
export const TERAPIA_MARCA_CLS = "h-2 w-2 shrink-0 rounded-[3px] ring-1 ring-black/10 dark:ring-white/10"

/** Marcador de SITUAÇÃO: círculo. Contraparte de `TERAPIA_MARCA_CLS`. */
export const SITUACAO_MARCA_CLS = "h-2 w-2 shrink-0 rounded-full"

// ─── UNIDADE ──────────────────────────────────────────────────────────────────
//
// A unidade é o principal agrupador de uma grade de ~89 cards ("quais salas de
// Realengo estão livres?"), e era a informação mais apagada do card: cinza de
// 12px, fundida com o andar numa string só.
//
// A cor aqui NÃO pode colidir com o vocabulário de estado acima. Rosa, âmbar,
// verde e azul-céu já significam conflito / atenção / saudável / agenda-aberta;
// pintar uma unidade de âmbar faria "Fazendinha" parecer um alerta. Sobram as
// famílias que nenhum estado usa — violeta, terracota e ciano.
//
// O veículo é um CHIP (fundo tonal + texto), não um trilho na borda: o
// DESIGN.md proíbe side-stripe (`border-left` > 1px) em card, e a memória do
// projeto registra a mesma regra — "a cor mora no perímetro, nunca num trilho
// lateral". O chip ainda é melhor de ler: carrega o nome junto da cor.
//
// Três unidades físicas (ver ORDEM_UNIDADES em comparativoSessoes.ts). Uma
// unidade nova cai no fallback neutro em vez de ganhar cor aleatória — cor
// atribuída por hash daria a duas unidades o mesmo tom no primeiro conflito.
const UNIDADE_CORES: { chip: string }[] = [
  { chip: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300" },
  { chip: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300" },
  { chip: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300" },
]

const UNIDADE_NEUTRA = { chip: "bg-muted text-muted-foreground" }

/**
 * Ordem canônica das unidades, espelhando ORDEM_UNIDADES de comparativoSessoes.
 * A posição na lista é o que define a cor — assim "Realengo" é sempre violeta,
 * em qualquer tela e em qualquer recorte de filtro.
 */
export const UNIDADES_CONHECIDAS = ["Realengo", "Fazendinha", "Padre Miguel"]

export function corDaUnidade(unidade: string | null | undefined) {
  const i = unidade ? UNIDADES_CONHECIDAS.indexOf(unidade) : -1
  return i === -1 ? UNIDADE_NEUTRA : UNIDADE_CORES[i]
}
