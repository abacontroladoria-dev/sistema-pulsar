// Filtro, ordenação e contagem da tela Status Laudos e Senhas.
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
  StatusSenha,
} from "@/types/laudosAcompanhamento"
import { CONVENIOS_PADRAO, SEM_CONVENIO } from "./convenio"

/**
 * Recorte de situação do laudo — o que os cards de KPI escrevem.
 *
 * "avisados" sozinho NÃO existe — decisão do usuário (28/08/2026): misturava
 * laudo vigente com vencido sob o mesmo número. `avisados_vigentes`/
 * `avisados_vencidos` cruzam as duas dimensões (contato × validade) em vez de
 * escondê-las atrás de uma soma. Já "vencidos" VOLTOU (o usuário pediu de
 * volta pouco depois de tirá-lo): é a visão geral, e convive com
 * `vencidos_sem_aviso` (a fila de trabalho, o subconjunto que importa agir).
 *
 * `vencidos_ha_muito` — o 4º card da visão geral (usuário, 29/09/2026), para o
 * painel do laudo ter a mesma forma do de senhas. Subconjunto de `vencidos`:
 * medido no mesmo dia, 92 dos 143 vencidos de pacientes ativos tinham passado
 * de 180 dias — paciente em atendimento sem laudo há meses, não renovação
 * atrasada. Ver `MESES_VENCIDO_HA_MUITO`.
 */
export type RecorteLaudo =
  | "todos"
  | "vigentes"
  | "vencidos"
  | "vencidos_ha_muito"
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

/**
 * "Vencidos há mais de 6 meses": a validade ficou antes de hoje menos 6 meses
 * de CALENDÁRIO — o rótulo diz meses, então a conta é em meses, não em 180
 * dias. Número de meses num lugar só: o rótulo do card sai daqui.
 */
export const MESES_VENCIDO_HA_MUITO = 6

/**
 * `hojeISO` recuado `meses` meses de calendário. Dia que não existe no mês de
 * destino encosta no último (31/08 − 6 meses = 28/02 ou 29/02), em vez de
 * transbordar para março como faria `Date` sozinho.
 */
export function recuarMeses(hojeISO: string, meses: number): string {
  const [ano, mes, dia] = hojeISO.split("-").map(Number)
  const total = ano * 12 + (mes - 1) - meses
  const anoD = Math.floor(total / 12)
  const mesD = (total % 12) + 1
  const ultimoDia = new Date(Date.UTC(anoD, mesD, 0)).getUTCDate()
  const diaD = Math.min(dia, ultimoDia)
  return `${anoD}-${String(mesD).padStart(2, "0")}-${String(diaD).padStart(2, "0")}`
}

/**
 * Recorte da SENHA ASSIM — o que os cards do painel "Senha ASSIM" escrevem.
 * Irmão de `RecorteLaudo`, e COMBINÁVEL com ele (decisão do usuário,
 * 28/09/2026): "Vencidos sem aviso" + "Sem senha" mostra o cruzamento.
 *
 * Lê `senhas.pior` — o pior dos dois lados (dentro/fora do ROL) —, para uma
 * senha fora do ROL pendente não se esconder atrás de uma dentro do ROL vigente.
 *
 *   visão geral:   vigente (inclui "vence em breve") · vencida · laudo_antigo ·
 *                  sem_senha
 *   fila de ação:  pendente · vence_em_breve · sem_validade · em_analise
 *
 * `vence_em_breve` é subconjunto de `vigente`, como `proximo_vencimento` é de
 * `vigentes` no laudo: o card geral diz "está valendo", o de detalhe diz "vai
 * deixar de valer logo". Os demais são disjuntos.
 */
export type RecorteSenha =
  | "todos"
  | "vigente"
  | "vencida"
  | "laudo_antigo"
  | "sem_senha"
  | "pendente"
  | "vence_em_breve"
  | "sem_validade"
  | "em_analise"

/**
 * Ordenação da lista, em dois grupos — espelho dos dois painéis (pedido do
 * usuário, 28/09/2026: "os filtros de ordenação só estão pensando no laudo").
 *
 *   laudo: validade · data_laudo · avisado_em · nome
 *   senha: urgencia_senha · validade_senha · liberacao_senha · atualizacao_senha
 */
export type OrdemLaudos =
  | "validade"
  | "data_laudo"
  | "avisado_em"
  | "nome"
  | "urgencia_senha"
  | "validade_senha"
  | "liberacao_senha"
  | "atualizacao_senha"

/**
 * Status da senha do PIOR para o melhor. É a régua de `senhas.pior` (o pior dos
 * dois lados, em senhas.ts) E da ordenação "Urgência da senha" — uma régua só,
 * para o card e a ordem da lista nunca discordarem do que é mais grave.
 */
export const GRAVIDADE_SENHA: StatusSenha[] = [
  "vencida",
  "sem_senha",
  // Depois de "Sem senha": a senha existe, falta vinculá-la ao laudo atual.
  "laudo_antigo",
  "pendente",
  "em_analise",
  "sem_validade",
  "vence_em_breve",
  "vigente",
  "nao_se_aplica",
]

export interface FiltrosLaudos {
  recorte: RecorteLaudo
  /** Nome, ID PAC ou ID LAU. Casa sem acento e sem caixa. */
  busca: string
  /** Situação do paciente no cadastro — complementares, somam ao resultado. */
  situacoesPaciente: Set<SituacaoPaciente>
  /** Recorte da senha ASSIM — os cards do painel "Senha ASSIM". Ver `RecorteSenha`. */
  recorteSenha: RecorteSenha
  /**
   * Convênios escolhidos. VAZIO = todos — ao contrário de paciente e senha, que
   * nascem com tudo marcado: as opções de convênio só existem depois que a lista
   * carrega (saem dos itens), e são ~17; marcar todas de saída obrigaria a
   * desmarcar 16 para ver um. `SEM_CONVENIO` ("") = laudo sem convênio.
   */
  convenios: Set<string>
  /** Janela de `validade` (ISO, inclusiva nas duas pontas). "" = sem limite. */
  validadeDe: string
  validadeAte: string
  /**
   * Janela da validade da SENHA (ISO, inclusiva). O laudo entra quando QUALQUER
   * das suas senhas (dentro ou fora do ROL) vence dentro dela — "próximos 15
   * dias" precisa pegar a senha fora do ROL que vence semana que vem mesmo com a
   * de dentro valendo até o ano que vem. "" = sem limite.
   */
  validadeSenhaDe: string
  validadeSenhaAte: string
  ordem: OrdemLaudos
}

export const TODAS_SITUACOES_PACIENTE: SituacaoPaciente[] = [
  "ativo",
  "inativo",
  "sem_cadastro",
  "ficticio",
]


/**
 * O estado inicial da tela — pedido do usuário (28/09/2026): "que sempre venha
 * filtrado por paciente ativo, convênio ASSIM Saúde" e o laudo em **Todos**.
 *
 * Até ali abria em "Vencidos sem aviso" (a fila de trabalho do laudo). Com o
 * painel da senha ao lado, abrir num recorte de laudo escondia metade do quadro
 * de senhas logo de cara; "Todos" mostra os dois painéis inteiros, e a fila do
 * dia continua a um clique, no primeiro card da "Fila de ação".
 */
export function filtrosIniciais(): FiltrosLaudos {
  return {
    recorte: "todos",
    busca: "",
    // Só ATIVO — pedido do usuário (28/09/2026): "precisa vir automaticamente
    // como filtrado somente por ATIVO". Substitui a decisão de 28/08 de abrir
    // com as quatro (fictício incluído, por causa do laudo de teste "Notificação
    // Prévia"): o fictício continua a um clique, no filtro Paciente. O link
    // direto de outra tela abre com as quatro — ver o shell.
    situacoesPaciente: new Set<SituacaoPaciente>(["ativo"]),
    recorteSenha: "todos",
    // ASSIM e LEVE marcados — o painel abre em "Senhas ASSIM e LEVE". Ver
    // `CONVENIOS_PADRAO`.
    convenios: new Set(CONVENIOS_PADRAO),
    validadeDe: "",
    validadeAte: "",
    validadeSenhaDe: "",
    validadeSenhaAte: "",
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
  if (f.validadeSenhaDe || f.validadeSenhaAte) return true
  // Conjunto: tamanho E conteúdo. Só o tamanho deixaria passar uma troca de
  // "ativo" por "fictício", que tem a mesma contagem e resultado diferente.
  if (f.situacoesPaciente.size !== inicial.situacoesPaciente.size) return true
  for (const s of inicial.situacoesPaciente) {
    if (!f.situacoesPaciente.has(s)) return true
  }
  if (f.convenios.size !== inicial.convenios.size) return true
  for (const c of inicial.convenios) {
    if (!f.convenios.has(c)) return true
  }
  if (f.recorteSenha !== inicial.recorteSenha) return true
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
  // Validade ANTES do limite (estrita): no dia exato dos 6 meses, ainda não
  // passou de 6 meses. Laudo sem validade nunca entra — nem vencido ele é.
  vencidos_ha_muito: (i, hojeISO) =>
    ehVencido(i) &&
    i.validade !== null &&
    i.validade < recuarMeses(hojeISO, MESES_VENCIDO_HA_MUITO),
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

const piorDaSenha = (i: ItemAcompanhamentoLaudo): StatusSenha | null => i.senhas?.pior ?? null

/**
 * Um predicado por recorte de senha. Laudo sem `senhas` (nenhum relatório
 * importado) só entra em "todos": não é "sem senha", é "sem informação".
 */
export const PREDICADO_RECORTE_SENHA: Record<RecorteSenha, (i: ItemAcompanhamentoLaudo) => boolean> = {
  todos: () => true,
  vigente: (i) => {
    const p = piorDaSenha(i)
    return p === "vigente" || p === "vence_em_breve"
  },
  vencida: (i) => piorDaSenha(i) === "vencida",
  laudo_antigo: (i) => piorDaSenha(i) === "laudo_antigo",
  sem_senha: (i) => piorDaSenha(i) === "sem_senha",
  pendente: (i) => piorDaSenha(i) === "pendente",
  vence_em_breve: (i) => piorDaSenha(i) === "vence_em_breve",
  sem_validade: (i) => piorDaSenha(i) === "sem_validade",
  em_analise: (i) => piorDaSenha(i) === "em_analise",
}

/** A senha se aplica ao laudo (é ASSIM/LEVE, ou tem autorização no relatório)? */
export function senhaSeAplica(i: ItemAcompanhamentoLaudo): boolean {
  const p = piorDaSenha(i)
  return p !== null && p !== "nao_se_aplica"
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
 * Os filtros do painel que NÃO são recorte: busca, situação do paciente,
 * convênio e as janelas de validade (do laudo e da senha). Extraído à parte porque `contarKpis` precisa aplicá-los
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

    if (f.convenios.size > 0 && !f.convenios.has(i.convenio ?? SEM_CONVENIO)) return false

    if (!dentroDaJanela(i.validade, f.validadeDe, f.validadeAte)) return false

    if (f.validadeSenhaDe || f.validadeSenhaAte) {
      // Sem nenhuma validade de senha (sem relatório, sem senha, outro convênio)
      // não entra: ausência não é intervalo — mesma regra da validade do laudo.
      const validades = [i.senhas?.dentro.validade ?? null, i.senhas?.fora.validade ?? null]
      if (!validades.some((v) => v !== null && dentroDaJanela(v, f.validadeSenhaDe, f.validadeSenhaAte)))
        return false
    }

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
  // CRUZADO: respeita o recorte da SENHA (o outro painel), não o do laudo. É o
  // que faz "Sem senha" marcado responder "e desses, quantos vencidos?".
  const base = aplicarFiltrosSecundarios(itens, f).filter(PREDICADO_RECORTE_SENHA[f.recorteSenha])
  return {
    todos: base.length,
    vigentes: base.filter((i) => PREDICADO_RECORTE.vigentes(i, hojeISO)).length,
    vencidos: base.filter((i) => PREDICADO_RECORTE.vencidos(i, hojeISO)).length,
    vencidos_ha_muito: base.filter((i) => PREDICADO_RECORTE.vencidos_ha_muito(i, hojeISO))
      .length,
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
 * Os números do painel "Senha ASSIM". Espelho de `contarKpis`: aplica os
 * filtros secundários e o recorte do LAUDO (o outro painel), nunca o próprio —
 * senão escolher "Sem senha" zeraria os outros cards de senha.
 *
 * `aplicaveis` é o denominador do painel: quantos laudos, no recorte atual, têm
 * a senha ASSIM/LEVE como assunto (os de outro convênio ficam fora da conta).
 */
export function contarKpisSenha(
  itens: ItemAcompanhamentoLaudo[],
  f: FiltrosLaudos,
  hojeISO: string,
): Record<RecorteSenha, number> & { aplicaveis: number } {
  const base = aplicarFiltrosSecundarios(itens, f).filter((i) => PREDICADO_RECORTE[f.recorte](i, hojeISO))
  const conta = (r: RecorteSenha) => base.filter(PREDICADO_RECORTE_SENHA[r]).length
  return {
    todos: base.length,
    vigente: conta("vigente"),
    vencida: conta("vencida"),
    laudo_antigo: conta("laudo_antigo"),
    sem_senha: conta("sem_senha"),
    pendente: conta("pendente"),
    vence_em_breve: conta("vence_em_breve"),
    sem_validade: conta("sem_validade"),
    em_analise: conta("em_analise"),
    aplicaveis: base.filter(senhaSeAplica).length,
  }
}

/**
 * A lista que a tela mostra: os filtros secundários E os DOIS recortes (laudo e
 * senha). Cada card leva a EXATAMENTE esta lista quando vira o recorte ativo —
 * é o que `contarKpis`/`contarKpisSenha` prometem contar.
 */
export function filtrar(
  itens: ItemAcompanhamentoLaudo[],
  f: FiltrosLaudos,
  hojeISO: string,
): ItemAcompanhamentoLaudo[] {
  return aplicarFiltrosSecundarios(itens, f).filter(
    (i) => PREDICADO_RECORTE[f.recorte](i, hojeISO) && PREDICADO_RECORTE_SENHA[f.recorteSenha](i),
  )
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
  // critérios de data, nos dois sentidos: "sem data" não é "muito antigo" nem
  // "muito recente".
  const porValor =
    (valor: (i: ItemAcompanhamentoLaudo) => string | null, sentido: 1 | -1 = 1) =>
    (a: ItemAcompanhamentoLaudo, b: ItemAcompanhamentoLaudo) => {
      const x = valor(a)
      const y = valor(b)
      if (x === y) return porNome(a, b)
      if (!x) return 1
      if (!y) return -1
      return (x < y ? -1 : 1) * sentido
    }

  // Mais grave primeiro; no mesmo status, a senha que vence antes. Laudo sem
  // relatório de senhas (`senhas` nulo) vai para o fim, depois de "não se aplica".
  const porUrgencia = (a: ItemAcompanhamentoLaudo, b: ItemAcompanhamentoLaudo) => {
    const g = (i: ItemAcompanhamentoLaudo) =>
      i.senhas ? GRAVIDADE_SENHA.indexOf(i.senhas.pior) : GRAVIDADE_SENHA.length
    return g(a) - g(b) || porValor(proximaValidadeDeSenha)(a, b)
  }

  const COMPARADORES: Record<
    OrdemLaudos,
    (a: ItemAcompanhamentoLaudo, b: ItemAcompanhamentoLaudo) => number
  > = {
    validade: porValor((i) => i.validade),
    data_laudo: porValor((i) => i.dataLaudo),
    avisado_em: porValor((i) => i.mensagemEnviadaEm),
    nome: porNome,
    urgencia_senha: porUrgencia,
    validade_senha: porValor(proximaValidadeDeSenha),
    liberacao_senha: porValor(ultimaLiberacaoDeSenha, -1),
    atualizacao_senha: porValor(ultimaAtualizacaoNaAssim, -1),
  }
  const comparador = COMPARADORES[ordem]

  // Cópia: ordenar no lugar mutaria o array do estado do React.
  return [...itens].sort(comparador)
}

/**
 * A validade de senha que vence PRIMEIRO no laudo — dentro ou fora do ROL. É a
 * que define até quando o paciente pode ser atendido sem nova senha.
 */
export function proximaValidadeDeSenha(i: ItemAcompanhamentoLaudo): string | null {
  const datas = [i.senhas?.dentro.validade, i.senhas?.fora.validade].filter(
    (d): d is string => !!d,
  )
  if (datas.length === 0) return null
  return datas.reduce((menor, d) => (d < menor ? d : menor))
}

/** A liberação de senha mais RECENTE do laudo, dentro ou fora do ROL. */
export function ultimaLiberacaoDeSenha(i: ItemAcompanhamentoLaudo): string | null {
  const datas = [i.senhas?.dentro.liberacao, i.senhas?.fora.liberacao].filter(
    (d): d is string => !!d,
  )
  if (datas.length === 0) return null
  return datas.reduce((maior, d) => (d > maior ? d : maior))
}

/**
 * Quando a ASSIM mexeu por último em alguma autorização do laudo ("Atualizado
 * em" do relatório). As autorizações já vêm da mais recente para a mais antiga.
 */
export function ultimaAtualizacaoNaAssim(i: ItemAcompanhamentoLaudo): string | null {
  return i.senhas?.autorizacoes[0]?.atualizadoEmOrigem ?? null
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
  vencidos_ha_muito: `Vencidos há mais de ${MESES_VENCIDO_HA_MUITO} meses`,
  vencidos_sem_aviso: "Vencidos sem aviso",
  // Mesmo rótulo do card irmão da Senha ASSIM (`RECORTE_SENHA_LABEL.vence_em_breve`)
  // — pedido do usuário (28/09/2026): os dois usam a mesma janela
  // (DIAS_ALERTA_VENCIMENTO = 15), então o nome tem que dizer o mesmo prazo.
  proximo_vencimento: `Vence em até ${DIAS_ALERTA_VENCIMENTO} dias`,
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

export const RECORTE_SENHA_LABEL: Record<RecorteSenha, string> = {
  todos: "Todas",
  vigente: "Senha vigente",
  vencida: "Senha vencida",
  laudo_antigo: "Senha vinculada ao laudo antigo",
  sem_senha: "Sem senha",
  pendente: "Senha pendente",
  vence_em_breve: `Vence em até ${DIAS_ALERTA_VENCIMENTO} dias`,
  sem_validade: "Sem validade",
  em_analise: "Em análise",
}
