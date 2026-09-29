// Agrupamento do relatório de laudos do Órbita em UM registro por laudo.
//
// Módulo PURO: nenhum import de supabase, nenhuma data do relógio lida aqui
// dentro (`hojeISO` é parâmetro). É o que permite testar as regras sem banco —
// e é onde vive a única regra de negócio da tela: vigente × vencido.
//
// ─── Por que agrupar ────────────────────────────────────────────────────────
//
// O relatório tem uma linha por (laudo × ESPECIALIDADE). Medido em 28/08/2026:
// 1.849 linhas, 343 `ID Laudo` distintos, até 11 linhas por laudo. A tela mostra
// 343 cartões, não 1.849 — o laudo é a unidade de trabalho da recepção, e o que
// vence é o laudo, não a especialidade.
//
// Agrupar é seguro porque os campos do laudo são UNIFORMES dentro de um mesmo
// `ID Laudo`: medido, 0 divergências em 343 laudos para `Data laudo`,
// `Validade`, `Autorizado em`, `Situação`, `Paciente` e `ID Favorecido`. Mesmo
// assim a divergência é DETECTADA e não presumida impossível (ver
// `camposDivergentes`): se o Órbita mudar, isso aparece na tela em vez de a
// primeira linha do grupo virar a verdade em silêncio.
//
// Também medido: 343 `ID Favorecido` distintos para 343 laudos — um laudo por
// paciente, 1:1, nenhum favorecido com dois laudos. A tela conta com isso para
// falar "o laudo do paciente X"; se um dia deixar de valer, `laudosPorPaciente`
// no resultado passa de 1 e o aviso aparece.

import type { LaudoRow } from "@/types/cronograma"
import type { ItemAcompanhamentoLaudo, SituacaoPaciente } from "@/types/laudosAcompanhamento"

/** Um laudo do Órbita, já agrupado. Datas em ISO (`AAAA-MM-DD`). */
export interface LaudoAgrupado {
  /** `ID Laudo` — a chave estável entre importações do robô. */
  idLaudo: string
  /** `ID Favorecido` = `pacientes.tita_paciente_id`. Nulo se ilegível. */
  idFavorecido: number | null
  /** Nome como o Órbita escreve. O do cadastro, quando existe, vem depois. */
  pacienteNome: string
  /** `Plano` (convênio) do Órbita — "ASSIM Saúde", "Particular"… */
  plano: string

  dataLaudo: string | null
  validade: string | null
  autorizadoEm: string | null

  /** Derivada de `validade` contra `hojeISO`. É o que a tela filtra. */
  situacao: SituacaoLaudo
  /** O rótulo cru do Órbita ("Vigente"/"Vencido"), para conferência. */
  situacaoOrbita: string
  /**
   * `true` quando o rótulo do Órbita não bate com o cálculo por `validade`.
   * Medido em 28/08/2026: 0 casos em 343. Existe para o dia em que houver —
   * um laudo que o Órbita chama de vigente e a validade diz vencido é decisão
   * administrativa, não arredondamento, e a recepção precisa ver.
   */
  situacaoDivergente: boolean

  /** Especialidades do laudo, ordenadas. Uma linha do relatório cada. */
  especialidades: string[]
  /**
   * As mesmas especialidades, com `Qtd laudo` e `Qtd autorizada` de cada uma —
   * a tabela do detalhe, no formato da aba Laudo de /cadastros/pacientes/[id].
   */
  especialidadesQtd: EspecialidadeQtd[]
  /** Linhas do relatório que formaram este laudo. */
  linhas: number
  /**
   * Campos que variaram entre as linhas do grupo — vazio no caso normal. Ver o
   * cabeçalho: uniformidade medida, não presumida.
   */
  camposDivergentes: string[]
}

export type SituacaoLaudo = "vigente" | "vencido" | "sem_validade"

/** Uma especialidade do laudo com as quantidades do relatório (texto cru; "" = vazio). */
export interface EspecialidadeQtd {
  especialidade: string
  qtdLaudo: string
  qtdAutorizada: string
}

/** Os campos que o agrupamento assume uniformes dentro de um `ID Laudo`. */
const CAMPOS_DO_LAUDO = [
  "Paciente",
  "ID Favorecido",
  "Data laudo",
  "Validade",
  "Autorizado em",
  "Situação",
] as const

/**
 * "DD/MM/AAAA" → "AAAA-MM-DD". Devolve `null` para vazio ou fora do formato.
 *
 * Convertida aqui, e não deixada como texto, porque a tela ORDENA e FILTRA por
 * data — "01/01/2027" e "28/08/2026" não se comparam como string, e ordenar
 * errado a fila de vencidos é o defeito mais fácil de não notar. É a única
 * conversão que este módulo faz sobre o jsonb do robô; o resto segue por
 * identidade (ver o cabeçalho de services/laudos/relatorio.ts).
 */
export function brParaIso(valor: unknown): string | null {
  const texto = String(valor ?? "").trim()
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
  if (!m) return null
  const [, dia, mes, ano] = m
  // Descarta data impossível em vez de produzir "2026-13-45": um mês 13 vindo do
  // Órbita é erro de origem, e propagá-lo faria o filtro de período mentir.
  const d = Number(dia), mo = Number(mes)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${ano}-${mes}-${dia}`
}

/** ISO → "DD/MM/AAAA" para exibição. `null` vira "—". */
export function isoParaBr(iso: string | null): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  return `${dia}/${mes}/${ano}`
}

/**
 * Vigente × vencido: comparação de strings ISO, sem `Date`.
 *
 * `new Date("2026-08-28")` é interpretado como UTC e, no fuso de Brasília
 * (UTC-3), um laudo que vence hoje passaria a "vencido" às 21h de ontem. String
 * ISO ordena lexicograficamente igual a data, então a comparação direta é ao
 * mesmo tempo mais simples e mais correta.
 *
 * Vence NO dia da validade: `validade === hoje` é VIGENTE. É o que o Órbita
 * faz — medido, 0 divergências em 343 laudos.
 */
export function situacaoPorValidade(validadeIso: string | null, hojeISO: string): SituacaoLaudo {
  if (!validadeIso) return "sem_validade"
  return validadeIso >= hojeISO ? "vigente" : "vencido"
}

/** O rótulo do Órbita normalizado para comparar com o cálculo. */
function situacaoDoOrbita(texto: string): SituacaoLaudo | null {
  const t = texto.trim().toLowerCase()
  if (t === "vigente") return "vigente"
  if (t === "vencido") return "vencido"
  return null
}

/**
 * Hoje em `AAAA-MM-DD`, no fuso de Brasília.
 *
 * O servidor do Next roda em UTC. Sem isto, entre 21h e 00h de Brasília a tela
 * usaria a data de AMANHÃ e marcaria como vencido um laudo que vence hoje —
 * três horas por dia mostrando a fila errada.
 */
export function hojeBrasiliaISO(agora: Date = new Date()): string {
  // en-CA dá exatamente AAAA-MM-DD; o `timeZone` faz o resto.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora)
}

/** Lê a chave tolerando as variantes de grafia do `<th>` do Órbita. */
function ler(row: LaudoRow, ...chaves: string[]): string {
  for (const k of chaves) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim()
  }
  return ""
}

/**
 * Uma entrada por especialidade, na mesma ordem de `especialidades`. Se a mesma
 * especialidade vier em duas linhas do laudo (não acontece no relatório medido),
 * vale a primeira — uma linha repetida na tabela pareceria duas autorizações.
 */
function quantidadesPorEspecialidade(linhas: LaudoRow[]): EspecialidadeQtd[] {
  const porNome = new Map<string, EspecialidadeQtd>()
  for (const l of linhas) {
    const especialidade = ler(l, "Especialidade")
    if (!especialidade || porNome.has(especialidade)) continue
    porNome.set(especialidade, {
      especialidade,
      qtdLaudo: ler(l, "Qtd laudo", "Qtd Laudo", "Qt Laudo"),
      qtdAutorizada: ler(l, "Qtd autorizada", "Qtd Autorizada", "Qt Autorizada"),
    })
  }
  return [...porNome.values()].sort((a, b) => a.especialidade.localeCompare(b.especialidade, "pt-BR"))
}

/**
 * Agrupa as linhas do relatório em um registro por `ID Laudo`.
 *
 * Linha sem `ID Laudo` é DESCARTADA e contada em `descartadas`: sem a chave
 * estável não há como guardar o acompanhamento dela, e inventar uma chave
 * (nome, posição da linha) faria o registro migrar de laudo na próxima
 * importação. Medido em 28/08/2026: 0 linhas sem `ID Laudo` em 1.849.
 */
export function agruparLaudos(
  rows: LaudoRow[],
  hojeISO: string,
): { laudos: LaudoAgrupado[]; descartadas: number } {
  const grupos = new Map<string, LaudoRow[]>()
  let descartadas = 0

  for (const row of rows) {
    const id = ler(row, "ID Laudo", "Id Laudo", "id laudo")
    if (!id) {
      descartadas++
      continue
    }
    const atual = grupos.get(id)
    if (atual) atual.push(row)
    else grupos.set(id, [row])
  }

  const laudos: LaudoAgrupado[] = []

  for (const [idLaudo, linhas] of grupos) {
    const primeira = linhas[0]

    const camposDivergentes = CAMPOS_DO_LAUDO.filter((campo) => {
      const vistos = new Set(linhas.map((l) => ler(l, campo)))
      return vistos.size > 1
    })

    const validade = brParaIso(ler(primeira, "Validade"))
    const situacao = situacaoPorValidade(validade, hojeISO)
    const situacaoOrbita = ler(primeira, "Situação", "Situacao")
    const doOrbita = situacaoDoOrbita(situacaoOrbita)

    const favBruto = ler(primeira, "ID Favorecido", "Id Favorecido", "ID Paciente", "Id Paciente")
    const fav = /^\d+$/.test(favBruto) ? Number(favBruto) : null

    laudos.push({
      idLaudo,
      idFavorecido: fav,
      pacienteNome: ler(primeira, "Paciente") || "(sem nome no relatório)",
      plano: ler(primeira, "Plano"),
      dataLaudo: brParaIso(ler(primeira, "Data laudo")),
      validade,
      autorizadoEm: brParaIso(ler(primeira, "Autorizado em", "Autorizado Em", "autorizado em")),
      situacao,
      situacaoOrbita,
      // Sem rótulo legível do Órbita não há divergência a apontar — só
      // ausência. E `sem_validade` não é comparável com nada.
      situacaoDivergente:
        doOrbita !== null && situacao !== "sem_validade" && doOrbita !== situacao,
      especialidades: [...new Set(linhas.map((l) => ler(l, "Especialidade")).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
      especialidadesQtd: quantidadesPorEspecialidade(linhas),
      linhas: linhas.length,
      camposDivergentes: [...camposDivergentes],
    })
  }

  return { laudos, descartadas }
}

// ─── Junção com cadastro e acompanhamento ────────────────────────────────────
//
// PURA de propósito, e separada de services/laudos/acompanhamento.ts (que faz
// as três leituras de rede): é aqui que mora a regra do usuário (28/08/2026)
// que dá nome a esta seção —
//
//   "Dizer que foi AVISADO se refere ao LAUDO. Se o paciente 123 tem o laudo
//    111 e houve aviso, o aviso serve ao 111. Quando o paciente 123 estiver
//    com um laudo DIFERENTE do 111, ele volta a precisar de aviso."
//
// E ela já sai verdadeira da própria FORMA dos dados, sem código extra para
// impor: `laudos` (agrupado da importação ATUAL) e `registros`
// (`laudos_acompanhamento`) casam por `idLaudo`/`id_laudo` — nunca por
// paciente. Se o Órbita passa a chamar o laudo do paciente 123 de "222" em vez
// de "111", o laudo agrupado da vez é o 222, a busca em `registros` por "222"
// não acha nada (só existe uma linha para "111"), e `mensagemEnviadaEm` sai
// `null` — sem que uma única condição sobre "111" precise ser escrita. O
// registro velho do 111 não é apagado (seu histórico continua íntegro em
// `cadastros_auditoria`); ele só deixa de aparecer, porque "111" não está mais
// na lista de laudos ATIVOS.

/** O corte de `public.pacientes` que esta tela usa para enriquecer o laudo. */
export interface PacienteParaAcompanhamento {
  id_paciente: number
  /** `ID Favorecido` do relatório — a chave de casamento, nunca o nome. */
  tita_paciente_id: number | null
  nome: string
  ativo: boolean
  ficticio: boolean
  foto_path: string | null
}

/** O corte de `public.laudos_acompanhamento` que esta tela usa. */
export interface RegistroAcompanhamentoBruto {
  /** A PK da tabela — e a chave de casamento com `LaudoAgrupado.idLaudo`. */
  id_laudo: string
  mensagem_enviada_em: string | null
  observacao: string | null
  atualizado_por_nome: string | null
  atualizado_em_brasilia: string | null
}

/**
 * Cruza os laudos agrupados com o cadastro (`pacientes`) e com o registro da
 * recepção (`laudos_acompanhamento`), produzindo as linhas prontas para a tela.
 *
 * A lista de SAÍDA tem exatamente os laudos de ENTRADA — nunca mais, nunca
 * menos: um paciente sem cadastro (`situacaoPaciente: "sem_cadastro"`) ou um
 * laudo sem registro de aviso (`mensagemEnviadaEm: null`) continuam presentes,
 * só com menos dado. A lista NUNCA é filtrada pelo que falta nela.
 */
export function juntarComAcompanhamento(
  laudos: LaudoAgrupado[],
  pacientes: PacienteParaAcompanhamento[],
  registros: RegistroAcompanhamentoBruto[],
): ItemAcompanhamentoLaudo[] {
  // Índice por `tita_paciente_id`, que é o mesmo número que o relatório chama
  // de `ID Favorecido`. NUNCA por nome: nome é rótulo, sujeito a typo, acento e
  // mojibake (a convenção está escrita em types/paciente.ts).
  const porFavorecido = new Map<number, PacienteParaAcompanhamento>()
  for (const p of pacientes) {
    if (p.tita_paciente_id === null) continue
    porFavorecido.set(Number(p.tita_paciente_id), p)
  }

  // Índice por `id_laudo` — a chave do laudo, nunca a do paciente. É esta
  // linha que faz a regra do cabeçalho valer: buscar aqui por um laudo NOVO do
  // mesmo paciente simplesmente não encontra nada.
  const porLaudo = new Map<string, RegistroAcompanhamentoBruto>()
  for (const r of registros) {
    porLaudo.set(String(r.id_laudo), r)
  }

  return laudos.map((laudo) => {
    const paciente = laudo.idFavorecido !== null ? porFavorecido.get(laudo.idFavorecido) : undefined
    const registro = porLaudo.get(laudo.idLaudo)

    // `ficticio` vem ANTES de ativo/inativo: Notificação Prévia está marcada
    // como ativa no cadastro, e sem esta ordem ela apareceria como "Paciente
    // ativo" numa fila de cobrança onde não existe responsável para avisar.
    // Mesma precedência da listagem de /cadastros/pacientes.
    const situacaoPaciente: SituacaoPaciente = !paciente
      ? "sem_cadastro"
      : paciente.ficticio
        ? "ficticio"
        : paciente.ativo
          ? "ativo"
          : "inativo"

    return {
      idLaudo: laudo.idLaudo,
      idFavorecido: laudo.idFavorecido,
      // O nome do CADASTRO tem precedência quando existe: é o nome de
      // tratamento (inclui nome social) e é o que a recepção vê em toda outra
      // tela. O do relatório fica como origem e como fallback dos laudos sem
      // cadastro.
      nome: paciente?.nome ?? laudo.pacienteNome,
      dataLaudo: laudo.dataLaudo,
      validade: laudo.validade,
      autorizadoEm: laudo.autorizadoEm,
      situacao: laudo.situacao,
      situacaoOrbita: laudo.situacaoOrbita,
      situacaoDivergente: laudo.situacaoDivergente,
      especialidades: laudo.especialidades,
      especialidadesQtd: laudo.especialidadesQtd,
      plano: laudo.plano,
      // Ponto de partida: o Plano do Órbita. `juntarComConvenio`
      // (lib/laudos/convenio.ts) troca pelo da grade da TiTa quando existe.
      convenio: laudo.plano || null,
      convenioOrigem: laudo.plano ? "orbita" : null,
      convenioOriginal: null,

      pacienteId: paciente?.id_paciente ?? null,
      pacienteNomeCadastro: paciente?.nome ?? null,
      situacaoPaciente,
      fotoPath: paciente?.foto_path ?? null,

      mensagemEnviadaEm: registro?.mensagem_enviada_em ?? null,
      observacao: registro?.observacao ?? null,
      registradoPorNome: registro?.atualizado_por_nome ?? null,
      registradoEm: registro?.atualizado_em_brasilia ?? null,

      // Preenchido depois por `juntarComSenhas` (lib/laudos/senhas.ts), quando
      // há relatório de senhas importado.
      senhas: null,
    }
  })
}
