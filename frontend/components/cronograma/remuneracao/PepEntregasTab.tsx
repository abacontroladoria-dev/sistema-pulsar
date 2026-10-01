"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Paperclip, Check, AlertTriangle, CalendarPlus, X, Trash2, History, Loader2, LayoutDashboard, ExternalLink } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { useRemuneracaoRPContext } from "@/contexts/RemuneracaoRPContext"
import { useParametrosGerais } from "@/hooks/useParametrosGerais"
import { usePepEntregas } from "@/hooks/usePepEntregas"
import { usePepApuracao } from "@/hooks/usePepApuracao"
import { usePepCalendario } from "@/hooks/usePepCalendario"
import { periodoDoMes } from "@/hooks/useRemuneracao"
import { SeletorMesPrevisao } from "@/components/cronograma/indicadores/SeletorMesPrevisao"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import { DatePicker } from "@/components/ui/date-picker"
import { PepHistoricoModal } from "./PepHistoricoModal"
import { BarraCompetencia, NotaFaturamento, VisaoGeralPep, faturamentoDaCompetencia } from "./pep/VisaoGeralPep"
import { ExplicacaoPepTooltip } from "./pep/ExplicacaoPepTooltip"
import { analistasDaGrade, pacientesCCDoProfissional } from "@/lib/remuneracao/visaoGeralPep"
import { COMPETENCIA_TESTE_PEP, calcularAjusteRecorrentes } from "@/lib/remuneracao/calculoPEP"
import type { PepCatalogoItem, PepEvidencia, PepPlanejamentoSemestral, PepRegistroEntrega, PepStatusEntrega } from "@/types/pep"
import toast from "react-hot-toast"
import { usePepSharepoint } from "@/hooks/usePepSharepoint"
import { EvidenciasSharepoint, type AvaliacaoSugestao } from "./pep/EvidenciasSharepoint"
import { ChipOrigem, LegendaOrigem, ORIGEM, SeloUnidade, contarOrigem, origemDaUnidade } from "./pep/origem"
import { RoboNaPep } from "@/components/admin/roboSharepoint/RoboNaPep"
import { resolverItem, reverterEntregaRobo } from "@/services/roboSharepoint.service"
import type { SpItem } from "@/types/roboSharepoint"

// Motivo gravado na trilha de auditoria quando a entrega vem de uma sugestão
// do robô SharePoint (a pessoa que clicou em "Confirmar" é quem fica como autora).
const MOTIVO_SHAREPOINT = "Evidência do SharePoint confirmada (robô)"

/** Data de envio do arquivo no fuso de Brasília, 'YYYY-MM-DD'. */
function dataBrasilia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
}

const money = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`

/** 'YYYY-MM-DD' → 'DD/MM/AAAA'. Sem hora em nenhum lugar (PRD §2.2). */
function formatarDataBR(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.split("-")
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : "—"
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. A competência é sempre DERIVADA da data (PRD §2.2/§3/§6), nunca o contrário. */
function competenciaDaData(iso: string): string {
  return iso.slice(0, 7)
}

function competenciaDoMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function addMeses(competencia: string, meses: number): string {
  const [y, m] = competencia.split("-").map(Number)
  const d = new Date(y, m - 1 + meses, 1)
  return competenciaDoMes(d)
}

// Quantidade esperada no mês para um item recorrente. PRD Seção 9.11: só os
// itens SEMANAIS (Supervisão/Estudo) variam com o calendário — calculado
// automaticamente a partir dos feriados (usePepCalendario). TAP/Parental usam
// sempre a referência fixa do catálogo (Seção 7.2).
function quantidadeEsperada(item: PepCatalogoItem, semanasCalendario: number): number {
  if (item.periodicidade === "semanal") return semanasCalendario
  return item.qtd_referencia_mes ?? 1
}

// Quantos meses se passaram entre a competência planejada e a atual —
// PRD Seção 10.1: dentro de 1 mês do vencimento ainda é "aceite postergado"
// normal; a partir de 2 meses é pendência reiterada (o sistema deve
// sinalizar — risco de inadimplemento de obrigação essencial).
function mesesEntre(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number)
  const [by, bm] = b.split("-").map(Number)
  return (by - ay) * 12 + (bm - am)
}

// Garante exatamente `n` posições de evidência, preservando o que já existia.
function normalizarEvidencias(evidencias: PepEvidencia[], n: number): PepEvidencia[] {
  const base = Array.from({ length: n }, (_, i) => evidencias[i] ?? { caminho: "", nome: null })
  return base
}

type StatusRecorrente = { esperado: number; entregue: number; completo: boolean; parcial: boolean }

// Única fonte da regra "completo/parcial" para item recorrente — usada tanto
// pela célula da tabela mensal quanto pelo indicador de progresso agregado,
// pra não duplicar a leitura de quantidadeEsperada em dois lugares.
function statusRecorrente(item: PepCatalogoItem, semanasCalendario: number, registro: RegistroResumo): StatusRecorrente {
  const esperado = quantidadeEsperada(item, semanasCalendario)
  const entregue = registro?.quantidade_entregue ?? 0
  return { esperado, entregue, completo: entregue >= esperado, parcial: entregue > 0 && entregue < esperado }
}

type StatusSemestral = {
  statusLabel: string
  statusTone: string
  entregue: boolean
  icone: "check" | "alert" | "calendar" | null
  link: string | null
}

// Extraído 1:1 da lógica que antes vivia inline em TabelaSemestralPaciente —
// nenhuma regra de vencido/reiterada/retroativo/reprogramado muda aqui.
function statusSemestral(item: PepCatalogoItem, plano: PepPlanejamentoSemestral | null, registro: RegistroResumo, hoje: string): StatusSemestral {
  const entregue = registro?.status === "entregue"
  const link = registro?.evidencias?.find(e => e.caminho)?.caminho ?? null

  if (!plano) {
    return { statusLabel: "Planejar", statusTone: "text-muted-foreground", entregue: false, icone: "calendar", link }
  }

  if (entregue) {
    const retroativo = !!(registro?.data_entrega && plano.data_planejada && registro.data_entrega > plano.data_planejada)
    return {
      statusLabel: retroativo ? "Realizado (retroativo)" : "Realizado",
      statusTone: "text-emerald-700 dark:text-emerald-400 font-medium",
      entregue: true,
      icone: "check",
      link,
    }
  }

  // `hoje` e a data planejada precisam comparar dia contra dia — comparar só a
  // competência (mês) marcava "Vencido" a partir do dia 1º do mês planejado,
  // mesmo quando o dia exato ainda não tinha chegado (ex.: planejado pra
  // 04/09, já aparecia vencido em 03/09).
  const dataPlanejadaISO = plano.data_planejada ?? `${plano.competencia_planejada}-01`
  const vencido = dataPlanejadaISO <= hoje
  const reiterada = vencido && mesesEntre(competenciaDaData(dataPlanejadaISO), competenciaDaData(hoje)) >= 2
  const reprogramado = plano.origem === "reprogramacao_impedimento" && !vencido
  const statusLabel = reprogramado ? "Reprogramado (REP-)" : reiterada ? "Pendência reiterada" : vencido ? "Vencido" : "Entrega pendente"
  const statusTone = reprogramado
    ? "text-sky-600 dark:text-sky-400 font-medium"
    : reiterada
      ? "text-rose-600 dark:text-rose-400 font-bold"
      : vencido
        ? "text-amber-700 dark:text-amber-400 font-medium"
        : "text-blue-700 dark:text-blue-400 font-medium"
  return { statusLabel, statusTone, entregue: false, icone: statusLabel !== "Entrega pendente" ? "alert" : null, link }
}

type CelulaAtiva = { pacienteNome: string | null; item: PepCatalogoItem } | null

// Fecha o modal só quando o próprio backdrop foi pressionado E solto — não
// quando o usuário estava selecionando texto (ex.: arrastando o mouse pra
// selecionar tudo na Observação) e soltou fora do card. Sem isso, o "click"
// do navegador é computado no backdrop mesmo o gesto tendo começado dentro,
// e o modal fechava no meio da seleção.
function useFecharAoClicarFora(onFechar: () => void) {
  const pressionouNoBackdrop = useRef(false)
  return {
    onMouseDown: (e: React.MouseEvent) => { pressionouNoBackdrop.current = e.target === e.currentTarget },
    onClick: () => { if (pressionouNoBackdrop.current) onFechar() },
  }
}

function SecaoTitulo({ numero, children, nota }: { numero: number; children: React.ReactNode; nota?: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#222847] text-[11px] font-bold text-white dark:bg-slate-600">
        {numero}
      </span>
      <h2 className="text-sm font-bold text-foreground">{children}</h2>
      {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
    </div>
  )
}

export function PepEntregasTab() {
  const { resultado, controlesGrade } = useRemuneracaoRPContext()
  const { setHeader, setRightContent } = useHeader()

  const [prestador, setPrestador] = useState("")
  const [celulaAtiva, setCelulaAtiva] = useState<CelulaAtiva>(null)
  const [historicoAberto, setHistoricoAberto] = useState<"prestador" | "geral" | null>(null)

  // Um único seletor de mês pra tela inteira — o de "Entregas mensais" abaixo.
  // `controlesGrade.periodo` já é a mesma "competência que fechou" por
  // padrão (mesFechadoAnterior em useRemuneracao.ts); não existe mais um
  // segundo estado de mês no cabeçalho pra manter sincronizado.
  const competencia = controlesGrade.periodo.de.slice(0, 7)
  const { carregarGradeAuto, carregarGradeDoBanco, gradeLoading, gradeErroResumo } = controlesGrade
  const { semanas: semanasCalendario } = usePepCalendario(competencia)


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
  // — depois disso o usuário controla o seletor normalmente. A competência
  // troca a Grade carregada assim que chega; o prestador só pode ser
  // selecionado quando aparecer na lista de analistas (carrega de forma
  // assíncrona junto com a Grade).
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
  // então é seguro chamar de novo. Esta tela abre no MÊS VIGENTE (as demais
  // abas do segmento abrem no último mês fechado); se outra aba já carregou um
  // mês, a grade compartilhada é respeitada. Com deep link ?competencia=, quem
  // manda é o efeito acima.
  useEffect(() => {
    if (competenciaParam) { carregarGradeAuto(); return }
    const hoje = new Date()
    carregarGradeAuto(periodoDoMes(hoje.getFullYear(), hoje.getMonth() + 1))
  }, [carregarGradeAuto, competenciaParam])

  // Ajuste de estado durante a renderização (não em efeito, e com useState em
  // vez de ref — refs não podem ser lidas durante o render) — mesmo padrão já
  // usado em SearchCombobox.tsx: só dispara setState quando a condição muda,
  // então React descarta e re-renderiza uma vez, sem loop nem efeito externo.
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
  const { itens: spItens, recarregar: recarregarSp } = usePepSharepoint(prestador, competencia)
  const [confirmandoLiberar, setConfirmandoLiberar] = useState(false)
  const [confirmandoReabrir, setConfirmandoReabrir] = useState(false)
  const [motivoReabrir, setMotivoReabrir] = useState("")

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
  // Não substitui nem recalcula a apuração financeira (usePepApuracao).
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
  // paciente do prestador, se ficarem assim até o fechamento — reaproveita a
  // mesma fórmula do motor de cálculo (calculoPEP.ts), sem duplicá-la. Geral
  // não tem valor próprio: o ajuste é aplicado igualmente a todo paciente.
  const impactoGeral = useMemo(() => {
    if (itensGerais.length === 0 || valorMensalPorPaciente <= 0) return 0
    const entregas = itensGerais.map(item => {
      const { esperado, entregue } = statusRecorrente(item, semanasCalendario, registroDe(null, item.id))
      return { itemCodigo: item.codigo, pesoMensal: item.peso_mensal, quantidadeEsperada: esperado, quantidadeEntregue: entregue }
    })
    return calcularAjusteRecorrentes(entregas, valorMensalPorPaciente).reduce((soma, a) => soma + a.valor, 0)
  }, [itensGerais, semanasCalendario, registroDe, valorMensalPorPaciente])

  // Carga única da visão geral (pedido de 02/10/2026): a grade, os parâmetros,
  // os blocos do robô e a apuração do mês carregam em paralelo e a tela só
  // aparece quando todos terminaram — no lugar, um indicador discreto. Vale
  // para a primeira abertura; trocas de mês depois mostram cada carregamento
  // no próprio bloco. Rede de segurança: depois de 15 s, mostra o que houver.
  const [roboPronto, setRoboPronto] = useState(false)
  const [visaoPronta, setVisaoPronta] = useState(false)
  const [primeiraCargaFeita, setPrimeiraCargaFeita] = useState(false)
  const marcarRoboPronto = useCallback(() => setRoboPronto(true), [])
  const marcarVisaoPronta = useCallback(() => setVisaoPronta(true), [])
  const gradePronta = !gradeLoading && (resultado != null || !!gradeErroResumo)
  const tudoCarregado = roboPronto && gradePronta && !parametrosLoading && (analistas.length === 0 || visaoPronta)
  if (tudoCarregado && !primeiraCargaFeita) setPrimeiraCargaFeita(true)
  useEffect(() => {
    if (primeiraCargaFeita) return
    const id = setTimeout(() => setPrimeiraCargaFeita(true), 15000)
    return () => clearTimeout(id)
  }, [primeiraCargaFeita])
  const visaoGeralVisivel = primeiraCargaFeita || tudoCarregado

  // Tela inicial, antes de escolher um analista: a visão do mês inteiro
  // (VisaoGeralPep, só leitura). Antes era só "Selecione um Analista…", e nem
  // o mês dava para trocar daqui.
  if (!prestador) {
    return (
      <div className="space-y-5">
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
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {gradeErroResumo}
          </p>
        )}
        <SeletorPrestador analistas={analistas} prestador={prestador} onChange={setPrestador} onHistoricoGeral={() => setHistoricoAberto("geral")} carregando={gradeLoading} />
        {/* Robô SharePoint: o que ele leu e o que precisa de uma pessoa (veio de /admin/robo-sharepoint). */}
        <RoboNaPep onCarregado={marcarRoboPronto} />
        {gradeLoading || analistas.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            {gradeLoading
              ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando prestadores da Grade…</span>
              : "Nenhum Analista do Comportamento na grade deste mês. Troque o mês acima para ver outra competência."}
          </div>
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
  // O robô já conferiu prestador (CNPJ), paciente (CPF + nome) e a sessão de
  // Coordenador de Caso no mês. Aqui fica só o que depende do estado da tela:
  // mês liberado, item já completo, semestral sem planejamento.
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
    // Marcado por uma pessoa = azul; o sp_id liga a unidade ao arquivo.
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
      // Data da entrega = dia em que o arquivo foi enviado. Se o mês veio do
      // NOME do arquivo e for outro, vale o nome (dia 1º daquele mês).
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
      // A entrega JÁ foi registrada; só a marca "confirmado" da sugestão falhou.
      toast.error(`Entrega registrada, mas a sugestão não foi marcada: ${e instanceof Error ? e.message : "erro"}`)
    }
    await recarregarSp()
    return true
  }

  // "Desfazer" uma entrega do robô: o banco tira a unidade, marca o arquivo
  // como desfeito (o robô não insiste) e desfaz a reprogramação que ele criou.
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
    <div className="space-y-6">
      <SecaoTitulo numero={1}>Analista do Comportamento</SecaoTitulo>
      <SeletorPrestador
        analistas={analistas}
        prestador={prestador}
        onChange={setPrestador}
        onHistoricoGeral={() => setHistoricoAberto("geral")}
        onHistoricoPrestador={() => setHistoricoAberto("prestador")}
        onVisaoGeral={() => setPrestador("")}
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
          onLiberar={() => setConfirmandoLiberar(true)}
          onReabrir={() => setConfirmandoReabrir(true)}
          modoTeste={competencia === COMPETENCIA_TESTE_PEP}
          erros={[gradeErroResumo, error]}
        />

        {confirmandoLiberar && (
          <ConfirmModal
            titulo="Liberar Faturamento"
            mensagem={`Confirma a liberação do faturamento de ${prestador} para ${competencia}? Depois de liberado, os lançamentos desta competência ficam bloqueados para edição até uma reabertura.`}
            pedirMotivo={false}
            motivo=""
            onMotivoChange={() => {}}
            confirmLabel="Liberar"
            onConfirmar={async () => {
              await liberar()
              setConfirmandoLiberar(false)
            }}
            onCancelar={() => setConfirmandoLiberar(false)}
          />
        )}

        {confirmandoReabrir && (
          <ConfirmModal
            titulo="Reabrir Faturamento"
            mensagem={`Reabrir permite editar novamente os lançamentos de ${prestador} em ${competencia}. Essa ação fica registrada na trilha de auditoria.`}
            pedirMotivo
            motivo={motivoReabrir}
            onMotivoChange={setMotivoReabrir}
            confirmLabel="Reabrir"
            perigo
            onConfirmar={async () => {
              const ok = await reabrir(motivoReabrir)
              if (ok) {
                setConfirmandoReabrir(false)
                setMotivoReabrir("")
              }
            }}
            onCancelar={() => { setConfirmandoReabrir(false); setMotivoReabrir("") }}
          />
        )}

        <LegendaOrigem className="rounded-xl border border-border bg-card px-4 py-2.5" />

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

        {/* Colgroup igual nas duas tabelas (primeira coluna e largura por item
            idênticas) — Geral fica em bloco separado, mas STC/ETC alinham
            verticalmente com TAP/TOP da tabela de pacientes logo abaixo. */}
        {itensGerais.length > 0 && (
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed text-sm">
              {/* Percentuais, não px fixo — assim as 4 colunas se espalham
                  pela largura toda do card em vez de sobrar espaço morto no
                  fim. Os 3 primeiros percentuais são IDÊNTICOS aos da tabela
                  de pacientes logo abaixo — é isso que mantém ETC/STC
                  alinhados com TAP/TOP mesmo em blocos separados. */}
              <colgroup>
                <col style={{ width: "28%" }} />
                {itensGerais.map(item => <col key={item.id} style={{ width: "16%" }} />)}
                <col style={{ width: "40%" }} />
              </colgroup>
              <tbody>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    Geral <span className="font-normal text-muted-foreground">(sem paciente)</span>
                  </td>
                  {itensGerais.map((item, i) => (
                    <td key={item.id} className={`px-3 py-3 text-center ${i === 0 ? "border-l border-border" : ""}`}>
                      <CelulaRecorrente
                        item={item}
                        semanasCalendario={semanasCalendario}
                        registro={registroDe(null, item.id)}
                        onClick={() => setCelulaAtiva({ pacienteNome: null, item })}
                        disabled={liberado}
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
            {impactoGeral > 0 && pacientes.length > 0 && (
              <p className="border-t border-border px-4 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                Se ficar assim, reduz cada um dos {pacientes.length} paciente{pacientes.length > 1 ? "s" : ""} em até {money(impactoGeral)}
              </p>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : pacientes.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Nenhum paciente encontrado para este Analista na Grade carregada.
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed text-sm">
              <colgroup>
                <col style={{ width: "28%" }} />
                {itensPorPaciente.map(item => <col key={item.id} style={{ width: "16%" }} />)}
                <col style={{ width: "40%" }} />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Paciente</th>
                  {itensPorPaciente.map((item, i) => (
                    <th key={item.id} className={`px-3 py-3 font-semibold text-muted-foreground text-center ${i === 0 ? "border-l border-border" : ""}`} title={item.nome}>
                      {item.sigla}
                    </th>
                  ))}
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-right border-l border-border">
                    <span className="inline-flex items-center gap-1.5">
                      PEP apurada
                      {apuracaoLoading && <Loader2 size={11} className="animate-spin" />}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pacientes.map(paciente => (
                  <tr key={paciente} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">{paciente}</td>
                    {itensPorPaciente.map((item, i) => (
                      <td key={item.id} className={`px-3 py-3 text-center ${i === 0 ? "border-l border-border" : ""}`}>
                        <CelulaRecorrente
                          item={item}
                          semanasCalendario={semanasCalendario}
                          registro={registroDe(paciente, item.id)}
                          onClick={() => setCelulaAtiva({ pacienteNome: paciente, item })}
                          disabled={liberado}
                        />
                      </td>
                    ))}
                    <td className={`px-3 py-3 text-right whitespace-nowrap border-l border-border transition-opacity ${apuracaoLoading ? "opacity-40" : ""}`}>
                      {/* O valor abre a explicação: de onde vem cada desconto e o
                          que falta para os 100% (ExplicacaoPepTooltip). */}
                      {resultadoDe(paciente)
                        ? <ExplicacaoPepTooltip apuracao={resultadoDe(paciente)!} catalogo={catalogoCompleto} semanasCalendario={semanasCalendario} />
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SecaoTitulo numero={3} nota="independe do mês acima — vale para o ano inteiro (PRD §7.2)">
        Entregas semestrais
      </SecaoTitulo>
      {pacientes.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhum paciente encontrado para este Analista na Grade carregada.
        </div>
      ) : (
        <MatrizSemestral
          pacientes={pacientes}
          itensSemestrais={itensSemestrais}
          planejamentoDe={planejamentoDe}
          registroSemestralDe={registroSemestralDe}
          onAbrirPainel={(pacienteNome, item) => setCelulaAtiva({ pacienteNome, item })}
          disabled={liberado}
        />
      )}

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
            // Mantém o painel aberto — o planejamento recém-criado já habilita
            // a próxima etapa (observação/evidência) sem forçar reabrir o modal.
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
    </div>
  )
}

function IndicadorProgresso({ completos, total }: { completos: number; total: number }) {
  if (total === 0) return null
  const pct = Math.round((completos / total) * 100)
  const tudoPronto = completos === total
  return (
    <div className="min-w-[190px]">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Itens completos
      </p>
      <p className="text-lg font-bold text-foreground">
        {completos} <span className="text-sm font-medium text-muted-foreground">de {total}</span>
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${tudoPronto ? "bg-emerald-600 dark:bg-emerald-500" : "bg-[#222847] dark:bg-slate-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// Um único bloco pro que antes eram 3-4 cards empilhados (competência, aviso
// de modo teste, potencial/alcançado + liberar). Linha 1 é parâmetro do mês;
// da linha 2 pra baixo é o trabalho do mês.
function CabecalhoEntregasMensais({
  competencia,
  onMudarMes, carregandoLabel, progresso, mostrarValores, potencial, alcancado,
  apuracaoLoading, liberado, onLiberar, onReabrir, modoTeste, erros,
}: {
  competencia: string
  onMudarMes: (ano: number, mes: number) => void
  carregandoLabel: string | null
  progresso: { completos: number; total: number }
  mostrarValores: boolean
  potencial: number
  alcancado: number
  apuracaoLoading: boolean
  liberado: boolean
  onLiberar: () => void
  onReabrir: () => void
  modoTeste: boolean
  erros: (string | null | undefined)[]
}) {
  const errosVisiveis = erros.filter(Boolean)
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-muted/30 px-5 py-2.5">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Mês de atendimento
        </span>
        <SeletorMesPrevisao
          ano={Number(competencia.split("-")[0])}
          mes={Number(competencia.split("-")[1])}
          onChange={onMudarMes}
        />
        <NotaFaturamento competencia={competencia} />
        {carregandoLabel && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            {carregandoLabel}
          </span>
        )}
      </div>

      {(progresso.total > 0 || mostrarValores) && (
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-border px-5 py-4">
        <IndicadorProgresso completos={progresso.completos} total={progresso.total} />
        {mostrarValores && (
          <>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Potencial do mês
                {apuracaoLoading && <Loader2 size={11} className="animate-spin" />}
              </p>
              <p className={`text-lg font-bold text-foreground transition-opacity ${apuracaoLoading ? "opacity-40" : ""}`}>
                {money(potencial)}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Alcançado (apurado)
                {apuracaoLoading && <Loader2 size={11} className="animate-spin" />}
              </p>
              <p className={`text-lg font-bold text-emerald-600 dark:text-emerald-400 transition-opacity ${apuracaoLoading ? "opacity-40" : ""}`}>
                {money(alcancado)}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {liberado ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    <Check size={13} /> Faturamento liberado
                  </span>
                  <button
                    type="button"
                    onClick={onReabrir}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border text-foreground bg-background hover:bg-muted/50"
                  >
                    Reabrir
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={apuracaoLoading}
                  title={apuracaoLoading ? "Aguarde a apuração terminar de calcular" : undefined}
                  onClick={onLiberar}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
                >
                  Liberar Faturamento
                </button>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {modoTeste && (
        <p className="border-t border-amber-300 bg-amber-50 px-5 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <span className="font-bold">Modo teste (PRD Seção 13.7):</span> {COMPETENCIA_TESTE_PEP} apura e demonstra os ajustes, mas paga 100% do potencial — por isso &quot;Alcançado&quot; ainda não reflete pendências. Os ajustes passam a valer a partir do mês seguinte.
        </p>
      )}

      {errosVisiveis.length > 0 && (
        <div className="border-t border-border px-5 py-2.5 space-y-1">
          {errosVisiveis.map((e, i) => (
            <p key={i} className="text-sm text-red-600 dark:text-red-400">{e}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function SeletorPrestador({ analistas, prestador, onChange, onHistoricoGeral, onHistoricoPrestador, onVisaoGeral, carregando }: {
  analistas: string[]
  prestador: string
  onChange: (v: string) => void
  onHistoricoGeral: () => void
  onHistoricoPrestador?: () => void
  /** Volta para a visão geral do mês (limpa a seleção, sem navegar). */
  onVisaoGeral?: () => void
  carregando?: boolean
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Analista do Comportamento
          {carregando && <Loader2 size={11} className="animate-spin" />}
        </label>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onVisaoGeral && (
            <button
              type="button"
              onClick={onVisaoGeral}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              <LayoutDashboard size={12} /> Visão geral do mês
            </button>
          )}
          {onHistoricoPrestador && (
            <button
              type="button"
              onClick={onHistoricoPrestador}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50"
            >
              <History size={12} /> Histórico
            </button>
          )}
          <button
            type="button"
            onClick={onHistoricoGeral}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50"
          >
            <History size={12} /> Histórico geral
          </button>
        </div>
      </div>
      <SearchCombobox
        value={prestador}
        onChange={onChange}
        opcoes={analistas}
        ariaLabel="Analista do Comportamento"
        placeholder={carregando && analistas.length === 0 ? "Carregando…" : "Digite para buscar..."}
        disabled={carregando && analistas.length === 0}
      />
    </div>
  )
}

type RegistroResumo = Pick<PepRegistroEntrega, "status" | "quantidade_entregue" | "evidencias" | "observacao" | "data_entrega"> | null

function temEvidencia(registro: RegistroResumo): boolean {
  return !!registro?.evidencias?.some(e => e.caminho)
}

function CelulaRecorrente({ item, semanasCalendario, registro, onClick, disabled }: {
  item: PepCatalogoItem
  semanasCalendario: number
  registro: RegistroResumo
  onClick: () => void
  disabled?: boolean
}) {
  const { esperado, entregue, completo } = statusRecorrente(item, semanasCalendario, registro)
  // Um check por unidade esperada, na cor de quem marcou (roxo robô, azul
  // pessoa); vazio = pendente. A borda diz completo/parcial/nada.
  const unidades = Array.from({ length: esperado }, (_, i) => (i < entregue ? origemDaUnidade(registro?.evidencias, i) : null))
  const { robo, humano } = contarOrigem(registro)
  const quem = [robo ? `${robo} do robô` : "", humano ? `${humano} de pessoa` : ""].filter(Boolean).join(", ")
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Faturamento liberado — reabra para editar" : `${item.nome} — ${entregue} de ${esperado}${quem ? ` (${quem})` : ""}`}
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed
        ${completo
          ? "border-slate-300 bg-white text-foreground dark:border-slate-600 dark:bg-slate-900"
          : entregue > 0
            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
            : "border-border bg-background text-muted-foreground hover:bg-muted/50"}`}
    >
      <span className="font-semibold">{item.sigla} {entregue}/{esperado}</span>
      <span className="inline-flex items-center gap-0.5">
        {unidades.map((o, i) => <SeloUnidade key={i} origem={o} tamanho={14} />)}
      </span>
      {temEvidencia(registro) && <Paperclip size={11} aria-hidden />}
    </button>
  )
}

// Célula da matriz semestral — irmã visual de CelulaRecorrente. Datas e link
// da evidência ficam no PainelSemestral (aberto no clique); aqui só o status.
function CelulaSemestral({ paciente, item, plano, registro, hoje, onClick, disabled }: {
  paciente: string
  item: PepCatalogoItem
  plano: PepPlanejamentoSemestral | null
  registro: RegistroResumo
  hoje: string
  onClick: () => void
  disabled?: boolean
}) {
  const { statusLabel, entregue, icone } = statusSemestral(item, plano, registro, hoje)
  const reiterada = statusLabel === "Pendência reiterada"
  const vencido = statusLabel === "Vencido"
  const reprogramado = statusLabel === "Reprogramado (REP-)"
  const pendente = statusLabel === "Entrega pendente"

  // Vencido = vermelho, Entrega pendente (ainda dentro do prazo, já tem
  // planejamento) = azul, Planejar (nem tem planejamento ainda) = âmbar,
  // Realizado = verde — pedido explícito do usuário. Reiterada é uma escalada
  // do vencido (2+ meses), por isso um vermelho mais intenso e em negrito.
  // Realizado = roxo se o robô entregou, azul se foi uma pessoa (20261002100000).
  // Por isso "Entrega pendente" deixou o azul e "Reprogramado" o sky: azul só
  // quer dizer "pessoa" nesta tela.
  const origem = entregue ? origemDaUnidade(registro?.evidencias, 0) : null
  const tom = entregue
    ? ORIGEM[origem ?? "humano"].tinta
    : reiterada
      ? "border-red-400 bg-red-100 text-red-800 font-bold dark:border-red-700 dark:bg-red-950 dark:text-red-300"
      : vencido
        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-300"
        : reprogramado
          ? "border-dashed border-slate-400 bg-slate-50 text-slate-700 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-300"
          : pendente
            ? "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
            : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled
        ? "Faturamento liberado — reabra para editar"
        : `${item.nome} · ${paciente} — ${statusLabel}${plano?.data_planejada ? ` (planejado para ${formatarDataBR(plano.data_planejada)})` : ""}${!entregue && plano ? " — clique para marcar como entregue" : ""}`}
      className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tom}`}
    >
      {icone === "check" && <SeloUnidade origem={origem ?? "humano"} tamanho={14} />}
      {icone === "alert" && <AlertTriangle size={13} />}
      {icone === "calendar" && <CalendarPlus size={13} />}
      {statusLabel}
      {origem && <span className="sr-only"> por {ORIGEM[origem].rotulo}</span>}
      {temEvidencia(registro) && <Paperclip size={11} aria-hidden />}
    </button>
  )
}

// PRD §7.2 — as entregas semestrais (OE/RT/PIC) valem para o ano inteiro,
// independente do mês selecionado na aba mensal. Uma matriz única: paciente na
// linha, documento na coluna — antes era uma tabela inteira repetida por
// paciente, o que fazia a página crescer sem limite.
function MatrizSemestral({ pacientes, itensSemestrais, planejamentoDe, registroSemestralDe, onAbrirPainel, disabled }: {
  pacientes: string[]
  itensSemestrais: PepCatalogoItem[]
  planejamentoDe: (pacienteNome: string, itemId: string) => PepPlanejamentoSemestral | null
  registroSemestralDe: (pacienteNome: string, itemId: string) => RegistroResumo
  onAbrirPainel: (pacienteNome: string, item: PepCatalogoItem) => void
  disabled?: boolean
}) {
  const hoje = new Date().toISOString().slice(0, 10)

  const larguraItem = 72 / Math.max(1, itensSemestrais.length)

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
      <table className="w-full min-w-[520px] table-fixed text-sm">
        <colgroup>
          <col style={{ width: "28%" }} />
          {itensSemestrais.map(item => (
            <col key={item.id} style={{ width: `${larguraItem}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Paciente</th>
            {itensSemestrais.map(item => (
              <th key={item.id} className="px-3 py-3 font-semibold text-muted-foreground text-center" title={item.nome}>
                {item.sigla}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pacientes.map(paciente => (
            <tr key={paciente} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-medium text-foreground truncate" title={paciente}>{paciente}</td>
              {itensSemestrais.map(item => (
                <td key={item.id} className="px-3 py-3 text-center">
                  <CelulaSemestral
                    paciente={paciente}
                    item={item}
                    plano={planejamentoDe(paciente, item.id)}
                    registro={registroSemestralDe(paciente, item.id)}
                    hoje={hoje}
                    onClick={() => onAbrirPainel(paciente, item)}
                    disabled={disabled}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CabecalhoPainel({ item, pacienteNome, competencia, onFechar }: {
  item: PepCatalogoItem; pacienteNome: string | null; competencia?: string; onFechar: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-bold text-foreground">{item.nome}</p>
        <p className="text-xs text-muted-foreground">
          {pacienteNome ?? "Geral (sem paciente)"}{competencia ? ` · Atendimento de ${faturamentoDaCompetencia(competencia).mesAtendimento}` : ""}
        </p>
      </div>
      <button type="button" onClick={onFechar} className="text-muted-foreground hover:text-foreground">
        <X size={16} />
      </button>
    </div>
  )
}

// Uma unidade de referência de evidência — o caminho é a informação que
// realmente importa (é o que torna a unidade faturável, PRD Seção 2.3/12.3);
// o nome do arquivo é só apoio visual, por isso pesa menos na hierarquia.
function CampoEvidenciaUnidade({ evidencia, rotulo, onChange }: {
  evidencia: PepEvidencia
  rotulo: string
  onChange: (campo: keyof PepEvidencia, valor: string) => void
}) {
  // Evidência confirmada a partir do robô do SharePoint chega com o endereço
  // completo do arquivo (webUrl) e o nome: aí dá para abrir direto daqui.
  const link = /^https?:\/\//i.test(evidencia.caminho) ? evidencia.caminho : null
  const marcada = !!evidencia.caminho.trim()
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {rotulo}
          {marcada && <ChipOrigem origem={evidencia.origem === "robo" ? "robo" : "humano"} />}
        </label>
      </div>
      {link && (
        <a href={link} target="_blank" rel="noreferrer"
          className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300">
          <span className="truncate">{evidencia.nome ?? "Abrir arquivo"}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs">Abrir no SharePoint <ExternalLink size={13} aria-hidden /></span>
        </a>
      )}
      {evidencia.origem === "robo" && (
        <p className="text-[11px] text-muted-foreground">Mudar este caminho troca a unidade para Pessoa e conta como entrega do robô desfeita.</p>
      )}
      <input
        type="text"
        placeholder="ex.: SharePoint/Pacientes/Fulano/STC-01-082026.pdf"
        value={evidencia.caminho}
        onChange={e => onChange("caminho", e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
      />
    </div>
  )
}

// Uma referência de evidência por unidade entregue (ex.: 2 de TAP = 2 campos
// — PRD Seção 13.6 usa nomenclatura sequencial: TAP-01-..., TAP-02-...).
function CamposEvidencia({ evidencias, onChange, rotulo }: {
  evidencias: PepEvidencia[]
  onChange: (evidencias: PepEvidencia[]) => void
  rotulo: (indice: number) => string
}) {
  function atualizar(indice: number, campo: keyof PepEvidencia, valor: string) {
    // Trocar o caminho de uma unidade do robô a torna da pessoa (o gatilho do
    // banco registra a entrega do robô como desfeita).
    const nova = evidencias.map((e, i) => {
      if (i !== indice) return e
      const base = campo === "caminho" && e.origem === "robo" ? { caminho: e.caminho, nome: e.nome } : e
      return { ...base, [campo]: campo === "nome" && !valor ? null : valor }
    })
    onChange(nova)
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {evidencias.map((ev, i) => (
        <CampoEvidenciaUnidade
          key={i}
          evidencia={ev}
          rotulo={rotulo(i)}
          onChange={(campo, valor) => atualizar(i, campo, valor)}
        />
      ))}
    </div>
  )
}

// Substitui o campo numérico "quantidade entregue" por N caixas fixas (uma
// por unidade esperada) com check branco/verde — clicar na caixa i preenche
// até ela (estilo "avaliação por estrelas": clicar numa já marcada desmarca
// ela e tudo depois). Ninguém digita número; a contagem é derivada.
function SeletorQuantidadeSlots({ esperado, quantidade, onChange, disabled, evidencias }: {
  esperado: number
  quantidade: number
  onChange: (nova: number) => void
  disabled?: boolean
  /** Para pintar cada unidade marcada: roxo = robô, azul = pessoa. */
  evidencias?: PepEvidencia[]
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: esperado }, (_, i) => {
        const marcado = i < quantidade
        const origem = marcado ? origemDaUnidade(evidencias, i) : null
        const Icone = origem ? ORIGEM[origem].icone : null
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onChange(marcado ? i : i + 1)}
            title={`Unidade ${i + 1} de ${esperado}${origem ? ` — entregue (${ORIGEM[origem].rotulo})` : " — pendente"}`}
            className={`relative flex h-11 w-11 items-center justify-center rounded-xl border-2 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed
              ${origem === "robo"
                ? "border-violet-600 bg-violet-600 text-white"
                : origem === "humano"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-border bg-background text-muted-foreground hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"}`}
          >
            {marcado ? <Check size={18} strokeWidth={3} /> : i + 1}
            {Icone && (
              <span className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200">
                <Icone size={12} aria-hidden />
              </span>
            )}
            {origem && <span className="sr-only">{ORIGEM[origem].rotulo}</span>}
          </button>
        )
      })}
    </div>
  )
}

function limparEvidencias(evidencias: PepEvidencia[]): PepEvidencia[] {
  return evidencias.filter(e => e.caminho.trim())
}

// PRD Seção 2.3/12.3: "uma unidade só é faturável com evidência presente" —
// não é opcional. Cada unidade entregue precisa da sua própria referência de
// evidência (2 unidades de TAP = 2 evidências, não uma só pra tudo).
function evidenciasCompletas(evidencias: PepEvidencia[], quantidade: number): boolean {
  return limparEvidencias(evidencias).length >= quantidade
}

// Confirmação genérica pra salvar edição ou excluir — toda alteração manual
// exige confirmação e, quando aplicável, motivo (PRD Seção 11.4).
function ConfirmModal({ titulo, mensagem, pedirMotivo, motivo, onMotivoChange, confirmLabel, perigo, confirmDisabled, erro, onConfirmar, onCancelar }: {
  titulo: string
  mensagem: string
  pedirMotivo: boolean
  motivo: string
  onMotivoChange: (v: string) => void
  confirmLabel: string
  perigo?: boolean
  confirmDisabled?: boolean
  erro?: string | null
  onConfirmar: () => void | Promise<void>
  onCancelar: () => void
}) {
  const backdrop = useFecharAoClicarFora(onCancelar)
  // Toda confirmação daqui dispara pelo menos um save + um recálculo de
  // apuração — sem isso o botão parecia travado (clicável de novo, sem
  // nenhum sinal) enquanto a promise corria por baixo.
  const [processando, setProcessando] = useState(false)
  async function confirmar() {
    setProcessando(true)
    try {
      await onConfirmar()
    } finally {
      setProcessando(false)
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" {...backdrop}>
      <div className="w-full max-w-xs rounded-2xl border border-border bg-card p-5 shadow-lg space-y-3" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-bold text-foreground">{titulo}</p>
        <p className="text-xs text-muted-foreground">{mensagem}</p>
        {pedirMotivo && (
          <div className="space-y-1.5">
            <label htmlFor="pep-confirm-motivo" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Motivo
            </label>
            <textarea
              id="pep-confirm-motivo"
              value={motivo}
              onChange={e => onMotivoChange(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
              autoFocus
            />
          </div>
        )}
        {erro && <p className="text-xs font-medium text-red-600 dark:text-red-400">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancelar}
            disabled={processando}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border text-foreground bg-background hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={confirmDisabled || processando || (pedirMotivo && !motivo.trim())}
            onClick={confirmar}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed ${perigo ? "bg-rose-600" : "bg-emerald-600"}`}
          >
            {processando && <Loader2 size={12} className="animate-spin" />}
            {processando ? "Aguarde…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function PainelQuantidade({ pacienteNome, item, competencia, semanasCalendario, registro, erro, onFechar, onSalvar, onExcluir }: {
  pacienteNome: string | null
  item: PepCatalogoItem
  competencia: string
  semanasCalendario: number
  registro: (RegistroResumo & { observacao?: string | null }) | null
  erro?: string | null
  onFechar: () => void
  onSalvar: (input: {
    quantidadeEntregue: number
    evidencias: PepEvidencia[]
    observacao: string | null
    motivo?: string | null
  }) => void | Promise<void>
  onExcluir?: (motivo: string) => boolean | Promise<boolean>
}) {
  const esperado = quantidadeEsperada(item, semanasCalendario)
  const [quantidade, setQuantidade] = useState(registro?.quantidade_entregue ?? 0)
  const [evidencias, setEvidencias] = useState<PepEvidencia[]>(
    normalizarEvidencias(registro?.evidencias ?? [], Math.max(1, registro?.quantidade_entregue ?? 0))
  )
  const [observacao, setObservacao] = useState(registro?.observacao ?? "")
  const [confirmando, setConfirmando] = useState<"salvar" | "excluir" | null>(null)
  const [motivo, setMotivo] = useState("")
  const [salvandoDireto, setSalvandoDireto] = useState(false)
  const jaExiste = !!registro
  const backdrop = useFecharAoClicarFora(onFechar)

  function alterarQuantidade(nova: number) {
    const clamped = Math.max(0, Math.min(esperado, nova))
    setQuantidade(clamped)
    setEvidencias(prev => normalizarEvidencias(prev, Math.max(1, clamped)))
  }

  // Sem confirmação prévia (registro novo) — o próprio botão precisa avisar
  // que está em andamento, senão o clique parece não ter feito nada durante
  // o save + recálculo de apuração por baixo.
  async function salvarDireto() {
    setSalvandoDireto(true)
    try {
      await onSalvar({ quantidadeEntregue: quantidade, evidencias: limparEvidencias(evidencias), observacao: observacao || null })
    } finally {
      setSalvandoDireto(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" {...backdrop}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <CabecalhoPainel item={item} pacienteNome={pacienteNome} competencia={competencia} onFechar={onFechar} />

        <div className="space-y-2 border-t border-border pt-3">
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Marque as unidades já entregues ({esperado} esperada{esperado > 1 ? "s" : ""} este mês)
          </label>
          <SeletorQuantidadeSlots esperado={esperado} quantidade={quantidade} onChange={alterarQuantidade} evidencias={evidencias} />
        </div>

        {quantidade > 0 && (
          <CamposEvidencia
            evidencias={evidencias}
            onChange={setEvidencias}
            rotulo={i => esperado > 1 ? `Referência da evidência — unidade ${i + 1} de ${quantidade}` : "Referência da evidência"}
          />
        )}

        <div className="space-y-2">
          <label htmlFor="pep-observacao" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Observação
          </label>
          <textarea
            id="pep-observacao"
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            disabled={salvandoDireto || (quantidade > 0 && !evidenciasCompletas(evidencias, quantidade))}
            onClick={() => jaExiste ? setConfirmando("salvar") : salvarDireto()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
          >
            {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {salvandoDireto ? "Salvando…" : "Salvar quantidade"}
          </button>
          {jaExiste && onExcluir && (
            <button
              type="button"
              onClick={() => setConfirmando("excluir")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border border-rose-300 text-rose-700 dark:text-rose-400 bg-background hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <Trash2 size={14} /> Excluir
            </button>
          )}
        </div>
      </div>

      {confirmando === "salvar" && (
        <ConfirmModal
          titulo="Salvar alterações?"
          mensagem="Este registro já existia — a quantidade e a evidência serão sobrescritas."
          pedirMotivo
          motivo={motivo}
          onMotivoChange={setMotivo}
          confirmLabel="Salvar alterações"
          onCancelar={() => setConfirmando(null)}
          onConfirmar={async () => {
            await onSalvar({ quantidadeEntregue: quantidade, evidencias: limparEvidencias(evidencias), observacao: observacao || null, motivo })
            setConfirmando(null)
          }}
        />
      )}
      {confirmando === "excluir" && onExcluir && (
        <ConfirmModal
          titulo="Excluir este registro?"
          mensagem="A quantidade entregue e a evidência deste item nesta competência serão apagadas. Essa ação fica registrada na trilha de auditoria."
          pedirMotivo
          motivo={motivo}
          onMotivoChange={setMotivo}
          confirmLabel="Excluir"
          perigo
          erro={erro}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={async () => {
            const ok = await onExcluir(motivo)
            if (ok) setConfirmando(null)
          }}
        />
      )}
    </div>
  )
}

function PainelSemestral({ pacienteNome, item, registro, planejamento, erro, onFechar, onSalvarPlanejamento, onSalvarEntrega, onSalvarReprogramacaoImpedimento, onExcluirEntrega, onExcluirPlanejamento }: {
  pacienteNome: string | null
  item: PepCatalogoItem
  registro: (RegistroResumo & { observacao?: string | null }) | null
  planejamento: PepPlanejamentoSemestral | null
  erro?: string | null
  onFechar: () => void
  onSalvarPlanejamento: (dataPlanejada: string) => void | Promise<void>
  onSalvarEntrega: (input: {
    status: "pendente" | "entregue"
    evidencias: PepEvidencia[]
    observacao: string | null
    motivo?: string | null
    dataEntrega: string
  }) => void | Promise<void>
  onSalvarReprogramacaoImpedimento: (input: {
    dataPlanejada: string
    motivo: string
    evidencias: PepEvidencia[]
  }) => void | Promise<void>
  onExcluirEntrega?: (motivo: string) => boolean | Promise<boolean>
  onExcluirPlanejamento?: (motivo: string) => boolean | Promise<boolean>
}) {
  const [evidencias, setEvidencias] = useState<PepEvidencia[]>(normalizarEvidencias(registro?.evidencias ?? [], 1))
  const [observacao, setObservacao] = useState(registro?.observacao ?? "")
  const [dataPlanejadaInput, setDataPlanejadaInput] = useState(planejamento?.data_planejada ?? "")
  // Vazio até o usuário escolher — não presumir "hoje" por padrão, senão o
  // campo parece já ter uma entrega confirmada quando ainda não há nenhuma.
  const [dataEntregaInput, setDataEntregaInput] = useState(registro?.data_entrega ?? "")
  const [mostrarRep, setMostrarRep] = useState(false)
  const [repDataPlanejada, setRepDataPlanejada] = useState(planejamento?.data_planejada ?? "")
  const [repMotivo, setRepMotivo] = useState("")
  const [repEvidencias, setRepEvidencias] = useState<PepEvidencia[]>(normalizarEvidencias([], 1))
  const [confirmando, setConfirmando] = useState<"salvar" | "desfazer" | "excluirEntrega" | "excluirPlanejamento" | null>(null)
  const [motivo, setMotivo] = useState("")
  // Ações diretas (sem passar por ConfirmModal) que ainda assim disparam
  // save + recálculo de apuração por baixo — sem isso o botão parecia
  // travado durante essa espera.
  const [salvandoDireto, setSalvandoDireto] = useState(false)
  // `jaExiste` (existe linha na tabela) e `entregueAtual` (status realmente
  // "entregue") são coisas diferentes: depois de um "Desfazer", a linha
  // continua existindo (jaExiste=true) mas volta a status "pendente" — sem
  // separar os dois, o painel tratava qualquer linha existente como já
  // entregue (data travada, sem nota de prazo), contradizendo a matriz.
  const jaExiste = !!registro
  const entregueAtual = registro?.status === "entregue"
  const backdrop = useFecharAoClicarFora(onFechar)

  async function executarDireto(acao: () => void | Promise<void>) {
    setSalvandoDireto(true)
    try {
      await acao()
    } finally {
      setSalvandoDireto(false)
    }
  }

  if (!planejamento) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" {...backdrop}>
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg space-y-4" onClick={e => e.stopPropagation()}>
          <CabecalhoPainel item={item} pacienteNome={pacienteNome} onFechar={onFechar} />
          <div className="space-y-2 border-t border-border pt-3">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Data planejada
            </label>
            <DatePicker value={dataPlanejadaInput} onChange={setDataPlanejadaInput} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={salvandoDireto || !dataPlanejadaInput}
              onClick={() => executarDireto(() => onSalvarPlanejamento(dataPlanejadaInput))}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#222847] dark:bg-slate-600 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
              {salvandoDireto ? "Salvando…" : "Salvar planejamento"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" {...backdrop}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <CabecalhoPainel item={item} pacienteNome={pacienteNome} onFechar={onFechar} />

        <div className="border-t border-border pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Planejado para</p>
                <p className="text-sm font-bold text-foreground">{formatarDataBR(planejamento.data_planejada)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {entregueAtual ? "Entregue em" : "Marcar entrega em"}
                </p>
                {entregueAtual
                  ? <p className="text-sm font-bold text-foreground">{formatarDataBR(registro?.data_entrega)}</p>
                  : <DatePicker
                      value={dataEntregaInput}
                      onChange={setDataEntregaInput}
                      classeGatilho="flex items-center gap-1.5 text-sm font-bold text-foreground hover:text-foreground/80 focus:outline-none focus:underline decoration-dotted disabled:text-muted-foreground"
                    />}
              </div>
            </div>
            {onExcluirPlanejamento && (
              <button
                type="button"
                onClick={() => setConfirmando("excluirPlanejamento")}
                title="Excluir planejamento"
                className="shrink-0 text-rose-600 dark:text-rose-400 hover:text-rose-700"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {!entregueAtual && dataEntregaInput && planejamento.data_planejada && dataEntregaInput > planejamento.data_planejada && (
            <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              Data depois do planejado — será registrada como entrega retroativa.
            </p>
          )}
        </div>

        <CamposEvidencia evidencias={evidencias} onChange={setEvidencias} rotulo={() => "Referência da evidência"} />

        <div className="space-y-2">
          <label htmlFor="pep-observacao" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Observação
          </label>
          <textarea
            id="pep-observacao"
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            disabled={salvandoDireto || !evidenciasCompletas(evidencias, 1) || !dataEntregaInput}
            onClick={() => jaExiste
              ? setConfirmando("salvar")
              : executarDireto(() => onSalvarEntrega({ status: "entregue", evidencias: limparEvidencias(evidencias), observacao: observacao || null, dataEntrega: dataEntregaInput }))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
          >
            {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {salvandoDireto ? "Salvando…" : entregueAtual ? "Salvar alterações" : "Marcar entregue"}
          </button>
          {entregueAtual && (
            <button
              type="button"
              disabled={salvandoDireto}
              onClick={() => setConfirmando("desfazer")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border border-border text-foreground bg-background hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Desfazer
            </button>
          )}
          {jaExiste && onExcluirEntrega && (
            <button
              type="button"
              onClick={() => setConfirmando("excluirEntrega")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border border-rose-300 text-rose-700 dark:text-rose-400 bg-background hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <Trash2 size={14} /> Excluir
            </button>
          )}
        </div>

        {!entregueAtual && (
          <div className="border-t border-border pt-3 space-y-3">
            <button
              type="button"
              onClick={() => setMostrarRep(v => !v)}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground underline decoration-dotted"
            >
              {mostrarRep ? "Cancelar reprogramação" : "Impedimento terapêutico? Registrar reprogramação (REP-)"}
            </button>

            {mostrarRep && (
              <div className="space-y-3 rounded-xl border border-dashed border-border p-3">
                <p className="text-[11px] text-muted-foreground">
                  PRD Seção 9.7 — aceito o relatório de reprogramação, o ajuste fica suspenso até a nova data planejada.
                </p>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Nova data planejada
                  </label>
                  <DatePicker value={repDataPlanejada} onChange={setRepDataPlanejada} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="pep-rep-motivo" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Motivos e justificativas técnicas
                  </label>
                  <textarea
                    id="pep-rep-motivo"
                    value={repMotivo}
                    onChange={e => setRepMotivo(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                  />
                </div>
                <CamposEvidencia
                  evidencias={repEvidencias}
                  onChange={setRepEvidencias}
                  rotulo={() => `Referência do relatório (ex.: REP-${item.sigla}-PACIENTE-${repDataPlanejada.replace(/-/g, "").slice(2)})`}
                />
                <button
                  type="button"
                  disabled={salvandoDireto || !repMotivo.trim() || !repDataPlanejada || !evidenciasCompletas(repEvidencias, 1)}
                  onClick={() => executarDireto(() => onSalvarReprogramacaoImpedimento({
                    dataPlanejada: repDataPlanejada,
                    motivo: repMotivo.trim(),
                    evidencias: limparEvidencias(repEvidencias),
                  }))}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#222847] dark:bg-slate-600 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
                  {salvandoDireto ? "Salvando…" : "Aceitar reprogramação"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {confirmando === "salvar" && (
        <ConfirmModal
          titulo="Salvar alterações?"
          mensagem="Este registro já existia — o status e a evidência serão sobrescritos."
          pedirMotivo
          motivo={motivo}
          onMotivoChange={setMotivo}
          confirmLabel="Salvar alterações"
          onCancelar={() => setConfirmando(null)}
          onConfirmar={async () => {
            await onSalvarEntrega({ status: "entregue", evidencias: limparEvidencias(evidencias), observacao: observacao || null, motivo, dataEntrega: dataEntregaInput })
            setConfirmando(null)
          }}
        />
      )}
      {confirmando === "desfazer" && (
        <ConfirmModal
          titulo="Desfazer esta entrega?"
          mensagem="O item volta a status Pendente e a evidência é apagada. Essa ação fica registrada na trilha de auditoria."
          pedirMotivo
          motivo={motivo}
          onMotivoChange={setMotivo}
          confirmLabel="Desfazer"
          perigo
          onCancelar={() => setConfirmando(null)}
          onConfirmar={async () => {
            await onSalvarEntrega({ status: "pendente", evidencias: [], observacao: observacao || null, motivo, dataEntrega: dataEntregaInput })
            setConfirmando(null)
          }}
        />
      )}
      {confirmando === "excluirEntrega" && onExcluirEntrega && (
        <ConfirmModal
          titulo="Excluir este registro?"
          mensagem="O status de entrega e a evidência deste item nesta competência serão apagados. Essa ação fica registrada na trilha de auditoria."
          pedirMotivo
          motivo={motivo}
          onMotivoChange={setMotivo}
          confirmLabel="Excluir"
          perigo
          erro={erro}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={async () => {
            const ok = await onExcluirEntrega(motivo)
            if (ok) setConfirmando(null)
          }}
        />
      )}
      {confirmando === "excluirPlanejamento" && onExcluirPlanejamento && (
        <ConfirmModal
          titulo="Excluir o planejamento?"
          mensagem="A competência planejada deste item some para este paciente. Se este planejamento já foi reprogramado antes, a exclusão pode ser bloqueada para preservar o histórico."
          pedirMotivo
          motivo={motivo}
          onMotivoChange={setMotivo}
          confirmLabel="Excluir"
          perigo
          erro={erro}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={async () => {
            const ok = await onExcluirPlanejamento(motivo)
            if (ok) setConfirmando(null)
          }}
        />
      )}
    </div>
  )
}
