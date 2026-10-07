// Busca a grade para as telas de remuneração direto do Supabase, SEM upload,
// mapeando para as chaves em português da planilha que cada consumidor espera.
// A leitura em si vive em lib/grade/fonte.ts.
//
// São dois destinos, com recortes de coluna diferentes e NÃO intercambiáveis:
//   buscarGradeParaAnalise → Análise Futura (aba /analise). Projeção; só precisa
//       da identidade da sessão.
//   buscarGradeParaRP      → Remuneração Real (abas /rp e /individual) E Análise
//       de Tratativas (/analise-tratativas, via o alias buscarGradeParaTratativas
//       logo abaixo). Precisa também das colunas de execução da Fase 2 — nas
//       duas telas, porque rodam a mesma pipeline de classificação
//       (normalizarGradeParaSessao/classificarSessaoReal). Em /rp é dinheiro —
//       ver a guarda de cobertura em avaliarCoberturaGrade(); em Tratativas é a
//       mesma guarda, com o parâmetro `contexto` trocando o texto para não falar
//       em pagamento numa tela que nunca calcula nem mostra R$.

import { buscarGrade, fixMojibake, medirSaudeGrade } from "@/lib/grade/fonte"
import type { CsvRow } from "@/types/cronograma"
import type { CsvGradeRow } from "./relatorio"
import { formatDateBR } from "./datas"
import { limparPrefixoDesligado } from "./constants"
import {
  rotulosDeExecucaoDesconhecidos, veredictoRotuloDesconhecido,
  justificativaDesconhecida, avisoJustificativaDesconhecida,
} from "./rotulosExecucao"

// profissional_id é a chave estável do profissional no TiTa: quando alguém é
// desligado o nome vira "INATIVO-<nome>" aqui, mas o id continua o mesmo e o
// agenda_tita ainda guarda o nome limpo sob ele (ver getUltimoAtendimentoAtivo).
const FIELDS = "paciente_id, paciente_nome, dia_semana, hora_inicial, hora_final, profissional_id, profissional_nome, terapia_nome, status_agendamento, sala_nome, data, unidade_nome"

const DIAS_PT = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"]

const MESES_PT_EXTENSO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

/** "2026-06-01" → "junho de 2026" — minúsculo, para embutir em frase. */
function mesPorExtenso(dataIso: string): string {
  const [ano, mes] = dataIso.split("-").map(Number)
  return `${MESES_PT_EXTENSO[mes - 1]} de ${ano}`
}

function diaSemanaDeData(data: string | null): string {
  if (!data) return ""
  return DIAS_PT[new Date(`${data}T12:00:00`).getDay()] ?? ""
}

export async function buscarGradeParaAnalise(dataInicio: string, dataFim: string): Promise<CsvRow[]> {
  // A view já garante `ativo` — o filtro que aqui é especialmente crítico,
  // porque esta consulta alimenta o cálculo de remuneração e contar a sessão
  // remarcada duas vezes pagaria em dobro.
  const all = await buscarGrade<Record<string, string | number | null>>({
    campos: FIELDS,
    fonte: "base",
    unidade: 280,
    de: dataInicio,
    ate: dataFim,
    ordem: [
      { coluna: "data" },
      { coluna: "hora_inicial" },
      { coluna: "profissional_nome" },
      { coluna: "id" },
    ],
  })

  return all.map(r => {
    const salaNome = fixMojibake(r.sala_nome as string | null)
    return {
      "Id Favorecido": String(r.paciente_id ?? ""),
      "Nome Favorecido": fixMojibake(r.paciente_nome as string | null),
      "Dia da Semana": (r.dia_semana as string) || diaSemanaDeData(r.data as string | null),
      "Hora Inicial": String(r.hora_inicial ?? "").slice(0, 5),
      "Hora Final": String(r.hora_final ?? "").slice(0, 5),
      "Terapia": fixMojibake(r.terapia_nome as string | null),
      "Id Profissional": String(r.profissional_id ?? ""),
      "Profissional": fixMojibake(r.profissional_nome as string | null),
      "Status do Agendamento": (r.status_agendamento as string) ?? "",
      "Sala": salaNome,
      "Data": (r.data as string) ?? "",
      "Unidade": fixMojibake(r.unidade_nome as string | null),
    } as unknown as CsvRow
  })
}

// ─── Remuneração Real (/rp e /individual) ───────────────────────────────────

/**
 * Primeira data em que o banco sabe o que aconteceu com a sessão.
 *
 * **Medido contra produção, não deduzido.** A virada é um penhasco, não uma
 * rampa: 30/06 tem 0% de cobertura em 695 sessões agendadas e 01/07 tem 98,2%
 * em 715. A causa é a mesma data em que `origem` passa de `backup_xls` para
 * `tita_csv` — as linhas semeadas do backup não têm `tita_agendamento_id`, que
 * é a chave por onde a captura de execução casa, então ela nunca alcançou
 * nenhuma delas. Não adianta reprocessar: o dado não existe do lado do TiTa.
 *
 * O que acontece sem esta guarda: `possui_tratativa` NULL, `isSim(null)` false,
 * o cálculo lê "não evoluído" e a tela mostra uma grade de aparência
 * perfeitamente normal (13.789 linhas em maio, 14.517 em junho) com R$ 0,00
 * para todo mundo, sem erro nenhum. Num fluxo de pagamento é a falha a impedir.
 */
export const PISO_EXECUCAO_GRADE = "2026-07-01"

/** O banco tem (ou pode ter) execução capturada para esta data? Mesmo piso de checarPisoDeExecucao. */
export function temExecucaoRegistrada(dataIso: string): boolean {
  return dataIso >= PISO_EXECUCAO_GRADE
}

/** Julho/2026 medido em produção deu 99,70%; a perda estrutural é ~0,30%. */
const COBERTURA_MINIMA = 0.95

/**
 * Janela em que ainda é normal faltar evolução: 75,8% das tratativas são
 * lançadas no mesmo dia, p90 = 3 dias, p95 = 6 dias.
 */
const DIAS_EVOLUCAO_EM_TRANSITO = 15

const RP_FIELDS = [
  "data", "dia_semana", "hora_inicial",
  "paciente_id", "paciente_nome",
  // Os dois ids não vão para a planilha: servem para canonizar o nome antes de
  // montá-la. Ver nomesCanonicos().
  "profissional_id", "profissional_nome", "terapia_nome",
  "unidade_nome", "convenio_nome",
  "status_agendamento", "tita_agendamento_id",
  "status_execucao", "justificativa",
  "possui_tratativa", "tratativa_profissional_id", "tratativa_profissional_nome", "tratativa_criada_em",
  // Contagem de evoluções do agendamento. No upload ela é dedutível (o relatório
  // repete a linha); aqui não, porque a tabela guarda uma linha por agendamento
  // e a segunda evolução sobrescreveu a primeira. Sem estas duas colunas o banco
  // não teria como marcar duplicidade nem conflito de autoria.
  "tratativas", "tratativas_distintas",
].join(", ")

/**
 * Um nome por `profissional_id`, escolhido pela grafia mais frequente na agenda.
 *
 * Existe porque o cálculo agrupa profissional por NOME, e o TiTa grava o mesmo
 * `profissional_id` com grafias diferentes nos dois campos. Medido em
 * julho/2026: o id 17586 aparece 133 vezes como "Nicolly Christine da Silva
 * Alcantara" em `profissional_nome` e 88 vezes como "Nicolly Alcantara" em
 * `tratativa_profissional_nome`. É a mesma pessoa.
 *
 * O estrago sem isto não é cosmético. `same` (agenda == tratativa) decide quem
 * recebe: com as duas grafias, as 88 sessões dela viram "Substituição" creditada
 * a um profissional que não existe em lugar nenhum, e a pessoa real fica com
 * R$ 0,00 e 107 sessões marcadas "substituído por outro" na tela de pagamento.
 *
 * Frequência, e não "o nome mais longo" ou "o primeiro que apareceu": a agenda é
 * a fonte de verdade do nome (é ela que casa com o cadastro de contratos), e a
 * grafia que ela mais usa é a que o resto do sistema reconhece.
 *
 * Só o id 12659 e o 17586 divergiam em julho; o 12659 é o prefixo `INATIVO-`,
 * que `nomeProfissional` já resolve — por isso a contagem é feita depois dele.
 */
function nomesCanonicos(linhas: Record<string, unknown>[]): Map<number, string> {
  const freq = new Map<number, Map<string, number>>()
  for (const r of linhas) {
    const id = r.profissional_id
    if (typeof id !== "number") continue
    const nome = nomeProfissional(r.profissional_nome)
    if (!nome) continue
    const porNome = freq.get(id) ?? new Map<string, number>()
    porNome.set(nome, (porNome.get(nome) ?? 0) + 1)
    freq.set(id, porNome)
  }

  const canonico = new Map<number, string>()
  for (const [id, porNome] of freq) {
    let melhor = ""
    let maior = -1
    for (const [nome, n] of porNome) {
      // Desempate por ordem alfabética para o resultado não depender da ordem
      // das linhas — duas cargas do mesmo período têm de dar o mesmo nome.
      if (n > maior || (n === maior && nome < melhor)) { melhor = nome; maior = n }
    }
    canonico.set(id, melhor)
  }
  return canonico
}

/** Só os contadores — o que a tela precisa guardar depois de decidir. */
export interface CoberturaGrade {
  /**
   * Sessões `Agendado` **já ocorridas** no período: o denominador.
   *
   * Sessão futura não tem execução por construção, e incluí-la torna o número
   * inútil justamente no mês que se está acompanhando. Medido em 2026-08-06:
   * agosto inteiro dá 19,60% de cobertura; agosto até hoje dá **99,78%**. O
   * primeiro número dispararia um alarme de 10.923 sessões quando as que
   * faltam de verdade são 6 — e alarme falso ensina a ignorar alarme.
   */
  agendados: number
  /** Dessas, quantas o banco não sabe se aconteceram (`status_execucao` NULL). */
  semExecucao: number
  /** 0..1. Vale 1 num período sem nenhuma sessão agendada. */
  cobertura: number
  /**
   * Sessões `Agendado` do período com `ativo = false` — **fora** dos números
   * acima, porque não estão na grade.
   *
   * Este contador existe porque os outros dois não conseguiam vê-lo. Cobertura
   * mede a grade por dentro: quantas das linhas presentes têm execução. Linha
   * inativada não é linha com campo vazio, é linha ausente — ela não entra nem
   * no numerador nem no denominador, e some sem mexer no percentual. Foi
   * exatamente assim que julho/2026 exibiu 98,9% de cobertura com 25 sessões
   * realizadas escondidas e R$ 490,00 a menos na folha.
   */
  inativasAgendadas: number
  /**
   * Rótulos de `Status` que vieram na grade e este código não sabe ler
   * (amostra: até 5 textos distintos, como o TiTa os escreveu).
   *
   * Reforço, hoje sem caso conhecido: o vocabulário de `Status` está
   * confirmado fechado (ver rotulosExecucao.ts) — a mudança real de
   * 24/08/2026 foi em `Justificativa`, coberta por `justificativasDesconhecidas`
   * abaixo. Mantido para o dia em que `Status` variar de verdade: um rótulo
   * ali que ninguém entende faria sessão não realizada passar por realizada, e
   * isso sim gera diária, ETA e PA indevidos — ver `cancelado` em calculo.ts.
   */
  rotulosDesconhecidos: string[]
  /** Quantas linhas do período trazem um dos rótulos acima. */
  linhasRotuloDesconhecido: number
  /**
   * Justificativas de sessão `Cancelado` que não batem com nenhum dos 6
   * motivos conhecidos (amostra: até 5 textos distintos).
   *
   * Esta é a mudança real de 24/08/2026. Ao contrário de `rotulosDesconhecidos`
   * acima, NÃO arrisca pagamento — `cancelado` depende só de `Status`, que
   * continua "Cancelado" — mas deixa "Presença TiTa" em branco para essas
   * linhas sem avisar ninguém, a menos que este contador vire aviso. Ver
   * `justificativaDesconhecida`/`avisoJustificativaDesconhecida` em
   * rotulosExecucao.ts.
   */
  justificativasDesconhecidas: string[]
  /** Quantas linhas `Cancelado` do período trazem uma das justificativas acima. */
  linhasJustificativaDesconhecida: number
}

export interface GradeDoBanco extends CoberturaGrade {
  /** Linhas com as chaves da planilha — prontas para normalizarGradeParaSessao. */
  linhas: CsvGradeRow[]
}

// "sv-SE" formata como "2026-06-08 08:37:17" — exatamente o formato em que a
// TiTa exporta "Criação Tratativa" no CSV, sem montagem manual. O PostgREST
// devolve o mesmo instante em UTC ("2026-06-08T11:37:17+00:00"), então o
// timeZone tem de ser explícito ou o texto sai três horas adiantado.
const FMT_INSTANTE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
})

/** timestamptz → o mesmo texto que o CSV traz. Campo só de exibição. */
function instanteBR(v: unknown): string {
  if (!v) return ""
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return ""
  return FMT_INSTANTE.format(d).replace("T", " ")
}

/**
 * boolean → o texto que a planilha traz. NULL **não** é "Não": significa que a
 * captura não alcançou a linha. Os dois viram vazio para `isSim()`, mas só o
 * NULL entra em `semExecucao`.
 */
function simNao(v: unknown): string {
  if (v === true) return "Sim"
  if (v === false) return "Não"
  return ""
}

/**
 * Nome do profissional sem o prefixo `INATIVO-` do TiTa.
 *
 * Aqui não é cosmético — é integridade da folha. O congelamento preserva o nome
 * como estava quando cada linha foi escrita, então quem é desligado no meio do
 * mês fica gravado sob **duas grafias** no mesmo mês. Medido em julho/2026:
 * `profissional_id` 12659 tem 79 linhas com o nome limpo e 41 com o prefixo, as
 * duas com sessão evoluída. Como `calcularRemuneracaoReal` agrupa por nome e
 * **não** remove o prefixo (só `calcularAnaliseFutura` remove), a mesma pessoa
 * saía como dois profissionais distintos na lista de pagamento.
 *
 * Limpar também restaura o casamento com `remuneracao_contratos`, que é
 * cadastrado no nome limpo — sem isso o desligado perde o valor de contrato e
 * cai na taxa genérica da tabela.
 *
 * Efeito colateral aceito: a tela do RP deixa de mostrar que a pessoa foi
 * desligada. O desligamento não apaga a dívida do mês trabalhado, então isso não
 * muda nenhuma decisão de pagamento.
 */
function nomeProfissional(v: unknown): string {
  return limparPrefixoDesligado(fixMojibake(v as string | null))
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * A grade do período no formato do CSV que hoje se sobe à mão, mais o que é
 * preciso para decidir se dá para confiar nela.
 *
 * Usa a fonte "base" (não "atendimentos") porque normalizarGradeParaSessao
 * também quer as linhas não-`Agendado` que tenham tratativa — é assim que a
 * classe "Evolução sem agendamento" aparece.
 */
export async function buscarGradeParaRP(de: string, ate: string, hoje = new Date()): Promise<GradeDoBanco> {
  // Em paralelo: a grade em si e o que ela não mostra. As duas medidas juntas são
  // o que responde "dá para pagar com isto?" — nenhuma das duas sozinha responde.
  const [brutas, saude] = await Promise.all([
    buscarGrade<Record<string, unknown>>({
      campos: RP_FIELDS,
      fonte: "base",
      unidade: 280,
      de,
      ate,
      ordem: [
        { coluna: "data" },
        { coluna: "hora_inicial" },
        { coluna: "profissional_nome" },
        { coluna: "id" },
      ],
    }),
    medirSaudeGrade(de, ate, 280),
  ])

  const ultimoDiaMedido = iso(hoje)
  const canonico = nomesCanonicos(brutas)
  // Nome pelo id quando o id é conhecido; senão o que veio. Profissional que só
  // aparece como tratativa (nunca na agenda) não está no mapa, e aí a grafia
  // dele é a única que existe — não há o que canonizar.
  const porId = (id: unknown, nome: unknown) =>
    (typeof id === "number" ? canonico.get(id) : undefined) ?? nomeProfissional(nome)

  let agendados = 0
  let semExecucao = 0
  // Rótulo ilegível é contado em TODA linha do período, sem o recorte
  // `Agendado`/já ocorrida das duas medidas acima. Aquele recorte existe para
  // não acusar como falha o que é só sessão futura sem execução; aqui não há
  // nada de normal a preservar — status_execucao preenchido e ininteligível é
  // sintoma em qualquer linha, e é o cálculo inteiro que fica sem chão.
  const rotulosDesconhecidos = new Set<string>()
  let linhasRotuloDesconhecido = 0
  // Mesma ideia, mas para `Justificativa` de linha `Cancelado` — é ali, e não em
  // `Status`, que o TiTa de fato mudou o vocabulário em 24/08/2026 (ver
  // rotulosExecucao.ts). Guardado por texto exato, sem o dedup por chave
  // normalizada de `rotulosDesconhecidos` — o volume esperado aqui é baixo
  // (só sessões canceladas) e não compensa a complexidade extra.
  const justificativasDesconhecidas = new Set<string>()
  let linhasJustificativaDesconhecida = 0

  const linhas = brutas.map(r => {
    // Só `Agendado` e só o que já aconteceu. `Livre` não tem evolução por
    // construção (derruba a medida para ~78% sem nada errado), e sessão futura
    // menos ainda — ver o comentário de CoberturaGrade.agendados.
    if (r.status_agendamento === "Agendado" && (r.data as string) <= ultimoDiaMedido) {
      agendados++
      if (r.status_execucao == null) semExecucao++
    }
    // Sobre o texto já corrigido (fixMojibake), não o cru: dupla codificação
    // deixaria acento e travessão da Justificativa irreconhecíveis e viraria
    // um alarme falso de vocabulário novo. É o mesmo texto que as colunas
    // "Status"/"Justificativa" abaixo entregam a quem classifica.
    const statusExec = fixMojibake(r.status_execucao as string | null)
    const justificativa = fixMojibake(r.justificativa as string | null)
    for (const rotulo of rotulosDeExecucaoDesconhecidos([statusExec])) {
      linhasRotuloDesconhecido++
      if (rotulosDesconhecidos.size < 5) rotulosDesconhecidos.add(rotulo)
    }
    const motivoIlegivel = justificativaDesconhecida(justificativa, statusExec)
    if (motivoIlegivel) {
      linhasJustificativaDesconhecida++
      if (justificativasDesconhecidas.size < 5) justificativasDesconhecidas.add(motivoIlegivel)
    }
    return {
      "Data": (r.data as string) ?? "",
      "Dia da Semana": fixMojibake(r.dia_semana as string | null) || diaSemanaDeData(r.data as string | null),
      "Hora Inicial": String(r.hora_inicial ?? "").slice(0, 5),
      "Id Favorecido": String(r.paciente_id ?? ""),
      "Nome Favorecido": fixMojibake(r.paciente_nome as string | null),
      // Sem prefixo INATIVO- — ver nomeProfissional(). A Análise Futura, acima,
      // faz o oposto de propósito: é do prefixo que ela deduz o desligamento.
      "Profissional": porId(r.profissional_id, r.profissional_nome),
      "Terapia": fixMojibake(r.terapia_nome as string | null),
      // "Nome Unidade", não "Unidade": é a chave que normalizarGradeParaSessao
      // procura. A Análise Futura, acima, espera outra — não unifique.
      "Nome Unidade": fixMojibake(r.unidade_nome as string | null),
      "Convênio": fixMojibake(r.convenio_nome as string | null),
      "Status do Agendamento": (r.status_agendamento as string) ?? "",
      "ID Agendamento": r.tita_agendamento_id == null ? "" : String(r.tita_agendamento_id),
      "Status": statusExec,
      // fixMojibake (aplicado em `justificativa`, acima) deixou de ser zelo: os
      // motivos novos ('Não realizado — clínica') têm acento e travessão,
      // enquanto os antigos ('Falta do Paciente') eram ASCII puro e nunca
      // podiam quebrar. Status + Justificativa juntos definem `cancelado`
      // (isCancelado) e presencaTita (motivoNaoRealizado) — ver rotulosExecucao.ts.
      "Justificativa": justificativa,
      "Possui Tratativa": simNao(r.possui_tratativa),
      "Nome Profissional Tratativa": porId(r.tratativa_profissional_id, r.tratativa_profissional_nome),
      "Criação Tratativa": instanteBR(r.tratativa_criada_em),
      // Chaves que normalizarGradeParaSessao lê para classificar "Evolução
      // duplicada" e "Evolução em conflito". NULL (captura ainda não alcançou a
      // linha) vira "", e lá o fallback é 1 — o normal.
      "Tratativas": r.tratativas == null ? "" : String(r.tratativas),
      "Tratativas Distintas": r.tratativas_distintas == null ? "" : String(r.tratativas_distintas),
    } as CsvGradeRow
  })

  return {
    linhas,
    agendados,
    semExecucao,
    cobertura: agendados === 0 ? 1 : (agendados - semExecucao) / agendados,
    inativasAgendadas: saude.inativasAgendadas,
    rotulosDesconhecidos: [...rotulosDesconhecidos],
    linhasRotuloDesconhecido,
    justificativasDesconhecidas: [...justificativasDesconhecidas],
    linhasJustificativaDesconhecida,
  }
}

/**
 * Alias para a Análise de Tratativas — mesma consulta, mesmo mapeamento.
 * Existe só para quem lê hooks/useTratativas.ts não estranhar uma função
 * "ParaRP" numa tela sem nada de remuneração; a query e as colunas são
 * idênticas às de /rp porque as duas telas rodam a mesma pipeline de
 * classificação (normalizarGradeParaSessao → classificarSessaoReal).
 */
export const buscarGradeParaTratativas = buscarGradeParaRP

/**
 * Reprovar é um estado com duas audiências, e por isso tem dois textos.
 *
 * `resumo` vai no cabeçalho, que é uma faixa de chips de status: precisa caber
 * numa linha e ser lido de relance. `erro` explica, e mora no modal, junto dos
 * botões que resolvem. Quando os dois eram o mesmo texto, a explicação inteira
 * era despejada no cabeçalho e o sobrepunha — o motivo desta separação.
 *
 * `dica` é o próximo passo, e vem junto com a falha em vez de ser fixa no modal.
 * Precisou ser assim depois que "o sync repõe sozinho o que o TiTa ainda
 * reporta" apareceu embaixo de um erro de leitura, onde não queria dizer nada:
 * cada motivo tem uma saída diferente, e uma orientação genérica é pior que
 * nenhuma.
 */
export type VeredictoGrade =
  | { ok: true; aviso: string | null }
  | { ok: false; erro: string; resumo: string; dica: string; quantidade?: number }

/**
 * Só troca o texto de "o que está em jogo" nas duas guardas abaixo — a
 * matemática (limiares, contagens) é a mesma para as duas telas. "pagamento"
 * é o padrão (histórico, usado por /rp e /individual); "tratativas" é usado
 * pela Análise de Tratativas, que nunca calcula nem mostra R$ — falar em
 * "pagar a menos"/"fechar o pagamento" lá seria falso.
 */
export type ContextoGrade = "pagamento" | "tratativas"

/**
 * Barra o período ANTES de consultar. Passo separado de propósito: um mês são
 * ~19 requisições paginadas, e período sem captura não passaria na guarda
 * seguinte de qualquer forma.
 */
export function checarPisoDeExecucao(de: string, contexto: ContextoGrade = "pagamento"): VeredictoGrade {
  if (de && de < PISO_EXECUCAO_GRADE) {
    return {
      ok: false,
      resumo: `Períodos anteriores a ${formatDateBR(PISO_EXECUCAO_GRADE)}`,
      erro: contexto === "pagamento"
        ? `O banco só passou a registrar execução em ${formatDateBR(PISO_EXECUCAO_GRADE)}. `
          + "Antes dessa data ele não sabe quem evoluiu, e o cálculo pagaria R$ 0,00 a todo mundo."
        : `A partir de ${formatDateBR(PISO_EXECUCAO_GRADE)}, o sistema passou a registrar as execuções no banco de `
          + "dados. Por isso, não temos informações suficientes para identificar quem realizou cada tratativa antes dessa data.",
      dica: contexto === "pagamento"
        ? "Para períodos anteriores, use o CSV exportado do TiTa. Não há o que reconciliar aqui — o dado nunca existiu no banco."
        : `Para ${mesPorExtenso(de)} e períodos anteriores, os dados devem ser consultados diretamente no CSV exportado do TiTa.`,
    }
  }
  return { ok: true, aviso: null }
}

/**
 * Decide se a grade que voltou serve para pagar.
 *
 * São duas perguntas, e por muito tempo esta função só fazia a segunda:
 *
 *   1. a grade está COMPLETA?  (nenhuma sessão escondida por ativo = false)
 *   2. o que está nela tem execução registrada?
 *
 * A ordem importa. A pergunta 2 mede a grade por dentro e não tem como acusar
 * ausência: em julho/2026 ela respondeu "98,9%, pode pagar" enquanto 25 sessões
 * realizadas estavam fora da grade, R$ 490,00 a menos. Incompletude bloqueia
 * sem exceção — diferente de execução faltando, ela não se resolve esperando.
 *
 * Há também uma pergunta 0, que vem antes das duas: o que está em `Status` é
 * LEGÍVEL? Reforço para um vocabulário confirmado fechado (ver
 * rotulosExecucao.ts) — sem caso conhecido até hoje, mas se um rótulo ali
 * algum dia não for entendido, ele não deixaria a grade incompleta: deixaria-a
 * mentirosa, com sessão não realizada passando por realizada e gerando diária,
 * ETA e PA. As perguntas 1 e 2 respondem "quanto falta"; esta responde "dá
 * para acreditar no que veio".
 *
 * A mudança real de vocabulário de 24/08/2026 — em `Justificativa`, não em
 * `Status` — entra por um canal separado e mais leve, no fechamento desta
 * função: um AVISO (nunca reprovação), porque `Justificativa` não decide
 * pagamento, só a exibição de "Presença TiTa". Ver avisoJustificativaDesconhecida.
 */
function resolverVeredictoDeCobertura(
  grade: CoberturaGrade,
  periodo: { de: string; ate: string },
  hoje: Date,
  contexto: ContextoGrade,
): VeredictoGrade {
  const { de, ate } = periodo
  const dePagamento = contexto === "pagamento"

  const veredictoRotulo = veredictoRotuloDesconhecido(grade, contexto)
  if (veredictoRotulo) return veredictoRotulo

  if (grade.inativasAgendadas > 0) {
    const n = grade.inativasAgendadas
    // "fora da grade", não "ativo = false": quem lê esta tela fecha pagamento
    // (ou audita tratativas), e o nome da coluna do banco não é vocabulário dela.
    return {
      ok: false,
      resumo: "Grade incompleta",
      quantidade: n,
      erro: `${n === 1 ? "Uma sessão agendada" : `${n} sessões agendadas`} do período `
        + `${n === 1 ? "não está" : "não estão"} na grade e `
        + (dePagamento
          ? `${n === 1 ? "ficou" : "ficaram"} fora do cálculo. Fechar o pagamento assim paga a menos.`
          : `${n === 1 ? "ficou" : "ficaram"} fora da contagem — algumas tratativas podem estar invisíveis nesta tela.`),
      dica: "O sync confere isso contra o TiTa todo dia: repõe o que ele ainda reporta e marca o que "
        + "ele confirma ter apagado. Recarregue amanhã. Se o número não tiver zerado, avise o time técnico.",
    }
  }

  if (grade.agendados === 0) {
    // Nenhuma sessão já ocorrida no período. Ou ele está inteiro no futuro, ou
    // está vazio — nos dois casos não há o que pagar/contar, e é melhor dizer
    // isso do que deixar a tela mostrar todo mundo zerado sem explicação.
    return {
      ok: true,
      aviso: de > iso(hoje)
        ? "Período ainda não aconteceu: nenhuma sessão dele foi executada até hoje."
        : null,
    }
  }

  const corte = new Date(hoje)
  corte.setDate(corte.getDate() - DIAS_EVOLUCAO_EM_TRANSITO)
  const emTransito = ate > iso(corte)

  const pct = (grade.cobertura * 100).toFixed(1).replace(".", ",")
  const avisoTransito = `${grade.semExecucao} de ${grade.agendados} sessões já ocorridas ainda sem execução (${pct}% de cobertura). `
    + "É esperado num período recente — a evolução costuma chegar em até 3 dias. "
    + (dePagamento ? "Confira antes de fechar o pagamento." : "Confira antes de tirar conclusões sobre quem evoluiu.")

  if (grade.cobertura >= COBERTURA_MINIMA) {
    return { ok: true, aviso: grade.semExecucao > 0 && emTransito ? avisoTransito : null }
  }
  if (emTransito) return { ok: true, aviso: avisoTransito }

  return {
    ok: false,
    resumo: `Captura incompleta · ${pct}%`,
    quantidade: grade.semExecucao,
    erro: `${grade.semExecucao} das ${grade.agendados} sessões já ocorridas do período estão sem `
      + `execução registrada (${pct}% de cobertura). O período é antigo demais para ser evolução `
      + "em trânsito, então a captura falhou.",
    dica: "Avise o time técnico — recarregar não resolve enquanto a captura não rodar. "
      + (dePagamento
        ? "Para fechar o pagamento agora, use o CSV exportado do TiTa."
        : "Para auditar esse período agora, use o CSV exportado do TiTa."),
  }
}

/**
 * Decide se a grade que voltou serve para pagar — ver resolverVeredictoDeCobertura
 * para as perguntas que decidem isso.
 *
 * Esta função só acrescenta uma coisa ao resultado dela: quando o veredicto é
 * `ok`, funde o aviso de "Justificativa desconhecida" (se houver) ao aviso que
 * já existisse. Fica FORA de resolverVeredictoDeCobertura de propósito — aquela
 * função tem várias saídas antecipadas (`return` cedo em cada guarda), e
 * calcular a fusão só uma vez aqui, depois de todas elas, é mais simples do que
 * repetir a fusão em cada retorno.
 */
export function avaliarCoberturaGrade(
  grade: CoberturaGrade,
  periodo: { de: string; ate: string },
  hoje = new Date(),
  contexto: ContextoGrade = "pagamento",
): VeredictoGrade {
  const resultado = resolverVeredictoDeCobertura(grade, periodo, hoje, contexto)
  if (!resultado.ok) return resultado

  const avisoJustif = avisoJustificativaDesconhecida(grade.linhasJustificativaDesconhecida, grade.justificativasDesconhecidas)
  if (!avisoJustif) return resultado

  return { ok: true, aviso: [resultado.aviso, avisoJustif].filter(Boolean).join("\n\n") }
}
