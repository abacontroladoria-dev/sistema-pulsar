"use client"

// Painel de sugestões automáticas de contratação (Tarefas 1-5) — renderizado
// acima de "Parâmetros da simulação". Ao clicar numa sugestão, aplica
// especialidade/dias/turnos/unidade no formulário já existente, reaproveitando
// 100% da grade e do comparativo já renderizados abaixo.

import { startTransition, useEffect, useMemo, useState, useTransition } from "react"
import { ArrowRight, Building2, ChevronLeft, ChevronRight, Loader2, Sparkles, Users, Wallet, Lock } from "lucide-react"
import { useSugestoesContratacao } from "@/hooks/useSugestoesContratacao"
import { useTaxasEspecialidadeCalculo } from "@/hooks/useTaxasEspecialidade"
import { useParametrosGeraisCalculo } from "@/hooks/useParametrosGerais"
import {
  calcularBreakEvenPJ, projetarMargemBreakEvenPJ, calcularBreakEvenAtendimento, projetarMargemBreakEvenAtendimento,
  ESPECIALIDADES_BREAK_EVEN_PJ, SEMANAS_POR_MES,
} from "@/lib/remuneracao/pontoEquilibrio"
import { diaCurto, fmtReal } from "@/lib/cronograma/helpers"
import { corTerapiaBadge, escurecerHex, hexParaRgba } from "@/lib/cronograma/constants"
import { Button } from "@/components/ui/button"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { COR_OCUPACAO } from "@/components/cronograma/ui/BadgeOcupacao"
import { IndicadorDiaTurno } from "@/components/cronograma/ui/IndicadorDiaTurno"
import { ConfirmDialog } from "@/components/cronograma/ui/ConfirmDialog"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { SecaoPastel, CabecalhoPastel, AnelProgresso, ChipOrigem } from "@/components/ui/pastel/pecas"
import { listarEspecialidades } from "@/lib/cronograma/simulacaoNovoPrestador"
import type { SugestaoContratacao } from "@/lib/cronograma/sugestaoContratacaoTypes"
import type { ModoCascataOcupacao, FaixaCascata } from "@/lib/cronograma/sugestaoContratacao"
import type { CsvRow } from "@/types/cronograma"
import {
  avaliarPeriodo, limitarCandidatosPorGap, type GapItem, type PeriodoSimulado, type Turno,
} from "@/lib/cronograma/simulacaoNovoPrestador"
import { anexarModalidadeERemanejamento, filtrarPorDisponibilidadeInterna, anexarRemuneracaoEOrdenar, terapiaDaEspecialidade } from "@/lib/cronograma/sugestaoContratacao"
import type { ConvenioValor, ConvenioValorPaciente } from "@/lib/cronograma/convenioValoresTypes"
import type { FeriadoInfo } from "@/types/feriados"

const SUGESTOES_POR_PAGINA = 6

interface Props {
  onAplicarSugestao: (especialidade: string, periodos: { dia: string; turno: Turno }[], unidade: string) => void
}

const FAIXAS_FILTRO: FaixaCascata[] = [70, 60, 50]

/** Reconstrói, pra UMA combinação (dia+turnos+unidade+especialidade), o mesmo
 *  pipeline de "Parâmetros da simulação" (avaliarPeriodo → limitarCandidatosPorGap
 *  → modalidade/remanejamento → disponibilidade interna → remuneração), SEM o
 *  teto de gap GLOBAL entre todas as sugestões do painel — só assim o valor de
 *  sessão e o volume batem exatamente com o que uma simulação manual dessa
 *  mesma combinação mostraria. `sugestao.candidatos`/`projecaoRemuneracao`
 *  continuam vindo do pipeline com teto global (evita contar o mesmo paciente
 *  em 2 sugestões ao mesmo tempo) — esta reconstrução é só pro Ponto de
 *  Equilíbrio de cada card, uma prévia local "se eu aplicar só esta". */
function avaliarComboIsolado(
  sugestao: SugestaoContratacao, cRows: CsvRow[], gapMap: Record<string, GapItem>,
  regrasGerais: ConvenioValor[], excecoesPaciente: ConvenioValorPaciente[],
  mesReferencia: { ano: number; mes: number } | null, feriados: Record<string, FeriadoInfo>,
): SugestaoContratacao | null {
  const periodosBrutos: PeriodoSimulado[] = sugestao.turnos.map(turno =>
    avaliarPeriodo(sugestao.dia, turno, sugestao.unidade, sugestao.especialidade, cRows, gapMap),
  )
  const periodos = limitarCandidatosPorGap(periodosBrutos, gapMap, sugestao.especialidade)

  const base: SugestaoContratacao = {
    id: `isolada-${sugestao.id}`,
    unidade: sugestao.unidade,
    especialidade: sugestao.especialidade,
    dia: sugestao.dia,
    turnos: sugestao.turnos,
    pctOcupacaoPrevista: 0,
    faixaCascata: 50,
    candidatos: periodos.flatMap(p => p.slots.flatMap(s => s.candidatos.map(c => ({
      paciente: c.pac, gap: c.gap, aut: c.aut, of: c.of, turno: p.turno, hora: s.hora,
      modalidade: "adjacente" as const, valorSessaoProjetado: null, ordemNaVaga: 1,
    })))),
    modalidadeDominante: "adjacente",
    salaVinculada: null,
    projecaoRemuneracao: null,
  }
  if (!base.candidatos.length) return null

  const comRemanejamento = anexarModalidadeERemanejamento([base], cRows, gapMap)
  const comDisponibilidade = filtrarPorDisponibilidadeInterna(comRemanejamento, cRows, gapMap)
  if (!comDisponibilidade.length) return null
  return anexarRemuneracaoEOrdenar(comDisponibilidade, cRows, regrasGerais, excecoesPaciente, mesReferencia, feriados)[0] ?? null
}

// Card inteiro é a área clicável (mesmo padrão de CardOportunidade, em
// OportunidadesInternasPanel.tsx, inspirado em CardPaciente de
// PacientesCadastro.tsx). O ConfirmDialog "sem sala livre" fica FORA do
// <div role="button"> (irmão dentro de um Fragment), não dentro dele: ele
// não é um portal, é renderizado na árvore normal — se ficasse dentro do
// card clicável, clicar em "Cancelar"/"Continuar" borbulharia até o
// onClick do card e disparava (ou reabria) a ação por cima do diálogo,
// um bug real no fluxo de segurança de contratação sem sala.
function CardSugestao({
  sugestao, cRows, gapMap, regrasGerais, excecoesPaciente, mesReferencia, feriados, pendente, onAplicar,
}: {
  sugestao: SugestaoContratacao; cRows: CsvRow[]; gapMap: Record<string, GapItem>
  regrasGerais: ConvenioValor[]; excecoesPaciente: ConvenioValorPaciente[]
  mesReferencia: { ano: number; mes: number } | null; feriados: Record<string, FeriadoInfo>
  pendente: boolean
  onAplicar: () => void
}) {
  const [confirmarSemSala, setConfirmarSemSala] = useState(false)

  const semSalaLivre = !sugestao.salaVinculada
  const qtdAdjacente = sugestao.candidatos.filter(c => c.modalidade === "adjacente").length
  const candidatosRemanejamento = sugestao.candidatos.filter(c => c.modalidade === "remanejamento")
  const qtdRemanejamento = candidatosRemanejamento.length
  // Vagas reais = horários distintos com pelo menos 1 candidato — vários pacientes
  // podem competir pela MESMA vaga, então "nº de candidatos" não é "nº de vagas".
  const vagas = new Set(sugestao.candidatos.map(c => `${c.turno}|||${c.hora}`)).size

  // Break Even sempre a 20% de perda neste card (o seletor de cenário fica só
  // em "Parâmetros da simulação" — aqui é uma prévia rápida, não uma análise
  // configurável) — mesmos modelos de lib/remuneracao/pontoEquilibrio.ts.
  const { taxas_pa: taxasPA, be_custo_mensal_pj: beCustoMensalPJ, be_capacidade_manha: beCapacidadeManha, be_capacidade_tarde: beCapacidadeTarde } = useTaxasEspecialidadeCalculo()
  const { parametros: parametrosGerais } = useParametrosGeraisCalculo()
  const PERDA_PADRAO_CARD = 20

  const isolada = useMemo(
    () => avaliarComboIsolado(sugestao, cRows, gapMap, regrasGerais, excecoesPaciente, mesReferencia, feriados),
    [sugestao, cRows, gapMap, regrasGerais, excecoesPaciente, mesReferencia, feriados],
  )
  const vagasIsoladas = isolada ? new Set(isolada.candidatos.map(c => `${c.turno}|||${c.hora}`)).size : 0

  // Badge de ocupação usa a % da combinação ISOLADA (sem o teto global de gap
  // entre sugestões), pra bater com o que "Parâmetros da simulação" mostraria
  // pra essa mesma combinação — sugestao.pctOcupacaoPrevista reflete o combo
  // com o teto global já aplicado, que normalmente é menor (outros dias/
  // especialidades competindo pelo mesmo paciente), então usá-lo aqui inflava
  // o badge em relação ao que "Detalhamento" acaba mostrando quando aplicado.
  const pctExibido = isolada?.pctOcupacaoPrevista ?? sugestao.pctOcupacaoPrevista
  const faixaExibida = isolada?.faixaCascata ?? sugestao.faixaCascata

  const margemBreakEven = (() => {
    if (!parametrosGerais || !isolada?.projecaoRemuneracao || vagasIsoladas <= 0) return null
    const valorSessaoMedio = isolada.projecaoRemuneracao.receitaSemanalProjetada / vagasIsoladas
    if (valorSessaoMedio <= 0) return null
    const periodosManha = sugestao.turnos.includes("manha") ? 1 : 0
    const periodosTarde = sugestao.turnos.includes("tarde") ? 1 : 0

    if (ESPECIALIDADES_BREAK_EVEN_PJ.has(sugestao.especialidade)) {
      const custoMensal = beCustoMensalPJ[sugestao.especialidade]
      const capManha = beCapacidadeManha[sugestao.especialidade]
      const capTarde = beCapacidadeTarde[sugestao.especialidade]
      if (custoMensal == null || capManha == null || capTarde == null) return null
      const resultado = calcularBreakEvenPJ({
        valorSessaoBruto: valorSessaoMedio, impostoFaturamentoPct: parametrosGerais.imposto_faturamento_pct,
        custoMensalDiaCompleto: custoMensal, capacidadeManha: capManha, capacidadeTarde: capTarde,
        perdaPct: PERDA_PADRAO_CARD, periodosManha, periodosTarde,
      })
      const projecao = projetarMargemBreakEvenPJ(resultado, PERDA_PADRAO_CARD, vagasIsoladas)
      return { receitaLiquidaMes: projecao.receitaLiquidaMes, custoMes: resultado.custoMensalTotal, margemMensal: projecao.margemMensal }
    }

    // taxas_pa é cadastrado por TERAPIA granular (ex.: "Aplicador ABA (PS)"),
    // não pela especialidade agregada ("Psicologia ABA") — terapiaDaEspecialidade
    // resolve a terapia representativa, mesma lógica já usada pro Break Even PJ.
    const taxaPA = taxasPA[terapiaDaEspecialidade(sugestao.especialidade)]
    if (!taxaPA) return null
    const resultado = calcularBreakEvenAtendimento({
      valorSessaoBruto: valorSessaoMedio, impostoFaturamentoPct: parametrosGerais.imposto_faturamento_pct,
      taxaPA, capacidadeManha: parametrosGerais.pa_capacidade_manha_padrao, capacidadeTarde: parametrosGerais.pa_capacidade_tarde_padrao,
      periodosManha, periodosTarde,
    })
    const projecao = projetarMargemBreakEvenAtendimento(resultado, taxaPA, PERDA_PADRAO_CARD, vagasIsoladas)
    return { receitaLiquidaMes: projecao.receitaLiquidaMes, custoMes: projecao.custoVariavelMes, margemMensal: projecao.margemMensal }
  })()

  // Bruto de referência usa a MESMA convenção de 4,33 semanas/mês da receita
  // líquida (não o "Projetado/mês" de calendário real, que soma um número
  // diferente de vezes esse dia da semana cai no mês) — senão esta linha
  // misturava a diferença de calendário com o efeito real de imposto/perda.
  const impostosEPerdas = margemBreakEven && isolada?.projecaoRemuneracao
    ? isolada.projecaoRemuneracao.receitaSemanalProjetada * SEMANAS_POR_MES - margemBreakEven.receitaLiquidaMes
    : 0

  const acionar = () => {
    if (pendente) return
    if (semSalaLivre) setConfirmarSemSala(true)
    else onAplicar()
  }

  const tFaixa = faixaExibida === 70 ? "verde" : faixaExibida === 60 ? "azul" : "amber"

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-busy={pendente}
        onClick={acionar}
        onKeyDown={e => {
          if (pendente) return
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); acionar() }
        }}
        aria-label={`Aplicar sugestão: ${sugestao.especialidade} em ${sugestao.unidade}, ${diaCurto(sugestao.dia)}`}
        className={`group flex h-full flex-col gap-3 rounded-[24px] border-[3px] bg-[var(--pp-surface)] p-5 transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 pp-tom pp-t-${tFaixa} border-[var(--c-suave)] ${pendente ? "cursor-wait opacity-80" : "cursor-pointer"}`}
      >
        <div className="flex items-start gap-4">
          <AnelProgresso feitas={pctExibido} total={100} rotulo="ocupação" texto={`${Math.round(pctExibido)}%`} t={tFaixa} />

          <div className="min-w-0 flex-1 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[14px] font-black tracking-tight text-[var(--pp-ink)]">
                {sugestao.especialidade}
              </span>
              <span className="text-[var(--pp-ink-muted)]">·</span>
              <span className="text-[13px] font-semibold text-[var(--pp-ink-muted)]">{sugestao.unidade}</span>
            </div>
            <div className="mt-1">
              <IndicadorDiaTurno dia={sugestao.dia} turnos={sugestao.turnos} t={tFaixa} />
            </div>
          </div>
        </div>

        {margemBreakEven ? (
          <div className={`mt-2 relative overflow-hidden rounded-[20px] p-4 pp-tom ${margemBreakEven.margemMensal >= 0 ? "pp-t-verde bg-[var(--c-suave)]" : "pp-t-vermelho bg-[var(--c-suave)]"}`}>
            <div className="absolute -right-4 -top-4 text-[var(--c-tinta)]/5">
              <Wallet size={120} strokeWidth={1} />
            </div>
            <div className="relative z-10 flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/60 text-[var(--c-tinta)] shadow-sm backdrop-blur-sm">
                    <Wallet size={14} strokeWidth={2.5} />
                  </div>
                  <span className="text-[12px] font-black uppercase tracking-wider text-[var(--c-tinta)]">Margem/mês</span>
                </div>
                <div className="mt-3 flex flex-col gap-1 text-[10.5px] font-bold text-[var(--c-tinta)]/70">
                  <div className="flex items-center justify-between gap-4">
                    <span>Receita líquida/mês</span>
                    <span>{fmtReal(margemBreakEven.receitaLiquidaMes)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>− Impostos ({parametrosGerais?.imposto_faturamento_pct}%) e perdas ({PERDA_PADRAO_CARD}%)</span>
                    <span>− {fmtReal(impostosEPerdas)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>− Remuneração do prestador</span>
                    <span>− {fmtReal(margemBreakEven.custoMes)}</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[20px] sm:text-[24px] font-black tabular-nums tracking-tight text-[var(--c-tinta)]">
                  {margemBreakEven.margemMensal >= 0 ? "+" : ""}{fmtReal(margemBreakEven.margemMensal)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-2 relative overflow-hidden rounded-[20px] p-4 pp-tom pp-t-verde bg-[var(--c-suave)]">
            <div className="relative z-10 flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/60 text-[var(--c-tinta)] shadow-sm backdrop-blur-sm">
                    <Wallet size={14} strokeWidth={2.5} />
                  </div>
                  <span className="text-[12px] font-black uppercase tracking-wider text-[var(--c-tinta)]">Receita/mês projetada</span>
                </div>
                {sugestao.projecaoRemuneracao && (
                  <span className="mt-1 text-[10.5px] font-bold text-[var(--c-tinta)]/70">
                    {fmtReal(sugestao.projecaoRemuneracao.receitaSemanalProjetada)} /semana
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="text-[20px] sm:text-[24px] font-black tabular-nums tracking-tight text-[var(--c-tinta)]">
                  {sugestao.projecaoRemuneracao ? fmtReal(sugestao.projecaoRemuneracao.receitaMensalProjetada) : "—"}
                </span>
              </div>
            </div>
          </div>
        )}
        {!!sugestao.projecaoRemuneracao?.sessoesSemValor && (
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
            <Lock size={12} /> {sugestao.projecaoRemuneracao.sessoesSemValor} sessão(ões) sem valor cadastrado
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-[var(--pp-muted)] px-3 py-1.5 text-[11px] font-bold text-[var(--pp-ink)]">
            <Users size={13} className="text-[var(--pp-ink-muted)]" />
            {vagas} vaga(s) <span className="text-[var(--pp-ink-muted)]">·</span> {sugestao.candidatos.length} paciente(s) elegível(is)
          </div>
          {qtdRemanejamento > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-[var(--pp-muted)] px-3 py-1.5 text-[11px] font-bold text-[var(--pp-ink-muted)]">
              {qtdAdjacente} adjacência <span className="text-[var(--pp-ink-muted)]">·</span> {qtdRemanejamento} remanejamento
            </div>
          )}
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${
            semSalaLivre
              ? "bg-rose-100 text-rose-700 animate-pulse"
              : "bg-[var(--pp-muted)] text-[var(--pp-ink-muted)]"
          }`}>
            <Building2 size={13} />
            {sugestao.salaVinculada
              ? `Sala ${sugestao.salaVinculada.nomeExibicao} · ${sugestao.salaVinculada.unidade}`
              : "Sem sala livre encontrada"}
          </div>
        </div>

        <div className="mt-auto pt-4">
          <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--c-tinta)]/10 py-3 text-[13px] font-black text-[var(--c-tinta)] transition-colors group-hover:bg-[var(--c-tinta)]/20">
            {pendente ? (
              <>
                Aplicando…
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
              </>
            ) : (
              <>
                Aplicar sugestão
                <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none" />
              </>
            )}
          </div>
        </div>
      </div>

      {confirmarSemSala && (
        <ConfirmDialog
          title="Simular sem sala livre"
          description="Esta sugestão não tem sala livre encontrada no momento — você está simulando uma contratação hipotética sem sala garantida. Confirme a alocação de sala antes de contratar de fato."
          confirmLabel="Continuar"
          confirmColor="#dc2626"
          onCancel={() => setConfirmarSemSala(false)}
          onConfirm={() => { setConfirmarSemSala(false); onAplicar() }}
        />
      )}
    </>
  )
}

const ESPECIALIDADES_OPCOES = listarEspecialidades().map((nome, id) => ({ id, nome }))

export function SugestoesContratacaoPanel({ onAplicarSugestao }: Props) {
  const [modo, setModo] = useState<ModoCascataOcupacao>("diaInteiro")
  const [faixasSelecionadas, setFaixasSelecionadas] = useState<ReadonlySet<FaixaCascata>>(new Set(FAIXAS_FILTRO))
  // Vazio = sem filtro (todas as especialidades) — diferente de "Faixa", que
  // sempre precisa de pelo menos 1 marcada, aqui "nada marcado" é o estado
  // inicial natural (mostrar tudo).
  const [especialidadesIds, setEspecialidadesIds] = useState<Set<number>>(new Set())
  const [pagina, setPagina] = useState(0)
  const {
    sugestoes: todasSugestoes, loading, error, laudosCarregados, refWeekLabel, cRows, gapMap,
    regrasGerais, excecoesPaciente, mesReferencia, feriados,
  } = useSugestoesContratacao(modo, faixasSelecionadas)

  // Aplicar um card dispara recálculo pesado abaixo (mesmo motivo do
  // startTransition usado nos filtros) — sem indicação visual, o clique
  // parece não ter feito nada até o recálculo terminar. `aplicando` cobre
  // o período em que o React está processando essa transição;
  // `sugestaoPendenteId` marca QUAL card mostra o spinner.
  const [aplicando, startAplicarTransition] = useTransition()
  const [sugestaoPendenteId, setSugestaoPendenteId] = useState<string | null>(null)
  useEffect(() => {
    if (!aplicando) setSugestaoPendenteId(null)
  }, [aplicando])

  const especialidadesSelecionadas = useMemo(
    () => new Set(ESPECIALIDADES_OPCOES.filter(o => especialidadesIds.has(o.id)).map(o => o.nome)),
    [especialidadesIds],
  )
  const sugestoes = useMemo(
    () => especialidadesSelecionadas.size === 0 ? todasSugestoes : todasSugestoes.filter(s => especialidadesSelecionadas.has(s.especialidade)),
    [todasSugestoes, especialidadesSelecionadas],
  )

  if (!laudosCarregados) return null

  // startTransition: mudar modo/faixa dispara calcularTodosCombos/pipeline de
  // enriquecimento (varre unidade × especialidade × dia), pesado e síncrono —
  // sem isso o clique trava até o recálculo terminar.
  const mudarModo = (novo: ModoCascataOcupacao) => startTransition(() => { setModo(novo); setPagina(0) })

  const alternarFaixa = (faixa: FaixaCascata) => startTransition(() => {
    setFaixasSelecionadas(prev => {
      const proxima = new Set(prev)
      if (proxima.has(faixa)) {
        if (proxima.size === 1) return prev // sempre precisa sobrar pelo menos 1 faixa marcada
        proxima.delete(faixa)
      } else {
        proxima.add(faixa)
      }
      return proxima
    })
    setPagina(0)
  })

  const alternarEspecialidade = (id: number) => {
    setEspecialidadesIds(prev => {
      const proxima = new Set(prev)
      if (proxima.has(id)) proxima.delete(id)
      else proxima.add(id)
      return proxima
    })
    setPagina(0)
  }

  const totalPaginas = Math.max(1, Math.ceil(sugestoes.length / SUGESTOES_POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas - 1)
  const sugestoesDaPagina = sugestoes.slice(paginaAtual * SUGESTOES_POR_PAGINA, paginaAtual * SUGESTOES_POR_PAGINA + SUGESTOES_POR_PAGINA)

  const aplicarSugestao = (s: SugestaoContratacao) => {
    setSugestaoPendenteId(s.id)
    startAplicarTransition(() => {
      onAplicarSugestao(s.especialidade, s.turnos.map(turno => ({ dia: s.dia, turno })), s.unidade)
    })
  }

  return (
    <SecaoPastel titulo="sugestoes-contratacao">
      <CabecalhoPastel
        id="sugestoes-contratacao"
        titulo="Sugestões automáticas de contratação"
        t="violeta"
        Icone={Sparkles}
        apoio={`O sistema identifica onde contratar rende mais ocupação prevista, já indicando sala livre e a receita mensal estimada — semana de referência: ${refWeekLabel}.`}
        direita={
          !loading && !error ? (
            <span className="rounded-full bg-[var(--pp-muted)] px-3 py-1 text-[11px] font-bold text-[var(--pp-ink-muted)]">
              {sugestoes.length} sugestão(ões)
            </span>
          ) : null
        }
        tamanho="medio"
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-[var(--pp-border)] bg-[var(--pp-surface)] px-4 py-3 shadow-[var(--pp-sombra)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--pp-ink-muted)]">Ocupação:</span>
          <div className="flex gap-1.5">
            {(
              [
                { value: "diaInteiro" as const, label: "Manhã + tarde juntos" },
                { value: "porTurno" as const, label: "Melhor turno isolado" },
              ]
            ).map(tab => {
              const ativa = modo === tab.value
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => mudarModo(tab.value)}
                  aria-pressed={ativa}
                  className={`rounded-full border px-3 py-1 text-[11.5px] font-bold transition-colors pp-tom ${
                    ativa
                      ? "pp-t-azul border-[var(--c-suave)] bg-[var(--c-suave)] text-[var(--c-tinta)]"
                      : "border-[var(--pp-border)] bg-transparent text-[var(--pp-ink-muted)] hover:bg-[var(--pp-muted)]"
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          <InfoTooltip ariaLabel="O que significa cada critério de ocupação">
            <p><strong className="text-foreground">Manhã + tarde juntos</strong>: soma os dois turnos do mesmo dia antes de calcular a % — simula um profissional que aceita ambos, então a % cai se um turno for bem mais ocioso que o outro.</p>
            <p className="mt-2"><strong className="text-foreground">Melhor turno isolado</strong>: ranqueia pelo turno (ou dia inteiro) que sozinho rende mais % — pode aparecer alto mesmo que o profissional só aceite um dos turnos.</p>
          </InfoTooltip>
        </div>

        <div className="hidden h-5 w-px bg-[var(--pp-border)] lg:block" />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--pp-ink-muted)]">Faixa:</span>
          <div className="flex gap-1.5">
            {FAIXAS_FILTRO.map(faixa => {
              const ativa = faixasSelecionadas.has(faixa)
              return (
                <button
                  key={faixa}
                  type="button"
                  onClick={() => alternarFaixa(faixa)}
                  aria-pressed={ativa}
                  className={`rounded-full border px-3 py-1 text-[11.5px] font-bold transition-colors pp-tom ${
                    ativa
                      ? "pp-t-azul border-[var(--c-suave)] bg-[var(--c-suave)] text-[var(--c-tinta)]"
                      : "border-[var(--pp-border)] bg-transparent text-[var(--pp-ink-muted)] hover:bg-[var(--pp-muted)]"
                  }`}
                >
                  ≥ {faixa}%
                </button>
              )
            })}
          </div>
        </div>

        <div className="hidden h-5 w-px bg-[var(--pp-border)] lg:block" />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--pp-ink-muted)]">Especialidades:</span>
          <div className="w-64">
            <MultiSearchCombobox
              opcoes={ESPECIALIDADES_OPCOES}
              selecionados={especialidadesIds}
              onToggle={alternarEspecialidade}
              placeholder="Todas as especialidades"
              nomePlural="especialidades"
              ariaLabel="Especialidades"
            />
          </div>
          {especialidadesIds.size > 0 && (
            <button
              type="button"
              onClick={() => { setEspecialidadesIds(new Set()); setPagina(0) }}
              className="text-[11px] font-bold text-[var(--pp-ink-muted)] underline decoration-dotted hover:text-[var(--pp-ink)]"
            >
              Limpar filtro
            </button>
          )}
        </div>
      </div>

      {loading && <InlineNotice tone="slate">Calculando sugestões…</InlineNotice>}

      {!loading && error && <InlineNotice tone="red">Falha ao calcular sugestões: {error}</InlineNotice>}

      {!loading && !error && !sugestoes.length && (
        <InlineNotice tone="slate">
          Nenhuma sugestão com ocupação prevista ≥ {Math.min(...faixasSelecionadas)}% no momento — tente marcar uma faixa mais baixa acima.
        </InlineNotice>
      )}

      {!loading && !error && !!sugestoes.length && (
        <>
          <div className="grid grid-cols-1 items-stretch gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {sugestoesDaPagina.map(s => (
              <CardSugestao
                key={s.id}
                sugestao={s}
                cRows={cRows}
                gapMap={gapMap}
                regrasGerais={regrasGerais}
                excecoesPaciente={excecoesPaciente}
                mesReferencia={mesReferencia}
                feriados={feriados}
                pendente={sugestaoPendenteId === s.id}
                onAplicar={() => aplicarSugestao(s)}
              />
            ))}
          </div>

          {totalPaginas > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline" size="icon-xs"
                disabled={paginaAtual === 0}
                onClick={() => setPagina(p => Math.max(0, p - 1))}
                aria-label="Página anterior"
              >
                <ChevronLeft size={13} />
              </Button>
              {Array.from({ length: totalPaginas }, (_, i) => i).map(i => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPagina(i)}
                  className={`h-7 min-w-7 rounded-full border px-2 text-[11px] font-bold transition-colors ${
                    i === paginaAtual
                      ? "border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500"
                      : "border-border bg-card text-foreground hover:bg-muted/50"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <Button
                variant="outline" size="icon-xs"
                disabled={paginaAtual === totalPaginas - 1}
                onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))}
                aria-label="Próxima página"
              >
                <ChevronRight size={13} />
              </Button>
            </div>
          )}
        </>
      )}
    </SecaoPastel>
  )
}
