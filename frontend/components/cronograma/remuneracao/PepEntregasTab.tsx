"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Paperclip, Check, AlertTriangle, CalendarPlus, X, Trash2, History, Loader2, LayoutDashboard } from "lucide-react"
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
import type { PepCatalogoItem, PepEvidencia, PepPlanejamentoSemestral, PepRegistroEntrega } from "@/types/pep"

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
    itensRecorrentes, itensSemestrais,
    loading, error, salvando,
    registroDe, registroSemestralDe, planejamentoDe,
    marcarEntrega, marcarQuantidade, cadastrarPlanejamento,
    excluirRegistro, excluirPlanejamento,
  } = usePepEntregas(prestador, competencia, pacientes)

  const { parametros } = useParametrosGerais()
  const valorMensalPorPaciente = parametros?.cc_pe_default ?? 0
  const pacientesApuracao = useMemo(() => pacientes.map(nome => ({ nome })), [pacientes])
  const { resultadoDe, totalPrestador, loading: apuracaoLoading, recalcular: recalcularApuracao, liberado, liberar, reabrir } = usePepApuracao(
    prestador, competencia, pacientesApuracao, valorMensalPorPaciente
  )
  const [confirmandoLiberar, setConfirmandoLiberar] = useState(false)
  const [confirmandoReabrir, setConfirmandoReabrir] = useState(false)
  const [motivoReabrir, setMotivoReabrir] = useState("")

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

  // Tela inicial, antes de escolher um analista: a visão do mês inteiro
  // (VisaoGeralPep, só leitura). Antes era só "Selecione um Analista…", e nem
  // o mês dava para trocar daqui.
  if (!prestador) {
    return (
      <div className="space-y-5">
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
          />
        )}
        {historicoAberto === "geral" && (
          <PepHistoricoModal catalogo={catalogoCompleto} onClose={() => setHistoricoAberto(null)} />
        )}
      </div>
    )
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
            const plano = celulaAtiva.pacienteNome ? planejamentoDe(celulaAtiva.pacienteNome, celulaAtiva.item.id) : null
            const competenciaEntrega = competenciaDaData(dataEntrega)
            const antecipada = plano && competenciaEntrega < plano.competencia_planejada ? plano : null

            await marcarEntrega({
              pacienteNome: celulaAtiva.pacienteNome,
              itemId: celulaAtiva.item.id,
              status,
              observacao,
              evidencias,
              motivo,
              competencia: competenciaEntrega,
              dataEntrega,
            })

            // Regra: entrega semestral antecipada reprograma e recalcula a
            // próxima competência planejada (marco zero + 6 meses a partir da
            // competência em que foi de fato entregue).
            if (status === "entregue" && antecipada && celulaAtiva.pacienteNome) {
              const proximaCompetencia = addMeses(competenciaEntrega, 6)
              await cadastrarPlanejamento({
                pacienteNome: celulaAtiva.pacienteNome,
                itemId: celulaAtiva.item.id,
                competenciaPlanejada: proximaCompetencia,
                dataPlanejada: `${proximaCompetencia}-01`,
                reprogramarDe: antecipada,
              })
            }

            await recalcularApuracao()
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Faturamento liberado — reabra para editar" : item.nome}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed
        ${completo
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : entregue > 0
            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
            : "border-border bg-background text-muted-foreground hover:bg-muted/50"}`}
    >
      {completo ? <Check size={13} /> : null}
      {item.sigla} {entregue}/{esperado}
      {temEvidencia(registro) && <Paperclip size={11} />}
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
  const tom = entregue
    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
    : reiterada
      ? "border-red-400 bg-red-100 text-red-800 font-bold dark:border-red-700 dark:bg-red-950 dark:text-red-300"
      : vencido
        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-300"
        : reprogramado
          ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
          : pendente
            ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
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
      {icone === "check" && <Check size={13} />}
      {icone === "alert" && <AlertTriangle size={13} />}
      {icone === "calendar" && <CalendarPlus size={13} />}
      {statusLabel}
      {temEvidencia(registro) && <Paperclip size={11} />}
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
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {rotulo}
      </label>
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
    const nova = evidencias.map((e, i) => i === indice ? { ...e, [campo]: campo === "nome" && !valor ? null : valor } : e)
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
function SeletorQuantidadeSlots({ esperado, quantidade, onChange, disabled }: {
  esperado: number
  quantidade: number
  onChange: (nova: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: esperado }, (_, i) => {
        const marcado = i < quantidade
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onChange(marcado ? i : i + 1)}
            title={`Unidade ${i + 1} de ${esperado}${marcado ? " — entregue" : " — pendente"}`}
            className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed
              ${marcado
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"}`}
          >
            {marcado ? <Check size={18} /> : i + 1}
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
          <SeletorQuantidadeSlots esperado={esperado} quantidade={quantidade} onChange={alterarQuantidade} />
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
