"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getRefWeek } from "@/lib/cronograma/helpers"
import {
  buscarGradeParaAnalise, buscarGradeParaRP, checarPisoDeExecucao, avaliarCoberturaGrade,
  type CoberturaGrade,
} from "@/lib/remuneracao/gradeRemuneracao"
import {
  calcularAnaliseFutura, calcularRemuneracaoReal, calcularPEProporcional,
  normalizarRelatorioPE, parsePeriodoArquivo, PE_INATIVO,
  type AnaliseFuturaResult, type ProfRemunReal, type PERow, type ContratoAntigoInfo, type CadastroContratual, type ContratoAtualItem,
  type DesligadosMap,
} from "@/lib/remuneracao/calculo"
import {
  normalizarGradeParaSessao, classificarSessaoReal, janelaDeDatasDaGrade,
  type SessaoReal, type CsvGradeRow,
} from "@/lib/remuneracao/relatorio"
import { buscarPresencaFilaAutorizacoes, presencaDaSessao, type PresencaIndice } from "@/lib/remuneracao/presencaReal"
import { mesAnoDeLinhas } from "@/lib/remuneracao/datas"
import { isProfDesligado, limparPrefixoDesligado } from "@/lib/remuneracao/constants"
import { getContratos, getUltimoAtendimentoAtivo } from "@/services/remuneracao.service"
import { useParametrosGerais } from "./useParametrosGerais"
import { useTaxasEspecialidade } from "./useTaxasEspecialidade"
import { useFeriados } from "./useFeriados"
import type { CsvRow } from "@/types/cronograma"

// Um "contrato antigo" agora é só um item não-vigente na mesma lista de
// contratos (ver migration 20260710120000) — pega o de maior valorTotal
// como referência de comparação (mesmo profissional pode ter mais de um
// contrato antigo desativado ao longo do tempo).
function deriveAntigoDeContratos(contratos: ContratoAtualItem[]): ContratoAntigoInfo | null {
  const candidatos = (Array.isArray(contratos) ? contratos : [])
    .filter(c => c && c.vigente === false && Number(c.valorTotal || 0) > 0)
  if (!candidatos.length) return null
  const maior = candidatos.reduce((a, b) => (Number(b.valorTotal) > Number(a.valorTotal) ? b : a))
  return { salario: Number(maior.valorTotal), contrato: maior.numero || null }
}

export function useAnaliseFutura() {
  const { parametros, loading: parametrosLoading, error: parametrosError } = useParametrosGerais()
  const { taxas_pa, diarias, loading: taxasLoading } = useTaxasEspecialidade()
  const { feriados, loading: feriadosLoading } = useFeriados()
  const [rows, setRows] = useState<CsvRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [rowsError, setRowsError] = useState<string | null>(null)
  const [antigos, setAntigos] = useState<Record<string, ContratoAntigoInfo>>({})
  const [cadastroPrestadores, setCadastroPrestadores] = useState<Record<string, CadastroContratual>>({})
  const [contratosError, setContratosError] = useState<string | null>(null)
  const [desligados, setDesligados] = useState<DesligadosMap>({})
  const refWeek = useMemo(() => getRefWeek(), [])

  useEffect(() => {
    let isMounted = true
    async function load() {
      setRowsLoading(true)
      try {
        const data = await buscarGradeParaAnalise(refWeek.inicio, refWeek.fim)
        if (isMounted) setRows(data)
      } catch (e) {
        if (isMounted) setRowsError(e instanceof Error ? e.message : "Erro ao buscar grade.")
      } finally {
        if (isMounted) setRowsLoading(false)
      }
    }
    load()
    return () => { isMounted = false }
  }, [refWeek])

  // Quem aparece na grade como "INATIVO-<nome>", com o profissional_id que o TiTa
  // mantém estável mesmo depois do rename. Vazio = nada a consultar.
  const idsDesligados = useMemo(() => {
    const porNome = new Map<string, number>()
    for (const r of rows) {
      const nome = String(r["Profissional"] ?? "").trim()
      if (!nome || !isProfDesligado(nome) || porNome.has(nome)) continue
      const id = Number(r["Id Profissional"])
      if (Number.isFinite(id) && id > 0) porNome.set(nome, id)
    }
    return porNome
  }, [rows])

  // O agenda_tita resolve, pelo mesmo profissional_id, o nome limpo (chave do
  // cadastro de contrato) e a data do último atendimento ativo — que é o que
  // datamos como mês do desligamento.
  //
  // Sem ninguém marcado na grade o efeito não faz nada: entradas de uma grade
  // anterior podem sobrar no mapa sem efeito colateral, porque o cálculo só
  // consulta nomes que estão na grade atual E têm o prefixo.
  useEffect(() => {
    if (!idsDesligados.size) return
    let isMounted = true
    async function loadDesligados() {
      const { data: porId } = await getUltimoAtendimentoAtivo([...idsDesligados.values()])
      if (!isMounted) return

      const mapa: DesligadosMap = {}
      for (const [nome, id] of idsDesligados) {
        const encontrado = porId[id]
        mapa[nome] = {
          // Sem linha no agenda_tita, o prefixo removido é o melhor palpite de nome.
          nomeLimpo: encontrado?.nome || limparPrefixoDesligado(nome),
          mesUltimoAtendimento: encontrado ? encontrado.ultimaData.slice(0, 7) : null,
        }
      }
      setDesligados(mapa)
    }
    loadDesligados()
    return () => { isMounted = false }
  }, [idsDesligados])

  // Contratos (atuais + antigos, unificados) — cadastrados em Cadastros, não
  // dependem da semana de referência.
  useEffect(() => {
    let isMounted = true
    async function loadContratuais() {
      const { data: contratosData, error } = await getContratos()
      if (!isMounted) return

      // Sem propagar o erro, uma falha de RLS (a tabela exige role rp/admin/
      // diretoria) fazia a tela mostrar TODO mundo como "Sem contrato antigo
      // cadastrado" / "PS.ABA-PENDENTE", sem nenhum aviso.
      if (error) {
        setContratosError("Não foi possível carregar os contratos cadastrados — a projeção abaixo ignora contrato antigo e modalidade. Verifique sua permissão de acesso a contratos.")
        return
      }
      setContratosError(null)

      const antigosMap: Record<string, ContratoAntigoInfo> = {}
      const cadastroMap: Record<string, CadastroContratual> = {}
      ;(contratosData ?? []).forEach(r => {
        const contratos = Array.isArray(r.contratos) ? r.contratos : []
        cadastroMap[r.profissional_nome] = {
          nome: r.profissional_nome,
          contratosAtuais: contratos,
          cnpj: r.cnpj ?? null,
          cpf: r.cpf ?? null,
          razaoSocial: r.razao_social ?? null,
        }
        const antigo = deriveAntigoDeContratos(contratos)
        if (antigo) antigosMap[r.profissional_nome] = antigo
      })

      setAntigos(antigosMap)
      setCadastroPrestadores(cadastroMap)
    }
    loadContratuais()
    return () => { isMounted = false }
  }, [])

  const resultado: AnaliseFuturaResult | null = useMemo(() => {
    if (!parametros || !rows.length) return null
    return calcularAnaliseFutura(rows, {
      taxasPA: taxas_pa,
      diarias,
      etaBonus: parametros.eta_bonus_default,
      ccPA: parametros.cc_pa_default,
      ccPE: parametros.cc_pe_default,
      ccLimDefault: parametros.cc_lim_default,
      presenca: parametros.presenca_padrao,
      feriados,
      antigos,
      cadastroPrestadores,
      desligados,
    })
  }, [parametros, taxas_pa, diarias, rows, antigos, cadastroPrestadores, desligados, feriados])

  const analMes = useMemo(() => (rows.length ? mesAnoDeLinhas(rows as unknown as Record<string, unknown>[]) : null), [rows])

  return {
    resultado,
    refWeek,
    analMes,
    presenca: parametros?.presenca_padrao ?? null,
    loading: parametrosLoading || taxasLoading || rowsLoading || feriadosLoading,
    error: parametrosError || rowsError,
    // Aviso, não erro bloqueante: sem os contratos a projeção de PA ainda serve.
    avisoContratos: contratosError,
    gradeVazia: !rowsLoading && rows.length === 0,
    totalGrade: rows.length,
  }
}

/** Fonte da grade em uso. Quem carregou por último vence. */
export type FonteGradeRP = "banco" | "upload"

/** Props dos controles de grade injetados no header. Ver `controlesGrade`. */
export type ControlesGradeRP = ReturnType<typeof useRemunRP>["controlesGrade"]

export interface PeriodoRP { de: string; ate: string }

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function periodoDoMes(ano: number, mes: number): PeriodoRP {
  return { de: isoLocal(new Date(ano, mes - 1, 1)), ate: isoLocal(new Date(ano, mes, 0)) }
}

/** Último mês inteiro já encerrado — o que normalmente se está fechando. */
function mesFechadoAnterior(): PeriodoRP {
  const h = new Date()
  const ref = new Date(h.getFullYear(), h.getMonth() - 1, 1)
  return periodoDoMes(ref.getFullYear(), ref.getMonth() + 1)
}

const indicePresencaVazio = (): PresencaIndice => ({ porId: new Map(), porChave: new Map() })

/**
 * Sem presença o cálculo não é "menos preciso", é errado para o lado de pagar:
 * toda falta vira sessão presente. Então a carga inteira é recusada, em vez de
 * exibir um total que parece bom.
 */
function falhaDePresenca(e: unknown) {
  return {
    resumo: "Falha ao ler a presença",
    erro: `Não consegui ler as faltas em fila_autorizacoes: ${e instanceof Error ? e.message : String(e)}. `
      + "Sem isso toda falta contaria como sessão presente, e o cálculo pagaria a mais.",
    dica: "Nenhum dado foi alterado. Tente carregar de novo; se repetir, avise o time técnico.",
  }
}

function falhaDeGrade(e: unknown) {
  return {
    resumo: "Falha ao ler a grade",
    erro: e instanceof Error ? e.message : "Não consegui ler a grade do banco.",
    dica: "Nenhum dado foi alterado. Tente carregar de novo; se repetir, avise o time técnico "
      + "com a mensagem acima e use o CSV exportado da TiTa enquanto isso.",
  }
}

export function useRemunRP() {
  const { parametros, loading: parametrosLoading, error: parametrosError } = useParametrosGerais()
  const { taxas_pa, diarias, loading: taxasLoading } = useTaxasEspecialidade()
  const { feriados, loading: feriadosLoading } = useFeriados()
  // Guardamos as linhas CRUAS, não a versão já normalizada: assim a
  // classificação é re-derivada quando os feriados chegarem. Normalizar no ato
  // do carregamento congelava um `feriados` ainda vazio e nenhum cancelamento
  // virava "Feriado/Ponto Fac.". Mesmo padrão de hooks/useTratativas.ts.
  const [gradeRaw, setGradeRaw] = useState<CsvGradeRow[]>([])
  // Preenchido pelas duas cargas, no MESMO commit em que as linhas entram — ver
  // carregarGrade / carregarGradeDoBanco.
  const [presencaIndice, setPresencaIndice] = useState<PresencaIndice>(indicePresencaVazio)
  const [csvName, setCsvName] = useState<string | null>(null)
  const [fonteGrade, setFonteGrade] = useState<FonteGradeRP | null>(null)
  const [periodo, setPeriodo] = useState<PeriodoRP>(mesFechadoAnterior)
  /** Período que a grade em uso de fato cobre — pode diferir do escolhido. */
  const [periodoCarregado, setPeriodoCarregado] = useState<PeriodoRP | null>(null)
  const [gradeLoading, setGradeLoading] = useState(false)
  const [gradeErro, setGradeErro] = useState<string | null>(null)
  // Par do `gradeErro`: título de uma linha para o chip do cabeçalho e o número
  // que dá concretude ao problema. Ver VeredictoGrade — a explicação vai no
  // modal, o cabeçalho só cabe um chip.
  const [gradeErroResumo, setGradeErroResumo] = useState<string | null>(null)
  const [gradeErroDica, setGradeErroDica] = useState<string | null>(null)
  const [gradeErroQtd, setGradeErroQtd] = useState<number | undefined>(undefined)
  const [gradeAviso, setGradeAviso] = useState<string | null>(null)
  const [coberturaGrade, setCoberturaGrade] = useState<CoberturaGrade | null>(null)
  const [peRows, setPeRows] = useState<PERow[]>([])
  const [peName, setPeName] = useState<string | null>(null)
  const [antigos, setAntigos] = useState<Record<string, ContratoAntigoInfo>>({})
  const [cadastroPrestadores, setCadastroPrestadores] = useState<Record<string, CadastroContratual>>({})

  // Contratos (atuais + antigos, unificados) — cadastrados em Config, não
  // dependem da grade importada.
  useEffect(() => {
    let isMounted = true
    async function loadContratuais() {
      const { data: contratosData } = await getContratos()
      if (!isMounted) return

      const antigosMap: Record<string, ContratoAntigoInfo> = {}
      const cadastroMap: Record<string, CadastroContratual> = {}
      ;(contratosData ?? []).forEach(r => {
        const contratos = Array.isArray(r.contratos) ? r.contratos : []
        cadastroMap[r.profissional_nome] = {
          nome: r.profissional_nome,
          contratosAtuais: contratos,
          cnpj: r.cnpj ?? null,
          cpf: r.cpf ?? null,
          razaoSocial: r.razao_social ?? null,
        }
        const antigo = deriveAntigoDeContratos(contratos)
        if (antigo) antigosMap[r.profissional_nome] = antigo
      })

      setAntigos(antigosMap)
      setCadastroPrestadores(cadastroMap)
    }
    loadContratuais()
    return () => { isMounted = false }
  }, [])

  // Os três campos da reprovação andam juntos sempre; separá-los já deixou o
  // cabeçalho com um chip de um erro que não existia mais.
  const limparReprovacao = useCallback(() => {
    setGradeErro(null)
    setGradeErroResumo(null)
    setGradeErroDica(null)
    setGradeErroQtd(undefined)
  }, [])

  const reprovar = useCallback((v: { erro: string; resumo: string; dica: string; quantidade?: number }) => {
    setGradeErro(v.erro)
    setGradeErroResumo(v.resumo)
    setGradeErroDica(v.dica)
    setGradeErroQtd(v.quantidade)
    setGradeAviso(null)
  }, [])

  // Serializa as cargas: dois cliques seguidos em períodos diferentes poderiam
  // terminar fora de ordem e deixar na tela a grade do período errado. Vale para
  // as duas fontes — um upload durante uma leitura do banco vence, e a leitura
  // que chegar depois não pode sobrescrevê-lo.
  const cargaAtual = useRef(0)

  /** Upload manual: sobrepõe o que veio do banco. */
  const carregarGrade = useCallback(async (rows: CsvGradeRow[], nomeArquivo?: string) => {
    const marca = ++cargaAtual.current
    setGradeLoading(true)
    limparReprovacao()
    setGradeAviso(null)
    try {
      // Mesma regra da leitura do banco: a presença entra no estado junto com as
      // linhas, nunca depois. A janela sai do próprio arquivo — ele pode cobrir
      // qualquer intervalo, inclusive um diferente do período escolhido no header.
      const janela = janelaDeDatasDaGrade(rows)
      const indice = janela
        ? await buscarPresencaFilaAutorizacoes(janela.min, janela.max)
        : indicePresencaVazio()
      if (marca !== cargaAtual.current) return

      setPresencaIndice(indice)
      setGradeRaw(rows)
      setFonteGrade("upload")
      setCoberturaGrade(null)
      setPeriodoCarregado(null)
      if (nomeArquivo !== undefined) setCsvName(nomeArquivo)
    } catch (e) {
      if (marca !== cargaAtual.current) return
      reprovar(falhaDePresenca(e))
    } finally {
      if (marca === cargaAtual.current) setGradeLoading(false)
    }
  }, [limparReprovacao, reprovar])

  const limparGrade = useCallback(() => {
    // Invalida qualquer carga em voo: sem isto, a que estivesse a caminho
    // repovoaria a tela que a pessoa acabou de limpar.
    cargaAtual.current++
    setGradeLoading(false)
    setGradeRaw([])
    setPresencaIndice(indicePresencaVazio())
    setCsvName(null)
    setFonteGrade(null)
    setCoberturaGrade(null)
    setPeriodoCarregado(null)
    limparReprovacao()
    setGradeAviso(null)
  }, [limparReprovacao])

  const carregarGradeDoBanco = useCallback(async (alvo?: PeriodoRP) => {
    const p = alvo ?? periodo
    if (alvo) setPeriodo(alvo)

    const piso = checarPisoDeExecucao(p.de)
    if (!piso.ok) {
      reprovar(piso)
      return
    }

    const marca = ++cargaAtual.current
    setGradeLoading(true)
    limparReprovacao()
    setGradeAviso(null)
    try {
      // As duas consultas saem JUNTAS, e não uma depois da outra.
      //
      // A janela da presença é o próprio período pedido, então nunca foi preciso
      // esperar a grade chegar para saber o que consultar. Encadeadas, a tela
      // ficava alguns segundos (8.413 linhas em 9 páginas, julho/2026) exibindo
      // um total calculado com o fallback "presente" de toda sessão — sempre
      // MAIOR que o correto, e sem nada indicando que era parcial. Quem lia o
      // número nesse intervalo lia um valor que paga a mais.
      const [gradeRes, presencaRes] = await Promise.allSettled([
        buscarGradeParaRP(p.de, p.ate),
        buscarPresencaFilaAutorizacoes(p.de, p.ate),
      ])
      if (marca !== cargaAtual.current) return

      // A presença primeiro: a mensagem dela diz o que está em jogo (pagar a
      // mais), e a da grade seria só ruído por cima disso.
      if (presencaRes.status === "rejected") {
        reprovar(falhaDePresenca(presencaRes.reason))
        return
      }
      if (gradeRes.status === "rejected") {
        reprovar(falhaDeGrade(gradeRes.reason))
        return
      }

      const { linhas, ...cobertura } = gradeRes.value
      const veredicto = avaliarCoberturaGrade(cobertura, p)
      if (!veredicto.ok) {
        // Nada do período reprovado entra no estado — nem as linhas, nem os
        // contadores. Se já havia uma grade boa carregada, ela continua como
        // está, e o badge segue descrevendo ELA. Os números do período
        // reprovado vão para o modal. A presença já lida é descartada junto:
        // é dela que a grade recusada precisaria.
        reprovar(veredicto)
        return
      }
      // Só os contadores: guardar `linhas` aqui manteria as ~19 mil vivas em
      // duas referências sem ninguém usar a segunda.
      setPresencaIndice(presencaRes.value)
      setGradeRaw(linhas)
      setCoberturaGrade(cobertura)
      setFonteGrade("banco")
      setCsvName(null)
      setPeriodoCarregado(p)
      setGradeAviso(veredicto.aviso)
    } catch (err) {
      if (marca !== cargaAtual.current) return
      reprovar(falhaDeGrade(err))
    } finally {
      if (marca === cargaAtual.current) setGradeLoading(false)
    }
  }, [periodo, reprovar, limparReprovacao])

  // Primeira carga automática. Fica atrás de um ref, e não de um efeito com
  // dependências, porque o provider vive no layout do segmento: as duas abas
  // que usam a grade montam o mesmo componente de controles e disparariam duas
  // buscas de ~19 páginas cada.
  //
  // `periodoInicial` deixa uma aba pedir outro mês para essa primeira carga
  // (Entregas PEP abre no mês vigente; as demais, no último mês fechado). Só
  // vale se esta for a primeira carga da sessão: se outra aba já carregou um
  // mês, a grade compartilhada é respeitada.
  const jaAutoCarregou = useRef(false)
  const carregarGradeAuto = useCallback((periodoInicial?: PeriodoRP) => {
    if (jaAutoCarregou.current) return
    jaAutoCarregou.current = true
    void carregarGradeDoBanco(periodoInicial)
  }, [carregarGradeDoBanco])

  // Normaliza/classifica a partir das linhas cruas + feriados atuais. Reage
  // tanto a uma carga nova quanto à chegada dos feriados.
  const evoRowsBase = useMemo<SessaoReal[]>(
    () => normalizarGradeParaSessao(gradeRaw, feriados),
    [gradeRaw, feriados],
  )

  // evoRows final: sobrepõe presencaOrbita conforme fila_autorizacoes — casando
  // primeiro pelo id do agendamento (mais confiável) e só then por
  // paciente+data+hora. Sessões sem registro na fila mantêm o fallback "Sim"
  // (mesmo comportamento de antes).
  const evoRows = useMemo(() => {
    if (presencaIndice.porId.size === 0 && presencaIndice.porChave.size === 0) return evoRowsBase
    return evoRowsBase.map(r => {
      const presente = presencaDaSessao(r.id, r.paciente, r.data, r.hora, presencaIndice)
      if (presente === undefined) return r
      const presencaOrbita = presente ? "Sim" : "Não"
      if (presencaOrbita === r.presencaOrbita) return r
      const atualizado = { ...r, presencaOrbita }
      atualizado.classificacao = classificarSessaoReal(atualizado, feriados)
      return atualizado
    })
  }, [evoRowsBase, presencaIndice, feriados])

  const carregarPE = useCallback((rows: CsvGradeRow[], fileName: string) => {
    setPeRows(normalizarRelatorioPE(rows, parsePeriodoArquivo(fileName)))
    setPeName(fileName)
  }, [])

  const limparPE = useCallback(() => {
    setPeRows([])
    setPeName(null)
  }, [])

  // Coordenadores de Caso "ativos": aparecem com essa especialidade na própria
  // grade enviada (adaptação — a calc original usava dadosPorProf da Análise
  // Futura, mas aqui as duas abas têm janelas de dados diferentes).
  const coordsAtivos = useMemo(
    () => [...new Set(evoRows.filter(r => r.especialidade === "Coordenador de Caso").map(r => r.profAgenda).filter(Boolean))],
    [evoRows]
  )

  const peAnaliseCompleta = evoRows.length > 0 && peRows.length > 0
  const peStatusMensagem = peAnaliseCompleta
    ? "PE calculado com relatórios 1 e 2."
    : "PE bloqueado: importe csv_grade_profissionais e agendamentos_profissionais para calcular com segurança."

  const peProporcional = useMemo(() => {
    if (!parametros || !peAnaliseCompleta) return PE_INATIVO
    return calcularPEProporcional(peRows, parametros.cc_pe_default, evoRows, coordsAtivos)
  }, [parametros, peAnaliseCompleta, peRows, evoRows, coordsAtivos])

  /**
   * Tudo que os controles do header precisam, num objeto de identidade estável.
   *
   * Vai por prop, e não por contexto, porque `setRightContent` guarda o elemento
   * em estado e quem o renderiza é o layout do dashboard — **acima** deste
   * segmento, portanto fora do RemuneracaoRPProvider. Contexto é posicional na
   * árvore de render, não no lugar onde o elemento foi criado.
   *
   * Memoizado porque o efeito que injeta o header depende deste objeto: uma
   * identidade nova a cada render reinjetaria o header em laço.
   */
  const controlesGrade = useMemo(() => ({
    evoRows, peRows, csvName,
    carregarGrade, carregarPE, limparGrade, limparPE,
    fonteGrade, periodo, setPeriodo, periodoCarregado, coberturaGrade,
    carregarGradeDoBanco, carregarGradeAuto,
    gradeLoading, gradeErro, gradeErroResumo, gradeErroDica, gradeErroQtd, gradeAviso,
  }), [
    evoRows, peRows, csvName,
    carregarGrade, carregarPE, limparGrade, limparPE,
    fonteGrade, periodo, periodoCarregado, coberturaGrade,
    carregarGradeDoBanco, carregarGradeAuto,
    gradeLoading, gradeErro, gradeErroResumo, gradeErroDica, gradeErroQtd, gradeAviso,
  ])

  const resultado: ProfRemunReal[] | null = useMemo(() => {
    if (!parametros || !evoRows.length) return null
    return calcularRemuneracaoReal(evoRows, {
      taxasPA: taxas_pa,
      diarias,
      etaBonus: parametros.eta_bonus_default,
      ccPA: parametros.cc_pa_default,
      ccPE: parametros.cc_pe_default,
      antigos,
      cadastroPrestadores,
      peAnaliseCompleta,
      peProporcional,
      peStatusMensagem,
    })
  }, [parametros, taxas_pa, diarias, evoRows, antigos, cadastroPrestadores, peAnaliseCompleta, peProporcional, peStatusMensagem])

  return {
    resultado,
    presenca: parametros?.presenca_padrao ?? 80,
    evoRows,
    csvName,
    carregarGrade,
    limparGrade,
    // Leitura pelo banco (padrão) — ver lib/remuneracao/gradeRemuneracao.ts
    fonteGrade,
    periodo,
    periodoCarregado,
    carregarGradeDoBanco,
    gradeLoading,
    gradeErro,
    gradeAviso,
    coberturaGrade,
    /** Props dos controles do header — ver o comentário na definição. */
    controlesGrade,
    peRows,
    peName,
    carregarPE,
    limparPE,
    peAnaliseCompleta,
    peStatusMensagem,
    cadastroPrestadores,
    loading: parametrosLoading || taxasLoading || feriadosLoading,
    error: parametrosError,
  }
}
