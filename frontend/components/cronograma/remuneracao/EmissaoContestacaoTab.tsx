"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { UserRound, XCircle, ChevronDown, Search, AlertTriangle, FileWarning } from "lucide-react"
import { useRemuneracaoRPContext } from "@/contexts/RemuneracaoRPContext"
import { useParametrosGerais } from "@/hooks/useParametrosGerais"
import { useTaxasEspecialidade } from "@/hooks/useTaxasEspecialidade"
import { usePepApuracaoResumo } from "@/hooks/usePepApuracaoResumo"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { exportResumoSessoesPdf } from "@/lib/remuneracao/exportResumoSessoesPdf"
import { gerarPDF, gerarWord, montarInfoDocumentoPrestador, type PdfOpts } from "@/lib/remuneracao/documento"
import { montarDemonstrativo, pepDasLinhas } from "@/lib/remuneracao/demonstrativo"
import { parseDateBR, competenciaDeLinhas } from "@/lib/remuneracao/datas"
import { getApuracaoMes } from "@/services/pepApuracao.service"
import type { PepApuracaoMensal } from "@/types/pep"
import { labelMes } from "./RemuneracaoGradeBadge"
import { EstadoGradeVazia } from "./EstadoGradeVazia"
import { RemuneracaoRPSkeleton } from "./RemuneracaoRPSkeleton"
import { ModalRemuneracaoRP } from "./ModalRemuneracaoRP"
import { PainelProfissional } from "./individual/PainelProfissional"

// ─── Aba "Contestação do prestador" do Faturamento de Prestadores Mensal ─────
//
// Era a tela /relacionamento-prestador/individual (até 22/10/2026). O documento
// do prestador (PDF/Word da apuração e o PDF das sessões) NÃO é enviado de
// rotina: só sai quando o prestador contesta o valor do mês. Por isso a faixa
// fixa no topo e a confirmação antes de cada emissão. Quem vê a aba é decidido
// pelo código relacionamento_prestador_individual (lib/permissions/routes.ts).
//
// Escolhido um nome, mostra o demonstrativo dele na tela antes de emitir
// (PainelProfissional) — a mesma conta que o PDF/Word imprime, de
// lib/remuneracao/demonstrativo.ts. Sem ninguém escolhido, só o seletor: a
// visão do mês inteiro é a aba Faturamento.

export function EmissaoContestacaoTab() {
  const {
    resultado, evoRows, loading, error,
    cadastroPrestadores, controlesGrade,
  } = useRemuneracaoRPContext()
  const { parametros } = useParametrosGerais()
  const { taxas_pa } = useTaxasEspecialidade()
  const { confirmar, dialogo } = useConfirmacao()

  const [profSelecionado, setProfSelecionado] = useState<string>("")
  const [selectOpen, setSelectOpen]         = useState(false)
  const [searchQuery, setSearchQuery]       = useState("")
  const [highlightIdx, setHighlightIdx]     = useState(0)
  const [sessoesAbertas, setSessoesAbertas] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  // Limpa a seleção quando o resultado muda (novo CSV carregado)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reage a uma prop assíncrona externa (novo CSV), não há valor derivável no primeiro render
    setProfSelecionado("")
  }, [resultado])

  // Fecha o dropdown ao clicar fora ou pressionar Escape
  useEffect(() => {
    if (!selectOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) setSelectOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectOpen(false) }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [selectOpen])

  const ccPA     = parametros?.cc_pa_default ?? 50
  const ccPE     = parametros?.cc_pe_default ?? 100
  const etaBonus = parametros?.eta_bonus_default ?? 100
  const taxasPA  = taxas_pa

  const profissionais = useMemo(
    () => Array.from(new Set(resultado?.map(r => r.prof) || [])).sort((a, b) => a.localeCompare(b)),
    [resultado]
  )

  const profissionaisFiltrados = useMemo(() => {
    if (!searchQuery.trim()) return profissionais
    const q = searchQuery.toLowerCase().trim()
    return profissionais.filter(p => p.toLowerCase().includes(q))
  }, [profissionais, searchQuery])

  const dadosProfSelecionado = useMemo(
    () => (resultado ?? []).find(p => p.prof === profSelecionado) ?? null,
    [resultado, profSelecionado]
  )

  const remPeriodo = useMemo(() => {
    const datas = evoRows.map(r => parseDateBR(r.data)).filter((d): d is Date => d !== null)
    if (!datas.length) return null
    const min = datas.reduce((a, b) => (b < a ? b : a))
    const max = datas.reduce((a, b) => (b > a ? b : a))
    const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
    return { inicio: fmt(min), fim: fmt(max) }
  }, [evoRows])

  const competencia = useMemo(() => competenciaDeLinhas(evoRows), [evoRows])

  // PEP apurada (pep_apuracao_mensal) do prestador selecionado, na competência
  // da Grade carregada — leitura pura, a apuração de verdade acontece na aba
  // Entregas PEP.
  //
  // Guardada junto com a chave (prestador|competência) que a pediu: enquanto a
  // resposta da pessoa ATUAL não chegou, `pepCarregando` segura a PEP e o total
  // na prévia — senão a tela mostraria "PEP não apurada" por um instante, e um
  // clique no PDF nesse instante sairia assim de verdade.
  const chavePep = profSelecionado && competencia ? `${profSelecionado}|${competencia}` : null
  const [pepEstado, setPepEstado] = useState<{ chave: string; data: PepApuracaoMensal[] | null } | null>(null)
  useEffect(() => {
    if (!chavePep || !competencia) return
    let cancelado = false
    getApuracaoMes(profSelecionado, competencia).then(({ data }) => {
      if (!cancelado) setPepEstado({ chave: chavePep, data })
    })
    return () => { cancelado = true }
  }, [chavePep, profSelecionado, competencia])
  const pepCarregando = !!chavePep && pepEstado?.chave !== chavePep
  const pepApuracao = chavePep && pepEstado?.chave === chavePep ? pepEstado.data : null

  const pdfOpts: PdfOpts = {
    remPeriodo,
    ccPA, ccPE, etaBonus, taxasPA,
    cadastroPrestadores,
    pepApuracao,
  }

  // PEP de todos os prestadores da competência — só para o "Ver sessões"
  // (ModalRemuneracaoRP), o mesmo indicador do card na aba Faturamento.
  const { resumo: pepResumo } = usePepApuracaoResumo(competencia)

  const demonstrativoSel = useMemo(
    () => dadosProfSelecionado
      ? montarDemonstrativo(dadosProfSelecionado, { ccPA, etaBonus, taxasPA, pep: pepDasLinhas(pepApuracao) })
      : null,
    [dadosProfSelecionado, ccPA, etaBonus, taxasPA, pepApuracao]
  )
  const infoSel = useMemo(
    () => (dadosProfSelecionado ? montarInfoDocumentoPrestador(dadosProfSelecionado, cadastroPrestadores) : null),
    [dadosProfSelecionado, cadastroPrestadores]
  )

  // Toda emissão passa por aqui: sem confirmar que houve contestação, nada sai.
  async function emitir(documento: string, gerar: () => void) {
    if (!dadosProfSelecionado) return
    const ok = await confirmar({
      titulo: `Houve contestação de ${dadosProfSelecionado.prof}?`,
      texto: (
        <>
          <strong>{documento}</strong> só pode ser emitido mediante contestação do prestador. Se ele não contestou o valor do mês, não emita.
        </>
      ),
      confirmar: "Sim, houve contestação: emitir",
      cancelar: "Cancelar",
      t: "amber",
      Icone: AlertTriangle,
    })
    if (ok) gerar()
  }

  const carregando = loading || controlesGrade.gradeLoading
  // O mesmo rótulo do seletor no cabeçalho ("Agosto de 2026").
  const periodoTexto = labelMes(controlesGrade.periodoCarregado ?? controlesGrade.periodo)

  // ── Estado: sem dados ──
  //
  // Sem nada na tela e a grade a caminho → esqueleto no formato do layout real
  // (o mesmo da aba Faturamento). Depois da carga, EstadoGradeVazia separa
  // "nada no mês" de "grade reprovada". A faixa fica em cima nos dois casos.
  if ((!resultado || resultado.length === 0) && carregando) {
    return (
      <div className="space-y-5">
        <FaixaContestacao />
        <RemuneracaoRPSkeleton periodo={periodoTexto} />
      </div>
    )
  }

  if (!resultado || resultado.length === 0) {
    return (
      <div className="space-y-5">
        <FaixaContestacao />
        <EstadoGradeVazia
          carregando={carregando}
          periodo={controlesGrade.periodo}
          erroResumo={controlesGrade.gradeErroResumo}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <FaixaContestacao />
      {loading && <p className="text-sm text-muted-foreground">Calculando…</p>}
      {error   && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* ── Painel de seleção ── */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">

        {/* Select estilizado */}
        <div>
          <label htmlFor="select-profissional" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Prestador que contestou ({profissionais.length})
          </label>
          <div className="relative" ref={selectRef}>
            <button
              type="button"
              id="select-profissional"
              aria-haspopup="listbox"
              aria-expanded={selectOpen}
              onClick={() => { setSelectOpen(o => !o); setSearchQuery(""); setHighlightIdx(0) }}
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <UserRound size={15} className="text-muted-foreground shrink-0" />
                <span className="truncate">
                  {profSelecionado || "— Selecione um profissional —"}
                </span>
              </span>
              <ChevronDown size={15} className={`text-muted-foreground shrink-0 transition-transform ${selectOpen ? "rotate-180" : ""}`} />
            </button>

            {selectOpen && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-popover shadow-lg flex flex-col max-h-72">
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Buscar profissional..."
                      value={searchQuery}
                      onChange={e => { setSearchQuery(e.target.value); setHighlightIdx(0) }}
                      onKeyDown={e => {
                        if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, profissionaisFiltrados.length - 1)) }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
                        else if (e.key === "Enter") {
                          e.preventDefault()
                          const prof = profissionaisFiltrados[highlightIdx]
                          if (prof) { setProfSelecionado(prof); setSelectOpen(false) }
                        }
                      }}
                      role="combobox"
                      aria-expanded={selectOpen}
                      aria-controls="lista-profissionais"
                      aria-activedescendant={profissionaisFiltrados[highlightIdx] ? `prof-opt-${profissionaisFiltrados[highlightIdx]}` : undefined}
                      className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 border-none focus:ring-1 focus:ring-ring rounded-lg outline-none transition-shadow"
                    />
                  </div>
                </div>
                <div id="lista-profissionais" role="listbox" aria-label="Profissionais" className="overflow-y-auto">
                  {profissionaisFiltrados.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">Nenhum profissional encontrado.</div>
                  ) : (
                    profissionaisFiltrados.map((prof, i) => (
                      <button
                        key={prof}
                        id={`prof-opt-${prof}`}
                        type="button"
                        role="option"
                        aria-selected={prof === profSelecionado}
                        onClick={() => { setProfSelecionado(prof); setSelectOpen(false) }}
                        onMouseEnter={() => setHighlightIdx(i)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2
                          ${prof === profSelecionado ? "bg-muted font-semibold text-foreground" : i === highlightIdx ? "bg-muted/60 text-foreground" : "text-muted-foreground"}`}
                      >
                        <UserRound size={13} className="shrink-0" />
                        <span className="truncate">{prof}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {profSelecionado && (
            <button
              type="button"
              onClick={() => setProfSelecionado("")}
              className="mt-1.5 text-xs text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors"
            >
              <XCircle size={12} /> Limpar seleção
            </button>
          )}
        </div>
      </div>

      {/* ── Com seleção: o demonstrativo na tela, antes de emitir ── */}
      {dadosProfSelecionado && demonstrativoSel && infoSel && (
        <PainelProfissional
          key={dadosProfSelecionado.prof}
          p={dadosProfSelecionado}
          d={demonstrativoSel}
          info={infoSel}
          pepCarregando={pepCarregando}
          remPeriodo={remPeriodo}
          competencia={competencia}
          onGerarPdf={() => emitir("O PDF da apuração do faturamento", () => gerarPDF(dadosProfSelecionado, pdfOpts))}
          onGerarWord={() => emitir("O Word da apuração do faturamento", () => gerarWord(dadosProfSelecionado, pdfOpts))}
          onResumoSessoes={() => emitir("O PDF da apuração das sessões", () => exportResumoSessoesPdf(infoSel, dadosProfSelecionado.sessoes || []))}
          onVerSessoes={() => setSessoesAbertas(true)}
        />
      )}

      {/* O mesmo detalhamento da aba Faturamento. `key` remonta a cada pessoa:
          aba, página e busca local nascem limpas. */}
      <ModalRemuneracaoRP
        key={sessoesAbertas && dadosProfSelecionado ? dadosProfSelecionado.prof : "fechado"}
        p={sessoesAbertas ? dadosProfSelecionado : null}
        periodo={controlesGrade.periodo}
        pepResumo={sessoesAbertas && dadosProfSelecionado ? pepResumo.get(dadosProfSelecionado.prof) ?? null : null}
        onClose={() => setSessoesAbertas(false)}
      />
      {dialogo}
    </div>
  )
}

/** Fixa no topo da aba, com ou sem prestador escolhido — inclusive com a grade vazia. */
function FaixaContestacao() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
      <FileWarning size={20} className="mt-0.5 shrink-0" aria-hidden />
      <div className="text-sm leading-snug">
        <p className="font-bold uppercase tracking-wide">Emitir somente mediante contestação do prestador</p>
        <p className="mt-0.5 text-amber-800 dark:text-amber-200/90">Este documento não é enviado de rotina: só sai quando o prestador contesta o valor do mês.</p>
      </div>
    </div>
  )
}
