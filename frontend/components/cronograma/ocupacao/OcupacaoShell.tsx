"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Ban, Loader2, XCircle } from "lucide-react"
import { B } from "@/lib/cronograma/constants"
import { buscarGradeComoCSVRows } from "@/lib/cronograma/gradeService"
import { getRefWeek, waKey } from "@/lib/cronograma/helpers"
import { runAlgorithm } from "@/lib/cronograma/runAlgorithm"
import { exportBase } from "@/lib/cronograma/xlsx"
import { useCronogramaData } from "@/contexts/CronogramaDataContext"
import { useHeader } from "@/contexts/HeaderContext"
import { GapsTab } from "./tabs/GapsTab"
import { GuiaTab } from "./tabs/GuiaTab"
import { AcompanhamentoTab } from "./tabs/AcompanhamentoTab"
import { CronModal } from "./CronModal"
import type { AlgorithmResult, Sugestao, WaStatus } from "@/types/cronograma"

// "inconsistencias" (Inconsistências e Exceções) saiu em 22/10/2026: ninguém
// usava. InconsistenciasTab.tsx ficou no repositório, caso volte.
const TABS = [
  { key: "oportunidades-recusadas", label: "🚫 Oportunidades Recusadas" },
  { key: "gaps",             label: "📊 Diferença: Laudo e Oferta" },
  { key: "guia",             label: "📖 Guia" },
] as const

type TabKey = (typeof TABS)[number]["key"]

const TAB_HEADERS: Record<TabKey, { title: string; subtitle: string }> = {
  "oportunidades-recusadas": { title: "Oportunidades Recusadas",  subtitle: "Acompanhamento de sugestões e redistribuições" },
  gaps:            { title: "Diferença: Laudo e Oferta",     subtitle: "Comparativo entre laudos autorizados e sessões ofertadas" },
  guia:            { title: "Guia do Cronograma",            subtitle: "" },
}

export function OcupacaoShell() {
  const { cRows, lRows, rec, inv, waMap, cfg, conf, pacBundles, saveError, clearSaveError, sRec, sInv, sWa, setCRows } = useCronogramaData()

  const searchParams = useSearchParams()
  const router = useRouter()
  const rawTab = searchParams.get("tab")
  // "acompanhamento" era o nome antigo desta aba (renomeada 2026-08-25) — mantém
  // links/favoritos antigos funcionando em vez de cair no default silenciosamente.
  const resolvedTab = rawTab === "acompanhamento" ? "oportunidades-recusadas" : rawTab
  const activeTab: TabKey = resolvedTab && TABS.some(t => t.key === resolvedTab) ? (resolvedTab as TabKey) : "oportunidades-recusadas"

  const { setHeader } = useHeader()

  const [res, setRes] = useState<AlgorithmResult | null>(null)
  const [load, setLoad] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [cRec, setCRec] = useState<Sugestao | null>(null)
  const [cInv, setCInv] = useState<Sugestao | null>(null)
  const [motInv, setMotInv] = useState("")
  const [cronPac, setCronPac] = useState<string | null>(null)

  const [apiFetch, setApiFetch] = useState(false)
  const [apiErr, setApiErr] = useState("")

  useEffect(() => {
    if (!rawTab) router.replace("/cronograma/ocupacao?tab=oportunidades-recusadas")
  }, [rawTab])

  useEffect(() => {
    if (!cRows.length || !lRows.length) { setRes(null); return }
    setLoad(true)
    setErr(null)
    const t = setTimeout(() => {
      try {
        // CRON-008: Grade Final = CSV + Reservas Pendentes. pacBundles (Ocp. Paciente)
        // é a única fonte de verdade da reserva — não é espelhado em `conf` — então
        // precisa entrar aqui também para bloquear a vaga para qualquer outro paciente.
        const confirmedItems = [
          ...conf.map(c => ({ prof: c.prof, dia: c.dia, hora: c.hora })),
          ...pacBundles
            .filter(b => b.status === "confirmado")
            .flatMap(b => b.sessoes.map(s => ({ prof: s.prof, dia: s.dia, hora: s.hora }))),
        ]
        setRes(runAlgorithm(cRows, lRows, rec, inv, { ...cfg, waMap, confirmedItems }))
      } catch (e) {
        setErr(`Erro: ${(e as Error).message}`)
      } finally {
        setLoad(false)
      }
    }, 50)
    return () => clearTimeout(t)
  }, [cRows, lRows, rec, inv, cfg, waMap, conf, pacBundles])

  // Período (semana de referência) entra direto no subtítulo do cabeçalho — nada
  // de repetir a mesma informação num pill separado abaixo, redundante em toda aba.
  useEffect(() => {
    const h = TAB_HEADERS[activeTab]
    const subtitle = res ? `${h.subtitle} · ${res.semanaRef}` : h.subtitle
    setHeader(h.title, subtitle)
    return () => setHeader("", "")
  }, [activeTab, res, setHeader])

  const handleWA = useCallback((s: Sugestao) => {
    sWa({ ...waMap, [waKey(s)]: "aguardando" })
  }, [waMap, sWa])

  const handleWAUndo = useCallback((s: Sugestao) => {
    const w = { ...waMap }
    delete w[waKey(s)]
    sWa(w)
  }, [waMap, sWa])

  const handleWAStatus = useCallback((s: Sugestao, status: WaStatus) => {
    sWa({ ...waMap, [waKey(s)]: status })
    if (status === "recusado") {
      sRec([...rec, {
        paciente: s.pac, profissional: s.prof, especialidade: s.esp,
        unidade: s.unidade, dia: s.dia, hora: s.hora,
        registradoEm: new Date().toLocaleDateString("pt-BR"),
      }])
    }
  }, [waMap, sWa, rec, sRec])

  const sugsByPac = useMemo(() => {
    if (!res) return {}
    const m: Record<string, Sugestao[]> = {}
    for (const s of [...res.vagasAgora, ...res.filaEspera]) {
      if (!m[s.pac]) m[s.pac] = []
      m[s.pac].push(s)
    }
    return m
  }, [res])


  // Carrega a grade da tabela csv_grades_profissionais (sincronizada diariamente às 06h).
  // É a fonte canônica e completa — substitui a antiga chamada à API ao vivo do TITA,
  // que vinha incompleta (ex.: sem sessões de "Coordenador de Caso").
  const handleApiFetch = useCallback(async () => {
    setApiFetch(true); setApiErr("")
    const rw = getRefWeek()
    try {
      const rows = await buscarGradeComoCSVRows(rw.inicio, rw.fim)
      if (rows.length === 0) { setApiErr("Nenhum registro encontrado para o período."); return }
      setCRows(rows)
    } catch (e) {
      setApiErr(e instanceof Error ? e.message : "Erro ao buscar a grade.")
    } finally {
      setApiFetch(false)
    }
  }, [setCRows])

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Status bar — período já está no cabeçalho. O indicador "Salvo às" foi
          retirado a pedido (2026-08-25): a persistência já é automática e o
          aviso não trazia informação acionável. O erro de salvamento continua
          visível — esse sim precisa de ação do usuário. */}
      {(load || err || (activeTab === "oportunidades-recusadas" && saveError)) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px", alignItems: "center" }}>
          {load && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "var(--text-xs)", color: B.blue, fontWeight: "var(--weight-semibold)" }}>
              <Loader2 size={12} className="animate-spin" /> Processando...
            </span>
          )}
          {err && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "var(--text-xs)", color: "#dc2626", fontWeight: "var(--weight-semibold)" }}>
              <AlertTriangle size={12} /> {err}
            </span>
          )}
          {activeTab === "oportunidades-recusadas" && saveError && (
            <button
              type="button"
              style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: "999px", padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer", fontFamily: "inherit" }}
              onClick={clearSaveError}
              aria-label={`Erro ao salvar: ${saveError}. Clique para fechar`}
            >
              <AlertTriangle size={12} /> {saveError}
            </button>
          )}
        </div>
      )}

      {/* Tab content */}
      {activeTab === "oportunidades-recusadas" && (
        <AcompanhamentoTab res={res}
          onWA={handleWA} onWAUndo={handleWAUndo} onWAStatus={handleWAStatus}
          onRec={setCRec} onInv={setCInv} onCron={s => setCronPac(s.pac)} />
      )}
      {activeTab === "gaps" && <GapsTab res={res} />}
      {activeTab === "guia" && <GuiaTab apiFetch={apiFetch} apiErr={apiErr} onApiFetch={handleApiFetch} />}

      {/* Modal Recusa */}
      {cRec && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)", padding: "16px" }}
          onClick={e => { if (e.target === e.currentTarget) setCRec(null) }}>
          <div style={{ background: "var(--card)", borderRadius: "var(--radius-xl)", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "380px", width: "100%", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "var(--weight-black)", fontSize: "var(--text-lg)", marginBottom: "4px" }}>
              <XCircle size={17} style={{ color: B.orange }} /> Registrar Recusa
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginBottom: "14px" }}>Esta combinação não será sugerida novamente.</div>
            <div style={{ background: "#fef2f2", borderRadius: "var(--radius-md)", padding: "12px", fontSize: "var(--text-md)", marginBottom: "14px" }}>
              <div><span style={{ color: "var(--muted-foreground)", fontSize: "var(--text-xs)" }}>Paciente</span><br /><strong>{cRec.pac}</strong></div>
              <div style={{ marginTop: "6px" }}><span style={{ color: "var(--muted-foreground)", fontSize: "var(--text-xs)" }}>Sessão</span><br />{cRec.dia} {cRec.hora} · {cRec.unidade}</div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => {
                sRec([...rec, { paciente: cRec.pac, profissional: cRec.prof, especialidade: cRec.esp, unidade: cRec.unidade, dia: cRec.dia, hora: cRec.hora, registradoEm: new Date().toLocaleDateString("pt-BR") }])
                setCRec(null)
              }} style={{ padding: "8px 16px", borderRadius: "var(--radius-md)", background: B.orange, color: "white", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-bold)", fontSize: "var(--text-sm)" }}>
                Confirmar Recusa
              </button>
              <button onClick={() => setCRec(null)} style={{ flex: 1, padding: "8px 16px", borderRadius: "var(--radius-md)", background: "var(--muted)", color: "var(--card-foreground)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-semibold)" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Inviável */}
      {cInv && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)", padding: "16px" }}
          onClick={e => { if (e.target === e.currentTarget) { setCInv(null); setMotInv("") } }}>
          <div style={{ background: "var(--card)", borderRadius: "var(--radius-xl)", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "380px", width: "100%", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "var(--weight-black)", fontSize: "var(--text-lg)", marginBottom: "4px" }}>
              <Ban size={17} style={{ color: "#b45309" }} /> Marcar como Inviável
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginBottom: "14px" }}>Removido de TODAS as sugestões até tirado da lista.</div>
            <div style={{ background: "var(--muted)", borderRadius: "var(--radius-md)", padding: "12px", fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", marginBottom: "10px" }}>{cInv.pac}</div>
            <textarea value={motInv} onChange={e => setMotInv(e.target.value)} placeholder="Motivo (ex: família faltando muito...)" rows={2}
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: "var(--text-sm)", fontFamily: "inherit", resize: "none", marginBottom: "14px", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => {
                const nextWa = Object.fromEntries(Object.entries(waMap).filter(([k]) => !k.startsWith(`${cInv.pac}|||`)))
                sWa(nextWa)
                sInv([...inv, { paciente: cInv.pac, motivo: motInv, registradoEm: new Date().toLocaleDateString("pt-BR") }])
                setCInv(null); setMotInv("")
              }} style={{ padding: "8px 16px", borderRadius: "var(--radius-md)", background: B.navy, color: "white", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-bold)", fontSize: "var(--text-sm)" }}>
                Confirmar
              </button>
              <button onClick={() => { setCInv(null); setMotInv("") }} style={{ flex: 1, padding: "8px 16px", borderRadius: "var(--radius-md)", background: "var(--muted)", color: "var(--card-foreground)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-semibold)" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cronograma */}
      {cronPac && res && (
        <CronModal pac={cronPac} sugsDosPac={sugsByPac[cronPac] || []} agendRows={res.agendRows} onClose={() => setCronPac(null)} />
      )}
    </div>
  )
}
