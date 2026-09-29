// Senhas da ASSIM: o relatório `relatorio_autorizacoes_assim_*.csv`, lido,
// agrupado por autorização e cruzado com os laudos do Órbita.
//
// Módulo PURO: nenhum import de supabase, nenhuma leitura do relógio (`hojeISO`
// é parâmetro). Roda no servidor (rota de upload, montagem da lista) e seus
// rótulos servem ao cliente.
//
// ─── O que o arquivo é (medido em 28/09/2026) ────────────────────────────────
//
// CSV `;`, UTF-8 com BOM, 27 colunas, 626 linhas. Uma linha por (autorização ×
// ESPECIALIDADE): 95 `ID autorização`, 88 laudos, 87 favorecidos. Senha, datas,
// situações, "Criado em" e "Atualizado em" são uniformes dentro de cada
// autorização (0 divergências em 95) — a divergência é DETECTADA mesmo assim,
// como em `agruparLaudos`.
//
// Cruzado com o Órbita no mesmo dia: 86 de 88 laudos casam em laudo +
// favorecido; 2 laudos (126, 577) não estão mais no Órbita; 0 casos de laudo
// igual com favorecido diferente. 5 laudos têm mais de uma autorização.
//
// Nome e CPF do paciente vêm no arquivo e NÃO são lidos aqui — nem entram no
// resultado do parser. A tela tem o nome pelo Órbita e pelo cadastro.

import Papa from "papaparse"
import { brParaIso } from "./acompanhamento"
import { DIAS_ALERTA_VENCIMENTO, GRAVIDADE_SENHA, diasAteValidade, norm } from "./filtros"

// ─── Tipos ───────────────────────────────────────────────────────────────────

/**
 * Status de UMA senha (dentro ou fora do ROL).
 *
 *   vigente        — validade ≥ hoje, com folga
 *   vence_em_breve — validade em até DIAS_ALERTA_VENCIMENTO dias
 *   vencida        — validade < hoje
 *   em_analise     — a ASSIM ainda não decidiu (ou renovação pedida depois de vencer)
 *   sem_validade   — autorizada/com senha, mas sem data de validade no relatório
 *   pendente       — precisa de senha e o relatório não traz nenhuma
 *   sem_senha      — laudo ASSIM ausente do relatório
 *   nao_se_aplica  — outro convênio (dentro) / sem especialidade fora do ROL (fora)
 */
export type StatusSenha =
  | "vigente"
  | "vence_em_breve"
  | "vencida"
  | "em_analise"
  | "sem_validade"
  | "pendente"
  | "sem_senha"
  | "nao_se_aplica"

/** Uma linha do CSV, reduzida ao que importa da especialidade. */
export interface EspecialidadeAutorizada {
  especialidade: string
  grupo: string
  quantidadeAutorizada: string
  quantidadeSolicitada: string
  codigoGuia: string
  descricaoGuia: string
  emUso: string
}

/** Uma autorização do relatório. Datas em ISO; data-hora em `AAAA-MM-DDTHH:MM`. */
export interface AutorizacaoSenha {
  idAutorizacao: string
  idLaudo: string
  idFavorecido: number | null
  plano: string
  dataLista: string | null
  situacaoDentro: string
  senhaDentro: string
  liberacaoDentro: string | null
  validadeDentro: string | null
  situacaoFora: string
  senhaFora: string
  liberacaoFora: string | null
  validadeFora: string | null
  criadoEmOrigem: string | null
  atualizadoEmOrigem: string | null
  arquivoAutorizacao: string
  cronogramaConvenio: string
  observacoes: string
  especialidades: EspecialidadeAutorizada[]
}

/** A senha de um lado (dentro/fora do ROL) de um laudo, já decidida. */
export interface SenhaDoRol {
  status: StatusSenha
  /** Número da senha da autorização representante. `null` quando não há. */
  senha: string | null
  liberacao: string | null
  validade: string | null
  /** Rótulo cru da ASSIM ("AUTORIZADO", "EM ANÁLISE"…), para conferência. */
  situacao: string | null
  /** Dias até a validade (negativo se passou). `null` sem validade. */
  dias: number | null
  /** De qual autorização saiu a senha exibida. */
  idAutorizacao: string | null
}

export interface SenhasDoLaudo {
  dentro: SenhaDoRol
  fora: SenhaDoRol
  /** O pior status entre os dois lados — é o que o filtro "Senha" lê. */
  pior: StatusSenha
  /** Todas as autorizações do laudo, mais recente primeiro. Vão para o detalhe. */
  autorizacoes: AutorizacaoSenha[]
}

// ─── Cabeçalho ───────────────────────────────────────────────────────────────

/**
 * As colunas que o parser lê. Faltando qualquer uma, o arquivo é RECUSADO —
 * aceitar um relatório com uma coluna de validade a menos marcaria todas as
 * senhas como "Sem validade" sem erro nenhum.
 *
 * `Paciente` e `CPF` não estão aqui de propósito: não são lidos.
 */
export const COLUNAS_OBRIGATORIAS_SENHAS = [
  "ID autorização",
  "ID laudo",
  "ID favorecido",
  "Plano",
  "Data da lista",
  "Situação dentro do ROL",
  "Senha dentro do ROL",
  "Data da liberação da senha dentro do ROL",
  "Data de validade da senha dentro do ROL",
  "Situação fora do ROL",
  "Senha fora do ROL",
  "Data da liberação da senha fora do ROL",
  "Data de validade da senha fora do ROL",
  "Especialidade",
  "Quantidade autorizada",
  "Grupo da especialidade",
  "Código da guia",
  "Descrição da guia",
  "Quantidade solicitada",
  "Em uso",
  "Arquivo da autorização",
  "Cronograma do convênio",
  "Observações",
  "Criado em",
  "Atualizado em",
] as const

type Coluna = (typeof COLUNAS_OBRIGATORIAS_SENHAS)[number]

/** Os campos que precisam ser iguais em todas as linhas de uma autorização. */
const CAMPOS_DA_AUTORIZACAO: Coluna[] = [
  "ID laudo",
  "ID favorecido",
  "Plano",
  "Data da lista",
  "Situação dentro do ROL",
  "Senha dentro do ROL",
  "Data da liberação da senha dentro do ROL",
  "Data de validade da senha dentro do ROL",
  "Situação fora do ROL",
  "Senha fora do ROL",
  "Data da liberação da senha fora do ROL",
  "Data de validade da senha fora do ROL",
  "Criado em",
  "Atualizado em",
]

/** Cabeçalho comparável: sem acento, sem caixa, espaços colapsados. */
function chaveCabecalho(v: string): string {
  return norm(v).replace(/\s+/g, " ")
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export interface ResultadoParseSenhas {
  autorizacoes: AutorizacaoSenha[]
  /** Linhas de dado lidas (sem o cabeçalho). */
  totalLinhas: number
  /** Linhas sem `ID autorização` ou sem `ID laudo` — sem chave, não entram. */
  linhasDescartadas: number
  /** Autorizações cujos campos variaram entre as linhas (valeu a primeira). */
  autorizacoesDivergentes: string[]
  /** Datas preenchidas que não estavam em DD/MM/AAAA — viraram vazio. */
  datasInvalidas: { idAutorizacao: string; campo: string; valor: string }[]
}

export class RelatorioSenhasInvalidoError extends Error {
  constructor(
    mensagem: string,
    readonly colunasFaltando: string[] = [],
  ) {
    super(mensagem)
    this.name = "RelatorioSenhasInvalidoError"
  }
}

/** "DD/MM/AAAA HH:MM" → "AAAA-MM-DDTHH:MM". Só data também é aceita (00:00). */
export function brDataHoraParaIso(valor: string): string | null {
  const texto = valor.trim()
  const m = /^(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}):(\d{2})(?::\d{2})?)?$/.exec(texto)
  if (!m) return null
  const data = brParaIso(m[1])
  if (!data) return null
  const hh = m[2] ?? "00"
  const mi = m[3] ?? "00"
  if (Number(hh) > 23 || Number(mi) > 59) return null
  return `${data}T${hh}:${mi}`
}

/**
 * Lê o CSV e devolve UMA entrada por autorização.
 *
 * Lança `RelatorioSenhasInvalidoError` quando o arquivo não é o relatório
 * (colunas faltando, nenhuma linha). O NOME do arquivo não é olhado: ele muda a
 * cada download, e quem diz se é o relatório certo é o cabeçalho.
 */
export function parsearRelatorioSenhas(texto: string): ResultadoParseSenhas {
  const semBom = texto.replace(/^﻿/, "")
  const parse = Papa.parse<Record<string, string>>(semBom, {
    header: true,
    delimiter: ";",
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  })

  const cabecalhos = parse.meta.fields ?? []
  // Coluna canônica → nome como veio no arquivo. Tolera acento/caixa trocados
  // numa exportação futura sem aceitar coluna faltando.
  const porChave = new Map(cabecalhos.map((h) => [chaveCabecalho(h), h]))
  const colunaReal = new Map<Coluna, string>()
  const faltando: string[] = []
  for (const c of COLUNAS_OBRIGATORIAS_SENHAS) {
    const real = porChave.get(chaveCabecalho(c))
    if (real === undefined) faltando.push(c)
    else colunaReal.set(c, real)
  }
  if (faltando.length > 0) {
    throw new RelatorioSenhasInvalidoError(
      `O arquivo não parece ser o relatório de autorizações da ASSIM. Faltam as colunas: ${faltando.join(", ")}.`,
      faltando,
    )
  }

  const ler = (row: Record<string, string>, c: Coluna): string =>
    String(row[colunaReal.get(c)!] ?? "").trim()

  const linhas = parse.data
  if (linhas.length === 0) {
    throw new RelatorioSenhasInvalidoError("O arquivo não tem nenhuma linha de autorização.")
  }

  const grupos = new Map<string, Record<string, string>[]>()
  let linhasDescartadas = 0
  for (const row of linhas) {
    const idAut = ler(row, "ID autorização")
    if (!idAut || !ler(row, "ID laudo")) {
      linhasDescartadas++
      continue
    }
    const g = grupos.get(idAut)
    if (g) g.push(row)
    else grupos.set(idAut, [row])
  }

  const autorizacoes: AutorizacaoSenha[] = []
  const autorizacoesDivergentes: string[] = []
  const datasInvalidas: ResultadoParseSenhas["datasInvalidas"] = []

  for (const [idAutorizacao, rows] of grupos) {
    const p = rows[0]

    if (CAMPOS_DA_AUTORIZACAO.some((c) => new Set(rows.map((r) => ler(r, c))).size > 1)) {
      autorizacoesDivergentes.push(idAutorizacao)
    }

    const data = (c: Coluna): string | null => {
      const bruto = ler(p, c)
      if (!bruto) return null
      const iso = brParaIso(bruto)
      if (!iso) datasInvalidas.push({ idAutorizacao, campo: c, valor: bruto })
      return iso
    }
    const dataHora = (c: Coluna): string | null => {
      const bruto = ler(p, c)
      if (!bruto) return null
      const iso = brDataHoraParaIso(bruto)
      if (!iso) datasInvalidas.push({ idAutorizacao, campo: c, valor: bruto })
      return iso
    }

    const favBruto = ler(p, "ID favorecido")

    autorizacoes.push({
      idAutorizacao,
      idLaudo: ler(p, "ID laudo"),
      idFavorecido: /^\d+$/.test(favBruto) ? Number(favBruto) : null,
      plano: ler(p, "Plano"),
      dataLista: data("Data da lista"),
      situacaoDentro: ler(p, "Situação dentro do ROL"),
      senhaDentro: ler(p, "Senha dentro do ROL"),
      liberacaoDentro: data("Data da liberação da senha dentro do ROL"),
      validadeDentro: data("Data de validade da senha dentro do ROL"),
      situacaoFora: ler(p, "Situação fora do ROL"),
      senhaFora: ler(p, "Senha fora do ROL"),
      liberacaoFora: data("Data da liberação da senha fora do ROL"),
      validadeFora: data("Data de validade da senha fora do ROL"),
      criadoEmOrigem: dataHora("Criado em"),
      atualizadoEmOrigem: dataHora("Atualizado em"),
      arquivoAutorizacao: ler(p, "Arquivo da autorização"),
      cronogramaConvenio: ler(p, "Cronograma do convênio"),
      observacoes: ler(p, "Observações"),
      especialidades: rows.map((r) => ({
        especialidade: ler(r, "Especialidade"),
        grupo: ler(r, "Grupo da especialidade"),
        quantidadeAutorizada: ler(r, "Quantidade autorizada"),
        quantidadeSolicitada: ler(r, "Quantidade solicitada"),
        codigoGuia: ler(r, "Código da guia"),
        descricaoGuia: ler(r, "Descrição da guia"),
        emUso: ler(r, "Em uso"),
      })),
    })
  }

  if (autorizacoes.length === 0) {
    throw new RelatorioSenhasInvalidoError(
      "Nenhuma linha do arquivo tem ID autorização e ID laudo preenchidos.",
    )
  }

  return {
    autorizacoes,
    totalLinhas: linhas.length,
    linhasDescartadas,
    autorizacoesDivergentes,
    datasInvalidas,
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

function ehEmAnalise(situacao: string): boolean {
  return norm(situacao) === "em analise"
}

function ehAutorizado(situacao: string): boolean {
  return norm(situacao) === "autorizado"
}

function ehGrupoForaDoRol(grupo: string): boolean {
  return norm(grupo) === "fora do rol"
}

/** Mais recente primeiro: "Atualizado em", depois o ID numérico maior. */
function maisRecentePrimeiro(a: AutorizacaoSenha, b: AutorizacaoSenha): number {
  const x = a.atualizadoEmOrigem ?? ""
  const y = b.atualizadoEmOrigem ?? ""
  if (x !== y) return x < y ? 1 : -1
  return Number(b.idAutorizacao) - Number(a.idAutorizacao) || b.idAutorizacao.localeCompare(a.idAutorizacao)
}

function statusPorDias(dias: number): StatusSenha {
  if (dias < 0) return "vencida"
  if (dias <= DIAS_ALERTA_VENCIMENTO) return "vence_em_breve"
  return "vigente"
}

const SEM_DADO: Omit<SenhaDoRol, "status"> = {
  senha: null,
  liberacao: null,
  validade: null,
  situacao: null,
  dias: null,
  idAutorizacao: null,
}

type Lado = "dentro" | "fora"

function doLado(a: AutorizacaoSenha, lado: Lado) {
  return lado === "dentro"
    ? { situacao: a.situacaoDentro, senha: a.senhaDentro, liberacao: a.liberacaoDentro, validade: a.validadeDentro }
    : { situacao: a.situacaoFora, senha: a.senhaFora, liberacao: a.liberacaoFora, validade: a.validadeFora }
}

/**
 * Decide a senha de um lado a partir das autorizações que têm algum dado dele.
 * `null` quando nenhuma tem — quem chama decide entre pendente/sem_senha/não se
 * aplica, porque isso depende do lado e do convênio.
 *
 * Regras (usuário, 28/09/2026: "o objetivo é mapear o andamento das senhas"):
 *
 *   1. Havendo data de validade, A DATA MANDA. A representante é a de maior
 *      validade — com duas autorizações do mesmo laudo, a que cobre por mais
 *      tempo é a que vale. Isso também cobre a senha fora do ROL que vem sem
 *      "Situação" preenchida (1 caso medido).
 *   2. Exceção: se a melhor validade JÁ VENCEU e existe outra autorização "EM
 *      ANÁLISE" sem data, o status é `em_analise` — a renovação foi pedida, e
 *      "Vencida" esconderia que alguém já está cuidando.
 *   3. Sem nenhuma data: "EM ANÁLISE" em todas → `em_analise`; alguma autorizada
 *      ou com senha → `sem_validade`; nenhuma das duas (rótulo desconhecido,
 *      ex. negada) → `pendente`. O rótulo cru segue em `situacao` e no detalhe.
 */
function decidirLado(
  autorizacoes: AutorizacaoSenha[],
  lado: Lado,
  hojeISO: string,
): SenhaDoRol | null {
  const comDado = autorizacoes.filter((a) => {
    const l = doLado(a, lado)
    return l.situacao !== "" || l.senha !== "" || l.validade !== null
  })
  if (comDado.length === 0) return null

  const montar = (a: AutorizacaoSenha, status: StatusSenha): SenhaDoRol => {
    const l = doLado(a, lado)
    return {
      status,
      senha: l.senha || null,
      liberacao: l.liberacao,
      validade: l.validade,
      situacao: l.situacao || null,
      dias: diasAteValidade(l.validade, hojeISO),
      idAutorizacao: a.idAutorizacao,
    }
  }

  const comValidade = comDado.filter((a) => doLado(a, lado).validade !== null)
  if (comValidade.length > 0) {
    const rep = [...comValidade].sort((a, b) => {
      const va = doLado(a, lado).validade!
      const vb = doLado(b, lado).validade!
      if (va !== vb) return va < vb ? 1 : -1
      return maisRecentePrimeiro(a, b)
    })[0]
    const status = statusPorDias(diasAteValidade(doLado(rep, lado).validade, hojeISO)!)
    if (status === "vencida") {
      const renovacao = comDado
        .filter((a) => doLado(a, lado).validade === null && ehEmAnalise(doLado(a, lado).situacao))
        .sort(maisRecentePrimeiro)[0]
      if (renovacao) return montar(renovacao, "em_analise")
    }
    return montar(rep, status)
  }

  const rep = [...comDado].sort(maisRecentePrimeiro)[0]
  if (comDado.every((a) => ehEmAnalise(doLado(a, lado).situacao))) return montar(rep, "em_analise")
  const autorizada = [...comDado]
    .filter((a) => doLado(a, lado).senha !== "" || ehAutorizado(doLado(a, lado).situacao))
    .sort(maisRecentePrimeiro)[0]
  if (autorizada) return montar(autorizada, "sem_validade")
  return montar(rep, "pendente")
}

/** `pior` pega o de menor índice em `GRAVIDADE_SENHA` (filtros.ts) entre os lados. */
function piorDe(a: StatusSenha, b: StatusSenha): StatusSenha {
  return GRAVIDADE_SENHA.indexOf(a) <= GRAVIDADE_SENHA.indexOf(b) ? a : b
}

/** O plano do Órbita é ASSIM? Decide entre "Sem senha" e "Outro convênio". */
export function planoEhAssim(plano: string): boolean {
  return /\bassim\b/.test(norm(plano))
}

/**
 * As senhas de um laudo.
 *
 * Sem nenhuma autorização no relatório: `sem_senha` se o laudo é ASSIM (o
 * relatório é da ASSIM — a ausência é informação), `nao_se_aplica` se é de
 * outro convênio (a ausência é esperada).
 *
 * Fora do ROL só se aplica quando o relatório diz que se aplica: alguma
 * autorização traz senha/situação fora do ROL, ou alguma especialidade é do
 * grupo "Fora do ROL". Nesse segundo caso sem senha, é `pendente`.
 */
export function calcularSenhasDoLaudo(
  autorizacoes: AutorizacaoSenha[],
  /** O convênio do paciente (da grade; sem ela, o Plano do Órbita). */
  convenio: string,
  hojeISO: string,
): SenhasDoLaudo {
  const ordenadas = [...autorizacoes].sort(maisRecentePrimeiro)

  if (ordenadas.length === 0) {
    const status: StatusSenha = planoEhAssim(convenio) ? "sem_senha" : "nao_se_aplica"
    return {
      dentro: { status, ...SEM_DADO },
      fora: { status: "nao_se_aplica", ...SEM_DADO },
      pior: status,
      autorizacoes: [],
    }
  }

  const dentro = decidirLado(ordenadas, "dentro", hojeISO) ?? { status: "pendente" as const, ...SEM_DADO }

  const temEspecialidadeFora = ordenadas.some((a) =>
    a.especialidades.some((e) => ehGrupoForaDoRol(e.grupo)),
  )
  const fora =
    decidirLado(ordenadas, "fora", hojeISO) ??
    ({ status: temEspecialidadeFora ? "pendente" : "nao_se_aplica", ...SEM_DADO } as SenhaDoRol)

  return { dentro, fora, pior: piorDe(dentro.status, fora.status), autorizacoes: ordenadas }
}

// ─── Junção com os laudos da tela ────────────────────────────────────────────

export interface ResumoJuncaoSenhas {
  /** Laudos da tela que receberam autorizações. */
  laudosCasados: number
  /** Laudos do relatório que não existem no Órbita (ex.: laudo renovado). */
  laudosOrfaos: string[]
  /** Laudo existe no Órbita, mas o favorecido não bate — NÃO casa. */
  laudosDivergentes: { idLaudo: string; favorecidoRelatorio: number | null; favorecidoOrbita: number | null }[]
}

/**
 * Anexa as senhas a cada laudo da tela.
 *
 * O casamento exige `idLaudo` E `idFavorecido` iguais — pedido do usuário
 * (28/09/2026): "cruzamento com ID do Laudo e ID Favorecido para bater
 * exatamente". Um laudo igual com favorecido diferente seria senha de outro
 * paciente no cartão; ele não casa e vai para `laudosDivergentes`.
 *
 * A lista de saída tem exatamente os itens de entrada, na mesma ordem.
 */
export function juntarComSenhas<
  T extends {
    idLaudo: string
    idFavorecido: number | null
    plano: string
    /** Convênio resolvido (grade → Órbita). Ausente = vale o `plano`. */
    convenio?: string | null
  },
>(
  itens: T[],
  autorizacoes: AutorizacaoSenha[],
  hojeISO: string,
): { itens: (T & { senhas: SenhasDoLaudo })[]; resumo: ResumoJuncaoSenhas } {
  const porLaudo = new Map<string, AutorizacaoSenha[]>()
  for (const a of autorizacoes) {
    const g = porLaudo.get(a.idLaudo)
    if (g) g.push(a)
    else porLaudo.set(a.idLaudo, [a])
  }

  const idsDaTela = new Set(itens.map((i) => i.idLaudo))
  const laudosOrfaos = [...porLaudo.keys()]
    .filter((id) => !idsDaTela.has(id))
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))

  const laudosDivergentes: ResumoJuncaoSenhas["laudosDivergentes"] = []
  let laudosCasados = 0

  const saida = itens.map((item) => {
    const doLaudo = porLaudo.get(item.idLaudo) ?? []
    const casadas = doLaudo.filter(
      (a) => item.idFavorecido !== null && a.idFavorecido === item.idFavorecido,
    )
    const outras = doLaudo.filter((a) => !casadas.includes(a))
    for (const a of outras) {
      laudosDivergentes.push({
        idLaudo: item.idLaudo,
        favorecidoRelatorio: a.idFavorecido,
        favorecidoOrbita: item.idFavorecido,
      })
    }
    if (casadas.length > 0) laudosCasados++
    return {
      ...item,
      senhas: calcularSenhasDoLaudo(casadas, item.convenio ?? item.plano, hojeISO),
    }
  })

  return { itens: saida, resumo: { laudosCasados, laudosOrfaos, laudosDivergentes } }
}
