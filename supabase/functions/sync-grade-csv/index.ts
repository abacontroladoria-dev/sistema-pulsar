// Sincroniza csv_grades_profissionais a partir da API csv_grade_profissionais da
// TiTa. Dois modos, dois crons, duas responsabilidades que não se misturam:
//
//   modo "grade"    (padrão)  hoje → fim do mês seguinte, UM DIA POR FATIA.
//                             Cuida da IDENTIDADE da sessão: insere o que é novo,
//                             versiona o que mudou, inativa o que sumiu.
//                             Cron sync-grade-csv-daily, 02:00 BRT.
//
//   modo "execucao"           hoje-45 → hoje, UM DIA POR FATIA.
//                             Cuida do que se SABE sobre a sessão: status real e
//                             evolução. Só faz UPDATE das colunas de execução, em
//                             linha que já existe. Nunca insere, nunca inativa.
//                             Cron sync-grade-execucao-daily, 04:00 BRT.
//
// ─── Por que UM DIA por fatia ─────────────────────────────────────────────────
//
// Até 2026-09-10 este cabeçalho dizia "fatias de 1 semana" e o laço NÃO EXISTIA:
// o handler fazia uma única chamada com a janela inteira (~60 dias, ~14 mil
// sessões). Não é carga que a Edge Function aguente — e o projeto já sabia
// disso. O backfill de outubro (supabase/snippets/20260901_backfill_outubro_dia_a_dia.sql)
// registra as duas tentativas anteriores: blocos de 7 dias morreram com
// 546 WORKER_RESOURCE_LIMIT, blocos de 4 dias também. Só um dia por chamada
// passou, e foi assim, à mão, 22 vezes, que outubro entrou.
//
// O efeito de não haver laço foi silencioso e durou 9 dias: o cron diário rodava,
// pedia 60 dias, morria, e ninguém via — `net.http_post` é assíncrono e descarta
// a resposta. Em 10/09/2026, na janela 01–07/10, isso valia 134 sessões reais
// invisíveis para a Ocupação de Paciente (57 pacientes) e 169 horários que a tela
// mostrava e já não existiam.
//
// Uma fatia que falha NÃO derruba as seguintes: cada dia é independente e o que
// falhou vem discriminado na resposta (HTTP 207). Abortar na primeira falha foi
// o que deixou outubro inteiro em zero.
//
// ─── Por que isto NÃO faz DELETE ──────────────────────────────────────────────
//
// Até 2026-08-05 esta function fazia DELETE do período + INSERT do que a TiTa
// devolvesse. O problema: a TiTa apaga agendamentos passados quando o cadastro
// muda — desligar um terapeuta remove retroativamente todos os atendimentos que
// ele já fez. Com DELETE+INSERT, bastava uma releitura de data passada para o
// histórico sumir do nosso lado também.
//
// Agora:
//   • a janela do modo "grade" nunca começa antes de hoje;
//   • não existe DELETE em caminho nenhum — sessão que a TiTa deixou de devolver
//     vira ativo = false, motivo_inativacao = 'excluido';
//   • sessão cujo conteúdo mudou não é sobrescrita: a versão antiga vira
//     ativo = false, motivo_inativacao = 'alterado', e a nova entra como linha
//     nova. Mesmo versionamento de agenda_tita (20260530000000).
//
// Além disso, o trigger trg_congelar_grade_passada (20260806100100) rejeita, em
// linha cuja data já passou, qualquer UPDATE que toque a identidade — e todo
// DELETE. Mesmo que algo aqui regrida, o banco não deixa o passado ser reescrito.
//
// ─── Por que o modo "execucao" existe ─────────────────────────────────────────
//
// A informação que decide o pagamento chega DEPOIS da sessão. Medido em junho de
// 2026 (7.981 evoluções): 75,8% no mesmo dia, p95 = 6 dias, p99 = 12, máximo 41.
// Uma janela de 45 dias cobriu 100% da cauda observada; 10 dias teriam perdido
// ~141 evoluções por mês. Como a linha já congelou quando a evolução nasce, o
// trigger precisou passar a distinguir identidade de execução — e é por isso que
// esta passada só pode escrever no segundo grupo.
//
// ─── Custo de escrita ─────────────────────────────────────────────────────────
//
// Nos dois modos, linha cujo conteúdo não mudou não gera escrita de conteúdo.
// Isso é deliberado: esta tabela já apareceu no diagnóstico de Disk IO do
// projeto, e reescrever ~14 mil linhas por dia só para reconfirmar os mesmos
// valores geraria WAL à toa.
//
// A única exceção é o carimbo `visto_em`, e ela é amortizada: só é renovado
// quando já passou de DIAS_REVALIDACAO, o que espalha o custo em ~1/7 por dia.
// Vale a pena porque sem esse carimbo não há como distinguir "a TiTa confirmou
// esta linha hoje" de "a TiTa parou de reportá-la" — e essa distinção é o que
// revela linha ativa órfã (44 delas em julho/2026).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TITA_TOKEN                = Deno.env.get("TITA_TOKEN")!

const UNIDADE = 280
const PAGINA  = 1000
const LOTE    = 500

/** Janela retroativa padrão do modo "execucao". Ver nota sobre o atraso medido. */
const DIAS_RECAPTURA = 45

/**
 * De quanto em quanto tempo uma linha inalterada tem o `visto_em` renovado.
 *
 * `visto_em` passou a significar "a última vez que a TiTa confirmou que esta
 * linha existe" — é o que permite identificar linha ativa que a TiTa não reporta
 * mais (medido em julho/2026: 44 delas). Renovar em TODA linha vista, todo dia,
 * seriam ~29 mil UPDATEs diários só de carimbo, exatamente o WAL que o desenho
 * desta função evita. Renovando só o que está velho, o custo cai a ~1/7 disso e o
 * sinal continua confiável: dentro da janela de 45 dias, `visto_em` mais antigo
 * que o dobro deste prazo significa que a TiTa parou de devolver a linha.
 */
const DIAS_REVALIDACAO = 7

/**
 * Piso de plausibilidade da resposta da TiTa, como fração do que está ativo na
 * janela. Abaixo disso a rodada insere, mas não inativa nada. Ver `sincronizarGrade`.
 */
const FRACAO_MINIMA_PLAUSIVEL = 0.8

type Modo = "grade" | "execucao"

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://127.0.0.1:3000",
  "https://orbitaautomacao.com.br",
]

function getCorsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin)
  return allowed
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      }
    : { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  })
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (c === "," && !inQuotes) {
      result.push(current.trim()); current = ""
    } else {
      current += c
    }
  }
  result.push(current.trim())
  return result
}

function toInt(s: string): number | null {
  const n = parseInt(s)
  return isNaN(n) ? null : n
}

function toTime(s: string): string | null {
  if (!s) return null
  // "08:00" ou "08:00:00"
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:00` : null
}

/**
 * Normaliza a data para ISO (YYYY-MM-DD).
 *
 * A versão anterior desta function gravava o valor cru do CSV direto na coluna
 * `date` e deixava o Postgres interpretar — funcionava, mas aqui a data passou a
 * ser COMPARADA em JavaScript (no recorte da janela e no diff contra o banco), e
 * comparação de string só é válida em ISO. Se a TiTa mudasse para dd/mm/aaaa,
 * sem esta normalização toda linha pareceria alterada e o sync inativaria e
 * reinseriria a grade inteira todos os dias. Aceita os dois formatos de
 * propósito, para não depender do que a API devolve hoje.
 */
function toDate(s: string): string | null {
  const t = (s || "").trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const br = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`
  // Formato desconhecido: devolve null em vez de arriscar gravar lixo numa
  // coluna date — a linha é descartada pelo filtro de janela e aparece na
  // contagem de descartados.
  return null
}

/**
 * Normaliza instante para ISO com fuso.
 *
 * A TiTa manda "2026-06-08 08:37:17" — horário de São Paulo, sem fuso declarado.
 * Sem anexar o offset, o Postgres interpretaria como UTC e toda tratativa
 * apareceria 3 horas adiantada. O -03:00 é constante: o Brasil não observa
 * horário de verão desde 2019.
 *
 * Aceita dd/mm/aaaa também, pela mesma razão defensiva de toDate(). Foi um
 * regex ancorado demais que fez o CCO gravar NULL em 2.862 de 2.862 tratativas
 * (cco-shared/logger.ts trata só `^\d{4}-\d{2}-\d{2}$`, e a hora no fim derruba
 * o casamento) — o erro custou dois meses de dado perdido, não vale repetir.
 */
function toTimestamp(s: string): string | null {
  const t = (s || "").trim()
  if (!t) return null

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (iso) {
    const [, a, m, d, hh, mm, ss] = iso
    return `${a}-${m}-${d}T${(hh ?? "00").padStart(2, "0")}:${mm ?? "00"}:${ss ?? "00"}-03:00`
  }

  const br = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (br) {
    const [, d, m, a, hh, mm, ss] = br
    return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${(hh ?? "00").padStart(2, "0")}:${mm ?? "00"}:${ss ?? "00"}-03:00`
  }

  return null
}

/** "Sim"/"Não" da TiTa. Vazio vira null — "não capturado" não é "não evoluiu". */
function toBool(s: string): boolean | null {
  const t = (s || "").trim().toLowerCase()
  if (!t) return null
  if (["sim", "s", "1", "true"].includes(t)) return true
  if (["não", "nao", "n", "0", "false"].includes(t)) return false
  return null
}

// ─── Janela ───────────────────────────────────────────────────────────────────

/** Data corrente em São Paulo — mesma referência do trigger de congelamento. */
function hojeSP(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
    .toISOString().slice(0, 10)
}

function fimPadrao(): string {
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
  return new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0).toISOString().slice(0, 10)
}

function diasAntes(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d - n)).toISOString().slice(0, 10)
}

/** Dia seguinte em ISO. UTC de propósito: aritmética de calendário, sem fuso. */
function diaSeguinte(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10)
}

/**
 * Os dias da janela, um a um. Ver a nota "Por que UM DIA por fatia" no topo.
 *
 * Fim de semana entra: a clínica não atende, a TiTa devolve vazio e a fatia
 * fecha em `total: 0`. Pular por dia da semana economizaria ~17 chamadas e
 * criaria uma regra de negócio escondida no laço — se algum dia houver
 * atendimento de sábado, ele sumiria calado.
 */
function diasDaJanela(inicio: string, fim: string): string[] {
  const dias: string[] = []
  for (let d = inicio; d <= fim; d = diaSeguinte(d)) dias.push(d)
  return dias
}

/**
 * Resolve a janela a sincronizar. Os dois modos têm limites opostos, e é isso
 * que os mantém sem se atropelar:
 *
 *   grade    — piso em hoje. Data passada é território congelado: mesmo que
 *              alguém peça explicitamente, não buscamos nem escrevemos lá.
 *              Devolve null se a janela pedida for inteiramente passada.
 *
 *   execucao — teto em hoje. O futuro não tem execução para registrar, e as
 *              linhas futuras já nascem com essas colunas preenchidas pelo modo
 *              grade. Devolve null se a janela pedida for inteiramente futura.
 */
function resolverJanela(body: { data_inicio?: string; data_fim?: string }, modo: Modo) {
  const hoje = hojeSP()

  if (modo === "execucao") {
    const pedido = body.data_inicio && body.data_fim
      ? { inicio: body.data_inicio, fim: body.data_fim }
      : { inicio: diasAntes(hoje, DIAS_RECAPTURA), fim: hoje }

    if (pedido.inicio > hoje) return null
    return { inicio: pedido.inicio, fim: pedido.fim > hoje ? hoje : pedido.fim, hoje }
  }

  const pedido = body.data_inicio && body.data_fim
    ? { inicio: body.data_inicio, fim: body.data_fim }
    : { inicio: hoje, fim: fimPadrao() }

  if (pedido.fim < hoje) return null
  return { inicio: pedido.inicio < hoje ? hoje : pedido.inicio, fim: pedido.fim, hoje }
}

// ─── Registro ─────────────────────────────────────────────────────────────────

/** Identidade da sessão: quem, quando, com quem, onde. Congelada no passado. */
interface Linha {
  tita_agendamento_id:   number | null
  paciente_id:           number | null
  paciente_nome:         string | null
  data:                  string | null
  dia_semana:            string | null
  hora_inicial:          string | null
  hora_final:            string | null
  profissional_id:       number | null
  profissional_nome:     string | null
  profissional_cpf:      string | null
  terapia_id:            number | null
  "Id Terapia":          string | null
  terapia_nome:          string | null
  terapia_exibicao_id:   number | null
  terapia_exibicao_nome: string | null
  sala_id:               number | null
  sala_nome:             string | null
  sala_observacoes:      string | null
  unidade_id:            number | null
  unidade_nome:          string | null
  convenio_nome:         string | null
  status_agendamento:    string | null
}

/** O que se sabe sobre a execução. Pode avançar mesmo em linha já congelada. */
interface Execucao {
  status_execucao:             string | null
  justificativa:               string | null
  possui_tratativa:            boolean | null
  tratativa_profissional_id:   number | null
  tratativa_profissional_nome: string | null
  tratativa_criada_em:         string | null
  tratativa_origem:            string | null
  evolucao_vinculo:            string | null
  descricao_evolucao:          string | null
  criado_em_tita:              string | null
  excluido_em_tita:            string | null
}

type Registro = Linha & Execucao

/**
 * Identidade de uma linha da grade.
 *
 * Agendamento marcado tem tita_agendamento_id, que é único por ocorrência (não
 * por série recorrente — validado em 14.244 linhas de junho/2026: 14.238 ids
 * distintos, e os 6 repetidos são linhas idênticas duplicadas), então ele É a
 * identidade.
 *
 * Linha sem id cai na coordenada física, que também não colide. São dois casos, e
 * medido em julho/2026 (4.243 linhas sem id): 4.233 slots 'Livre' e 10 evoluções
 * 'Sem Agendamento'. A afirmação antiga de que 100% eram 'Livre' era falsa — e
 * era ela que sustentava a decisão de ignorar linha sem id no passe de execução,
 * ver `chaveSemAgendamento`.
 */
function chave(r: Pick<Linha, "tita_agendamento_id" | "data" | "hora_inicial" | "profissional_id" | "terapia_id" | "sala_id">): string {
  if (r.tita_agendamento_id !== null && r.tita_agendamento_id !== undefined) {
    return `A:${r.tita_agendamento_id}`
  }
  return `L:${r.data}|${r.hora_inicial}|${r.profissional_id}|${r.terapia_id}|${r.sala_id}`
}

/**
 * Identidade de uma evolução que não tem agendamento por trás.
 *
 * A TiTa emite `Status do Agendamento = 'Sem Agendamento'` quando alguém evolui
 * um atendimento que nunca foi marcado: vem com paciente, profissional, terapia e
 * horário, mas `ID Agendamento` vazio. É o que a /rp classifica como "Evolução
 * sem agendamento" — não paga nada, e é justamente por isso que precisa aparecer.
 *
 * A sala fica FORA da chave, ao contrário de `chave()`: nessas linhas o `Id Sala`
 * vem como "Ainda não selecionado" (null depois do parse) e o nome da sala é
 * texto livre digitado por quem evoluiu — a mesma sessão apareceu como "sala 13"
 * numa semana e "Sala 13" na outra. Paciente entra no lugar dela, e é mais
 * discriminante: dois atendimentos no mesmo horário, com o mesmo profissional, na
 * mesma terapia e com o mesmo paciente seriam a mesma sessão de qualquer forma.
 */
function chaveSemAgendamento(
  r: Pick<Linha, "data" | "hora_inicial" | "profissional_id" | "terapia_id" | "paciente_id">,
): string {
  return `S:${r.data}|${r.hora_inicial}|${r.profissional_id}|${r.terapia_id}|${r.paciente_id}`
}

const SEM_AGENDAMENTO = "Sem Agendamento"

/**
 * Campos que definem o "conteúdo" de uma linha para efeito de versionamento. Se
 * algum deles mudar, a versão antiga é inativada como 'alterado' e uma nova entra.
 *
 * As colunas de execução ficam DE FORA de propósito, e isso é importante: se
 * estivessem aqui, toda evolução registrada inativaria a sessão e criaria uma
 * versão nova da linha — a mesma sessão apareceria duas vezes no histórico só
 * porque alguém escreveu a evolução dela. Execução não é uma nova versão da
 * sessão; é informação nova sobre a mesma sessão, e por isso é UPDATE (modo
 * "execucao"), não versionamento.
 */
const CAMPOS_CONTEUDO: (keyof Linha)[] = [
  "paciente_id", "paciente_nome", "data", "dia_semana", "hora_inicial", "hora_final",
  "profissional_id", "profissional_nome", "profissional_cpf",
  "terapia_id", "Id Terapia", "terapia_nome", "terapia_exibicao_id", "terapia_exibicao_nome",
  "sala_id", "sala_nome", "sala_observacoes",
  "unidade_id", "unidade_nome", "convenio_nome", "status_agendamento",
]

const CAMPOS_EXECUCAO: (keyof Execucao)[] = [
  "status_execucao", "justificativa", "possui_tratativa",
  "tratativa_profissional_id", "tratativa_profissional_nome", "tratativa_criada_em",
  "tratativa_origem", "evolucao_vinculo", "descricao_evolucao",
  "criado_em_tita", "excluido_em_tita",
]

/** Os três campos de instante voltam do banco noutro offset; comparar texto acusaria diferença sempre. */
const CAMPOS_INSTANTE = new Set<keyof Execucao>([
  "tratativa_criada_em", "criado_em_tita", "excluido_em_tita",
])

function mudou(a: Linha, b: Linha): boolean {
  return CAMPOS_CONTEUDO.some(c => (a[c] ?? null) !== (b[c] ?? null))
}

/**
 * Compara o bloco de execução.
 *
 * Os timestamps precisam de comparação por instante, não por string: gravamos
 * "2026-06-08T08:37:17-03:00" e o PostgREST devolve "2026-06-08T11:37:17+00:00".
 * São o mesmo momento; comparados como texto, divergiriam todo dia e o sync
 * reescreveria a tabela inteira a cada execução — exatamente o custo de WAL que
 * este desenho existe para evitar.
 */
function mudouExecucao(atual: Partial<Execucao>, novo: Execucao): boolean {
  return CAMPOS_EXECUCAO.some(c => {
    const a = atual[c] ?? null
    const b = novo[c] ?? null
    if (CAMPOS_INSTANTE.has(c)) {
      if (a === null || b === null) return a !== b
      return new Date(a as string).getTime() !== new Date(b as string).getTime()
    }
    return a !== b
  })
}

// ─── Banco ────────────────────────────────────────────────────────────────────

/**
 * Repete uma chamada que falhou por motivo transitório.
 *
 * Uma execução faz mais de uma dezena de idas ao PostgREST (a paginação do
 * select, mais um POST por lote da RPC). Medido em produção em 2026-08-06: sem
 * isto, um blip em qualquer uma delas derrubava a fatia inteira — três das nove
 * fatias do backfill falharam na primeira tentativa e passaram na seguinte, sem
 * nada ter mudado.
 *
 * Erro de rede e 5xx/429 são retentados; 4xx não, porque significa pedido
 * errado e repetir só multiplica o mesmo erro.
 */
async function comRetentativa<T>(rotulo: string, fn: () => Promise<T>, tentativas = 4): Promise<T> {
  let ultimo: unknown
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = e
      const msg = e instanceof Error ? e.message : String(e)
      if (/\b4\d\d\b/.test(msg) && !/\b(408|429)\b/.test(msg)) throw e
      if (i === tentativas - 1) break
      const espera = 500 * Math.pow(2, i)
      console.warn(`[sync-grade-csv] ${rotulo}: tentativa ${i + 1} falhou (${msg}); repetindo em ${espera}ms`)
      await new Promise(r => setTimeout(r, espera))
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo))
}

// PostgREST exige aspas no select para identificador com espaço ("Id Terapia").
const qcol = (nome: string) => (nome.includes(" ") ? `"${nome}"` : nome)

const CAMPOS_SELECT = ["id", ...CAMPOS_CONTEUDO.map(qcol), "tita_agendamento_id"].join(", ")
const CAMPOS_SELECT_EXECUCAO = [
  "id", "tita_agendamento_id", "visto_em",
  // Agregados por agendamento, não campos do Registro — ver a contagem em
  // sincronizarExecucao. Precisam vir no select para o sync saber se mudaram.
  "tratativas", "tratativas_distintas",
  // Coordenada física: é por ela que a evolução "Sem Agendamento" encontra a
  // linha, já que essa não tem id nenhum dos dois lados. `status_agendamento`
  // entra junto para desempatar candidatas na mesma coordenada.
  "data", "hora_inicial", "profissional_id", "terapia_id", "paciente_id", "status_agendamento",
  ...CAMPOS_EXECUCAO,
].join(", ")

async function carregarPorAtividade<T>(
  sb: SupabaseClient, inicio: string, fim: string, campos: string, ativo: boolean,
): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const lote = await comRetentativa(`select ${ativo ? "ativas" : "inativas"} ${de}`, async () => {
      const { data, error } = await sb
        .from("csv_grades_profissionais")
        .select(campos)
        .gte("data", inicio)
        .lte("data", fim)
        .eq("ativo", ativo)
        .order("id")
        .range(de, de + PAGINA - 1)

      if (error) throw new Error(`select: ${error.message}`)
      return (data ?? []) as unknown as T[]
    })
    todas.push(...lote)
    if (lote.length < PAGINA) return todas
  }
}

const carregarAtivas = <T>(sb: SupabaseClient, inicio: string, fim: string, campos: string) =>
  carregarPorAtividade<T>(sb, inicio, fim, campos, true)

const carregarInativas = <T>(sb: SupabaseClient, inicio: string, fim: string, campos: string) =>
  carregarPorAtividade<T>(sb, inicio, fim, campos, false)

async function inserir(sb: SupabaseClient, linhas: Record<string, unknown>[]) {
  for (let i = 0; i < linhas.length; i += LOTE) {
    await comRetentativa(`insert lote ${i / LOTE}`, async () => {
      const { error } = await sb.from("csv_grades_profissionais").insert(linhas.slice(i, i + LOTE))
      if (error) throw new Error(`insert: ${error.message}`)
    })
  }
}

async function inativar(sb: SupabaseClient, ids: string[], motivo: "alterado" | "excluido") {
  const agora = new Date().toISOString()
  for (let i = 0; i < ids.length; i += LOTE) {
    await comRetentativa(`inativar(${motivo}) lote ${i / LOTE}`, async () => {
      const { error } = await sb
        .from("csv_grades_profissionais")
        // `inativado_em` é o carimbo que faltava: sem ele não havia como datar uma
        // baixa depois do fato. updated_at não serve — não há trigger que o
        // atualize nesta tabela, então ele marca a última escrita de conteúdo.
        .update({ ativo: false, motivo_inativacao: motivo, inativado_em: agora })
        .in("id", ids.slice(i, i + LOTE))
      if (error) throw new Error(`inativar(${motivo}): ${error.message}`)
    })
  }
}

/**
 * Desfaz uma inativação: a TiTa continua reportando a sessão, então a linha nunca
 * deveria ter saído da grade.
 *
 * Permitido no passado desde 20260806120000. A assimetria é de propósito — o
 * congelamento existe para impedir baixa retroativa (a TiTa apaga agendamento
 * passado quando um terapeuta é desligado), e reativar é o oposto disso.
 */
async function reativar(sb: SupabaseClient, ids: string[]) {
  for (let i = 0; i < ids.length; i += LOTE) {
    await comRetentativa(`reativar lote ${i / LOTE}`, async () => {
      const { error } = await sb
        .from("csv_grades_profissionais")
        .update({ ativo: true, motivo_inativacao: null, inativado_em: null, ausencia_confirmada_em: null })
        .in("id", ids.slice(i, i + LOTE))
      if (error) throw new Error(`reativar: ${error.message}`)
    })
  }
}

/**
 * Registra que a TiTa foi consultada para a janela desta linha e não a devolveu.
 *
 * É o outro lado da reconciliação, e o que impede o guarda da remuneração de
 * virar alarme permanente. Sem isto, uma alta de paciente — que retira dezenas
 * de sessões futuras de uma vez, legitimamente — deixaria o cálculo bloqueado
 * para sempre naquele mês. Carimbada uma vez, a linha é exclusão confirmada e
 * para de contar; se ela voltar a aparecer na TiTa, `reativar` limpa o carimbo.
 */
async function confirmarAusencia(sb: SupabaseClient, ids: string[], agora: string) {
  for (let i = 0; i < ids.length; i += LOTE) {
    await comRetentativa(`confirmarAusencia lote ${i / LOTE}`, async () => {
      const { error } = await sb
        .from("csv_grades_profissionais")
        .update({ ausencia_confirmada_em: agora })
        .in("id", ids.slice(i, i + LOTE))
      if (error) throw new Error(`confirmarAusencia: ${error.message}`)
    })
  }
}

/** Renova o "a TiTa confirmou que esta linha existe". Ver DIAS_REVALIDACAO. */
async function marcarVistas(sb: SupabaseClient, ids: string[], agora: string) {
  for (let i = 0; i < ids.length; i += LOTE) {
    await comRetentativa(`marcarVistas lote ${i / LOTE}`, async () => {
      const { error } = await sb
        .from("csv_grades_profissionais")
        .update({ visto_em: agora })
        .in("id", ids.slice(i, i + LOTE))
      if (error) throw new Error(`marcarVistas: ${error.message}`)
    })
  }
}

async function aplicarExecucao(sb: SupabaseClient, linhas: Record<string, unknown>[]): Promise<number> {
  let total = 0
  for (let i = 0; i < linhas.length; i += LOTE) {
    total += await comRetentativa(`execucao lote ${i / LOTE}`, async () => {
      const { data, error } = await sb.rpc("fn_aplicar_execucao_grade", {
        p_linhas: linhas.slice(i, i + LOTE),
      })
      if (error) throw new Error(`fn_aplicar_execucao_grade: ${error.message}`)
      return (data as number) ?? 0
    })
  }
  return total
}

// ─── TiTa ─────────────────────────────────────────────────────────────────────

async function buscarRegistros(dataInicio: string, dataFim: string): Promise<Registro[] | null> {
  const resp = await fetch("https://apiv2.apptita.com.br/api/integracao/csv_grade_profissionais", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-INTEGRACAO-TOKEN": TITA_TOKEN },
    body: JSON.stringify({ data_inicio: dataInicio, data_fim: dataFim, unidade: UNIDADE }),
  })

  if (!resp.ok) throw new Error(`TITA API retornou ${resp.status}`)

  const csvText = await resp.text()
  const lines   = csvText.trim().split("\n")
  if (lines.length < 2) return null

  // Cabeçalhos em minúsculas, com acento e sem BOM — é assim que a TiTa manda.
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^﻿/, "").trim().toLowerCase())
  const col     = (name: string) => headers.indexOf(name)

  const iAgId    = col("id agendamento")
  const iPacId   = col("id favorecido")
  const iPacNome = col("nome favorecido")
  const iData    = col("data")
  const iDiaSem  = col("dia da semana")
  const iHoraIni = col("hora inicial")
  const iHoraFim = col("hora final")
  const iProfId  = col("id profissional")
  const iProfNom = col("profissional")
  const iProfCpf = col("cpf do profissional")
  const iTerID   = col("id terapia")
  const iTerNom  = col("terapia")
  const iTerExId = col("id terapia exibição")
  const iTerExNm = col("terapia exibição")
  const iSalaId  = col("id sala")
  const iSalaNom = col("sala")
  const iSalaObs = col("observações da sala")
  const iUniId   = col("id unidade")
  const iUniNom  = col("nome unidade")
  const iConv    = col("convênio")

  // Duas colunas de status, e a diferença importa: "status do agendamento" diz se
  // o horário está ocupado (Agendado/Livre); "status" diz o que aconteceu
  // (Realizado/Cancelado/Em Conflito/Planejado-Pendente). O fallback abaixo
  // preserva o comportamento antigo caso a primeira suma da API.
  const iStatusAg   = col("status do agendamento") >= 0 ? col("status do agendamento") : col("status")
  const iStatusExec = col("status")
  const iJust       = col("justificativa")
  const iPossuiTrat = col("possui tratativa")
  const iTratProfId = col("id profissional tratativa")
  const iTratProfNm = col("nome profissional tratativa")
  const iTratCriac  = col("criação tratativa")
  const iTratOrig   = col("origem tratativa")
  const iVinculo    = col("vínculo da evolução")
  const iCriadoEm   = col("agendamento criado em")
  const iExcluidoEm = col("agendamento excluído em")

  // O texto que o profissional escreve depois de atender. Apareceu em setembro/2026
  // como 43ª coluna e vinha sendo descartada em silêncio — o lookup é por nome, e o
  // que não está nesta lista não é lido. O cabeçalho vem acentuado (conferido na API
  // em 2026-09-09); a variante sem acento é defensiva, porque este `col()` compara
  // string crua, sem normalizar NFD como o cco-sync-tita-sessions faz.
  const iDescEvol = col("descrição da evolução") >= 0
    ? col("descrição da evolução")
    : col("descricao da evolucao")

  const v = (vals: string[], i: number) => (i >= 0 ? vals[i]?.trim() ?? "" : "")

  const registros: Registro[] = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i])
    if (vals.every(x => !x)) continue
    registros.push({
      tita_agendamento_id:   toInt(v(vals, iAgId)),
      paciente_id:           toInt(v(vals, iPacId)),
      paciente_nome:         v(vals, iPacNome) || null,
      data:                  toDate(v(vals, iData)),
      dia_semana:            v(vals, iDiaSem)  || null,
      hora_inicial:          toTime(v(vals, iHoraIni)),
      hora_final:            toTime(v(vals, iHoraFim)),
      profissional_id:       toInt(v(vals, iProfId)),
      profissional_nome:     v(vals, iProfNom) || null,
      profissional_cpf:      v(vals, iProfCpf) || null,
      terapia_id:            toInt(v(vals, iTerID)),
      "Id Terapia":          v(vals, iTerID)   || null,
      terapia_nome:          v(vals, iTerNom)  || null,
      terapia_exibicao_id:   toInt(v(vals, iTerExId)),
      terapia_exibicao_nome: v(vals, iTerExNm) || null,
      sala_id:               toInt(v(vals, iSalaId)),
      sala_nome:             v(vals, iSalaNom) || null,
      sala_observacoes:      v(vals, iSalaObs) || null,
      unidade_id:            toInt(v(vals, iUniId)),
      unidade_nome:          v(vals, iUniNom)  || null,
      convenio_nome:         v(vals, iConv)    || null,
      status_agendamento:    v(vals, iStatusAg) || null,

      status_execucao:             v(vals, iStatusExec) || null,
      justificativa:               v(vals, iJust)       || null,
      possui_tratativa:            toBool(v(vals, iPossuiTrat)),
      tratativa_profissional_id:   toInt(v(vals, iTratProfId)),
      tratativa_profissional_nome: v(vals, iTratProfNm) || null,
      tratativa_criada_em:         toTimestamp(v(vals, iTratCriac)),
      tratativa_origem:            v(vals, iTratOrig)   || null,
      evolucao_vinculo:            v(vals, iVinculo)    || null,
      descricao_evolucao:          v(vals, iDescEvol)   || null,
      criado_em_tita:              toTimestamp(v(vals, iCriadoEm)),
      excluido_em_tita:            toTimestamp(v(vals, iExcluidoEm)),
    })
  }
  return registros
}

// ─── Modo "grade" ─────────────────────────────────────────────────────────────

async function sincronizarGrade(
  sb: SupabaseClient, recebidos: Registro[], dataInicio: string, dataFim: string, hoje: string,
) {
  // A TiTa pode devolver dias fora do range pedido; fora da janela não escrevemos,
  // e abaixo de hoje muito menos (o trigger rejeitaria, e é a regra do projeto).
  // Também cai aqui qualquer linha cuja data não pôde ser normalizada (toDate).
  const naJanela    = recebidos.filter(r => r.data && r.data >= dataInicio && r.data <= dataFim)
  const descartados = recebidos.length - naJanela.length

  const existentes = await carregarAtivas<Linha & { id: string }>(sb, dataInicio, dataFim, CAMPOS_SELECT)

  const porChaveExistente = new Map<string, Linha & { id: string }>()
  for (const e of existentes) porChaveExistente.set(chave(e), e)

  const aInserir: Record<string, unknown>[] = []
  const idsAlterados: string[] = []
  const vistos = new Set<string>()
  const agora  = new Date().toISOString()

  for (const r of naJanela) {
    const k = chave(r)
    // Linha repetida dentro do mesmo CSV: já tratada nesta rodada.
    if (vistos.has(k)) continue
    vistos.add(k)

    const atual = porChaveExistente.get(k)
    if (!atual) {
      aInserir.push({ ...r, ativo: true, origem: "tita_csv", visto_em: agora })
      continue
    }
    if (mudou(atual, r)) {
      idsAlterados.push(atual.id)
      aInserir.push({ ...r, ativo: true, origem: "tita_csv", visto_em: agora })
    }
    // idêntica → nenhuma escrita
  }

  // O que estava ativo na janela e não veio mais da TiTa foi removido lá.
  //
  // Sessão remarcada para outra data cai aqui como 'excluido' nesta fatia e é
  // reinserida como linha nova na fatia da data de destino — a chave (o
  // tita_agendamento_id) sobrevive à mudança, mas as duas fatias são chamadas
  // independentes e não se enxergam. O saldo é correto (uma versão inativa, uma
  // ativa); só o motivo fica 'excluido' em vez de 'alterado'.
  //
  // ─── Duas guardas, pagas em julho/2026 ────────────────────────────────────
  //
  // Este trecho custou R$ 490,00 na primeira conferência da /rp lendo o banco.
  // Das 43 linhas de julho que ele havia inativado, **as 43 continuavam sendo
  // reportadas pela TiTa** — 100% de falso positivo, 25 delas em sessão já
  // realizada e evoluída, ou seja dinheiro que sumiu calado da folha.
  //
  // (1) Nunca inativar no PRÓPRIO DIA da sessão. A auto-cura descrita acima só
  //     funciona enquanto a data ainda é >= hoje, porque o piso da janela é
  //     hoje: para uma linha de hoje, esta é a última rodada que a enxerga, e o
  //     engano vira permanente. Cancelamento real do dia não se perde — chega
  //     depois como status_execucao = 'Cancelado' pela passada de execução, que
  //     é a representação correta de "a sessão não aconteceu".
  //
  // (2) Nunca inativar com base em resposta implausível. "Não veio na resposta"
  //     só significa "foi apagado lá" se a resposta estiver inteira. Numa
  //     resposta truncada, inativar é destruir. Inserir continua liberado: dado
  //     a mais nunca foi o risco.
  //
  //     A guarda é uma RAZÃO (recebidos < ativos × FRACAO_MINIMA_PLAUSIVEL), não
  //     um número absoluto, então vale igual em qualquer tamanho de janela. Com
  //     uma fatia por dia ela ficou mais sensível, não menos: antes um dia
  //     truncado se diluía entre os outros 59 da janela e passava do piso; agora
  //     é avaliado sozinho, contra os ~800 ativos daquele dia.
  const naoVieram   = existentes.filter(e => !vistos.has(chave(e)))
  const protegidas  = naoVieram.filter(e => e.data === hoje).length
  const candidatas  = naoVieram.filter(e => e.data !== hoje).map(e => e.id)

  const respostaMagra = existentes.length > 0
    && naJanela.length < existentes.length * FRACAO_MINIMA_PLAUSIVEL
  if (respostaMagra) {
    console.warn(
      `[sync-grade-csv] resposta implausível para ${dataInicio}..${dataFim}: `
      + `${naJanela.length} linhas para ${existentes.length} ativas. Inserindo, mas NÃO inativando.`,
    )
  }
  const idsExcluidos = respostaMagra ? [] : candidatas

  // Ordem: inativa antes de inserir, para que uma consulta concorrente nunca veja
  // as duas versões da mesma sessão como ativas ao mesmo tempo — duplicata
  // inflaria silenciosamente qualquer contagem, enquanto uma lacuna momentânea é
  // evidente.
  //
  // Não há transação entre as chamadas. Se a execução morrer no meio, a fatia
  // fica com linhas inativadas e sem substituta até a próxima rodada, que
  // conserta sozinha (o registro volta a chegar da TiTa e não existe mais ativo
  // no banco, então é inserido). Nada é perdido de forma definitiva em nenhum
  // cenário — que era exatamente o risco do DELETE+INSERT anterior.
  if (idsAlterados.length) await inativar(sb, idsAlterados, "alterado")
  if (idsExcluidos.length) await inativar(sb, idsExcluidos, "excluido")
  if (aInserir.length)     await inserir(sb, aInserir)

  return {
    modo: "grade" as const,
    recebidos:   naJanela.length,
    descartados,
    existentes:  existentes.length,
    inseridos:   aInserir.length,
    alterados:   idsAlterados.length,
    excluidos:   idsExcluidos.length,
    inalterados: naJanela.length - aInserir.length,
    // Não vieram na resposta e mesmo assim continuam ativas. Não é erro: são
    // exatamente as duas guardas agindo. Se `naoInativadasPorSuspeita` aparecer
    // com frequência, a resposta da TiTa está vindo curta e é isso que precisa
    // de conserto — não a inativação.
    protegidasDoDia:            protegidas,
    naoInativadasPorSuspeita:   respostaMagra ? candidatas.length : 0,
  }
}

// ─── Modo "execucao" ──────────────────────────────────────────────────────────

async function sincronizarExecucao(
  sb: SupabaseClient, recebidos: Registro[], dataInicio: string, dataFim: string,
) {
  const naJanela = recebidos.filter(r => r.data && r.data >= dataInicio && r.data <= dataFim)

  // Casamento por tita_agendamento_id, com uma exceção tratada logo abaixo:
  // evolução 'Sem Agendamento' não tem id e mesmo assim tem tratativa.
  const porId = new Map<number, Registro>()
  // Quantas linhas a TiTa devolveu por agendamento e de quantas pessoas.
  //
  // O relatório emite uma linha por TRATATIVA, não por agendamento: evoluir a
  // mesma sessão duas vezes produz dois registros com o mesmo id. Guardar só o
  // último (que é o que `porId` faz, e continua fazendo) perdia essa informação
  // — e com ela a diferença entre "a mesma pessoa salvou de novo" e "duas
  // pessoas dizem ter atendido". A segunda decide pagamento, então precisa
  // chegar ao frontend em vez de morrer aqui.
  const contagem = new Map<number, { total: number; pessoas: Set<string> }>()

  // O outro índice: evolução sem agendamento, casada por coordenada. Só entra
  // aqui quem tem tratativa — slot 'Livre' também não tem id, e indexá-lo faria
  // um horário vago competir com um atendimento real pela mesma chave.
  const porCoordenada = new Map<string, Registro>()
  const contagemCoord = new Map<string, { total: number; pessoas: Set<string> }>()

  for (const r of naJanela) {
    if (r.tita_agendamento_id === null) {
      if (r.possui_tratativa !== true || r.paciente_id === null) continue
      const k = chaveSemAgendamento(r)
      porCoordenada.set(k, r)
      const cc = contagemCoord.get(k) ?? { total: 0, pessoas: new Set<string>() }
      cc.total++
      const autor = r.tratativa_profissional_id !== null && r.tratativa_profissional_id !== undefined
        ? String(r.tratativa_profissional_id)
        : (r.tratativa_profissional_nome ?? "").trim()
      if (autor) cc.pessoas.add(autor)
      contagemCoord.set(k, cc)
      continue
    }
    porId.set(r.tita_agendamento_id, r)

    const c = contagem.get(r.tita_agendamento_id) ?? { total: 0, pessoas: new Set<string>() }
    c.total++
    // Id quando existe; nome quando não. Linha sem tratativa nenhuma não conta
    // pessoa — senão uma sessão não evoluída pareceria ter autor.
    const quem = r.tratativa_profissional_id !== null && r.tratativa_profissional_id !== undefined
      ? String(r.tratativa_profissional_id)
      : (r.tratativa_profissional_nome ?? "").trim()
    if (quem) c.pessoas.add(quem)
    contagem.set(r.tita_agendamento_id, c)
  }

  type LinhaExec = Execucao & {
    id: string; tita_agendamento_id: number | null; visto_em: string | null
    tratativas: number | null; tratativas_distintas: number | null
    data: string | null; hora_inicial: string | null; status_agendamento: string | null
    profissional_id: number | null; terapia_id: number | null; paciente_id: number | null
  }
  const existentes = await carregarAtivas<LinhaExec>(sb, dataInicio, dataFim, CAMPOS_SELECT_EXECUCAO)

  // Qual linha recebe cada evolução sem agendamento, decidido ANTES do laço.
  //
  // Sem isto a coordenada seria ambígua: só na janela de 45 dias há 4.147 linhas
  // semeadas do backup XLS que também não têm id e também têm paciente, e uma
  // delas pode cair na mesma coordenada. Duas linhas casando com a mesma evolução
  // gravariam a mesma tratativa duas vezes — e "duas tratativas" é justamente o
  // sinal que o frontend usa para decidir conflito de autoria.
  //
  // Ganha a linha que a própria TiTa marcou 'Sem Agendamento'; empate real cai na
  // ordem do select, que é estável (order=id).
  const donaDaCoordenada = new Map<string, LinhaExec>()
  if (porCoordenada.size) {
    for (const e of existentes) {
      if (e.tita_agendamento_id !== null || e.paciente_id === null) continue
      const k = chaveSemAgendamento(e)
      if (!porCoordenada.has(k)) continue
      const atual = donaDaCoordenada.get(k)
      if (!atual || (e.status_agendamento === SEM_AGENDAMENTO && atual.status_agendamento !== SEM_AGENDAMENTO)) {
        donaDaCoordenada.set(k, e)
      }
    }
  }

  const aAtualizar: Record<string, unknown>[] = []
  const idsRevalidar: string[] = []
  const casados = new Set<number>()
  const coordCasadas = new Set<string>()
  const agora = new Date().toISOString()
  const limiteRevalidacao = diasAntes(hojeSP(), DIAS_REVALIDACAO)
  let semId = 0
  let semCorrespondencia = 0

  for (const e of existentes) {
    // Duas formas de casar, nesta ordem. Pelo id, que é a identidade real. Pela
    // coordenada só quando não há id dos dois lados — evolução 'Sem Agendamento'
    // é o único caso, e sem isto ela nunca chega ao banco.
    let novo: Registro | undefined
    let cont: { total: number; pessoas: Set<string> } | undefined

    if (e.tita_agendamento_id === null) {
      // Fora a evolução sem agendamento, linha sem id é cega para esta passada:
      // são as semeadas do backup XLS (origem='backup_xls'), que nunca tiveram
      // id, e os slots 'Livre'. Fica contabilizado à parte de propósito — é a
      // métrica que diz quanto da janela esta passada consegue enxergar, e some
      // sozinha conforme a janela de 45 dias avança para além do período semeado.
      const k = e.paciente_id === null ? null : chaveSemAgendamento(e)
      if (k === null || donaDaCoordenada.get(k)?.id !== e.id) { semId++; continue }
      novo = porCoordenada.get(k)
      if (!novo) { semId++; continue }
      coordCasadas.add(k)
      cont = contagemCoord.get(k)
    } else {
      novo = porId.get(e.tita_agendamento_id)
      if (!novo) {
        // A TiTa não devolveu esta linha. Não limpamos nada: valor capturado
        // antes continua valendo. Zerar aqui apagaria evolução já registrada só
        // porque a sessão saiu da agenda — que é o oposto do que este sistema
        // existe para fazer.
        semCorrespondencia++
        continue
      }
      casados.add(e.tita_agendamento_id)
      cont = contagem.get(e.tita_agendamento_id)
    }

    // A TiTa confirmou que a linha existe. Renovar o carimbo em TODAS elas todo
    // dia seriam ~29 mil UPDATEs só de data; renovando só o que já está velho, o
    // sinal continua servindo para achar linha órfã e o custo fica em ~1/7.
    if (!e.visto_em || e.visto_em.slice(0, 10) < limiteRevalidacao) idsRevalidar.push(e.id)

    // A contagem é agregada (vem do conjunto de linhas do agendamento, não de
    // uma linha só), então fica fora de `mudouExecucao`, que compara campo a
    // campo do Registro. Sem este teste, um agendamento que ganhou uma segunda
    // evolução mas cujo bloco de execução ficou idêntico — exatamente o duplo
    // clique — nunca seria gravado.
    const tratativas = cont ? cont.total : 1
    const tratativasDistintas = cont ? Math.max(cont.pessoas.size, 1) : 1
    const mudouContagem = (e.tratativas ?? null) !== tratativas
      || (e.tratativas_distintas ?? null) !== tratativasDistintas

    if (!mudouExecucao(e, novo) && !mudouContagem) continue

    aAtualizar.push({
      id: e.id,
      status_execucao:             novo.status_execucao,
      justificativa:               novo.justificativa,
      possui_tratativa:            novo.possui_tratativa,
      tratativa_profissional_id:   novo.tratativa_profissional_id,
      tratativa_profissional_nome: novo.tratativa_profissional_nome,
      tratativa_criada_em:         novo.tratativa_criada_em,
      tratativa_origem:            novo.tratativa_origem,
      tratativas,
      tratativas_distintas:        tratativasDistintas,
      evolucao_vinculo:            novo.evolucao_vinculo,
      descricao_evolucao:          novo.descricao_evolucao,
      criado_em_tita:              novo.criado_em_tita,
      excluido_em_tita:            novo.excluido_em_tita,
    })
  }

  // ─── Reconciliação: o sentido TiTa → linha ────────────────────────────────
  //
  // O laço acima só pergunta "para cada linha minha, o que a TiTa diz?". Nunca
  // perguntou o contrário — e é exatamente aí que moravam os R$ 490,00 de julho:
  // 23 sessões que a TiTa reportava como realizadas e evoluídas estavam com
  // ativo = false no banco, e 2 nunca chegaram a ser inseridas. Todas dentro
  // desta janela de 45 dias, todas visíveis nesta resposta, e invisíveis para o
  // laço acima porque ele parte das linhas que existem.
  //
  // Esta passada é o mecanismo de auto-cura que o modo "grade" não pode ter: lá
  // o piso é hoje, aqui a janela olha 45 dias para trás. Roda todo dia, então um
  // engano dura no máximo 24h — e nunca mais do que a janela.
  const orfas = [...porId.entries()].filter(([id]) => !casados.has(id))

  let reativadas = 0
  let inseridasRetroativas = 0
  let ausenciasConfirmadas = 0

  // Carregadas sempre, e não só quando há órfã: a reconciliação tem dois lados.
  // Repor o que a TiTa ainda reporta é um; carimbar o que ela confirma não ter
  // mais é o outro, e é o que faz o alarme do guarda apagar sozinho.
  type LinhaInativa = { id: string; tita_agendamento_id: number | null; data: string | null; ausencia_confirmada_em: string | null }
  const inativas = await carregarInativas<LinhaInativa>(
    sb, dataInicio, dataFim, "id, tita_agendamento_id, data, ausencia_confirmada_em",
  )

  if (orfas.length) {
    // Chave id+data, não id sozinho. Uma sessão remarcada deixa versão inativa na
    // data de origem E na de destino com o MESMO tita_agendamento_id; casar só
    // pelo id reativaria uma delas ao acaso e ressuscitaria a sessão no dia
    // errado. Se não houver inativa na data que a TiTa afirma, o certo é inserir
    // ali — `casados` já garantiu que não existe nenhuma ativa com esse id na
    // janela, então não há risco de duplicar.
    const inativaPorIdData = new Map<string, string>()
    for (const i of inativas) {
      if (i.tita_agendamento_id === null) continue
      const k = `${i.tita_agendamento_id}|${i.data}`
      if (!inativaPorIdData.has(k)) inativaPorIdData.set(k, i.id)
    }

    const idsReativar: string[] = []
    const aInserir: Record<string, unknown>[] = []
    const execucaoDasReativadas: Record<string, unknown>[] = []

    for (const [titaId, r] of orfas) {
      const uuidInativo = inativaPorIdData.get(`${titaId}|${r.data}`)
      if (uuidInativo) {
        // Existe e foi escondida. Desfazer a inativação preserva a identidade
        // original — inserir uma segunda linha faria o histórico afirmar que a
        // sessão foi alterada e recriada, o que não aconteceu.
        idsReativar.push(uuidInativo)
        execucaoDasReativadas.push({
          id: uuidInativo,
          status_execucao:             r.status_execucao,
          justificativa:               r.justificativa,
          possui_tratativa:            r.possui_tratativa,
          tratativa_profissional_id:   r.tratativa_profissional_id,
          tratativa_profissional_nome: r.tratativa_profissional_nome,
          tratativa_criada_em:         r.tratativa_criada_em,
          tratativa_origem:            r.tratativa_origem,
          evolucao_vinculo:            r.evolucao_vinculo,
          descricao_evolucao:          r.descricao_evolucao,
          criado_em_tita:              r.criado_em_tita,
          excluido_em_tita:            r.excluido_em_tita,
        })
      } else {
        // Nunca entrou. Acontece com sessão criada na TiTa depois da rodada do
        // modo "grade" do próprio dia: a janela daquele modo nunca mais desce
        // até lá. INSERT é livre em qualquer data (o congelamento protege UPDATE
        // e DELETE), então aqui é o único lugar do sistema que consegue repor.
        inseridasRetroativas++
        aInserir.push({ ...r, ativo: true, origem: "tita_csv", visto_em: agora })
      }
    }

    if (idsReativar.length) {
      await reativar(sb, idsReativar)
      reativadas = idsReativar.length
      // Depois de reativar, e não antes: a linha precisa estar de volta na grade
      // para a execução ter onde pousar.
      await aplicarExecucao(sb, execucaoDasReativadas)
    }
    if (aInserir.length) await inserir(sb, aInserir)
  }

  // Evolução sem agendamento que não achou linha nenhuma. Nasce depois do fato —
  // alguém evolui hoje um atendimento que nunca foi marcado — e o modo "grade"
  // tem piso em hoje, então a partir do dia seguinte nenhuma passada consegue
  // inseri-la. Esta é a única porta. Medido em julho/2026: das 10 evoluções sem
  // agendamento, 9 tinham linha (com execução vazia) e 1 não tinha nada.
  const semAgendamentoNovas = [...porCoordenada.entries()].filter(([k]) => !coordCasadas.has(k))
  if (semAgendamentoNovas.length) {
    await inserir(sb, semAgendamentoNovas.map(([k, r]) => {
      // Já entra com a contagem resolvida. Ela seria escrita de qualquer forma na
      // rodada seguinte, mas até lá a linha afirmaria "uma tratativa" — e é essa
      // contagem que separa evolução repetida de conflito de autoria.
      const cc = contagemCoord.get(k)
      return {
        ...r, ativo: true, origem: "tita_csv", visto_em: agora,
        tratativas: cc ? cc.total : 1,
        tratativas_distintas: cc ? Math.max(cc.pessoas.size, 1) : 1,
      }
    }))
  }

  // Inativa que a TiTa não devolveu nesta janela: exclusão confirmada na origem.
  // Só as que têm id — sem id não há como perguntar, e slot 'Livre' (o único caso
  // sem id) não entra em cálculo de pagamento de qualquer forma.
  const aConfirmar = inativas
    .filter(i => !i.ausencia_confirmada_em && i.tita_agendamento_id !== null && !porId.has(i.tita_agendamento_id))
    .map(i => i.id)
  if (aConfirmar.length) {
    await confirmarAusencia(sb, aConfirmar, agora)
    ausenciasConfirmadas = aConfirmar.length
  }

  const atualizadas = aAtualizar.length ? await aplicarExecucao(sb, aAtualizar) : 0
  // Por último e sem retentativa crítica: é só carimbo. aplicarExecucao já renova
  // o visto_em das linhas que passaram por ele, então tira-se a interseção.
  const jaCarimbadas = new Set(aAtualizar.map(a => a.id as string))
  const paraCarimbar = idsRevalidar.filter(id => !jaCarimbadas.has(id))
  if (paraCarimbar.length) await marcarVistas(sb, paraCarimbar, agora)

  return {
    modo: "execucao" as const,
    recebidos:  naJanela.length,
    existentes: existentes.length,
    atualizadas,
    inalteradas: existentes.length - aAtualizar.length - semCorrespondencia - semId,
    semCorrespondencia,   // tem id, mas a TiTa não devolveu a linha nesta janela
    semId,                // linha semeada do XLS: esta passada não a alcança
    comTratativa: naJanela.filter(r => r.possui_tratativa === true).length,
    // Reconciliação. Em regime normal os dois são 0; qualquer número aqui é uma
    // sessão que estava fora da grade e voltou.
    reativadas,
    inseridasRetroativas,
    // Evolução escrita sem agendamento por trás. Não é reconciliação: é captura
    // de uma classe de linha que antes não entrava. `semAgendamentoCasadas` é a
    // que achou linha e ganhou a execução; `inseridas`, a que não tinha linha.
    semAgendamentoCasadas:  coordCasadas.size,
    semAgendamentoInseridas: semAgendamentoNovas.length,
    // Inativas que a TiTa confirmou não ter mais. Diferente das duas acima, um
    // número aqui é normal: alta de paciente e cancelamento produzem isso.
    ausenciasConfirmadas,
    revalidadas: paraCarimbar.length,
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const origin = req.headers.get("origin") || ""
  const cors   = getCorsHeaders(origin)

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "method_not_allowed" }, 405, cors)

  const body = await req.json().catch(() => ({})) as {
    data_inicio?: string; data_fim?: string; modo?: string
  }

  const modo: Modo = body.modo === "execucao" ? "execucao" : "grade"

  const janela = resolverJanela(body, modo)
  if (!janela) {
    return json({
      ok: true,
      ignorado: modo === "execucao"
        ? "janela inteiramente no futuro"
        : "janela inteiramente no passado",
      modo, ...body,
    }, 200, cors)
  }
  const { inicio: dataInicio, fim: dataFim, hoje } = janela

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const dias = diasDaJanela(dataInicio, dataFim)
  const fatias: Record<string, unknown>[] = []
  const total: Record<string, number> = {}

  // Uma fatia por dia, e o erro de uma não contamina as outras. O catch por fatia
  // substitui o try/catch único que existia aqui: sem ele, qualquer exceção do
  // merge escapava do serve() e o runtime devolvia um "Internal Server Error"
  // pelado — foi o que aconteceu em 3 das 9 fatias do backfill de 2026-08-06, e
  // era indistinguível de falha de plataforma.
  for (const dia of dias) {
    try {
      const recebidos = await buscarRegistros(dia, dia)
      // null = a TiTa respondeu, mas sem conteúdo aproveitável para o dia. É o
      // caso normal de fim de semana; não é erro e não interrompe o laço.
      if (recebidos === null) {
        fatias.push({ data: dia, ok: true, recebidos: 0 })
        continue
      }

      const r = modo === "execucao"
        ? await sincronizarExecucao(sb, recebidos, dia, dia)
        : await sincronizarGrade(sb, recebidos, dia, dia, hoje)

      fatias.push({ data: dia, ok: true, ...r })
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === "number") total[k] = (total[k] ?? 0) + v
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[sync-grade-csv] FALHA modo=${modo} dia=${dia}: ${msg}`)
      fatias.push({ data: dia, ok: false, erro: msg })
    }
  }

  const falhas = fatias.filter(f => !f.ok)
  const resumo = {
    ok: falhas.length === 0,
    modo,
    dataInicio,
    dataFim,
    diasPedidos: dias.length,
    diasComFalha: falhas.length,
    total,
    fatias,
  }

  // O cron descarta a resposta (net.http_post é assíncrono), então o log é o
  // único lugar onde a falha de uma fatia fica visível. Ver o P1 do plano: o que
  // fecha essa lacuna de verdade é um alarme sobre visto_em das datas futuras.
  console.log(`[sync-grade-csv] ${JSON.stringify({ ...resumo, fatias: undefined })}`)
  if (falhas.length) {
    console.error(`[sync-grade-csv] ${falhas.length}/${dias.length} fatias falharam: ${falhas.map(f => f.data).join(", ")}`)
  }

  // 207 (Multi-Status) quando parte entrou e parte falhou: 200 mentiria e 500
  // esconderia o que foi gravado com sucesso.
  return json(resumo, falhas.length === 0 ? 200 : 207, cors)
})
