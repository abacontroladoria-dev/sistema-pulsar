'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NotaManual, TokenConferencia } from '@/services/auditoria-assim.service'
import {
  buscarNotasEConferencias,
  listarAuditoriaAssim,
  listarAutorizacoesAssimSemana,
  listarFaltasAuditoria,
  listarUnidadesPorPaciente,
} from '@/services/auditoria-assim.service'
import {
  listarGuiasOrfas,
  listarReclassificacoesAtivas,
  listarVinculosAtivos,
} from '@/services/reconciliacao-assim.service'
import type {
  AuditoriaAssimItem,
  AutorizacaoAssimSemana,
  GuiaOrfa,
  PacientePendencias,
  PlacarTuss,
  ReclassificacaoSituacao,
  VinculoAutorizacao,
} from '@/components/auditoria-assim/types'
import {
  SITUACOES_SEM_SESSAO,
  guiasSubstituidas,
  sessaoDecorrida,
  sessaoNaoSolicitada,
  sessaoSemCobertura,
} from '@/components/auditoria-assim/reconciliacao/cobertura'
import {
  cartaoPendente,
  montarGrade,
  SEM_VINCULOS,
  type Vinculos,
} from '@/components/auditoria-assim/reconciliacao/grade'
import type { EstadoAutorizacao } from '@/components/auditoria-assim/reconciliacao/vinculo'
import {
  comoData,
  comoIso,
  diasUteisDe,
  primeiraSegundaDoMes,
  segundaDe,
  somarDias,
} from '@/components/auditoria-assim/reconciliacao/datas'
import {
  autorizacaoCancelada,
  autorizacaoLiberada,
  autorizacaoReincidencia,
  calcularLedger,
  contarPendencias,
  excedentesDoPlacar,
} from '@/components/auditoria-assim/reconciliacao/contagem'

/**
 * O cálculo puro — datas e aritmética — mora em `reconciliacao/`, não aqui.
 *
 * Saiu deste arquivo em 2026-08-26 pelo mesmo motivo que `guiasSubstituidas`
 * tinha saído antes: este módulo importa os services, e com eles o cliente do
 * Supabase, então qualquer teste que tocasse uma soma acabava construindo um
 * cliente HTTP. Reexportado daqui porque era daqui que todo mundo importava, e
 * mudar o arquivo de casa não é razão para mexer no import de quem só quer
 * somar uma coluna ou achar uma segunda-feira.
 */
export {
  autorizacaoCancelada,
  autorizacaoLiberada,
  autorizacaoReincidencia,
  calcularLedger,
  contarPendencias,
  diasUteisDe,
  excedentesDoPlacar,
  segundaDe,
  somarDias,
}

/**
 * Análise de reincidência — a cota do MÊS por TUSS, da clínica inteira.
 *
 * O QUE ESTE HOOK RECONCILIA, e por que não dava para ler de uma tela só:
 *
 * A glosa 1601 ("REINCIDENCIA NO ATENDIMENTO") diz que a autorização daquele
 * TUSS passou da cota semanal (o critério é semanal na ASSIM, a AGREGAÇÃO
 * aqui é que passou a ser mensal — ver seção abaixo). A auditoria não mostra
 * isso por duas razões somadas: ela é diária, e é dirigida pela SESSÃO.
 * `get_auditoria_assim` pareia sessão <-> autorização por (carteirinha, dia,
 * TUSS, ordinal) num LEFT JOIN com a `agenda_tita` à esquerda, então a
 * autorização EXCEDENTE — a de `ordem_autorizacao = 3` onde só existem 2
 * sessões — não casa com nada e não aparece em tela nenhuma. É exatamente ela
 * que estoura a cota.
 *
 * Daí os dois lados vindo de fontes diferentes: as sessões pela RPC da auditoria
 * (que já traz TUSS pelo mapa único `tuss_da_sessao` e a situação de cada
 * bloco), e as autorizações direto de `autorizacoes_assim`, sem passar pelo
 * pareamento — que é o único jeito de a órfã aparecer.
 *
 * O pareamento em si NÃO é reimplementado aqui, em duas camadas:
 *
 * 1. quais guias casaram com sessão deste período sai das próprias linhas da RPC;
 * 2. quais guias PRECISAM de vínculo sai de `get_guias_orfas` — a mesma função
 *    que alimenta a listagem. A diferença entre as duas não é acadêmica: aquela
 *    exclui guia já triada ANTES do `row_number()`, exclui guia capturada pelo
 *    próprio Pulsar e só considera `status = 'Liberado'`. Decidir isso aqui
 *    faria a tela oferecer vínculo para guia que a Conferência já casou — o erro
 *    que a migration 20260821040000 existe para não deixar acontecer.
 *
 * ── O MÊS INTEIRO NA LISTAGEM, A SEMANA NO MODAL ───────────────────────────
 *
 * A listagem (2026-08-24) passou a responder "quem precisa da minha atenção
 * NESTE MÊS?" — mês fechado é dia 1 ao último dia, mês vigente é dia 1 até
 * hoje. O modal por paciente (a grade, seg a sex) continua semanal: é o que
 * cabe numa grade de 5 colunas, e trocar de semana ali é gratuito — os dados
 * do mês inteiro já estão em memória, então navegar semana dentro do modal
 * não busca nada.
 *
 * Por isso o intervalo BUSCADO (`inicioFetch`/`fimFetch`) é um pouco mais
 * largo que o mês estrito: da segunda da semana que contém o dia 1 até a
 * sexta da semana que contém o fim efetivo do mês. É o que evita que a
 * última (ou primeira) semana do modal apareça com buracos quando ela cruza
 * a virada do mês. A listagem, por sua vez, filtra de volta para o intervalo
 * estrito do mês antes de agregar por paciente — ver `sessoesDoMes` /
 * `autorizacoesDoMes`.
 */

/**
 * A regra de cobertura mora em `reconciliacao/cobertura.ts`, não aqui.
 *
 * Ela é dado puro e precisa ser exercitável num teste de nó — este módulo
 * arrasta os services, e com eles o cliente do Supabase. E é a MESMA regra que
 * `grade.ts` usa para carimbar o cartão: duas cópias fariam o número do topo do
 * modal e a marca do cartão discordarem sobre a mesma semana.
 */

/** Quantos dias buscar em paralelo por vez. Um mês cheio tem ~22 dias úteis —
 *  disparar todos de uma vez seria 44 requisições simultâneas (2 por dia). */
const DIAS_POR_LOTE = 6

/** Os dias úteis (seg a sex) entre `inicio` e `fimInclusivo`, os dois inclusos. */
export function diasUteisDoIntervalo(inicio: string, fimInclusivo: string): string[] {
  const dias: string[] = []
  let atual = inicio
  while (atual <= fimInclusivo) {
    const dow = comoData(atual).getDay()
    if (dow !== 0 && dow !== 6) dias.push(atual)
    atual = somarDias(atual, 1)
  }
  return dias
}

/** "2026-08-17" ou "2026-08" → "2026-08-01". O dia 1 do mês de `iso`. */
export function primeiroDiaDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** O último dia do mês que começa em `mesInicioIso`. */
export function ultimoDiaDoMes(mesInicioIso: string): string {
  const [ano, mes] = mesInicioIso.split('-').map(Number)
  // Dia 0 do mês seguinte é o último dia deste mês.
  return comoIso(new Date(ano, mes, 0))
}

function somarMesesIso(mesIso: string, delta: number): string {
  const [ano, mes] = mesIso.split('-').map(Number)
  return comoIso(new Date(ano, mes - 1 + delta, 1))
}

/** Hoje em componentes locais. */
function hojeIso(): string {
  return comoIso(new Date())
}

/** O fim efetivo de um mês: o último dia dele, ou hoje quando o mês é o corrente. */
function fimEfetivoDoMes(mesIso: string): string {
  const hoje = hojeIso()
  return mesIso === primeiroDiaDoMes(hoje) ? hoje : ultimoDiaDoMes(mesIso)
}

/**
 * Agora menos 30 minutos, em componentes locais: "2026-08-24T08:12".
 *
 * É o corte de "sessão já pendente" — uma sessão só entra na cota de
 * "faltando" 30 minutos depois do horário marcado, nunca antes. Junto com
 * `instanteSessao`, isto substitui o corte por DIA que a tela tinha antes:
 * aquele já dizia "sessão de amanhã não é pendência", mas deixava a sessão de
 * daqui a 10 minutos, hoje, contar como decorrida — o que este corte por
 * INSTANTE corrige.
 */
export function agoraMenos30MinIso(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - 30)
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  const hora = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${ano}-${mes}-${dia}T${hora}:${min}`
}

// `carteirinhaUtil` foi para `agruparPacientes`, junto do agrupamento que a usa.
// Reexportada aqui porque era daqui que a tela a importava.
export { carteirinhaUtil } from '@/components/auditoria-assim/reconciliacao/agruparPacientes'
import {
  agruparPacientes,
  ehDoPacienteSelecionado,
} from '@/components/auditoria-assim/reconciliacao/agruparPacientes'


/**
 * O placar de um conjunto de sessões contra um conjunto de autorizações.
 *
 * Pura de propósito: a listagem chama isto uma vez por paciente do período e o
 * modal chama de novo para o paciente aberto (e para a semana aberta). Duas
 * implementações fariam a linha da tabela e o card do modal discordarem sobre
 * o mesmo paciente — que é exatamente o tipo de divergência que esta tela
 * existe para caçar.
 *
 * `cutoff` é o instante (inclusivo) até o qual uma sessão já aconteceu E já
 * passou dos 30 minutos de tolerância. Ela separa `agendadas` de
 * `decorridas`, e a diferença não é cosmética: contar como "autorização
 * faltando" uma sessão que ainda vai acontecer — ou que aconteceu há 5
 * minutos — transformaria a tela em ruído. Só sessão realmente decorrida
 * pode estar sem cobertura.
 *
 * `faltante` conta SESSÕES, uma a uma, por `sessaoSemCobertura` — não é mais
 * `decorridas − liberadas`. A troca (2026-08-24) tem um motivo e um efeito:
 *
 * - motivo: a subtração diz quantas faltam e não diz QUAIS, então a grade não
 *   tinha como marcar a sessão problemática. Contando por sessão, cada unidade
 *   do número é um cartão que a tela consegue apontar.
 * - efeito: os dois números divergem num caso, e é o caso que importa. Três
 *   sessões decorridas, três liberações, mas uma delas órfã e uma sessão em
 *   glosa: a subtração fechava `0` e escondia tudo; a contagem por sessão diz
 *   `1`, e do lado das guias a órfã aparece como "sem vínculo". Que é
 *   exatamente o par que esta tela existe para reconciliar.
 */
export function calcularPlacar(
  sessoes: AuditoriaAssimItem[],
  autorizacoes: AutorizacaoAssimSemana[],
  cutoff: string,
  /** As triagens vivas, por bloco — ver `sessaoSemCobertura`. */
  vinculosPorBloco: ReadonlyMap<string, VinculoAutorizacao> = new Map()
): PlacarTuss[] {
  const porTuss = new Map<string, PlacarTuss & { terapiasVistas: Set<string> }>()

  const entrada = (codigo: string | null) => {
    const chave = codigo ?? '—'
    let atual = porTuss.get(chave)
    if (!atual) {
      atual = {
        codigo_tuss: chave,
        terapias: '',
        agendadas: 0,
        decorridas: 0,
        autorizadas: 0,
        liberadas: 0,
        canceladas: 0,
        excedente: 0,
        faltante: 0,
        naoSolicitada: 0,
        terapiasVistas: new Set<string>(),
      }
      porTuss.set(chave, atual)
    }
    return atual
  }

  for (const s of sessoes) {
    const item = entrada(s.codigo_tuss)
    if (s.terapias) item.terapiasVistas.add(s.terapias)
    // Sessão com falta não aconteceu, então não é cota — e autorizar em cima
    // dela é justamente um dos jeitos de estourar a cota.
    if (SITUACOES_SEM_SESSAO.has(s.situacao ?? '')) continue
    item.agendadas += 1
    if (sessaoDecorrida(s, cutoff)) item.decorridas += 1
    if (sessaoSemCobertura(s, cutoff, vinculosPorBloco)) item.faltante += 1
    if (sessaoNaoSolicitada(s, cutoff, vinculosPorBloco)) item.naoSolicitada += 1
  }

  for (const a of autorizacoes) {
    const item = entrada(a.codigo_tuss)
    item.autorizadas += 1
    if (autorizacaoLiberada(a.status)) item.liberadas += 1
    else if (autorizacaoCancelada(a.status)) item.canceladas += 1
  }

  return [...porTuss.values()]
    .map(({ terapiasVistas, ...item }) => ({
      ...item,
      terapias: [...terapiasVistas].join(' | '),
      excedente: item.liberadas - item.agendadas,
    }))
    .sort((a, b) => b.excedente - a.excedente || a.codigo_tuss.localeCompare(b.codigo_tuss))
}

/**
 * O destino de uma autorização, em cinco estados. Ver `EstadoAutorizacao`.
 *
 * A ordem é a precedência, e cada degrau existe por um motivo:
 *
 * 1. estar na fila de órfãs vence tudo, porque é a única afirmação que autoriza
 *    ação — e a fila já exclui guia triada, então os dois primeiros degraus não
 *    podem disputar a mesma guia;
 * 2. a triagem manual vem antes do pareamento do banco porque ela é justamente
 *    o que o pareamento NÃO consegue enxergar: vincular não move a guia para
 *    dentro da sessão (a sessão coberta guarda a guia antiga), então perguntar
 *    ao pareamento primeiro devolveria "não casa com nada" e a guia acabaria
 *    rotulada "Outra semana" logo depois de alguém dizer o que ela cobre;
 * 3. só então se pergunta se a guia encosta em alguma sessão que a pessoa vê.
 *
 * Função de módulo, e não um `useCallback` dentro do hook, porque as duas pontas
 * precisam da MESMA resposta: a semana aberta e a varredura que conta os cartões
 * de cada semana do mês (`marcadosDaSemana`). Duas cópias fariam a faixa do
 * cabeçalho prometer um número e a grade desenhar outro.
 */
function estadoDeUmaGuia(
  guia: string,
  ehOrfa: (guia: string) => boolean,
  vinculosPorGuia: ReadonlyMap<string, VinculoAutorizacao>,
  pareadas: ReadonlySet<string>
): EstadoAutorizacao {
  if (ehOrfa(guia)) return 'sem-vinculo'
  const vinculo = vinculosPorGuia.get(guia)
  if (vinculo) return vinculo.tipo === 'vinculo' ? 'vinculada' : 'sem-sessao'
  return pareadas.has(guia) ? 'pareada' : 'fora-da-semana'
}

/**
 * Quantos cartões marcados uma semana teria — montando a grade DE VERDADE.
 *
 * Podia ser uma soma esperta sobre o placar, e não é de propósito: a faixa de
 * semanas promete "há 4 aqui", e a pessoa clica esperando encontrar 4. Contar
 * por um caminho e desenhar por outro é como as duas passam a discordar na
 * primeira regra nova. Custa uma montagem de grade por semana sobre dados que
 * já estão em memória — cinco semanas de um paciente, não da clínica.
 */
function marcadosDaSemana(
  sessoes: AuditoriaAssimItem[],
  autorizacoes: AutorizacaoAssimSemana[],
  dias: string[],
  cutoff: string,
  ehOrfa: (guia: string) => boolean,
  vinculos: Vinculos
): number {
  const placar = calcularPlacar(sessoes, autorizacoes, cutoff, vinculos.porBloco)
  const pareadas = new Set(sessoes.map((s) => s.guia).filter((g): g is string => !!g))
  const linhas = montarGrade(
    sessoes,
    autorizacoes,
    (guia) => estadoDeUmaGuia(guia, ehOrfa, vinculos.porGuia, pareadas),
    dias,
    placar,
    {
      descoberta: (s) => sessaoSemCobertura(s, cutoff, vinculos.porBloco),
      decorrida: (s) => sessaoDecorrida(s, cutoff),
      excedentes: excedentesDoPlacar(placar, autorizacoes, pareadas),
    },
    vinculos
  )
  let total = 0
  for (const linha of linhas) {
    for (const dia of dias) {
      for (const cartao of linha.celulas[dia] ?? []) if (cartaoPendente(cartao)) total += 1
    }
  }
  return total
}

export function useAnaliseReincidencia(dataInicial: string, pacienteInicial: string | null) {
  const [mesRef, setMesRef] = useState(() => primeiroDiaDoMes(dataInicial))
  const [semanaInicio, setSemanaInicio] = useState(() => segundaDe(dataInicial))
  const [cutoff, setCutoff] = useState(() => agoraMenos30MinIso())

  /**
   * O paciente aberto no modal.
   *
   * Nome E carteirinhas juntos porque as duas chaves resolvem lados diferentes:
   * a sessão se acha pelo nome (é o que a RPC devolve), e a autorização se acha
   * pela carteirinha (é o que `autorizacoes_assim.matricula` guarda). As
   * carteirinhas vindas de fora são um ponto de partida — o recorte soma a elas
   * as que o próprio período descobrir.
   */
  /**
   * Quem está aberto no modal.
   *
   * `ids` existe porque o NOME NÃO IDENTIFICA ninguém entre as duas origens: a
   * ASSIM trunca em 20 caracteres e sem acento ("DAVI LUCAS DE OLIVEI"), a
   * agenda grava "Davi Lucas De Oliveira Capela". Filtrar as sessões por nome
   * fazia a grade abrir SEM SESSÃO NENHUMA sempre que a linha tivesse sido
   * aberta pelo lado da ASSIM — e aí toda guia aparecia "além do agendado",
   * porque não havia sessão com que parear.
   *
   * O nome continua guardado: nem toda linha tem id (as que vêm só de falta),
   * e para essas ele ainda é a única chave.
   */
  const [selecionado, setSelecionado] = useState<{ nome: string; carteirinhas: string[]; ids: string[] } | null>(
    // Sem `ids`: a abertura por URL só traz o nome, e nesse caminho o fallback
    // por nome é o que existe. A primeira seleção pela lista já os traz.
    pacienteInicial ? { nome: pacienteInicial, carteirinhas: [], ids: [] } : null
  )

  const [sessoes, setSessoes] = useState<AuditoriaAssimItem[]>([])
  const [autorizacoes, setAutorizacoes] = useState<AutorizacaoAssimSemana[]>([])
  const [orfasDaSemana, setOrfasDaSemana] = useState<Map<string, GuiaOrfa>>(() => new Map())
  const [triagens, setTriagens] = useState<VinculoAutorizacao[]>([])
  const [reclassificacoes, setReclassificacoes] = useState<ReclassificacaoSituacao[]>([])
  const [unidades, setUnidades] = useState<Map<string, string>>(() => new Map())
  /*
    AS QUATRO NASCEM `true`, e não `false` (2026-08-27, reportado da tela).

    Cada uma sobe no `useCallback` da própria carga e desce no `finally`. Mas o
    efeito que dispara a carga roda DEPOIS da primeira pintura, então com elas
    nascendo `false` havia um render — o primeiro — em que `loading` era `false`
    e nenhum dado tinha chegado. Era esse render que obrigava `ListaPendencias` a
    gatear por `carregando && pacientes.length === 0`: sem a segunda metade, o
    esqueleto não aparecia na abertura.

    E foi essa segunda metade que produziu o defeito relatado. `pacientesDoMes`
    fica não-vazio assim que UMA das quatro chega (as autorizações chegam numa
    requisição; as sessões vêm em lotes de 6 dias, ~44 requisições no mês), e com
    a lista já não-vazia o esqueleto saía de cena: a tela pintava linhas com
    `agendadas = 0`, o que faz TODA guia liberada parecer excedente, zera "Não
    solicitada" e deixa de descontar a glosa que um vínculo já cobriu. Depois as
    sessões chegavam e cada número se corrigia na frente de quem estava lendo.

    Nascendo `true`, `loading` é verdadeiro desde o primeiro render e o
    componente pode gatear só nele — que é o contrato que a nota de `loading`
    sempre descreveu. Nenhuma carga foi serializada: as quatro seguem em
    paralelo, só a primeira pintura é que espera a última.
  */
  const [carregandoSemana, setCarregandoSemana] = useState(true)
  const [carregandoAutorizacoes, setCarregandoAutorizacoes] = useState(true)
  /**
   * A terceira carga do mês, e a única que não tinha porteiro até 2026-08-24.
   *
   * As três disparam JUNTAS, em efeitos independentes, mas `loading` só olhava
   * duas — então a listagem pintava assim que sessões e autorizações chegavam,
   * com `orfasDaSemana` ainda vazio. Com o mapa vazio `ehOrfa` responde "não"
   * para toda guia, a coluna "Sem vínculo" nasce zerada, e
   * `ListaPendencias` descarta quem tem `contagem.total === 0` — ou seja, todo
   * paciente cuja única pendência era guia sem vínculo SUMIA da listagem. Aí a
   * resposta de `get_guias_orfas` chegava e a tela se corrigia sozinha: os
   * números dos chips pulavam, linhas apareciam e a paginação se remontava.
   *
   * Gatear aqui não serializa nada — as três já corriam em paralelo, e isto só
   * adia a primeira pintura até a última terminar. É o preço de não mostrar uma
   * listagem que exclui gente de verdade sem dizer.
   */
  const [carregandoOrfas, setCarregandoOrfas] = useState(false)
  /**
   * A quarta carga: as triagens vivas da Reconciliação.
   *
   * Gateada junto com as outras três pela mesma lição de `carregandoOrfas`: sem
   * ela a grade pintava a guia recém-vinculada como "Outra semana" e trocava o
   * rótulo para "Vinculada" segundos depois, na frente de quem estava lendo — e
   * as contagens saltavam junto, porque a guia substituída só sai do "glosas"
   * quando esta lista chega.
   *
   * Não depende do mês (a tabela vem inteira, ver `listarVinculosAtivos`), então
   * ela roda uma vez por montagem e nas recargas — navegar mês a mês não a
   * repete.
   */
  const [carregandoVinculos, setCarregandoVinculos] = useState(false)
  /**
   * A quinta carga: as reclassificações manuais de situação.
   *
   * A ÚNICA das cinco que NÃO entra em `loading`, e a diferença é real, não
   * economia. As outras quatro mudam o que a tela conclui — sem as órfãs a
   * coluna "sem vínculo" nasce zerada e some com pacientes; sem as triagens a
   * guia recém-vinculada aparece como "Outra semana". Esta não muda conclusão
   * nenhuma: a `situacao` que a RPC devolve JÁ vem reclassificada (migration
   * 20260827000001), então a sessão já chega pintada de FALTA com ou sem esta
   * lista. O que ela acrescenta é a AUTORIA — quem decidiu, quando, por quê —,
   * que aparece na gaveta e em nenhum número.
   *
   * Gatear a primeira pintura nela atrasaria a tela inteira por um dado que só
   * se lê ao abrir um cartão. O estado de carregamento existe assim mesmo, para
   * a gaveta poder dizer "carregando" em vez de "não há" enquanto espera.
   */
  const [carregandoReclassificacoes, setCarregandoReclassificacoes] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Cada carga carrega seu número de série: resposta de mês antigo que chega
  // atrasada não sobrescreve o atual.
  const geracaoSemana = useRef(0)
  const geracaoAutorizacoes = useRef(0)
  const geracaoOrfas = useRef(0)
  const geracaoVinculos = useRef(0)
  const geracaoReclassificacoes = useRef(0)

  // ── O mês selecionado: fechado (dia 1 ao último) ou vigente (dia 1 a hoje) ─
  const mesFimEfetivo = useMemo(() => fimEfetivoDoMes(mesRef), [mesRef])
  const mesAtual = useMemo(() => primeiroDiaDoMes(hojeIso()), [])
  const podeAvancarMes = mesRef < mesAtual

  // ── O intervalo BUSCADO: um pouco mais largo que o mês, para o modal poder
  // navegar semana a semana sem buracos nas pontas. ──────────────────────────
  // `primeiraSegundaDoMes`, e não `segundaDe(mesRef)`: quando o dia 1 cai num
  // sábado ou domingo, a segunda daquela semana e os cinco dias úteis dela ficam
  // TODOS no mês anterior — agosto/2026 abria a faixa oferecendo 27/07–31/07,
  // uma semana sem um único dia de agosto, sempre vazia ao clicar. Acontece em
  // 4 dos 12 meses de 2026. Ver a nota em `datas.ts`.
  const inicioFetch = useMemo(() => primeiraSegundaDoMes(mesRef), [mesRef])
  const fimFetch = useMemo(() => somarDias(segundaDe(mesFimEfetivo), 4), [mesFimEfetivo])
  const semanaMinima = inicioFetch
  const semanaMaxima = useMemo(() => segundaDe(fimFetch), [fimFetch])

  /** Reposiciona a análise — mês, semana, paciente e carteirinha de uma vez. */
  const reabrirEm = useCallback((data: string, paciente: string | null, carteirinha: string | null, ids: string[] = []) => {
    setMesRef(primeiroDiaDoMes(data))
    setSemanaInicio(segundaDe(data))
    setErro(null)
    setSelecionado(paciente ? { nome: paciente, carteirinhas: carteirinha ? [carteirinha] : [], ids } : null)
  }, [])

  /** Troca de mês pela listagem — nunca vai além do mês corrente. */
  const irParaMesRef = useCallback((mesAlvoBruto: string) => {
    const hoje = hojeIso()
    const mesAtualIso = primeiroDiaDoMes(hoje)
    const alvo = mesAlvoBruto > mesAtualIso ? mesAtualIso : mesAlvoBruto
    setMesRef(alvo)
    const fim = fimEfetivoDoMes(alvo)
    // A semana do modal acompanha o mês: a de hoje quando hoje cai dentro
    // dele, senão a primeira semana do mês.
    setSemanaInicio(hoje >= alvo && hoje <= fim ? segundaDe(hoje) : segundaDe(alvo))
  }, [])

  // ── As sessões do período ──────────────────────────────────────────────
  // Por dia, em vez de uma chamada de `get_auditoria_assim_periodo` sobre o
  // intervalo: um mês inteiro da clínica encosta no teto de linhas que o
  // PostgREST aplica por resposta, e um corte ali seria silencioso. Em lotes
  // de `DIAS_POR_LOTE` para não abrir dezenas de requisições simultâneas — e
  // as faltas entram, que a RPC de auditoria não traz e que importam para a
  // contagem da cota.
  const carregarMes = useCallback(async () => {
    const geracao = ++geracaoSemana.current
    setCarregandoSemana(true)
    setErro(null)
    try {
      const dias = diasUteisDoIntervalo(inicioFetch, fimFetch)
      const respostas: [AuditoriaAssimItem[], AuditoriaAssimItem[]][] = []
      for (let i = 0; i < dias.length; i += DIAS_POR_LOTE) {
        const fatia = dias.slice(i, i + DIAS_POR_LOTE)
        const parcial = await Promise.all(
          fatia.map((dia) => Promise.all([listarAuditoriaAssim(dia), listarFaltasAuditoria(dia)]))
        )
        if (geracao !== geracaoSemana.current) return
        respostas.push(...parcial)
      }

      const vistos = new Set<string | null>()
      const unicos: AuditoriaAssimItem[] = []
      for (const item of respostas.flat(2)) {
        if (!vistos.has(item.bloco_id)) {
          vistos.add(item.bloco_id)
          unicos.push(item)
        }
      }
      setSessoes(unicos)
      // Recomputa o corte de 30 min junto com a carga: quem clica "Atualizar"
      // não deve esperar o próximo tick do relógio para ver o efeito.
      setCutoff(agoraMenos30MinIso())
    } catch {
      if (geracao !== geracaoSemana.current) return
      setErro('Não foi possível carregar o cronograma deste mês.')
    } finally {
      if (geracao === geracaoSemana.current) setCarregandoSemana(false)
    }
  }, [inicioFetch, fimFetch])

  useEffect(() => {
    carregarMes()
  }, [carregarMes])

  // ── A fila de órfãs recortada neste período ────────────────────────────
  const carregarOrfasDoMes = useCallback(async () => {
    const geracao = ++geracaoOrfas.current
    setCarregandoOrfas(true)
    try {
      const lista = await listarGuiasOrfas(inicioFetch, fimFetch)
      if (geracao !== geracaoOrfas.current) return
      setOrfasDaSemana(new Map(lista.map((g) => [g.guia, g])))
    } catch {
      // Silencioso de propósito: sem esta lista a cota por TUSS continua certa
      // (ela sai de sessões e autorizações), e derrubar a tela inteira por causa
      // da coluna "Sem vínculo" seria pior que perdê-la. O que NÃO se pode fazer
      // é pintar antes de saber — ver `carregandoOrfas`.
      if (geracao !== geracaoOrfas.current) return
      setOrfasDaSemana(new Map())
    } finally {
      if (geracao === geracaoOrfas.current) setCarregandoOrfas(false)
    }
  }, [inicioFetch, fimFetch])

  useEffect(() => {
    carregarOrfasDoMes()
  }, [carregarOrfasDoMes])

  // ── As triagens vivas: o que já foi decidido sobre as guias ────────────
  const carregarVinculos = useCallback(async () => {
    const geracao = ++geracaoVinculos.current
    setCarregandoVinculos(true)
    try {
      const lista = await listarVinculosAtivos()
      if (geracao !== geracaoVinculos.current) return
      setTriagens(lista)
    } catch {
      // Silencioso pelo mesmo critério das órfãs: sem esta lista a semana ainda
      // diz a verdade sobre sessões e cota, e derrubar a tela por causa do
      // rótulo de uma guia seria pior que perdê-lo. O que não se pode é pintar
      // antes de saber — ver `carregandoVinculos`.
      if (geracao !== geracaoVinculos.current) return
      setTriagens([])
    } finally {
      if (geracao === geracaoVinculos.current) setCarregandoVinculos(false)
    }
  }, [])

  useEffect(() => {
    carregarVinculos()
  }, [carregarVinculos])

  // ── As reclassificações vivas: quem sobrepôs a situação, e por quê ──────
  const carregarReclassificacoes = useCallback(async () => {
    const geracao = ++geracaoReclassificacoes.current
    setCarregandoReclassificacoes(true)
    try {
      const lista = await listarReclassificacoesAtivas()
      if (geracao !== geracaoReclassificacoes.current) return
      setReclassificacoes(lista)
    } catch {
      // Silencioso, e aqui com menos consequência que nas outras cargas: a
      // `situacao` já vem reclassificada da RPC, então perder esta lista custa a
      // autoria na gaveta — não a correção do estado na tela.
      if (geracao !== geracaoReclassificacoes.current) return
      setReclassificacoes([])
    } finally {
      if (geracao === geracaoReclassificacoes.current) setCarregandoReclassificacoes(false)
    }
  }, [])

  useEffect(() => {
    carregarReclassificacoes()
  }, [carregarReclassificacoes])

  // ── As autorizações do período, da clínica inteira e sem pareamento ────
  const carregarAutorizacoes = useCallback(async () => {
    const geracao = ++geracaoAutorizacoes.current
    setCarregandoAutorizacoes(true)
    try {
      const fimExclusivo = somarDias(fimFetch, 1)
      const [dados, mapaUnidades] = await Promise.all([
        listarAutorizacoesAssimSemana(null, inicioFetch, fimExclusivo),
        listarUnidadesPorPaciente(inicioFetch, fimFetch),
      ])
      if (geracao !== geracaoAutorizacoes.current) return
      setAutorizacoes(dados)
      setUnidades(mapaUnidades)
    } catch {
      if (geracao !== geracaoAutorizacoes.current) return
      setErro('Não foi possível carregar as autorizações deste mês.')
    } finally {
      if (geracao === geracaoAutorizacoes.current) setCarregandoAutorizacoes(false)
    }
  }, [inicioFetch, fimFetch])

  useEffect(() => {
    carregarAutorizacoes()
  }, [carregarAutorizacoes])

  // ── O relógio dos 30 minutos ────────────────────────────────────────────
  // Puramente local: recalcula sobre o que já está em memória, sem tocar a
  // rede. É o que faz uma sessão virar "pendente" sozinha enquanto a tela
  // fica aberta, sem exigir um F5.
  useEffect(() => {
    const id = setInterval(() => setCutoff(agoraMenos30MinIso()), 60_000)
    return () => clearInterval(id)
  }, [])

  const ehOrfa = useCallback((guia: string) => orfasDaSemana.has(guia), [orfasDaSemana])

  /**
   * As triagens indexadas pelas duas pontas do mesmo fato.
   *
   * Um mapa por guia (a guia precisa saber que sessão cobre) e um por bloco (a
   * sessão precisa saber que guia a cobriu). Só `tipo = 'vinculo'` entra no
   * segundo: a constraint da tabela garante `bloco_id` nulo em `sem_sessao`, e
   * indexá-lo daria uma chave `''` cobrindo todo bloco sem id.
   */
  const vinculos = useMemo<Vinculos>(() => {
    if (triagens.length === 0) return SEM_VINCULOS
    const porGuia = new Map<string, VinculoAutorizacao>()
    const porBloco = new Map<string, VinculoAutorizacao>()
    for (const v of triagens) {
      porGuia.set(v.guia, v)
      if (v.tipo === 'vinculo' && v.bloco_id) porBloco.set(v.bloco_id, v)
    }
    return { porGuia, porBloco }
  }, [triagens])

  /**
   * As reclassificações ativas indexadas pelo bloco — a única ponta que existe.
   *
   * Diferente de `vinculos`, que precisa de dois mapas porque o vínculo é um
   * fato sobre um PAR (uma guia e a sessão que ela cobre). A reclassificação é
   * um fato sobre uma sessão só: não há segunda ponta a indexar.
   */
  const reclassificacoesPorBloco = useMemo(() => {
    if (reclassificacoes.length === 0) return new Map<string, ReclassificacaoSituacao>()
    const mapa = new Map<string, ReclassificacaoSituacao>()
    for (const r of reclassificacoes) mapa.set(r.bloco_id, r)
    return mapa
  }, [reclassificacoes])

  // ── O recorte ESTRITO do mês, para a listagem (descarta os dias de sobra
  // que só existem para completar as semanas do modal nas pontas) ──────────
  const sessoesDoMes = useMemo(
    () => sessoes.filter((s) => (s.data_atendimento ?? '') >= mesRef && (s.data_atendimento ?? '') <= mesFimEfetivo),
    [sessoes, mesRef, mesFimEfetivo]
  )
  const autorizacoesDoMes = useMemo(
    () =>
      autorizacoes.filter((a) => {
        const dia = (a.data_execucao ?? '').slice(0, 10)
        return dia >= mesRef && dia <= mesFimEfetivo
      }),
    [autorizacoes, mesRef, mesFimEfetivo]
  )

  // ── A listagem: um paciente por linha, com as cinco pendências ─────────────
  const pacientesDoMes = useMemo<PacientePendencias[]>(() => {
    // O agrupamento mora em `agruparPacientes` e não aqui: é ele que resolve o
    // desencontro de identidade entre a agenda e o extrato da ASSIM, e fora de
    // um `useMemo` ele pode ser testado. Ver o módulo para a tabela do porquê.
    const agrupados = agruparPacientes(sessoesDoMes, autorizacoesDoMes)

    const linhas: PacientePendencias[] = []
    for (const item of agrupados) {
      const placar = calcularPlacar(item.sessoes, item.autorizacoes, cutoff, vinculos.porBloco)
      // A glosa que um vínculo cobriu sai da conta aqui também, e não só no
      // modal: a listagem é a fila de trabalho, e uma linha que insiste em "1
      // glosa" depois de resolvida manda alguém abrir um paciente para não achar
      // nada — a grade não tem mais o que apontar, porque a sessão virou
      // GLOSA_RESOLVIDA.
      const ledger = calcularLedger(
        item.autorizacoes,
        ehOrfa,
        guiasSubstituidas(item.sessoes, vinculos.porBloco)
      )
      let ultima: string | null = null
      for (const a of item.autorizacoes) {
        if (a.data_execucao && (!ultima || a.data_execucao > ultima)) ultima = a.data_execucao
      }
      // O pareamento do banco, emprestado — a mesma leitura que o modal faz por
      // `guiasPareadas`. É ele que diz QUAL guia sobrou, e sem ele a atribuição
      // do excedente cai no desempate por data e costuma acusar a guia errada.
      const pareadasDoItem = new Set(
        item.sessoes.map((s) => s.guia).filter((g): g is string => !!g)
      )
      const pacienteIds = [...item.pacienteIds]
      linhas.push({
        chave: item.chave,
        nome: item.nome,
        carteirinhas: [...item.carteirinhas],
        pacienteIds,
        plano: item.plano,
        unidade: pacienteIds.map((id) => unidades.get(id)).find(Boolean) ?? null,
        contagem: contarPendencias(
          placar,
          ledger,
          excedentesDoPlacar(placar, item.autorizacoes, pareadasDoItem)
        ),
        sessoes: item.sessoes.length,
        ultimaAutorizacao: ultima,
      })
    }

    // Ordem alfabética — o total de pendências deixou de decidir a ordem.
    return linhas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [sessoesDoMes, autorizacoesDoMes, unidades, ehOrfa, cutoff, vinculos])

  /**
   * A conferência da filipeta e a nota manual do paciente aberto.
   *
   * `get_auditoria_assim` NÃO devolve estes campos, embora `AuditoriaAssimItem`
   * os declare: eles moram em `auditoria_token_conferencias` e
   * `auditoria_atendimento_notas`, e quem os junta é o cliente. O serviço faz um
   * cast do retorno da RPC para o tipo, então os campos chegam `undefined` e
   * qualquer leitor honesto lê "ainda não conferida" numa filipeta que foi
   * conferida — foi o que aconteceu no detalhamento (caso Kourtney Savino Lopes,
   * 05/08 10:00, token 318580).
   *
   * A busca é por PACIENTE, não pelo mês inteiro: um mês da clínica passa de
   * 2.800 blocos e um `.in()` com essa lista estoura o comprimento da URL do
   * PostgREST. Por paciente são algumas dezenas, numa requisição só, disparada
   * quando o modal abre. Blocos sintéticos de falta (`falta_…`) ficam de fora —
   * eles não existem naquelas tabelas e o `bloco_id` lá é uuid.
   */
  const [notasPorBloco, setNotasPorBloco] = useState<Map<string, NotaManual>>(() => new Map())
  const [conferenciasPorBloco, setConferenciasPorBloco] = useState<Map<string, TokenConferencia>>(
    () => new Map()
  )

  // O predicado mora em `agruparPacientes`, junto da regra de identidade que ele
  // aplica — e onde há teste travando a regressão que ele corrige.
  const ehDoPaciente = ehDoPacienteSelecionado

  const blocosDoPaciente = useMemo(() => {
    if (!selecionado?.nome) return [] as string[]
    return sessoes
      .filter((s) => ehDoPaciente(s, selecionado))
      .map((s) => s.bloco_id)
      .filter((id): id is string => !!id && !id.startsWith('falta_'))
  }, [sessoes, selecionado, ehDoPaciente])

  const chaveBlocos = blocosDoPaciente.join(',')
  useEffect(() => {
    if (blocosDoPaciente.length === 0) {
      setNotasPorBloco(new Map())
      setConferenciasPorBloco(new Map())
      return
    }
    let vivo = true
    buscarNotasEConferencias(blocosDoPaciente)
      .then(({ notas, conferencias }) => {
        if (!vivo) return
        setNotasPorBloco(notas)
        setConferenciasPorBloco(conferencias)
      })
      .catch(() => {
        // Silencioso: sem isto a tela ainda diz a verdade sobre a semana, só
        // deixa de mostrar a conferência. Derrubar o modal por causa dela seria
        // pior que perdê-la.
        if (vivo) {
          setNotasPorBloco(new Map())
          setConferenciasPorBloco(new Map())
        }
      })
    return () => {
      vivo = false
    }
    // `chaveBlocos` e não o array: ele é recriado a cada render do memo pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveBlocos])

  /** As unidades que o mês de fato tem — a lista do filtro, sem inventar opção. */
  const unidadesDoMes = useMemo(
    () =>
      [...new Set(pacientesDoMes.map((p) => p.unidade).filter((u): u is string => !!u))].sort(
        (a, b) => a.localeCompare(b, 'pt-BR')
      ),
    [pacientesDoMes]
  )

  // ── O recorte do paciente aberto, na SEMANA do modal ──────────────────────
  const pacienteNome = selecionado?.nome ?? null
  const semanaFim = somarDias(semanaInicio, 4)

  const linhaSelecionada = useMemo(
    () => (pacienteNome ? pacientesDoMes.find((p) => p.nome === pacienteNome) ?? null : null),
    [pacientesDoMes, pacienteNome]
  )

  const carteirinhas = useMemo(() => {
    const juntas = new Set(selecionado?.carteirinhas ?? [])
    for (const c of linhaSelecionada?.carteirinhas ?? []) juntas.add(c)
    return [...juntas]
  }, [selecionado, linhaSelecionada])

  const sessoesPaciente = useMemo(() => {
    if (!pacienteNome) return []
    return sessoes
      .filter(
        (s) =>
          ehDoPaciente(s, selecionado) &&
          (s.data_atendimento ?? '') >= semanaInicio &&
          (s.data_atendimento ?? '') <= semanaFim
      )
      .sort(
        (a, b) =>
          (a.data_atendimento ?? '').localeCompare(b.data_atendimento ?? '') ||
          (a.hora_inicial ?? '').localeCompare(b.hora_inicial ?? '')
      )
  }, [sessoes, pacienteNome, selecionado, ehDoPaciente, semanaInicio, semanaFim])

  const autorizacoesPaciente = useMemo(() => {
    // Sem exigir carteirinha: uma linha pode ter só `paciente_id` (a guia da
    // ASSIM traz id sempre, matrícula nem sempre), e a guarda antiga a deixava
    // sem guia nenhuma.
    if (!pacienteNome) return []
    const chaves = new Set(carteirinhas)
    const ids = new Set(selecionado?.ids ?? [])
    return autorizacoes
      .filter((a) => {
        // Por id quando os dois lados o têm; pela matrícula quando não. A
        // matrícula sozinha não basta: a agenda grava a carteirinha de um jeito
        // ("000000074749794400") e a ASSIM de outro ("000000.0747497.00"), então
        // uma linha que só conheça a forma da agenda não reconheceria guia
        // nenhuma como sua.
        const porId = a.paciente_id != null && ids.has(String(a.paciente_id))
        const porMatricula = !!a.matricula && chaves.has(a.matricula)
        if (!porId && !porMatricula) return false
        const dia = (a.data_execucao ?? '').slice(0, 10)
        return dia >= semanaInicio && dia <= semanaFim
      })
      .sort((a, b) => (a.data_execucao ?? '').localeCompare(b.data_execucao ?? ''))
  }, [autorizacoes, pacienteNome, carteirinhas, selecionado, semanaInicio, semanaFim])

  // Nome de paciente é a chave da busca, mas não é identidade. Se duas pessoas
  // dividem o nome, dizer isso é melhor que escolher uma em silêncio.
  const idsDoPaciente = useMemo(
    () => [...new Set(sessoesPaciente.map((s) => s.paciente_id).filter((id): id is string => !!id))],
    [sessoesPaciente]
  )

  /**
   * As guias que a própria RPC casou com uma sessão desta semana. É o pareamento
   * do banco, emprestado — não uma reimplementação dele.
   */
  const guiasPareadas = useMemo(
    () => new Set(sessoesPaciente.map((s) => s.guia).filter((g): g is string => !!g)),
    [sessoesPaciente]
  )

  /** O recorte de um paciente numa semana qualquer do mês já carregado. */
  const recortarSemana = useCallback(
    (nome: string, chaves: Set<string>, inicio: string, ids: string[] = []) => {
      const fim = somarDias(inicio, 4)
      const alvo = { nome, ids }
      return {
        sessoes: sessoes.filter(
          (s) =>
            ehDoPaciente(s, alvo) &&
            (s.data_atendimento ?? '') >= inicio &&
            (s.data_atendimento ?? '') <= fim
        ),
        autorizacoes: autorizacoes.filter((a) => {
          // Mesmo critério de `autorizacoesPaciente`: id primeiro, matrícula
          // como alternativa. Divergir aqui faria o índice de semanas contar
          // uma coisa e a grade mostrar outra.
          const porId = a.paciente_id != null && ids.includes(String(a.paciente_id))
          const porMatricula = !!a.matricula && chaves.has(a.matricula)
          if (!porId && !porMatricula) return false
          const dia = (a.data_execucao ?? '').slice(0, 10)
          return dia >= inicio && dia <= fim
        }),
      }
    },
    [sessoes, autorizacoes, ehDoPaciente]
  )

  /**
   * O mês do paciente aberto, semana a semana, com quantos cartões cada uma tem.
   *
   * A listagem é MENSAL e o modal é SEMANAL, e até 2026-08-24 nada fazia a ponte:
   * a semana exibida saía de `ultimaAutorizacao`, que é o instante da última
   * autorização do mês e não onde está a pendência. Um "faltando" na primeira
   * semana com uma autorização normal na quarta abria a quarta, limpa — e o
   * operador não tinha como saber que precisava voltar. Pior no paciente que só
   * tem falta: `ultimaAutorizacao` nula, e o modal abria na semana de hoje.
   *
   * Isto é o índice que faltava. Custa uma montagem de grade por semana sobre
   * dados de um paciente que já estão em memória — nenhuma requisição.
   */
  const semanasDoMes = useMemo(() => {
    if (!pacienteNome) return []
    const chaves = new Set(carteirinhas)
    const semanas: { inicio: string; fim: string; marcados: number }[] = []
    for (let ini = semanaMinima; ini <= semanaMaxima; ini = somarDias(ini, 7)) {
      const { sessoes: s, autorizacoes: a } = recortarSemana(pacienteNome, chaves, ini, selecionado?.ids ?? [])
      semanas.push({
        inicio: ini,
        fim: somarDias(ini, 4),
        marcados: marcadosDaSemana(s, a, diasUteisDe(ini), cutoff, ehOrfa, vinculos),
      })
    }
    return semanas
  }, [
    pacienteNome, carteirinhas, selecionado, semanaMinima, semanaMaxima, recortarSemana, cutoff,
    ehOrfa, vinculos,
  ])

  /** Vai direto para uma semana do mês, pela faixa do cabeçalho. */
  const irParaSemanaEm = useCallback((inicio: string) => setSemanaInicio(inicio), [])

  /**
   * Abre um paciente da listagem mensal no modal, na semana que tem o trabalho.
   *
   * A ordem de escolha da semana, e o porquê de cada degrau:
   *
   * 1. **a primeira semana do mês com cartão marcado.** É a resposta certa para
   *    a pergunta que o clique faz ("o que este paciente tem?"), e a única que
   *    funciona para quem só tem falta — esse paciente não tem autorização
   *    nenhuma, então nenhuma data derivada de autorização o acha;
   * 2. `dataReferencia` (a última autorização do mês), que era o critério único
   *    até 2026-08-24. Serve de rede quando o mês não tem nada marcado: cai onde
   *    houve movimento, e não numa semana arbitrária;
   * 3. o começo do mês, quando não há nem uma coisa nem outra.
   *
   * A busca varre o mês inteiro, e não só até achar, porque o custo é uma
   * montagem de grade por semana sobre dados já em memória — nada de rede.
   */
  const escolherPaciente = useCallback(
    (nome: string | null, carteirinhas: string[] = [], dataReferencia?: string | null, ids: string[] = []) => {
      setSelecionado(nome ? { nome, carteirinhas, ids } : null)
      if (!nome) return

      const chaves = new Set(carteirinhas)
      let comMarca: string | null = null
      for (let ini = semanaMinima; ini <= semanaMaxima; ini = somarDias(ini, 7)) {
        const { sessoes: s, autorizacoes: a } = recortarSemana(nome, chaves, ini, ids)
        if (marcadosDaSemana(s, a, diasUteisDe(ini), cutoff, ehOrfa, vinculos) > 0) {
          comMarca = ini
          break
        }
      }

      const alvo = comMarca ?? (dataReferencia ? segundaDe(dataReferencia.slice(0, 10)) : semanaMinima)
      setSemanaInicio(alvo < semanaMinima ? semanaMinima : alvo > semanaMaxima ? semanaMaxima : alvo)
    },
    [semanaMinima, semanaMaxima, recortarSemana, cutoff, ehOrfa, vinculos]
  )

  /** O destino de uma autorização da semana aberta. Ver `estadoDeUmaGuia`. */
  const estadoDaGuia = useCallback(
    (guia: string): EstadoAutorizacao =>
      estadoDeUmaGuia(guia, ehOrfa, vinculos.porGuia, guiasPareadas),
    [ehOrfa, vinculos, guiasPareadas]
  )

  const placar = useMemo(
    () => calcularPlacar(sessoesPaciente, autorizacoesPaciente, cutoff, vinculos.porBloco),
    [sessoesPaciente, autorizacoesPaciente, cutoff, vinculos]
  )

  /**
   * Esta sessão já ocorreu e ninguém a liberou. Fechada sobre o `cutoff` vivo e
   * sobre as triagens — uma sessão que o operador acabou de cobrir não pode
   * continuar sendo cobrada enquanto a RPC não concorda (ver `situacaoComVinculo`).
   */
  const sessaoDescoberta = useCallback(
    (s: AuditoriaAssimItem) => sessaoSemCobertura(s, cutoff, vinculos.porBloco),
    [cutoff, vinculos]
  )

  /**
   * Esta sessão já ocorreu — coberta ou não.
   *
   * Separada de `sessaoDescoberta` porque o cartão precisa distinguir "ninguém
   * pediu e a sessão já passou" (problema) de "ninguém pediu ainda porque a
   * sessão é sexta" (normal). Sem ela as duas chegavam como NAO_SOLICITADA e
   * saíam vermelhas, e a tela cobrava autorização da agenda que ainda nem
   * aconteceu.
   */
  const sessaoJaDecorrida = useCallback(
    (s: AuditoriaAssimItem) => sessaoDecorrida(s, cutoff),
    [cutoff]
  )

  /**
   * As guias que estouraram a cota — nomeadas, não contadas. Ver
   * `excedentesDoPlacar`, que carrega o critério e o defeito que o trocou.
   *
   * `guiasPareadas` é o argumento que faz a escolha ser um fato e não um chute:
   * a guia marcada é a que não casou com sessão nenhuma.
   */
  const guiasExcedentes = useMemo(
    () => excedentesDoPlacar(placar, autorizacoesPaciente, guiasPareadas),
    [placar, autorizacoesPaciente, guiasPareadas]
  )

  /**
   * A semana do paciente, inteira.
   *
   * Houve um recorte por espécie de pendência aqui (2026-08-24), acionado pelos
   * indicadores do modal. Os indicadores saíram a pedido do usuário e nada mais
   * podia acioná-lo, então o recorte saiu junto: filtro que ninguém alcança é
   * armadilha para quem ler isto depois. Os dois nomes seguem porque o modal
   * fala em "visíveis" e um dia pode voltar a recortar.
   */
  const sessoesVisiveis = sessoesPaciente

  /**
   * Os três estados que esta tela existe para vigiar, contados ANTES do filtro
   * de estado — senão escolher "glosas" zeraria os outros dois contadores e a
   * pessoa perderia a única visão do que mais há para olhar na semana.
   */
  const ledger = useMemo(
    () =>
      calcularLedger(
        autorizacoesPaciente,
        ehOrfa,
        guiasSubstituidas(sessoesPaciente, vinculos.porBloco)
      ),
    [autorizacoesPaciente, ehOrfa, sessoesPaciente, vinculos]
  )

  /** Guia liberada que casou com sessão da semana — a cobertura que de fato funcionou. */
  const utilizadas = useMemo(
    () =>
      autorizacoesPaciente.filter((a) => autorizacaoLiberada(a.status) && estadoDaGuia(a.guia) === 'pareada')
        .length,
    [autorizacoesPaciente, estadoDaGuia]
  )

  const liberadas = useMemo(
    () => autorizacoesPaciente.filter((a) => autorizacaoLiberada(a.status)).length,
    [autorizacoesPaciente]
  )

  const autorizacoesVisiveis = autorizacoesPaciente

  const totalExcedente = useMemo(
    () => placar.reduce((soma, p) => soma + Math.max(0, p.excedente), 0),
    [placar]
  )

  /**
   * As quatro espécies de pendência da semana aberta.
   *
   * Pela MESMA `contarPendencias` que monta os badges da listagem — não uma
   * segunda soma. Era daí que vinha a confusão que este trabalho resolve: a
   * linha prometia "3 pendências" e o modal abria mostrando números de outro
   * vocabulário. Mesma função, mesmas palavras, mesma ordem.
   */
  const contagem = useMemo(
    () => contarPendencias(placar, ledger, guiasExcedentes),
    [placar, ledger, guiasExcedentes]
  )

  return {
    // ── Mês: a listagem ──────────────────────────────────────────────────
    mesRef,
    mesFimEfetivo,
    mesAtual,
    podeAvancarMes,
    irParaMes: (delta: number) => irParaMesRef(somarMesesIso(mesRef, delta)),
    irParaMesData: (novoMes: string) => irParaMesRef(primeiroDiaDoMes(novoMes)),
    pacientesDoMes,
    unidadesDoMes,

    // ── Semana: o modal do paciente, sem novo fetch ao navegar ────────────
    semanaInicio,
    semanaFim,
    semanaAtual: segundaDe(hojeIso()),
    podeSemanaAnterior: semanaInicio > semanaMinima,
    podeProximaSemana: semanaInicio < semanaMaxima,
    irParaSemana: (delta: number) => {
      setSemanaInicio((atual) => {
        const proximo = somarDias(atual, delta * 7)
        if (proximo < semanaMinima) return semanaMinima
        if (proximo > semanaMaxima) return semanaMaxima
        return proximo
      })
        },

    pacienteNome,
    escolherPaciente,
    /** As semanas do mês do paciente aberto, com quantos cartões cada uma tem. */
    semanasDoMes,
    irParaSemanaEm,
    reabrirEm,
    /** A linha da listagem do paciente aberto — plano, unidade e contagens. */
    linhaSelecionada,
    idsDoPaciente,
    /** Para o cabeçalho de identidade. Nula até a semana carregar. */
    carteirinhaDoPaciente: carteirinhas[0] ?? null,
    ledger,
    /** As cinco espécies de pendência, no mesmo vocabulário da listagem. */
    contagem,
    liberadas,
    utilizadas,
    placar,
    totalExcedente,
    sessoesVisiveis,
    autorizacoesVisiveis,
    estadoDaGuia,
    /** Marca a sessão que já ocorreu e ninguém liberou — o "faltando" apontável. */
    sessaoDescoberta,
    /** Marca a sessão que já ocorreu, coberta ou não. */
    sessaoJaDecorrida,
    /** Conferência da filipeta por bloco — a RPC não a traz, ver a nota acima. */
    conferenciasPorBloco,
    /** Nota escrita à mão na Conferência, por bloco. Mesma razão. */
    notasPorBloco,
    /** As guias que passaram da cota, nomeadas — o "sobrando" apontável. */
    guiasExcedentes,
    orfasDaSemana,
    /**
     * As triagens vivas, indexadas por guia e por bloco. É o que a grade usa
     * para desenhar as duas pontas do vínculo — ver `Vinculos`.
     */
    vinculos,
    /**
     * As reclassificações ativas por bloco — a autoria de quem sobrepôs a
     * situação. Não muda o que a tela conclui (a RPC já devolve a situação
     * reclassificada); diz QUEM decidiu. Ver `carregandoReclassificacoes`.
     */
    reclassificacoesPorBloco,
    carregandoReclassificacoes,
    /**
     * As QUATRO cargas que gateiam a pintura. Não exponha uma sozinha: gatear
     * numa só foi exatamente o defeito que fazia a listagem pintar e se corrigir
     * na frente de quem estava lendo (ver `carregandoOrfas` e
     * `carregandoVinculos`).
     *
     * A quinta carga (reclassificações) fica FORA de propósito — ela não muda
     * conclusão nenhuma da tela, só acrescenta autoria à gaveta. A nota em
     * `carregandoReclassificacoes` tem o porquê.
     */
    loading:
      carregandoSemana || carregandoAutorizacoes || carregandoOrfas || carregandoVinculos,
    erro,
    recarregar: useCallback(() => {
      carregarMes()
      carregarAutorizacoes()
      carregarOrfasDoMes()
      carregarVinculos()
      carregarReclassificacoes()
    }, [
      carregarMes, carregarAutorizacoes, carregarOrfasDoMes, carregarVinculos,
      carregarReclassificacoes,
    ]),
  }
}
