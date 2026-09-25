"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { UserRound, XCircle, ChevronDown, Search } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { useRemuneracaoRPContext } from "@/contexts/RemuneracaoRPContext"
import { useParametrosGerais } from "@/hooks/useParametrosGerais"
import { useTaxasEspecialidade } from "@/hooks/useTaxasEspecialidade"
import { usePepApuracaoResumo } from "@/hooks/usePepApuracaoResumo"
import { useProfissionaisReboot } from "@/hooks/useProfissionaisReboot"
import { exportResumoSessoesPdf } from "@/lib/remuneracao/exportResumoSessoesPdf"
import { gerarPDF, gerarWord, montarInfoDocumentoPrestador, type PdfOpts } from "@/lib/remuneracao/documento"
import { montarDemonstrativo, pepDasLinhas } from "@/lib/remuneracao/demonstrativo"
import { resumoGeralIndividual } from "@/lib/remuneracao/visaoGeralIndividual"
import { calcularTotalPorEspecialidade } from "@/lib/remuneracao/dashboardRP"
import { normKey } from "@/lib/remuneracao/constants"
import { parseDateBR, competenciaDeLinhas } from "@/lib/remuneracao/datas"
import { getApuracaoMes } from "@/services/pepApuracao.service"
import type { PepApuracaoMensal } from "@/types/pep"
import { RemuneracaoGradeBadge, labelMes } from "./RemuneracaoGradeBadge"
import { EstadoGradeVazia } from "./EstadoGradeVazia"
import { RemuneracaoRPSkeleton } from "./RemuneracaoRPSkeleton"
import { ModalRemuneracaoRP } from "./ModalRemuneracaoRP"
import { VisaoGeralIndividual } from "./individual/VisaoGeralIndividual"
import { PainelProfissional } from "./individual/PainelProfissional"

// ─── Componente principal ─────────────────────────────────────────────────────
//
// Sem ninguém escolhido, a aba mostra a visão geral do mês SEM NOMES
// (VisaoGeralIndividual). Escolhido um nome, mostra o demonstrativo dele na
// tela antes de exportar (PainelProfissional) — a mesma conta que o PDF/Word
// imprime, de lib/remuneracao/demonstrativo.ts.

export function RemunIndividualTab() {
  const {
    resultado, evoRows, loading, error,
    cadastroPrestadores, controlesGrade,
  } = useRemuneracaoRPContext()
  const { parametros } = useParametrosGerais()
  const { taxas_pa } = useTaxasEspecialidade()
  const { setHeader, setRightContent } = useHeader()

  const [profSelecionado, setProfSelecionado] = useState<string>("")
  const [selectOpen, setSelectOpen]         = useState(false)
  const [searchQuery, setSearchQuery]       = useState("")
  const [highlightIdx, setHighlightIdx]     = useState(0)
  const [sessoesAbertas, setSessoesAbertas] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setHeader("Remuneração Individual", "Relacionamento Prestador")
    setRightContent(<RemuneracaoGradeBadge c={controlesGrade} />)
    return () => {
      setHeader("", "")
      setRightContent(null)
    }
  }, [setHeader, setRightContent, controlesGrade])

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

  // Visão geral: PEP de todos os prestadores da competência (uma consulta só) e
  // a especialidade geral cadastrada — as mesmas entradas do dashboard do /rp,
  // para os valores por especialidade baterem com os de lá.
  const { resumo: pepResumo, loading: pepResumoCarregando } = usePepApuracaoResumo(competencia)
  const { profissionais: profissionaisReboot } = useProfissionaisReboot()
  const especialidadeGeralPorProf = useMemo(() => {
    const mapa = new Map<string, string>()
    profissionaisReboot.forEach(p => {
      if (p.especialidade?.trim()) mapa.set(normKey(p.nome), p.especialidade.trim())
    })
    return mapa
  }, [profissionaisReboot])

  const resumoGeral = useMemo(() => {
    if (!resultado || resultado.length === 0) return null
    const { porEspecialidade } = calcularTotalPorEspecialidade(resultado, pepResumo, cadastroPrestadores, especialidadeGeralPorProf)
    return resumoGeralIndividual(resultado, {
      demonstrativoDe: p => {
        const pep = pepResumo.get(p.prof)
        // O resumo não traz a contagem de pacientes — só o total entra na conta.
        return montarDemonstrativo(p, { ccPA, etaBonus, taxasPA, pep: pep ? { total: pep.alcancado, pacientes: 0 } : null })
      },
      infoDe: p => montarInfoDocumentoPrestador(p, cadastroPrestadores),
      porEspecialidade,
    })
  }, [resultado, pepResumo, cadastroPrestadores, especialidadeGeralPorProf, ccPA, etaBonus, taxasPA])

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

  const carregando = loading || controlesGrade.gradeLoading
  // O mesmo rótulo do seletor no cabeçalho ("Agosto de 2026").
  const periodoTexto = labelMes(controlesGrade.periodoCarregado ?? controlesGrade.periodo)

  // ── Estado: sem dados ──
  //
  // Sem nada na tela e a grade a caminho → esqueleto no formato do layout real
  // (o mesmo da Remuneração Mensal). Depois da carga, EstadoGradeVazia separa
  // "nada no mês" de "grade reprovada".
  if ((!resultado || resultado.length === 0) && carregando) {
    return <RemuneracaoRPSkeleton periodo={periodoTexto} />
  }

  if (!resultado || resultado.length === 0) {
    return (
      <EstadoGradeVazia
        carregando={carregando}
        periodo={controlesGrade.periodo}
        erroResumo={controlesGrade.gradeErroResumo}
      />
    )
  }

  return (
    <div className="space-y-5">
      {loading && <p className="text-sm text-muted-foreground">Calculando…</p>}
      {error   && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* ── Painel de seleção ── */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">

        {/* Select estilizado */}
        <div>
          <label htmlFor="select-profissional" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Profissional ({profissionais.length})
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

      {/* ── Sem seleção: visão geral sem nomes ── */}
      {!profSelecionado && resumoGeral && (
        <VisaoGeralIndividual resumo={resumoGeral} periodoTexto={periodoTexto} pepCarregando={pepResumoCarregando} />
      )}

      {/* ── Com seleção: o demonstrativo na tela, antes de exportar ── */}
      {dadosProfSelecionado && demonstrativoSel && infoSel && (
        <PainelProfissional
          key={dadosProfSelecionado.prof}
          p={dadosProfSelecionado}
          d={demonstrativoSel}
          info={infoSel}
          pepCarregando={pepCarregando}
          remPeriodo={remPeriodo}
          competencia={competencia}
          onGerarPdf={() => gerarPDF(dadosProfSelecionado, pdfOpts)}
          onGerarWord={() => gerarWord(dadosProfSelecionado, pdfOpts)}
          onResumoSessoes={() => exportResumoSessoesPdf(infoSel, dadosProfSelecionado.sessoes || [])}
          onVerSessoes={() => setSessoesAbertas(true)}
        />
      )}

      {/* O mesmo detalhamento do /rp. `key` remonta a cada pessoa: aba, página
          e busca local nascem limpas. */}
      <ModalRemuneracaoRP
        key={sessoesAbertas && dadosProfSelecionado ? dadosProfSelecionado.prof : "fechado"}
        p={sessoesAbertas ? dadosProfSelecionado : null}
        periodo={controlesGrade.periodo}
        pepResumo={sessoesAbertas && dadosProfSelecionado ? pepResumo.get(dadosProfSelecionado.prof) ?? null : null}
        onClose={() => setSessoesAbertas(false)}
      />
    </div>
  )
}
