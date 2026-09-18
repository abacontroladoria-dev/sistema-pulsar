"use client"

import { useCallback, useMemo, useState } from "react"
import { ESP_CLINICO, TERAPIA_TO_ESP } from "@/lib/cronograma/constants"
import {
  buildSugestoesManual,
  type SugestaoManual, type SugestoesManualResult,
} from "@/lib/cronograma/novoCronograma"
import { construirProfissionaisOcupados, profissionalEstaOcupado } from "@/lib/cronograma/helpers"
import { UnidadeSelector } from "@/components/cronograma/ui/UnidadeSelector"
import { WorkbenchBar, WorkbenchArea, WorkbenchKpi } from "@/components/cronograma/ui/WorkbenchBar"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import {
  CronogramaWorkspace, WorkspaceEmptyState,
  type WorkspaceEspResumo, type WorkspaceSessao,
} from "@/components/cronograma/ui/CronogramaWorkspace"
import { ctaPrimariaStyle, inputStyle, toggleButtonStyle } from "@/components/cronograma/ui/ocupStyles"
import type { CsvRow, LaudoRow } from "@/types/cronograma"

interface Props {
  cRows: CsvRow[]
}

interface LinhaTerapia {
  id: string
  especialidade: string
  quantidade: number
}

const ESP_OPCOES = Object.keys(ESP_CLINICO)

const ESP_ORD_T = [
  "Fonoaudiologia", "Terapia Ocupacional", "Psicologia ABA", "Musicoterapia",
  "Psicopedagogia", "Psicomotricidade", "Terapia Alimentar", "Fisioterapia",
  "Fisioterapia Aquática", "Equoterapia", "Arteterapia", "Psicologia", "Habilidades Sociais",
]

// Chave interna do "paciente" no laudo sintético — o orçamento não tem paciente
// cadastrado e nada é gravado, então o nome só precisa casar entre o laudo
// montado em memória e a chamada a buildSugestoesManual.
const PACIENTE_SIMULADO = "Simulação"

let seqLinha = 0
/** Nova linha já na primeira terapia ainda não usada — cada terapia entra no orçamento uma única vez. */
function novaLinha(usadas: Set<string>): LinhaTerapia | null {
  const livre = ESP_OPCOES.find(e => !usadas.has(e))
  if (!livre) return null
  seqLinha += 1
  return { id: `l${seqLinha}`, especialidade: livre, quantidade: 1 }
}

// Simulação de orçamento: pura visualização, nada é gravado na TiTa nem
// persistido em lugar nenhum (nem localStorage) — para paciente que ainda não
// tem cadastro na clínica, então não há laudo real nem histórico de agendamento
// pra consultar. O usuário digita terapias/quantidades à mão; a busca de horário
// roda sobre a grade real (vagas livres), só o "laudo" é sintético. A ausência de
// action bar no rodapé da grade é o que materializa "não há o que confirmar aqui".
export function OrcamentoPacMode({ cRows }: Props) {
  const [linhas, setLinhas] = useState<LinhaTerapia[]>(() => [novaLinha(new Set())!])
  const [turno, setTurno] = useState<"manha" | "tarde">("manha")
  const [unidades, setUnidades] = useState<string[]>([])
  const [multiplas, setMultiplas] = useState(false)
  const [result, setResult] = useState<SugestoesManualResult | null>(null)

  // ── Estado de seleção interativa ──────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [profSelIdx, setProfSelIdx] = useState<Record<string, number>>({})
  const [espSelIdx, setEspSelIdx] = useState<Record<string, number>>({})
  const [verApenasSelecionados, setVerApenasSelecionados] = useState(false)

  const livreSlots = useMemo(() => {
    const profOcupado = construirProfissionaisOcupados(cRows)
    return cRows.filter(r =>
      r["Status do Agendamento"] === "Livre"
      && !profissionalEstaOcupado(profOcupado, r["Profissional"], r["Dia da Semana"], String(r.HI_str || "")),
    )
  }, [cRows])

  function addLinha() {
    setLinhas(prev => {
      const nova = novaLinha(new Set(prev.map(l => l.especialidade)))
      return nova ? [...prev, nova] : prev
    })
    setResult(null)
  }

  function removerLinha(id: string) {
    setLinhas(prev => prev.filter(l => l.id !== id))
    setResult(null)
  }

  function atualizarLinha(id: string, patch: Partial<LinhaTerapia>) {
    setLinhas(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)))
    setResult(null)
  }

  // Opções de uma linha: todas as terapias menos as já escolhidas nas OUTRAS
  function opcoesPorLinha(linha: LinhaTerapia): string[] {
    const usadasEmOutras = new Set(linhas.filter(l => l.id !== linha.id).map(l => l.especialidade))
    return ESP_OPCOES.filter(e => !usadasEmOutras.has(e))
  }

  const todasTerapiasUsadas = linhas.length >= ESP_OPCOES.length
  const totalSolicitado = linhas.reduce((a, l) => a + (l.quantidade > 0 ? l.quantidade : 0), 0)
  const canSimular = unidades.length > 0 && linhas.every(l => !!l.especialidade) && cRows.length > 0

  function handleSimular() {
    if (!canSimular) return
    const laudoSimulado: LaudoRow[] = linhas
      .filter(l => l.quantidade > 0 && !!l.especialidade)
      .map(l => ({
        "Paciente": PACIENTE_SIMULADO,
        "Especialidade": l.especialidade,
        "Qtd autorizada": l.quantidade,
        "Situação": "Vigente",
      }))
    const r = buildSugestoesManual(PACIENTE_SIMULADO, unidades, turno, laudoSimulado, livreSlots)
    setResult(r)
    setSelectedIds(new Set())
    setProfSelIdx({})
    setEspSelIdx({})
    setVerApenasSelecionados(false)
  }

  const getActiveData = useCallback((s: SugestaoManual) => {
    const ei = espSelIdx[s.id] || 0
    if (ei > 0 && s.espAlts[ei - 1]) {
      const ea = s.espAlts[ei - 1]
      const pi = profSelIdx[s.id] || 0
      if (pi > 0 && ea.profAlts[pi - 1]) {
        const pa = ea.profAlts[pi - 1]
        return { tP: pa.tP, esp: ea.esp, prof: pa.prof, unidade: pa.unidade, csvGradeId: pa.csvGradeId }
      }
      return { tP: ea.tP, esp: ea.esp, prof: ea.prof, unidade: ea.unidade, csvGradeId: ea.csvGradeId }
    }
    const pi = profSelIdx[s.id] || 0
    if (pi > 0 && s.profAlts[pi - 1]) {
      const pa = s.profAlts[pi - 1]
      return { tP: pa.tP, esp: s.esp, prof: pa.prof, unidade: pa.unidade, csvGradeId: pa.csvGradeId }
    }
    return { tP: s.tP, esp: s.esp, prof: s.prof, unidade: s.unidade, csvGradeId: s.csvGradeId }
  }, [espSelIdx, profSelIdx])

  const sessoesWorkspace = useMemo<WorkspaceSessao[]>(() => {
    if (!result) return []
    return result.sugestoes
      .filter(s => !verApenasSelecionados || selectedIds.has(s.id))
      .map(s => {
        const d = getActiveData(s)
        const tE = TERAPIA_TO_ESP[d.tP] && TERAPIA_TO_ESP[d.tP] !== d.tP ? TERAPIA_TO_ESP[d.tP] : undefined
        return {
          dia: s.dia, hora: s.hora, tP: d.tP, esp: d.esp, prof: d.prof,
          unidade: d.unidade,
          tE,
          sugestaoId: s.id,
          origTp: s.tP,
          origProf: s.prof,
        }
      })
  }, [result, getActiveData, verApenasSelecionados, selectedIds])

  // ── Contagem por especialidade (reflete seleção) ──────────────────────────

  const selectedByEsp = useMemo<Record<string, number>>(() => {
    if (!result) return {}
    const counts: Record<string, number> = {}
    for (const s of result.sugestoes) {
      if (!selectedIds.has(s.id)) continue
      const d = getActiveData(s)
      counts[d.esp] = (counts[d.esp] || 0) + 1
    }
    return counts
  }, [result, selectedIds, getActiveData])

  const totalSelecionado = Object.values(selectedByEsp).reduce((a, b) => a + b, 0)

  const espResumo = useMemo<WorkspaceEspResumo[]>(() => {
    if (!result) return []
    const nomes = [
      ...ESP_ORD_T.filter(e => result.espTable[e]),
      ...Object.keys(result.espTable).filter(e => !ESP_ORD_T.includes(e)),
    ]
    return nomes
      .filter(e => (result.espTable[e]?.aut ?? 0) > 0)
      .map(e => ({ esp: e, of: selectedByEsp[e] || 0, aut: result.espTable[e].aut }))
  }, [result, selectedByEsp])

  // ── Excesso e multi-prof (informativos) ───────────────────────────────────

  const excessoEsps = useMemo<Set<string>>(() => {
    if (!result) return new Set()
    return new Set(espResumo.filter(g => g.of > g.aut).map(g => g.esp))
  }, [result, espResumo])

  const multiProfTerapias = useMemo<Set<string>>(() => {
    if (!result) return new Set()
    const profsPorTerapia: Record<string, Set<string>> = {}
    for (const s of result.sugestoes) {
      if (!selectedIds.has(s.id)) continue
      const d = getActiveData(s)
      if (!profsPorTerapia[d.tP]) profsPorTerapia[d.tP] = new Set()
      profsPorTerapia[d.tP].add(d.prof)
    }
    return new Set(
      Object.entries(profsPorTerapia).filter(([, profs]) => profs.size > 3).map(([tP]) => tP),
    )
  }, [result, selectedIds, getActiveData])

  // ── Trava de unidade por dia ──────────────────────────────────────────────

  const diaUnidadeTravada = useMemo<Record<string, string>>(() => {
    if (!result) return {}
    const trava: Record<string, string> = {}
    for (const s of result.sugestoes) {
      if (!selectedIds.has(s.id)) continue
      const d = getActiveData(s)
      if (!trava[s.dia]) trava[s.dia] = d.unidade
    }
    return trava
  }, [result, selectedIds, getActiveData])

  // ── Mapas de alternativas ─────────────────────────────────────────────────

  const profAltsMap = useMemo<Record<string, import("@/lib/cronograma/novoCronograma").ProfAlt[]>>(() => {
    if (!result) return {}
    const m: Record<string, import("@/lib/cronograma/novoCronograma").ProfAlt[]> = {}
    for (const s of result.sugestoes) {
      const ei = espSelIdx[s.id] || 0
      m[s.id] = (ei > 0 && s.espAlts[ei - 1]) ? s.espAlts[ei - 1].profAlts : s.profAlts
    }
    return m
  }, [result, espSelIdx])

  const espAltsMap = useMemo<Record<string, import("@/lib/cronograma/novoCronograma").EspAltManual[]>>(() => {
    if (!result) return {}
    const m: Record<string, import("@/lib/cronograma/novoCronograma").EspAltManual[]> = {}
    for (const s of result.sugestoes) m[s.id] = s.espAlts
    return m
  }, [result])

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const handleToggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }, [])

  const handleChangeProf = useCallback((id: string, idx: number) => {
    setProfSelIdx(prev => ({ ...prev, [id]: idx }))
  }, [])

  const handleChangeEsp = useCallback((id: string, idx: number) => {
    setEspSelIdx(prev => ({ ...prev, [id]: idx }))
    setProfSelIdx(prev => ({ ...prev, [id]: 0 }))
  }, [])

  const handleSelectAll = useCallback(() => {
    if (!result) return
    const trava: Record<string, string> = {}
    const next = new Set<string>()
    for (const s of result.sugestoes) {
      const d = getActiveData(s)
      if (!trava[s.dia]) trava[s.dia] = d.unidade
      if (trava[s.dia] === d.unidade) next.add(s.id)
    }
    setSelectedIds(next)
  }, [result, getActiveData])

  const handleClearAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const avisos = useMemo(() => {
    if (!result) return []
    return [
      "⚠ Simulação apenas — nada é gravado na TiTa nem salvo. Para agendar, cadastre o paciente e use \"Criar Novo Cronograma\".",
      ...result.alertas.map(a => a.msg),
    ]
  }, [result])

  return (
    <>
      <WorkbenchBar colunas="31fr 14fr 17fr 23fr 15fr">
        <WorkbenchArea label="Terapias a simular">
          {/* overflow visible: a lista suspensa do combobox precisa poder
              transbordar a área de rolagem das linhas. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {linhas.map(l => (
              <div key={l.id} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SearchCombobox
                    value={l.especialidade}
                    onChange={v => atualizarLinha(l.id, { especialidade: v })}
                    opcoes={opcoesPorLinha(l)}
                    placeholder="Buscar terapia..."
                    ariaLabel="Buscar terapia"
                    variante="ocupacao"
                    compacto
                  />
                </div>
                <input
                  type="number"
                  aria-label="Quantidade"
                  min={1}
                  max={20}
                  value={l.quantidade}
                  onChange={e => atualizarLinha(l.id, { quantidade: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  style={{ ...inputStyle(false), width: "48px", padding: "4px 6px", fontSize: "11px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}
                />
                <button
                  type="button"
                  onClick={() => removerLinha(l.id)}
                  disabled={linhas.length === 1}
                  className="disabled:opacity-40"
                  style={{
                    flexShrink: 0, width: "24px", padding: "4px 0", borderRadius: "5px",
                    fontSize: "9px", fontWeight: 700, fontFamily: "inherit",
                    border: "1px solid #fca5a5", background: "#fee2e2", color: "#dc2626",
                    cursor: linhas.length === 1 ? "not-allowed" : "pointer", lineHeight: "1.4",
                  }}
                  aria-label="Remover terapia"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addLinha}
            disabled={todasTerapiasUsadas}
            title={todasTerapiasUsadas ? "Todas as terapias já foram adicionadas" : undefined}
            style={{
              alignSelf: "flex-start", fontSize: "10px", fontWeight: 700,
              color: todasTerapiasUsadas ? "var(--muted-foreground)" : "#0369a1",
              background: "none", border: "none", padding: 0,
              cursor: todasTerapiasUsadas ? "not-allowed" : "pointer", fontFamily: "inherit",
            }}
          >
            + Adicionar terapia
          </button>
          {cRows.length === 0 && (
            <div style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
              Carregue a <strong style={{ color: "var(--card-foreground)" }}>Grade</strong> no badge do topo.
            </div>
          )}
        </WorkbenchArea>

        <WorkbenchArea label="Turno">
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", width: "100%" }}>
            {(["manha", "tarde"] as const).map(t => {
              const active = turno === t
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setTurno(t); setResult(null); setSelectedIds(new Set()) }}
                  className="crono-wb-toggle"
                  style={{
                    flex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "6px 10px", borderRadius: "8px", fontSize: "11px",
                    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                    ...toggleButtonStyle(active),
                  }}
                >
                  {t === "manha" ? "Manhã" : "Tarde"}
                </button>
              )
            })}
          </div>
        </WorkbenchArea>

        <WorkbenchArea label="Seleção">
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", width: "100%" }}>
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={!result || result.sugestoes.length === 0}
              style={{ flex: 1, padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, cursor: (!result || result.sugestoes.length === 0) ? "not-allowed" : "pointer", fontFamily: "inherit", border: "1px solid #86efac", background: "#dcfce7", color: "#15803d", whiteSpace: "nowrap", opacity: (!result || result.sugestoes.length === 0) ? 0.5 : 1, transition: "background 150ms ease" }}
            >
              Selecionar tudo
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={selectedIds.size === 0}
              style={{ flex: 1, padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, cursor: selectedIds.size === 0 ? "not-allowed" : "pointer", fontFamily: "inherit", border: "1px solid #fca5a5", background: "#fee2e2", color: "#dc2626", whiteSpace: "nowrap", opacity: selectedIds.size === 0 ? 0.5 : 1, transition: "background 150ms ease" }}
            >
              Limpar seleção
            </button>
            <button
              type="button"
              aria-pressed={verApenasSelecionados}
              onClick={() => setVerApenasSelecionados(v => !v)}
              className="crono-wb-toggle"
              style={{
                width: "100%",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                border: verApenasSelecionados ? "1px solid #86efac" : "1px solid var(--border)",
                background: verApenasSelecionados ? "#dcfce7" : "var(--muted)",
                color: verApenasSelecionados ? "#15803d" : "var(--muted-foreground)",
              }}
            >
              <span>Ver apenas selecionados</span>
              <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.02em" }}>
                {verApenasSelecionados ? "ON" : "OFF"}
              </span>
            </button>
          </div>
        </WorkbenchArea>

        <WorkbenchArea label="Unidade">
          <UnidadeSelector
            value={unidades}
            onChange={next => { setUnidades(next); setResult(null); setSelectedIds(new Set()) }}
            multiplas={multiplas}
            onMultiplasChange={next => { setMultiplas(next); setResult(null); setSelectedIds(new Set()) }}
          />
        </WorkbenchArea>

        <WorkbenchArea variante="acao" comBorda={false}>
          <WorkbenchKpi rotulo="Sessões solicitadas" valor={totalSolicitado} legenda="Somatório das terapias" />
          <button
            type="button"
            onClick={handleSimular}
            disabled={!canSimular}
            style={{
              padding: "8px 14px", borderRadius: "9px", fontSize: "12px",
              fontFamily: "inherit", ...ctaPrimariaStyle(!canSimular),
            }}
          >
            Simular
          </button>
        </WorkbenchArea>
      </WorkbenchBar>

      {!result && (
        <WorkspaceEmptyState
          emoji="🧮"
          titulo="Monte o orçamento"
          subtitulo="Informe as terapias, o turno e a unidade. Nada é gravado — a simulação é só para visualizar."
        />
      )}

      {result && (
        <>
          <CronogramaWorkspace
            sessoes={sessoesWorkspace}
            espResumo={espResumo}
            antes={0}
            avisos={avisos}
            vazioMsg="Nenhuma vaga livre encontrada para este turno/unidade."
            interativo
            selectedIds={selectedIds}
            onToggle={handleToggle}
            profAltsMap={profAltsMap}
            espAltsMap={espAltsMap}
            profSelIdx={profSelIdx}
            espSelIdx={espSelIdx}
            onChangeProf={handleChangeProf}
            onChangeEsp={handleChangeEsp}
            excessoEsps={excessoEsps}
            multiProfTerapias={multiProfTerapias}
            diaUnidadeTravada={diaUnidadeTravada}
          />
        </>
      )}
    </>
  )
}
