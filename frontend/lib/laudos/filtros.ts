// Filtro, ordenação e contagem da tela Acompanhamento de Laudos.
//
// Módulo PURO, separado dos componentes por dois motivos concretos:
//
//   1. Os KPIs são o filtro (padrão adotado em auditoria-assim: o card é o
//      número que motiva o recorte, então um seletor paralelo seria a segunda
//      porta que ninguém usa). Se o número do card e a lista filtrada fossem
//      calculados em lugares diferentes, eles divergiriam — é exatamente o
//      defeito da barra de unidade, onde "N vagas" não bate com a projeção. Aqui
//      `contarKpis` e `filtrar` leem as MESMAS funções de predicado.
//   2. Dá para testar sem montar React.

import type {
  ItemAcompanhamentoLaudo,
  SituacaoPaciente,
  SituacaoLaudo,
} from "@/types/laudosAcompanhamento"

/**
 * Recorte de situação do laudo — o que os cards de KPI escrevem.
 *
 * "avisados" sozinho NÃO existe — decisão do usuário (28/08/2026): misturava
 * laudo vigente com vencido sob o mesmo número. `avisados_vigentes`/
 * `avisados_vencidos` cruzam as duas dimensões (contato × validade) em vez de
 * escondê-las atrás de uma soma. Já "vencidos" VOLTOU (o usuário pediu de
 * volta pouco depois de tirá-lo): é a visão geral, e convive com
 * `vencidos_sem_aviso` (a fila de trabalho, o subconjunto que importa agir).
 */
export type RecorteLaudo =
  | "todos"
  | "vigentes"
  | "vencidos"
  | "vencidos_sem_aviso"
  | "proximo_vencimento"
  | "avisados_vigentes"
  | "avisados_vencidos"

/**
 * Janela de alerta de "Vigente próximo ao vencimento": 15 dias corridos ou
 * menos até a `Validade`. Pedido do usuário (28/08/2026) — a fila de vencidos
 * já é tarde demais para agir sem pressa; este card é o aviso ANTES de o laudo
 * virar pendência.
 */
export const DIAS_ALERTA_VENCIMENTO = 15

/**
 * Acima de 30 dias até a `Validade`, marcar "avisado" é cedo demais — decisão
 * do usuário (28/08/2026). Não BLOQUEIA o salvamento (o responsável pode ter
 * sido contatado por outro motivo, ou a recepção pode ter uma razão que a tela
 * não vê); só confirma, porque errar aqui costuma ser clicar direto sem reparar
 * na validade. Mesmo raciocínio de `DIAS_ALERTA_VENCIMENTO`, e não coincidência
 * que os dois apontem para os mesmos 15 dias como "hora certa de avisar".
 */
export const DIAS_AVISO_PREMATURO = 30

export type OrdemLaudos = "validade" | "nome" | "avisado_em" | "data_laudo"

export interface FiltrosLaudos {
  recorte: RecorteLaudo
  /** Nome, ID PAC ou ID LAU. Casa sem acento e sem caixa. */
  busca: string
  /** Situação do paciente no cadastro — complementares, somam ao resultado. */
  situacoesPaciente: Set<SituacaoPaciente>
  /** Janela de `validade` (ISO, inclusiva nas duas pontas). "" = sem limite. */
  validadeDe: string
  validadeAte: string
  ordem: OrdemLaudos
}

export const TODAS_SITUACOES_PACIENTE: SituacaoPaciente[] = [
  "ativo",
  "inativo",
  "sem_cadastro",
  "ficticio",
]

/**
 * O estado inicial da tela: **vencidos sem aviso**, ordenados por validade mais
 * antiga.
 *
 * É a fila de trabalho de verdade — vencido e ninguém ainda contatou o
 * responsável — e não "vencidos" (que existe como card de visão geral, mas
 * inclui quem já foi avisado): um vencido já avisado está fora da urgência do
 * dia. Abrir em "todos" faria a recepção aplicar o mesmo filtro toda vez antes
 * de começar a trabalhar.
 */
export function filtrosIniciais(): FiltrosLaudos {
  return {
    recorte: "vencidos_sem_aviso",
    busca: "",
    // As QUATRO marcadas, fictício incluído. /cadastros/pacientes deixa o
    // fictício fora por padrão, e aqui a inclinação era copiar isso — mas o
    // usuário pediu explicitamente para "Notificação Prévia" continuar visível
    // (é o laudo que ele usa para testar a tela, 28/08/2026). O fictício segue
    // identificado por selo próprio e desmarcável no filtro; só não nasce
    // escondido.
    situacoesPaciente: new Set(TODAS_SITUACOES_PACIENTE),
    validadeDe: "",
    validadeAte: "",
    ordem: "validade",
  }
}

/**
 * Há algo a limpar? Compara o estado atual com o de abertura.
 *
 * Serve ao botão "Limpar filtros": sem esta pergunta o botão fica sempre aceso,
 * inclusive quando clicar nele não muda nada — um controle morto que o usuário
 * aprende a ignorar.
 *
 * Vive aqui e não no componente porque "limpo" é definido por `filtrosIniciais`,
 * que também vive aqui: se um default mudar, os dois mudam juntos. Um `===` de
 * objeto não serviria (o Set nunca é o mesmo), daí a comparação campo a campo.
 */
export function filtrosAlterados(f: FiltrosLaudos): boolean {
  const inicial = filtrosIniciais()
  if (f.recorte !== inicial.recorte) return true
  if (f.ordem !== inicial.ordem) return true
  if (f.busca.trim() !== "") return true
  if (f.validadeDe || f.validadeAte) return true
  // Conjunto: tamanho E conteúdo. Só o tamanho deixaria passar uma troca de
  // "ativo" por "fictício", que tem a mesma contagem e resultado diferente.
  if (f.situacoesPaciente.size !== inicial.situacoesPaciente.size) return true
  for (const s of inicial.situacoesPaciente) {
    if (!f.situacoesPaciente.has(s)) return true
  }
  return false
}

/** Sem acento, minúsculo — para "Joao" casar com "João". Igual ao cadastro. */
export function norm(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

// ─── Predicados: uma definição por recorte, usada pelo filtro E pelo KPI ─────

const ehVencido = (i: ItemAcompanhamentoLaudo) => i.situacao === "vencido"
const ehVigente = (i: ItemAcompanhamentoLaudo) => i.situacao === "vigente"
const foiAvisado = (i: ItemAcompanhamentoLaudo) => i.mensagemEnviadaEm !== null

/**
 * Dias corridos de `hojeISO` até `validade` (negativo se já passou). `null` sem
 * validade — "sem prazo" não é "vence em N dias".
 *
 * `Date.UTC` sobre os três campos separados, e não `new Date(iso)`: as duas
 * strings já são datas puras em `AAAA-MM-DD`, sem hora nem fuso — construir a
 * partir delas com UTC explícito garante que a subtração conta dias de
 * calendário, não 24h corridas que um horário de verão deslocaria.
 *
 * EXPORTADA: além de `proximoDoVencimento` aqui dentro, o modal de registro do
 * aviso usa a mesma função para decidir se é cedo demais para marcar "avisado"
 * (ver `RegistrarAvisoModal`, regra de 30 dias do usuário em 28/08/2026). Uma
 * função só, para as duas regras nunca discordarem sobre quantos dias faltam.
 */
export function diasAteValidade(validade: string | null, hojeISO: string): number | null {
  if (!validade) return null
  const [anoV, mesV, diaV] = validade.split("-").map(Number)
  const [anoH, mesH, diaH] = hojeISO.split("-").map(Number)
  const msPorDia = 24 * 60 * 60 * 1000
  return Math.round(
    (Date.UTC(anoV, mesV - 1, diaV) - Date.UTC(anoH, mesH - 1, diaH)) / msPorDia,
  )
}

/**
 * É cedo demais para marcar "avisado"? Mais de `DIAS_AVISO_PREMATURO` dias
 * até a validade.
 *
 * `null` (sem validade) NUNCA é prematuro — sem prazo não há o que antecipar, e
 * bloquear o registro de um laudo sem validade cadastrada seria travar a tela
 * por um dado ausente que a recepção não controla.
 *
 * Usada pelo modal de registro para decidir se mostra a confirmação vermelha —
 * ver `RegistrarAvisoModal`. Vive aqui, e não no componente, para ter o mesmo
 * tratamento de teste que o resto das regras de data desta tela.
 */
export function avisoEhPrematuro(validade: string | null, hojeISO: string): boolean {
  const dias = diasAteValidade(validade, hojeISO)
  return dias !== null && dias > DIAS_AVISO_PREMATURO
}

/**
 * Vigente, SEM aviso registrado, e a validade cai dentro de
 * `DIAS_ALERTA_VENCIMENTO`.
 *
 * NÃO é "validade nos próximos 15 dias" sozinho: um laudo já vencido também
 * teria validade "há poucos dias", e ele já está em `vencidos_sem_aviso` ou em
 * `avisados_vencidos` — contá-lo aqui também inflaria dois cards pela mesma
 * linha. Exigir `vigente` torna esses recortes disjuntos.
 *
 * E `!foiAvisado` — decisão do usuário (28/08/2026): um laudo que a recepção já
 * avisou não é mais "precisa agir logo", é "já agiu, aguardando o responsável".
 * Sem essa exclusão, o MESMO laudo apareceria neste card E em
 * `avisados_vigentes` ao mesmo tempo — dois números contando a mesma linha.
 * Avisado é sempre `avisados_vigentes`, nunca os dois.
 */
function proximoDoVencimento(i: ItemAcompanhamentoLaudo, hojeISO: string): boolean {
  if (!ehVigente(i) || foiAvisado(i)) return false
  const dias = diasAteValidade(i.validade, hojeISO)
  return dias !== null && dias <= DIAS_ALERTA_VENCIMENTO
}

export const PREDICADO_RECORTE: Record<
  RecorteLaudo,
  (i: ItemAcompanhamentoLaudo, hojeISO: string) => boolean
> = {
  todos: () => true,
  vigentes: ehVigente,
  vencidos: ehVencido,
  // O recorte que a tela existe para servir: vencido E ainda sem contato. É a
  // fila de trabalho do dia — subconjunto de `vencidos`, não par dele.
  vencidos_sem_aviso: (i) => ehVencido(i) && !foiAvisado(i),
  proximo_vencimento: proximoDoVencimento,
  // As duas faces de "Avisados" — cruzando contato × validade, em vez de somar
  // as duas sob um único número que não diria se o laudo ainda precisa de
  // renovação ou não.
  avisados_vigentes: (i) => ehVigente(i) && foiAvisado(i),
  avisados_vencidos: (i) => ehVencido(i) && foiAvisado(i),
}

/** `null` nunca entra numa janela de data: ausência não é intervalo. */
function dentroDaJanela(iso: string | null, de: string, ate: string): boolean {
  if (!de && !ate) return true
  if (!iso) return false
  if (de && iso < de) return false
  if (ate && iso > ate) return false
  return true
}

/**
 * Os filtros da barra que NÃO são o recorte: busca, situação do paciente e a
 * janela de validade. Extraído à parte porque `contarKpis` precisa aplicá-los
 * SEM aplicar o recorte — ver o comentário lá.
 */
function aplicarFiltrosSecundarios(
  itens: ItemAcompanhamentoLaudo[],
  f: FiltrosLaudos,
): ItemAcompanhamentoLaudo[] {
  const termo = norm(f.busca)

  return itens.filter((i) => {
    // Conjunto vazio não devolve a lista inteira: se o usuário desmarcou as três
    // situações, o resultado honesto é nenhuma linha, não todas.
    if (!f.situacoesPaciente.has(i.situacaoPaciente)) return false

    if (!dentroDaJanela(i.validade, f.validadeDe, f.validadeAte)) return false

    if (termo) {
      const casaNome = norm(i.nome).includes(termo)
      // Comparação por `includes` no id, e não igualdade: digitar "115" acha
      // 11511. Casa contra os DOIS ids que o cartão mostra — o de paciente e o
      // de laudo —, porque a recepção tem os dois em mão dependendo de onde
      // veio a pendência.
      const casaPac = i.idFavorecido !== null && String(i.idFavorecido).includes(termo)
      const casaLaudo = i.idLaudo.includes(termo)
      if (!casaNome && !casaPac && !casaLaudo) return false
    }

    return true
  })
}

/**
 * Os números dos cards.
 *
 * Aplica `aplicarFiltrosSecundarios` (busca, situação, janelas de data) ANTES
 * de contar — pedido do usuário (28/08/2026): "eu tenho 4 Vence em breve, mas
 * nenhum dentro do período de Avisado em que eu escolhi — o painel precisa
 * responder a isso". Sem isso, os cards mostravam a contagem da lista INTEIRA,
 * ignorando os filtros de data/busca/situação que o resto da tela já obedecia.
 *
 * NÃO aplica `f.recorte` — cada card conta pelo SEU PRÓPRIO predicado, nunca
 * pelo que está selecionado no momento. Se aplicasse, selecionar "Vencidos"
 * zeraria todos os outros cards (eles ficariam de fora do recorte ativo), e a
 * barra de KPI deixaria de servir para TROCAR de recorte — que é a razão dela
 * ser clicável. `hojeISO` vem de fora pelo mesmo motivo de sempre: nunca
 * `new Date()` aqui dentro.
 */
export function contarKpis(
  itens: ItemAcompanhamentoLaudo[],
  f: FiltrosLaudos,
  hojeISO: string,
): Record<RecorteLaudo, number> {
  const base = aplicarFiltrosSecundarios(itens, f)
  return {
    todos: base.length,
    vigentes: base.filter((i) => PREDICADO_RECORTE.vigentes(i, hojeISO)).length,
    vencidos: base.filter((i) => PREDICADO_RECORTE.vencidos(i, hojeISO)).length,
    vencidos_sem_aviso: base.filter((i) => PREDICADO_RECORTE.vencidos_sem_aviso(i, hojeISO))
      .length,
    proximo_vencimento: base.filter((i) => PREDICADO_RECORTE.proximo_vencimento(i, hojeISO))
      .length,
    avisados_vigentes: base.filter((i) => PREDICADO_RECORTE.avisados_vigentes(i, hojeISO))
      .length,
    avisados_vencidos: base.filter((i) => PREDICADO_RECORTE.avisados_vencidos(i, hojeISO))
      .length,
  }
}

/**
 * A lista que a tela mostra: os filtros secundários E o recorte selecionado.
 * Cada card de KPI leva a EXATAMENTE esta lista quando vira o recorte ativo —
 * é o que `contarKpis` promete contar.
 */
export function filtrar(
  itens: ItemAcompanhamentoLaudo[],
  f: FiltrosLaudos,
  hojeISO: string,
): ItemAcompanhamentoLaudo[] {
  return aplicarFiltrosSecundarios(itens, f).filter((i) => PREDICADO_RECORTE[f.recorte](i, hojeISO))
}

/**
 * Ordena. Sempre com desempate por nome, para a lista não trocar de ordem entre
 * dois renders quando o critério empata (343 laudos com muitas validades
 * repetidas — sem desempate, a paginação embaralha).
 */
export function ordenar(
  itens: ItemAcompanhamentoLaudo[],
  ordem: OrdemLaudos,
): ItemAcompanhamentoLaudo[] {
  const porNome = (a: ItemAcompanhamentoLaudo, b: ItemAcompanhamentoLaudo) =>
    a.nome.localeCompare(b.nome, "pt-BR")

  // Datas em ISO comparam como string. `null` vai para o FIM em todos os
  // critérios de data: "sem data" não é "muito antigo".
  const porData =
    (campo: "validade" | "mensagemEnviadaEm" | "dataLaudo") =>
    (a: ItemAcompanhamentoLaudo, b: ItemAcompanhamentoLaudo) => {
      const x = a[campo]
      const y = b[campo]
      if (x === y) return porNome(a, b)
      if (!x) return 1
      if (!y) return -1
      return x < y ? -1 : 1
    }

  const comparador =
    ordem === "nome"
      ? porNome
      : ordem === "avisado_em"
        ? porData("mensagemEnviadaEm")
        : ordem === "data_laudo"
          ? porData("dataLaudo")
          : porData("validade")

  // Cópia: ordenar no lugar mutaria o array do estado do React.
  return [...itens].sort(comparador)
}

/** Filtrar + ordenar, na ordem certa. É o que a tela chama. */
export function aplicar(
  itens: ItemAcompanhamentoLaudo[],
  f: FiltrosLaudos,
  hojeISO: string,
): ItemAcompanhamentoLaudo[] {
  return ordenar(filtrar(itens, f, hojeISO), f.ordem)
}

export const RECORTE_LABEL: Record<RecorteLaudo, string> = {
  todos: "Todos",
  vigentes: "Vigentes",
  vencidos: "Vencidos",
  vencidos_sem_aviso: "Vencidos sem aviso",
  proximo_vencimento: "Vence em breve",
  avisados_vigentes: "Avisados — Vigentes",
  avisados_vencidos: "Avisados — Vencidos",
}

export const SITUACAO_LAUDO_LABEL: Record<SituacaoLaudo, string> = {
  vigente: "Vigente",
  vencido: "Vencido",
  sem_validade: "Sem validade",
}

export const SITUACAO_PACIENTE_LABEL: Record<SituacaoPaciente, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  sem_cadastro: "Sem cadastro",
  ficticio: "Fictício",
}
