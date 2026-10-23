"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, Loader2, Users } from "lucide-react"
import toast from "react-hot-toast"
import { RoboNaPep } from "@/components/admin/roboSharepoint/RoboNaPep"
import { aviso, btnSecundario } from "@/components/cronograma/grade/estilo"
import { Cartao, EstadoVazio } from "@/components/ui/padrao"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { useHeader } from "@/contexts/HeaderContext"
import { useRemuneracaoRPContext } from "@/contexts/RemuneracaoRPContext"
import { useParametrosGerais } from "@/hooks/useParametrosGerais"
import { usePepApuracao } from "@/hooks/usePepApuracao"
import { usePepCalendario } from "@/hooks/usePepCalendario"
import { usePepEntregas } from "@/hooks/usePepEntregas"
import { usePepSharepoint } from "@/hooks/usePepSharepoint"
import { periodoDoMes } from "@/hooks/useRemuneracao"
import { COMPETENCIA_TESTE_PEP, calcularAjusteRecorrentes } from "@/lib/remuneracao/calculoPEP"
import type { ConferenciaMes } from "@/lib/remuneracao/situacaoEntregasPep"
import { analistasDaGrade, pacientesCCDoProfissional } from "@/lib/remuneracao/visaoGeralPep"
import { ajusteDaEvidencia } from "@/lib/roboSharepoint/ajusteNome"
import { conferirMes, listarConferencias } from "@/services/pepSituacao.service"
import { resolverItem, reverterEntregaRobo } from "@/services/roboSharepoint.service"
import type { PepCatalogoItem, PepEvidencia, PepStatusEntrega } from "@/types/pep"
import type { SpItem } from "@/types/roboSharepoint"
import { PepHistoricoModal } from "./PepHistoricoModal"
import { AjusteNomeContexto, type ConferirAjuste } from "./pep/ajusteNome"
import { CabecalhoEntregasMensais } from "./pep/CabecalhoEntregasMensais"
import {
  addMeses,
  competenciaDaData,
  confirmarComMotivo,
  normalizarEvidencias,
  quantidadeEsperada,
  statusRecorrente,
} from "./pep/Celulas"
import { EvidenciasSharepoint, type AvaliacaoSugestao } from "./pep/EvidenciasSharepoint"
import { LegendaOrigem, contarOrigem } from "./pep/origem"
import { PainelQuantidade } from "./pep/PainelQuantidade"
import { PainelSemestral } from "./pep/PainelSemestral"
import {
  MatrizSemestral,
  SeletorPrestador,
  TabelaGeralAnalista,
  TabelaMensalPacientes,
} from "./pep/TabelasAnalista"
import { BarraCompetencia, VisaoGeralPep } from "./pep/VisaoGeralPep"

// Motivo gravado na trilha de auditoria quando a entrega vem de uma sugestão
// do robô SharePoint (a pessoa que clicou em "Confirmar" é quem fica como autora).
const MOTIVO_SHAREPOINT = "Evidência do SharePoint confirmada (robô)"

/** Data de envio do arquivo no fuso de Brasília, 'YYYY-MM-DD'. */
function dataBrasilia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
}

type CelulaAtiva = { pacienteNome: string | null; item: PepCatalogoItem } | null

function SecaoTitulo({ numero, children, nota }: { numero: number; children: React.ReactNode; nota?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="text-base font-semibold text-foreground">
        <span className="mr-1.5 tabular-nums text-muted-foreground">{numero}.</span>
        {children}
      </h2>
      {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
    </div>
  )
}

export function PepEntregasTab() {
  const { resultado, controlesGrade } = useRemuneracaoRPContext()
  const { setHeader, setRightContent } = useHeader()
  const { confirmar, dialogo } = useConfirmacao()
  const motivoReabrirRef = useRef("")

  const [prestador, setPrestador] = useState("")
  const [celulaAtiva, setCelulaAtiva] = useState<CelulaAtiva>(null)
  const [historicoAberto, setHistoricoAberto] = useState<"prestador" | "geral" | null>(null)

  // Um único seletor de mês pra tela inteira — o de "Entregas mensais" abaixo.
  // `controlesGrade.periodo` já é a mesma "competência que fechou" por
  // padrão (mesFechadoAnterior em useRemuneracao.ts); não existe mais um
  // segundo estado de mês no cabeçalho pra manter sincronizado.
  const competencia = controlesGrade.periodo.de.slice(0, 7)
  const { carregarGradeAuto, carregarGradeDoBanco, gradeLoading, gradeErroResumo } = controlesGrade
  const { semanas: semanasCalendario, loading: calendarioLoading } = usePepCalendario(competencia)

  // A Grade carregada aqui alimenta o mesmo contexto compartilhado das abas
  // Rem. Mês - Total e Individual — não precisa reanexar ao trocar de aba.
  // Sem seletor de mês no cabeçalho nesta tela: o mês é escolhido só em
  // "Entregas mensais", que já recarrega a Grade junto (ver onChange abaixo).
  useEffect(() => {
    setHeader("Entregas PEP", "Relacionamento Prestador")
    setRightContent(null)
    return () => {
      setHeader("", "")
      setRightContent(null)
    }
  }, [setHeader, setRightContent])

  // Roster da Grade: quem atende como Coordenador de Caso no mês, com seus
  // pacientes — a mesma regra da visão geral (lib/remuneracao/visaoGeralPep.ts).
  const analistasGrade = useMemo(() => analistasDaGrade(resultado ?? []), [resultado])

  // O "Modo teste" (par de homologação do robô SharePoint) saiu em 02/10/2026:
  // a homologação acabou e o interruptor só confundia nas duas visões.
  const analistas = useMemo(() => analistasGrade.map(a => a.nome), [analistasGrade])

  // Deep link vindo de outra tela (ex.: "Abrir Entregas PEP" no modal de
  // Rem. Mês - Total): ?competencia=YYYY-MM&prestador=Nome. Aplica só uma vez
  // — depois disso o usuário controla o seletor normalmente.
  const searchParams = useSearchParams()
  const competenciaParam = searchParams.get("competencia")
  const prestadorParam = searchParams.get("prestador")
  const aplicouCompetenciaParam = useRef(false)
  const [prestadorParamAplicado, setPrestadorParamAplicado] = useState(false)

  useEffect(() => {
    if (aplicouCompetenciaParam.current || !competenciaParam) return
    const match = /^(\d{4})-(\d{2})$/.exec(competenciaParam)
    if (!match) return
    aplicouCompetenciaParam.current = true
    carregarGradeDoBanco(periodoDoMes(Number(match[1]), Number(match[2])))
  }, [competenciaParam, carregarGradeDoBanco])

  // Primeira carga da Grade — guardada por ref dentro de carregarGradeAuto,
  // então é seguro chamar de novo. Esta tela abre no MÊS VIGENTE.
  useEffect(() => {
    if (competenciaParam) { carregarGradeAuto(); return }
    const hoje = new Date()
    carregarGradeAuto(periodoDoMes(hoje.getFullYear(), hoje.getMonth() + 1))
  }, [carregarGradeAuto, competenciaParam])

  if (!prestadorParamAplicado && prestadorParam && analistas.includes(prestadorParam)) {
    setPrestadorParamAplicado(true)
    setPrestador(prestadorParam)
  }

  const pacientes = useMemo(() => {
    const p = (resultado ?? []).find(r => r.prof === prestador)
    return p ? pacientesCCDoProfissional(p) : []
  }, [resultado, prestador])

  const {
    itensRecorrentes, itensSemestrais, registros, recarregar: recarregarEntregas,
    loading, error, salvando,
    registroDe, registroSemestralDe, planejamentoDe,
    marcarEntrega, marcarQuantidade, cadastrarPlanejamento,
    excluirRegistro, excluirPlanejamento,
  } = usePepEntregas(prestador, competencia, pacientes)

  const { parametros, loading: parametrosLoading } = useParametrosGerais()
  const valorMensalPorPaciente = parametros?.cc_pe_default ?? 0
  const pacientesApuracao = useMemo(() => pacientes.map(nome => ({ nome })), [pacientes])
  const { resultados: resultadosApuracao, resultadoDe, totalPrestador, loading: apuracaoLoading, recalcular: recalcularApuracao, liberado, liberar, reabrir } = usePepApuracao(
    prestador, competencia, pacientesApuracao, valorMensalPorPaciente
  )
  const { itens: spItens, carregando: spCarregando, recarregar: recarregarSp } = usePepSharepoint(prestador, competencia)

  // Selo "Ajustar nomenclatura" (14/10/2026): a entrega vale mesmo com o nome
  // fora do padrão, mas a unidade carrega o aviso até o arquivo ser renomeado.
  const spPorId = useMemo(() => new Map(spItens.map(i => [i.sp_id, i])), [spItens])
  const conferirAjuste = useCallback<ConferirAjuste>(
    (ev, indice, pacienteNome, item) => ajusteDaEvidencia(ev, {
      sigla: item.sigla, tipoRegistro: item.tipo_registro, pacienteNome, competencia, spPorId,
    }, indice),
    [spPorId, competencia]
  )

  // "Conferido" (20261003110000): uma pessoa conferiu as entregas do analista no
  // mês. Vale até uma entrega dele mudar depois — a visão geral usa a mesma regra.
  const [conferencia, setConferencia] = useState<ConferenciaMes | null>(null)
  const [conferindo, setConferindo] = useState(false)
  const carregarConferencia = useCallback(async () => {
    if (!prestador || !competencia) { setConferencia(null); return }
    const todas = await listarConferencias(competencia)
    setConferencia(todas.find(c => c.prestador_nome === prestador) ?? null)
  }, [prestador, competencia])
  useEffect(() => { void carregarConferencia() }, [carregarConferencia])
  const conferenciaValida = !!conferencia && !registros.some(r => Date.parse(r.updated_at) > Date.parse(conferencia.conferido_em))
  const alternarConferencia = useCallback(async (conferir: boolean) => {
    setConferindo(true)
    try {
      await conferirMes(prestador, competencia, conferir)
      await carregarConferencia()
      toast.success(conferir ? "Entregas marcadas como conferidas." : "Conferência desfeita.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar a conferência.")
    } finally {
      setConferindo(false)
    }
  }, [prestador, competencia, carregarConferencia])

  async function pedirConfirmacaoLiberar() {
    const ok = await confirmar({
      titulo: "Liberar Faturamento",
      texto: `Confirma a liberação do faturamento de ${prestador} para ${competencia}? Depois de liberado, os lançamentos desta competência ficam bloqueados para edição até uma reabertura.`,
      confirmar: "Liberar",
      t: "verde",
    })
    if (ok) await liberar()
  }

  async function pedirConfirmacaoReabrir() {
    motivoReabrirRef.current = ""
    const motivo = await confirmarComMotivo(confirmar, {
      titulo: "Reabrir Faturamento",
      mensagem: `Reabrir permite editar novamente os lançamentos de ${prestador} em ${competencia}. Essa ação fica registrada na trilha de auditoria.`,
      confirmLabel: "Reabrir",
      t: "vermelho",
      motivoRef: motivoReabrirRef,
    })
    if (motivo) await reabrir(motivo)
  }

  // Quanto do apurado veio do robô e quanto de pessoas (20261002100000), e
  // quantas unidades do mês foram marcadas por pessoas.
  const valoresOrigem = useMemo(() => resultadosApuracao.length === 0 ? null : {
    robo: resultadosApuracao.reduce((s, r) => s + (Number(r.valor_robo) || 0), 0),
    humano: resultadosApuracao.reduce((s, r) => s + (Number(r.valor_humano) || 0), 0),
  }, [resultadosApuracao])
  const unidadesPessoa = useMemo(
    () => registros.filter(r => r.competencia === competencia).reduce((s, r) => s + contarOrigem(r).humano, 0),
    [registros, competencia]
  )

  const itensGerais = useMemo(() => itensRecorrentes.filter(i => i.tipo_registro === "GERAL"), [itensRecorrentes])
  const itensPorPaciente = useMemo(() => itensRecorrentes.filter(i => i.tipo_registro === "POR_PACIENTE"), [itensRecorrentes])

  const catalogoCompleto = useMemo(() => [...itensRecorrentes, ...itensSemestrais], [itensRecorrentes, itensSemestrais])

  // Contagem de itens completos no mês — completude objetiva (a quantidade
  // registrada alcançou a esperada), nunca avaliação de mérito (PRD §12.4).
  const progressoMensal = useMemo(() => {
    let completos = 0
    let total = 0
    for (const item of itensGerais) {
      total += 1
      if (statusRecorrente(item, semanasCalendario, registroDe(null, item.id)).completo) completos += 1
    }
    for (const paciente of pacientes) {
      for (const item of itensPorPaciente) {
        total += 1
        if (statusRecorrente(item, semanasCalendario, registroDe(paciente, item.id)).completo) completos += 1
      }
    }
    return { completos, total }
  }, [itensGerais, itensPorPaciente, pacientes, semanasCalendario, registroDe])

  // Quanto os itens Geral (Supervisão/Estudo) incompletos reduziriam de CADA
  // paciente do prestador, se ficarem assim até o fechamento.
  const impactoGeral = useMemo(() => {
    if (itensGerais.length === 0 || valorMensalPorPaciente <= 0) return 0
    const entregas = itensGerais.map(item => {
      const { esperado, entregue } = statusRecorrente(item, semanasCalendario, registroDe(null, item.id))
      return { itemCodigo: item.codigo, pesoMensal: item.peso_mensal, quantidadeEsperada: esperado, quantidadeEntregue: entregue }
    })
    return calcularAjusteRecorrentes(entregas, valorMensalPorPaciente).reduce((soma, a) => soma + a.valor, 0)
  }, [itensGerais, semanasCalendario, registroDe, valorMensalPorPaciente])

  // Carga única também ao abrir um analista (pedido de 02/10/2026).
  const carregandoAnalista = gradeLoading || loading || apuracaoLoading || spCarregando || calendarioLoading || parametrosLoading
  const [analistaPronto, setAnalistaPronto] = useState("")
  useEffect(() => {
    if (!prestador || carregandoAnalista || analistaPronto === prestador) return
    const id = setTimeout(() => setAnalistaPronto(prestador), 200)
    return () => clearTimeout(id)
  }, [prestador, carregandoAnalista, analistaPronto])
  useEffect(() => {
    if (!prestador || analistaPronto === prestador) return
    const id = setTimeout(() => setAnalistaPronto(prestador), 15000)
    return () => clearTimeout(id)
  }, [prestador, analistaPronto])
  const analistaVisivel = !!prestador && analistaPronto === prestador

  // Trocar de visão leva ao TOPO da página.
  const topoRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    topoRef.current?.scrollIntoView({ block: "start" })
    window.scrollTo({ top: 0 })
  }, [prestador])

  // "Visão geral do mês" no cabeçalho, com a seta de voltar.
  useEffect(() => {
    setRightContent(prestador ? (
      <button
        type="button"
        onClick={() => setPrestador("")}
        className={`${btnSecundario} min-h-11 sm:min-h-0`}
      >
        <ArrowLeft size={16} aria-hidden /> Visão geral do mês
      </button>
    ) : null)
  }, [prestador, setRightContent])

  // Carga única da visão geral (pedido de 02/10/2026).
  const [roboPronto, setRoboPronto] = useState(false)
  const [visaoPronta, setVisaoPronta] = useState(false)
  const [primeiraCargaFeita, setPrimeiraCargaFeita] = useState(false)
  const marcarRoboPronto = useCallback(() => setRoboPronto(true), [])
  const marcarVisaoPronta = useCallback(() => setVisaoPronta(true), [])
  const gradePronta = !gradeLoading && (resultado != null || !!gradeErroResumo)
  const tudoCarregado = roboPronto && gradePronta && !parametrosLoading && (analistas.length === 0 || visaoPronta)
  const [visaoAnterior, setVisaoAnterior] = useState(prestador)
  const trocouDeVisao = visaoAnterior !== prestador
  if (trocouDeVisao) {
    setVisaoAnterior(prestador)
    if (!prestador) { setRoboPronto(false); setVisaoPronta(false); setPrimeiraCargaFeita(false) }
  }
  if (!trocouDeVisao && tudoCarregado && !primeiraCargaFeita) setPrimeiraCargaFeita(true)
  useEffect(() => {
    if (primeiraCargaFeita) return
    const id = setTimeout(() => setPrimeiraCargaFeita(true), 15000)
    return () => clearTimeout(id)
  }, [primeiraCargaFeita])
  const visaoGeralVisivel = !trocouDeVisao && (primeiraCargaFeita || tudoCarregado)

  // Tela inicial, antes de escolher um analista: a visão do mês inteiro.
  if (!prestador) {
    return (
      <div ref={topoRef} className="space-y-5">
        {!visaoGeralVisivel && (
          <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Carregando Entregas PEP…
            </span>
          </div>
        )}
        {/* Tudo monta escondido (para os dados carregarem em paralelo) e aparece de uma vez. */}
        <div className={visaoGeralVisivel ? "space-y-5" : "hidden"}>
          <BarraCompetencia
            competencia={competencia}
            onMudarMes={(ano, mes) => carregarGradeDoBanco(periodoDoMes(ano, mes))}
            carregando={gradeLoading}
            modoTeste={competencia === COMPETENCIA_TESTE_PEP}
          />
          {gradeErroResumo && (
            <div className={aviso("red")}>
              <span className="font-medium">{gradeErroResumo}</span>
            </div>
          )}
          <SeletorPrestador
            analistas={analistas}
            prestador={prestador}
            onChange={setPrestador}
            onHistoricoGeral={() => setHistoricoAberto("geral")}
            carregando={gradeLoading}
          />
          <RoboNaPep onCarregado={marcarRoboPronto} competencia={competencia} analistas={analistasGrade} />
          {gradeLoading ? (
            <Cartao className="space-y-2">
              <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
            </Cartao>
          ) : analistas.length === 0 ? (
            <EstadoVazio
              Icone={Users}
              titulo="Nenhum Analista do Comportamento na grade deste mês"
              texto="Troque o mês acima para ver outra competência."
            />
          ) : (
            <VisaoGeralPep
              competencia={competencia}
              analistas={analistasGrade}
              valorPorPaciente={valorMensalPorPaciente}
              onSelecionar={setPrestador}
              onCarregado={marcarVisaoPronta}
            />
          )}
        </div>
        {historicoAberto === "geral" && (
          <PepHistoricoModal catalogo={catalogoCompleto} onClose={() => setHistoricoAberto(null)} />
        )}
      </div>
    )
  }

  // Entrega semestral — uma regra só para o painel manual e para a sugestão do
  // SharePoint. Entrega antecipada reprograma o próximo ciclo (marco zero + 6
  // meses a partir da competência em que foi de fato entregue).
  async function registrarEntregaSemestral(pacienteNome: string | null, item: PepCatalogoItem, dados: {
    status: PepStatusEntrega
    evidencias: PepEvidencia[]
    observacao: string | null
    motivo: string | null
    dataEntrega: string
  }) {
    const plano = pacienteNome ? planejamentoDe(pacienteNome, item.id) : null
    const competenciaEntrega = competenciaDaData(dados.dataEntrega)
    const antecipada = plano && competenciaEntrega < plano.competencia_planejada ? plano : null

    const r = await marcarEntrega({
      pacienteNome,
      itemId: item.id,
      status: dados.status,
      observacao: dados.observacao,
      evidencias: dados.evidencias,
      motivo: dados.motivo,
      competencia: competenciaEntrega,
      dataEntrega: dados.dataEntrega,
    })

    if (r.ok && dados.status === "entregue" && antecipada && pacienteNome) {
      const proximaCompetencia = addMeses(competenciaEntrega, 6)
      await cadastrarPlanejamento({
        pacienteNome,
        itemId: item.id,
        competenciaPlanejada: proximaCompetencia,
        dataPlanejada: `${proximaCompetencia}-01`,
        reprogramarDe: antecipada,
      })
    }

    await recalcularApuracao()
    return r
  }

  // ── Sugestões do robô SharePoint ────────────────────────────────────────────
  function avaliarSugestao(sp: SpItem): AvaliacaoSugestao {
    const cat = catalogoCompleto.find(c => c.id === sp.item_id)
    if (!cat) return { pode: false, motivo: "Item do PEP desconhecido." }
    if (liberado) return { pode: false, motivo: "Faturamento deste mês já liberado. Reabra para registrar." }
    const pac = cat.tipo_registro === "GERAL" ? null : sp.paciente_nome
    if (pac && !pacientes.includes(pac)) {
      return { pode: false, motivo: "Paciente não está entre os pacientes deste analista na Grade do mês." }
    }
    if (cat.classe === "recorrente") {
      const reg = registroDe(pac, cat.id)
      if (reg?.evidencias?.some(e => e.caminho === sp.web_url)) return { pode: true }
      const { esperado, entregue } = statusRecorrente(cat, semanasCalendario, reg)
      if (entregue >= esperado) return { pode: false, motivo: `${cat.sigla} já está completo neste mês (${entregue}/${esperado}).` }
      return { pode: true }
    }
    if (!pac || !planejamentoDe(pac, cat.id)) {
      return { pode: false, motivo: "Planeje este item em “Entregas semestrais” antes de confirmar a entrega." }
    }
    if (registroSemestralDe(pac, cat.id)?.status === "entregue") {
      return { pode: false, motivo: "Este documento já está registrado como entregue neste ciclo." }
    }
    return { pode: true }
  }

  async function confirmarSugestao(sp: SpItem): Promise<boolean> {
    const cat = catalogoCompleto.find(c => c.id === sp.item_id)
    if (!cat) return false
    const pac = cat.tipo_registro === "GERAL" ? null : sp.paciente_nome
    const evidencia: PepEvidencia = { caminho: sp.web_url ?? sp.caminho ?? sp.nome, nome: sp.nome, origem: "humano", sp_id: sp.sp_id }
    let registroId: string | null = null
    let competenciaFinal = sp.competencia

    if (cat.classe === "recorrente") {
      const reg = registroDe(pac, cat.id)
      if (reg && reg.evidencias?.some(e => e.caminho === evidencia.caminho)) {
        registroId = reg.id
      } else {
        const { esperado, entregue } = statusRecorrente(cat, semanasCalendario, reg)
        const r = await marcarQuantidade({
          pacienteNome: pac,
          pacienteCpf: sp.paciente_cpf,
          itemId: cat.id,
          quantidadeEntregue: entregue + 1,
          quantidadeEsperada: esperado,
          observacao: reg?.observacao ?? null,
          evidencias: [...normalizarEvidencias(reg?.evidencias ?? [], entregue), evidencia],
          motivo: MOTIVO_SHAREPOINT,
        })
        if (!r.ok) { toast.error("Não foi possível registrar a entrega."); return false }
        registroId = r.registro?.id ?? null
        await recalcularApuracao()
      }
      competenciaFinal = competencia
    } else {
      let dataEntrega = sp.criado_em_sp ? dataBrasilia(sp.criado_em_sp) : `${sp.competencia}-01`
      if (sp.competencia && competenciaDaData(dataEntrega) !== sp.competencia) dataEntrega = `${sp.competencia}-01`
      const r = await registrarEntregaSemestral(pac, cat, {
        status: "entregue", evidencias: [evidencia], observacao: null, motivo: MOTIVO_SHAREPOINT, dataEntrega,
      })
      if (!r.ok) { toast.error("Não foi possível registrar a entrega."); return false }
      registroId = r.registro?.id ?? null
      competenciaFinal = competenciaDaData(dataEntrega)
    }

    try {
      await resolverItem({ spId: sp.sp_id, acao: "confirmar", registroEntregaId: registroId, competencia: competenciaFinal })
      toast.success(`${cat.sigla} registrado com a evidência do SharePoint.`)
    } catch (e) {
      toast.error(`Entrega registrada, mas a sugestão não foi marcada: ${e instanceof Error ? e.message : "erro"}`)
    }
    await recarregarSp()
    return true
  }

  async function desfazerEntregaRobo(sp: SpItem, motivo: string): Promise<boolean> {
    try {
      await reverterEntregaRobo(sp.sp_id, motivo)
      await recarregarEntregas()
      await recalcularApuracao()
      await recarregarSp()
      toast.success(`Entrega do robô desfeita: ${sp.sigla ?? ""} ${sp.paciente_nome ?? ""}`.trim())
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desfazer a entrega.")
      return false
    }
  }

  async function ignorarSugestao(sp: SpItem): Promise<boolean> {
    try {
      await resolverItem({ spId: sp.sp_id, acao: "ignorar" })
      await recarregarSp()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ignorar a sugestão.")
      return false
    }
  }

  return (
    <AjusteNomeContexto.Provider value={conferirAjuste}>
      <div ref={topoRef} className="space-y-6">
        {!analistaVisivel && (
          <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> Carregando as entregas de {prestador}…
            </span>
          </div>
        )}
        <div className={analistaVisivel ? "space-y-6" : "hidden"}>
          <SecaoTitulo numero={1}>Analista do Comportamento</SecaoTitulo>
          <SeletorPrestador
            analistas={analistas}
            prestador={prestador}
            onChange={setPrestador}
            onHistoricoGeral={() => setHistoricoAberto("geral")}
            onHistoricoPrestador={() => setHistoricoAberto("prestador")}
            carregando={gradeLoading}
          />

          <SecaoTitulo numero={2}>Entregas mensais</SecaoTitulo>
          <div className="space-y-4">
            <CabecalhoEntregasMensais
              competencia={competencia}
              onMudarMes={(ano, mes) => carregarGradeDoBanco(periodoDoMes(ano, mes))}
              carregandoLabel={
                gradeLoading ? "Carregando grade…" : salvando ? "Salvando…" : apuracaoLoading ? "Atualizando valores apurados…" : null
              }
              progresso={progressoMensal}
              mostrarValores={valorMensalPorPaciente > 0 && pacientes.length > 0}
              potencial={pacientes.length * valorMensalPorPaciente}
              alcancado={totalPrestador}
              apuracaoLoading={apuracaoLoading}
              liberado={liberado}
              conferencia={conferenciaValida ? conferencia : null}
              conferenciaInvalidada={!!conferencia && !conferenciaValida}
              conferindo={conferindo}
              onConferir={alternarConferencia}
              onLiberar={pedirConfirmacaoLiberar}
              onReabrir={pedirConfirmacaoReabrir}
              modoTeste={competencia === COMPETENCIA_TESTE_PEP}
              erros={[gradeErroResumo, error]}
            />

            <LegendaOrigem />

            <EvidenciasSharepoint
              itens={spItens}
              catalogo={catalogoCompleto}
              avaliar={avaliarSugestao}
              onConfirmar={confirmarSugestao}
              onIgnorar={ignorarSugestao}
              onDesfazer={desfazerEntregaRobo}
              valores={valoresOrigem}
              unidadesPessoa={unidadesPessoa}
              liberado={liberado}
            />

            <TabelaGeralAnalista
              itensGerais={itensGerais}
              semanasCalendario={semanasCalendario}
              registroDe={registroDe}
              onAbrirPainel={item => setCelulaAtiva({ pacienteNome: null, item })}
              liberado={liberado}
              impactoGeral={impactoGeral}
              totalPacientes={pacientes.length}
            />

            <TabelaMensalPacientes
              loading={loading}
              pacientes={pacientes}
              itensPorPaciente={itensPorPaciente}
              semanasCalendario={semanasCalendario}
              registroDe={registroDe}
              resultadoDe={resultadoDe}
              catalogoCompleto={catalogoCompleto}
              apuracaoLoading={apuracaoLoading}
              liberado={liberado}
              onAbrirPainel={(pacienteNome, item) => setCelulaAtiva({ pacienteNome, item })}
            />
          </div>

          <SecaoTitulo numero={3} nota="independe do mês acima — vale para o ano inteiro (PRD §7.2)">
            Entregas semestrais
          </SecaoTitulo>
          <MatrizSemestral
            pacientes={pacientes}
            itensSemestrais={itensSemestrais}
            planejamentoDe={planejamentoDe}
            registroSemestralDe={registroSemestralDe}
            onAbrirPainel={(pacienteNome, item) => setCelulaAtiva({ pacienteNome, item })}
            disabled={liberado}
          />

          {celulaAtiva && celulaAtiva.item.classe === "recorrente" && (
            <PainelQuantidade
              pacienteNome={celulaAtiva.pacienteNome}
              item={celulaAtiva.item}
              competencia={competencia}
              semanasCalendario={semanasCalendario}
              registro={registroDe(celulaAtiva.pacienteNome, celulaAtiva.item.id)}
              erro={error}
              onFechar={() => setCelulaAtiva(null)}
              onSalvar={async ({ quantidadeEntregue, evidencias, observacao, motivo }) => {
                await marcarQuantidade({
                  pacienteNome: celulaAtiva.pacienteNome,
                  itemId: celulaAtiva.item.id,
                  quantidadeEntregue,
                  quantidadeEsperada: quantidadeEsperada(celulaAtiva.item, semanasCalendario),
                  observacao,
                  evidencias,
                  motivo,
                })
                await recalcularApuracao()
                setCelulaAtiva(null)
              }}
              onExcluir={
                registroDe(celulaAtiva.pacienteNome, celulaAtiva.item.id)
                  ? async (motivo) => {
                      const registro = registroDe(celulaAtiva.pacienteNome, celulaAtiva.item.id)
                      if (!registro) return false
                      const r = await excluirRegistro({ id: registro.id, pacienteNome: celulaAtiva.pacienteNome, motivo })
                      if (r.ok) {
                        await recalcularApuracao()
                        setCelulaAtiva(null)
                      }
                      return r.ok
                    }
                  : undefined
              }
            />
          )}

          {celulaAtiva && celulaAtiva.item.classe === "semestral" && (
            <PainelSemestral
              pacienteNome={celulaAtiva.pacienteNome}
              item={celulaAtiva.item}
              registro={registroSemestralDe(celulaAtiva.pacienteNome ?? "", celulaAtiva.item.id)}
              planejamento={celulaAtiva.pacienteNome ? planejamentoDe(celulaAtiva.pacienteNome, celulaAtiva.item.id) : null}
              erro={error}
              onFechar={() => setCelulaAtiva(null)}
              onSalvarPlanejamento={async (dataPlanejada) => {
                if (!celulaAtiva.pacienteNome) return
                await cadastrarPlanejamento({
                  pacienteNome: celulaAtiva.pacienteNome,
                  itemId: celulaAtiva.item.id,
                  competenciaPlanejada: competenciaDaData(dataPlanejada),
                  dataPlanejada,
                })
                await recalcularApuracao()
              }}
              onSalvarEntrega={async ({ status, evidencias, observacao, motivo, dataEntrega }) => {
                await registrarEntregaSemestral(celulaAtiva.pacienteNome, celulaAtiva.item, {
                  status, evidencias, observacao: observacao ?? null, motivo: motivo ?? null, dataEntrega,
                })
                setCelulaAtiva(null)
              }}
              onSalvarReprogramacaoImpedimento={async ({ dataPlanejada, motivo, evidencias }) => {
                if (!celulaAtiva.pacienteNome) return
                const plano = planejamentoDe(celulaAtiva.pacienteNome, celulaAtiva.item.id)
                await cadastrarPlanejamento({
                  pacienteNome: celulaAtiva.pacienteNome,
                  itemId: celulaAtiva.item.id,
                  competenciaPlanejada: competenciaDaData(dataPlanejada),
                  dataPlanejada,
                  reprogramarDe: plano,
                  origem: "reprogramacao_impedimento",
                  motivo,
                  evidencias,
                })
                await recalcularApuracao()
                setCelulaAtiva(null)
              }}
              onExcluirEntrega={
                registroSemestralDe(celulaAtiva.pacienteNome ?? "", celulaAtiva.item.id)
                  ? async (motivo) => {
                      const registro = registroSemestralDe(celulaAtiva.pacienteNome ?? "", celulaAtiva.item.id)
                      if (!registro) return false
                      const r = await excluirRegistro({ id: registro.id, pacienteNome: celulaAtiva.pacienteNome, motivo })
                      if (r.ok) {
                        await recalcularApuracao()
                        setCelulaAtiva(null)
                      }
                      return r.ok
                    }
                  : undefined
              }
              onExcluirPlanejamento={
                celulaAtiva.pacienteNome
                  ? async (motivo) => {
                      const plano = planejamentoDe(celulaAtiva.pacienteNome!, celulaAtiva.item.id)
                      if (!plano) return false
                      const r = await excluirPlanejamento({ id: plano.id, pacienteNome: celulaAtiva.pacienteNome!, motivo })
                      if (r.ok) {
                        await recalcularApuracao()
                        setCelulaAtiva(null)
                      }
                      return r.ok
                    }
                  : undefined
              }
            />
          )}

          {historicoAberto && (
            <PepHistoricoModal
              prestadorNome={historicoAberto === "prestador" ? prestador : undefined}
              catalogo={catalogoCompleto}
              onClose={() => setHistoricoAberto(null)}
            />
          )}
          {dialogo}
        </div>
      </div>
    </AjusteNomeContexto.Provider>
  )
}
