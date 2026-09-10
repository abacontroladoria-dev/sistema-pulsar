// ─── Regra C: a grade da TiTa é a autoridade sobre o que é ofertável ──────────
//
// Ocupação de Paciente decidia "este horário está livre" olhando SÓ
// csv_grades_profissionais (via vw_grade_base), que é o export de
// AGENDAMENTOS. Só que a TiTa tem uma segunda fonte — grade_profissionais_tita,
// o export da GRADE do terapeuta — e as duas discordam de DUAS formas
// diferentes. Este módulo aplica as duas regras que saem daí.
//
// ── Regra C1: a grade diz 'Agendado' e o CSV diz 'Livre' ──
//
// Medido em 2026-08-25, unidade 280, janela 25/08→30/09: 233 slots em que a
// grade diz 'Agendado' e o CSV diz apenas 'Livre', espalhados por 27
// profissionais. O caso que motivou a investigação (Paula Quintanilha De
// Sousa, quinta-feira 13:40→17:00) tem a assinatura clássica: o
// grade_terapeuta_id vira 'Agendado' numa data e nunca mais volta, que é o
// rastro de uma série semanal implantada — enquanto as ocorrências
// individuais nunca chegaram ao CSV de agendamentos.
//
// Por que a grade ganha o desempate: é exatamente a tabela que a implantação
// já consulta. montarPayloadAgendamento (services/tita/payload.ts) grava
// `id_grade_terapeuta` resolvido por resolverGradeTerapeuta a partir DELA. Ou
// seja, a escrita entra no mesmo gtid que a grade já marca como ocupado — a
// sugestão é que estava lendo a fonte fraca. payload.ts:34-38 já registrava
// que "csv_grades_profissionais não é uma fonte confiável ... em linhas
// 'Livre'"; isso aqui só aplica esse mesmo conhecimento à decisão de ocupação,
// e não apenas a id_sala/id_terapia_exibicao.
//
// OLHAR PARA FRENTE é parte da regra, não refinamento: a implantação cria uma
// série semanal até DATA_FINAL_FIXA (31/12), então não basta o slot estar
// livre na data sugerida. Dos 77 slots que esta regra remove na janela real da
// tela, 33 estão livres no dia e ocupados só mais adiante — colidiriam no meio
// da série. Por isso a chave é (profissional, dia da semana, hora) sobre TODAS
// as datas visíveis a partir da janela, e não (profissional, data, hora).
//
// Custo medido na janela 01/09→07/09: de 746 slots ofertados, 77 saem (10,3%),
// sobram 669. O risco de esconder vaga boa é baixo: onde o CSV diz 'Agendado',
// a grade discorda em apenas 0,7% (22 de 3.348) — ela não superestima ocupação.
//
// ── Regra C2: a grade NÃO TEM O HORÁRIO e o CSV diz 'Livre' ──
//
// A C1 sozinha é uma allowlist invertida: só um "positivo" bloqueia, então a
// AUSÊNCIA de linha na grade nunca barrava nada. E a ausência é justamente
// como a TiTa representa "o profissional não tem grade aberta nesse horário" —
// grade_profissionais_tita (unidade 280, futuro) só tem dois valores de
// status_agendamento, 'Agendado' (24.359) e 'Livre' (4.974). Não existe
// 'Bloqueado'/'Indisponível': o horário sem grade simplesmente não vem na API.
//
// Medido em 2026-09-10, unidade 280, janela 01/10→07/10 — caso Evelyn Andressa
// (profissional_id 8638), segunda-feira: a API da TiTa devolve 7 slots para
// ela (13:00→17:00) e NADA na manhã, porque a segunda dela começa às 13:00. O
// nosso csv_grades_profissionais tem 13 linhas, com 6 fantasmas na manhã
// (08:00→11:20, ativo=true, origem='tita_csv'). A tela ofertou as 6 — e como o
// paciente (Theo Meneses Da Silva) não tinha nenhuma sessão na segunda, o
// motor montou um "dia novo" inteiro em cima de horários que não existem.
//
// Na mesma janela, 79 dos 748 slots 'Livre' (10,6%) não têm linha
// correspondente na grade, em 7 profissionais (14517: 30 slots; 8589: 26;
// 8649: 13; 8638: 6; e mais 3). São vagas que a TiTa recusaria na implantação.
//
// Autoridade independente: POST /integracao/get_disponibilidade não devolve
// gtid nenhum para a manhã de segunda dela (não há grade), enquanto o 13:00
// volta com horarios_livres:13.
//
// A CHAVE DESTA REGRA É DIFERENTE DA C1, e essa é a parte não-óbvia. Para
// "está comprometido" a chave agrega por dia da semana (a série semanal olha
// para frente, ver acima). Para "existe na grade" isso seria ERRADO: agregado
// por dia da semana, uma única terça com grade aberta faria TODAS as terças
// parecerem válidas — inclusive as que não têm grade. Aqui a chave é
// (profissional, DATA, hora), exata.
//
// E a abstenção da C2 é por PROFISSIONAL, não por dia — ver o comentário no
// filtro. Abster por dia foi medido e deixava passar 71 slots que a API bruta
// da TiTa confirma não existirem: seria reabrir o bug com outro nome.
//
// ── Regra C3: profissional desligado nunca é ofertado ──
//
// Achado no caminho da C2, em 2026-09-10: a profissional 14517
// (INATIVO-Gabriela Pereira Ramos) tinha 30 slots 'Livre' ofertáveis no CSV e
// zero linha na grade em qualquer data. Como a abstenção da C2 mantém quem não
// aparece na grade, ela sozinha deixaria essas 30 passarem.
//
// O desligamento não é ambíguo — a TiTa prefixa o nome com "INATIVO-" (ver
// reference_desligamento_inativo_tita) — e nada mais neste módulo barra o
// prefixo: isProfBloqueadoTemp é uma lista fixa de dois nomes, não um filtro de
// desligado. Por isso a trava vive aqui.

import { getSupabaseClient } from "@/lib/supabase/client"
import type { CsvRow } from "@/types/cronograma"

const PAGE = 1000
const UNIDADE = 280

/** C1 — `profissionalId|||dow|||HH:MM`, agregada por dia da semana. */
type ChaveSlot = string
/** C2 — `profissionalId|||YYYY-MM-DD|||HH:MM`, exata na data. */
type ChaveData = string

interface LinhaGrade {
  profissional_id: number | null
  data: string | null
  hora_inicial: string | null
  status_agendamento: string | null
}

// Dia da semana derivado da DATA, não do texto `dia_semana`. As duas tabelas
// trazem o rótulo em português e hoje batem, mas casar por número elimina de
// vez a chance de um lado divergir na grafia/acentuação e a regra falhar
// aberta (deixando passar slot ocupado) sem ninguém perceber. Meio-dia evita
// a virada de fuso empurrar a data para o dia anterior.
const dowDe = (data: string): number => new Date(`${data.slice(0, 10)}T12:00:00`).getDay()

const hhmm = (hora: unknown): string => String(hora ?? "").slice(0, 5)
const dia = (data: unknown): string => String(data ?? "").slice(0, 10)

// A TiTa marca o desligamento prefixando o nome do profissional com "INATIVO-"
// (ver reference_desligamento_inativo_tita). Casa no início da string já sem
// acento/caixa; o hífen é opcional porque a grafia do prefixo não é garantida.
const isDesligado = (prof: unknown): boolean =>
  /^inativo-?\s*/i.test(String(prof ?? "").trim())

const chaveSlot = (profId: number, dow: number, hora: unknown): ChaveSlot =>
  `${profId}|||${dow}|||${hhmm(hora)}`

const chaveData = (profId: number, data: unknown, hora: unknown): ChaveData =>
  `${profId}|||${dia(data)}|||${hhmm(hora)}`

interface Grade {
  /** C1 — slots que a grade dá como 'Agendado' (por profissional/dow/hora). */
  comprometidos: Set<ChaveSlot>
  /** C2 — slots que EXISTEM na grade, com qualquer status (por profissional/data/hora). */
  naGrade: Set<ChaveData>
  /** C2 — profissionais para os quais a grade trouxe ALGUMA linha. */
  profissionaisLidos: Set<number>
  /** Total de linhas lidas — distingue "nada comprometido" de "não consegui ler". */
  linhas: number
}

/**
 * Lê a grade da TiTa de `desde` em diante e monta os três índices de uma vez.
 *
 * Sem filtro de status na consulta (a C2 precisa das linhas 'Livre' também):
 * é a MESMA consulta de antes menos um `.eq`, então não há custo de rede extra.
 *
 * Restringe aos profissionais recebidos porque a tabela tem ~22 mil linhas no
 * horizonte visível e só interessam os que têm alguma vaga a oferecer — sem
 * esse recorte seriam ~18 páginas de ida e volta para descartar a maior parte
 * no cliente.
 */
async function buscarGrade(desde: string, profissionaisIds: number[]): Promise<Grade> {
  const grade: Grade = {
    comprometidos: new Set<ChaveSlot>(),
    naGrade: new Set<ChaveData>(),
    profissionaisLidos: new Set<number>(),
    linhas: 0,
  }
  if (profissionaisIds.length === 0) return grade

  const sb = getSupabaseClient()
  let from = 0
  for (;;) {
    const { data, error } = await sb
      .from("grade_profissionais_tita")
      .select("profissional_id, data, hora_inicial, status_agendamento")
      .eq("id_unidade", UNIDADE)
      .gte("data", desde)
      .in("profissional_id", profissionaisIds)
      .order("id")
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`grade_profissionais_tita: ${error.message}`)

    const linhas = (data ?? []) as LinhaGrade[]
    for (const l of linhas) {
      if (l.profissional_id == null || !l.data || !l.hora_inicial) continue
      grade.linhas++
      grade.profissionaisLidos.add(l.profissional_id)
      grade.naGrade.add(chaveData(l.profissional_id, l.data, l.hora_inicial))
      if (l.status_agendamento === "Agendado") {
        grade.comprometidos.add(chaveSlot(l.profissional_id, dowDe(l.data), l.hora_inicial))
      }
    }
    if (linhas.length < PAGE) break
    from += PAGE
  }

  return grade
}

/**
 * Remove de `cRows` as linhas 'Livre' que a grade da TiTa não sustenta:
 * as que ela dá como comprometidas (C1) e as que não existem nela (C2).
 *
 * REMOVE em vez de virar o status para 'Agendado' de propósito: meia dúzia de
 * funções conta linhas 'Agendado' como sessão real (sessoesDaCategoria em
 * ocupacaoCategoria.ts, agendaClinica, os índices de remanejamento.ts), e
 * injetar aí uma linha sem paciente inflaria silenciosamente esses números.
 * Sumindo com a linha, o slot simplesmente deixa de ser ofertado e nenhum
 * contador de sessão real é tocado.
 *
 * Na C1, como a chave ignora a terapia, some também com as linhas-irmãs do
 * mesmo profissional/dia/hora — que é o comportamento desejado e o mesmo
 * princípio da trava de profOcupado (ver o achado do caso Marcia Regina Araujo
 * de Paula em disponibilidadeInterna.ts): a TiTa mantém uma linha por terapia
 * ofertada, então bloquear só a linha que casou deixaria as outras
 * reaparecerem como disponíveis no mesmo horário.
 *
 * Linha sem ProfissionalId é mantida: sem o id não há como consultar a grade, e
 * derrubar por precaução esconderia vaga boa sem evidência nenhuma.
 */
export async function filtrarLivresSemGradeAberta(cRows: CsvRow[], desde: string): Promise<CsvRow[]> {
  const idsComVaga = new Set<number>()
  for (const r of cRows) {
    if (r["Status do Agendamento"] !== "Livre") continue
    const id = r.ProfissionalId
    if (typeof id === "number") idsComVaga.add(id)
  }
  if (idsComVaga.size === 0) return cRows

  const grade = await buscarGrade(desde, [...idsComVaga])

  // A policy de grade_profissionais_tita só libera SELECT para `authenticated`
  // (ver 20260524120000_grade_profissionais_rls_policy.sql). Sessão anônima não
  // recebe erro — recebe zero linha. Com a C2 isso é MAIS crítico do que era
  // com a C1 sozinha: "nenhuma linha lida" significaria "nenhum slot existe na
  // grade" e derrubaria TODAS as vagas, esvaziando a tela em silêncio. Então
  // leitura vazia desliga as duas regras e devolve cRows intacto.
  // Em produção o usuário está logado; em localhost sem login, este aviso é o
  // que diferencia "não havia nada comprometido" de "não consegui ler".
  if (grade.linhas === 0) {
    console.warn(
      "[gradeTitaOcupacao] Nenhuma linha lida de grade_profissionais_tita — regras C1/C2 desligadas. "
      + "Se a tela está oferecendo horário ocupado ou sem grade, verifique se a sessão está autenticada (RLS).",
      JSON.stringify({ desde, profissionais: idsComVaga.size }),
    )
    return cRows
  }

  return cRows.filter(r => {
    if (r["Status do Agendamento"] !== "Livre") return true
    const id = r.ProfissionalId
    if (typeof id !== "number") return true
    const data = dia(r.Data)
    if (!data) return true

    // C1 — a grade dá o slot como comprometido nesse dia da semana.
    if (grade.comprometidos.has(chaveSlot(id, dowDe(data), r.HI_str))) return false

    // C2 — o horário não existe na grade da profissional nessa data.
    //
    // A abstenção é por PROFISSIONAL, não por dia. Medido em 2026-09-10 na
    // janela 01/10→07/10: abster por dia deixava passar 71 slots, e conferindo
    // contra a API bruta da TiTa nenhum deles era sync parcial — a nossa cópia
    // batia 100% com a API. Eram ausências reais: profissional que tem grade em
    // três dias da semana e é ofertado nos outros. Abster por dia, ali, é só
    // reabrir o bug com outro nome.
    //
    // Já a ausência TOTAL do profissional na grade é ambígua: pode ser sync
    // parcial (ver o incidente de 01/09, em que o sync morria no primeiro bloco
    // e um bloco não-alcançado não gerava alerta nenhum) ou profissional que
    // simplesmente não tem mais grade. Como não há como distinguir os dois pelo
    // dado, a C2 se abstém e mantém a linha — esconder a agenda inteira de um
    // profissional por falha de carga é o erro mais caro dos dois.
    //
    // A exceção é o DESLIGADO, que não é ambíguo: a TiTa prefixa o nome com
    // "INATIVO-" (ver reference_desligamento_inativo_tita) e ninguém deve
    // receber oferta de quem saiu, com ou sem grade. Caso real medido em
    // 2026-09-10: 14517 INATIVO-Gabriela Pereira Ramos, 30 slots 'Livre'
    // ofertáveis e zero linha na grade em qualquer data. Nada mais no módulo
    // barra o prefixo — isProfBloqueadoTemp é uma lista fixa de dois nomes, não
    // um filtro de desligado — então a trava tem de estar aqui.
    if (isDesligado(r.Profissional)) return false
    if (!grade.profissionaisLidos.has(id)) return true
    return grade.naGrade.has(chaveData(id, data, r.HI_str))
  })
}
