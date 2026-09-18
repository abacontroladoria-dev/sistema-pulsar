"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { PACS_ADMIN, TERAPIA_TO_ESP } from "@/lib/cronograma/constants"
import {
  buildSugestoesManual,
  type EspEntry, type SugestaoManual, type SugestoesManualResult,
} from "@/lib/cronograma/novoCronograma"
import {
  construirProfissionaisOcupados, isLaudoComAlta, profissionalEstaOcupado,
} from "@/lib/cronograma/helpers"
import { useCronogramaData } from "@/contexts/CronogramaDataContext"
import { UnidadeSelector } from "@/components/cronograma/ui/UnidadeSelector"
import { WorkbenchBar, WorkbenchArea, WorkbenchKpi } from "@/components/cronograma/ui/WorkbenchBar"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import {
  CronogramaWorkspace, WorkspaceActionBar, WorkspaceEmptyState,
  type WorkspaceEspResumo, type WorkspaceSessao,
} from "@/components/cronograma/ui/CronogramaWorkspace"
import { badgeTriad, ctaPrimariaStyle, toggleButtonStyle } from "@/components/cronograma/ui/ocupStyles"
import { ConfirmarImplantacaoModal, type AvisoMultiProf } from "./ConfirmarImplantacaoModal"
import type { CsvRow, LaudoRow } from "@/types/cronograma"
import type { AceiteSessao, AceitePacBundle } from "@/types/acompanhamento"

interface Props {
  cRows: CsvRow[]
  lRows: LaudoRow[]
  /** `${pacienteNome}|||${especialidade}` com suspensão temporária vigente — ver suspensaoTemporaria.ts. */
  suspensaoSet?: Set<string>
}

// Referência estável para quando `suspensaoSet` não é passado.
const SUSPENSAO_SET_VAZIO = new Set<string>()

// "Notificação Prévia" é o paciente-teste de homologação da integração TiTa —
// mesma exceção de OcupPacMode.tsx (PACS_ADMIN_OCUP_PAC), pra permitir testar o
// fluxo real de implantação desta modalidade sem afetar as demais páginas.
const PACIENTE_TESTE_TITA = "Notificação Prévia"
const PACS_ADMIN_NOVO = new Set(PACS_ADMIN)
PACS_ADMIN_NOVO.delete(PACIENTE_TESTE_TITA)

const ESP_ORD_T = [
  "Fonoaudiologia", "Terapia Ocupacional", "Psicologia ABA", "Musicoterapia",
  "Psicopedagogia", "Psicomotricidade", "Terapia Alimentar", "Fisioterapia",
  "Fisioterapia Aquática", "Equoterapia", "Arteterapia", "Psicologia", "Habilidades Sociais",
]

interface PendingConfirm {
  sessoes: AceiteSessao[]
  avisoMultiProf: AvisoMultiProf[]
}

/** Recorte do que a rota /api/tita/situacao-favorecidos devolve ao cliente. */
interface FavorecidoSituacaoCliente {
  id: number | null
  nome: string
  situacao: "Ativo" | "Inativo"
}

type SituacoesState =
  | { estado: "carregando" }
  | { estado: "erro" }
  | { estado: "ok"; porId: Map<number, "Ativo" | "Inativo">; porNome: Map<string, "Ativo" | "Inativo"> }

export function CriarNovoCronogramaPacMode({ cRows, lRows, suspensaoSet = SUSPENSAO_SET_VAZIO }: Props) {
  const { pacBundles, persistPacBundles } = useCronogramaData()
  const [paciente, setPaciente] = useState("")
  const [turno, setTurno] = useState<"manha" | "tarde">("manha")
  const [unidades, setUnidades] = useState<string[]>([])
  const [multiplas, setMultiplas] = useState(false)
  const [result, setResult] = useState<SugestoesManualResult | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [situacoes, setSituacoes] = useState<SituacoesState>({ estado: "carregando" })

  // ── Estado de seleção interativa ──────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [profSelIdx, setProfSelIdx] = useState<Record<string, number>>({})
  const [espSelIdx, setEspSelIdx] = useState<Record<string, number>>({})
  const [verApenasSelecionados, setVerApenasSelecionados] = useState(false)

  // Situação cadastral (Ativo/Inativo) vem da TiTa, não do laudo: o laudo diz o
  // que o paciente PODE receber, não se ele ainda é paciente da clínica. Sem
  // este cruzamento, um cadastro inativado continuaria elegível aqui, porque o
  // laudo dele segue no relatório.
  useEffect(() => {
    let cancelado = false
    fetch("/api/tita/situacao-favorecidos")
      .then(async r => {
        const body = await r.json().catch(() => null) as
          | { ok: boolean; favorecidos?: FavorecidoSituacaoCliente[]; error?: string }
          | null
        if (cancelado) return
        if (!r.ok || !body?.ok || !body.favorecidos) {
          setSituacoes({ estado: "erro" })
          return
        }
        const porId = new Map<number, "Ativo" | "Inativo">()
        const porNome = new Map<string, "Ativo" | "Inativo">()
        for (const f of body.favorecidos) {
          if (f.id != null) porId.set(f.id, f.situacao)
          if (f.nome) porNome.set(f.nome.trim().toLowerCase(), f.situacao)
        }
        setSituacoes({ estado: "ok", porId, porNome })
      })
      .catch(() => { if (!cancelado) setSituacoes({ estado: "erro" }) })
    return () => { cancelado = true }
  }, [])

  // Pacientes já com alguma linha "Agendado" — fora do escopo desta modalidade
  // (é justamente o público do modo "Aumentar Cronograma").
  const agendPacs = useMemo(() => {
    const s = new Set<string>()
    for (const r of cRows) {
      if (r["Status do Agendamento"] !== "Agendado") continue
      if (r["Nome Favorecido"]) s.add(r["Nome Favorecido"])
    }
    return s
  }, [cRows])

  // Laudo com alguma especialidade com quantidade autorizada > 0 — qualquer
  // Situação — e zero agendamentos ainda: cronograma realmente novo, do zero.
  const candidatos = useMemo(() => {
    const comAutorizacao = new Set<string>()
    for (const r of lRows) {
      const p = String(r["Paciente"] || "").trim()
      if (!p || PACS_ADMIN_NOVO.has(p)) continue
      const esp = String(r["Especialidade"] || "").trim()
      if (!esp || isLaudoComAlta(r as Record<string, unknown>) || suspensaoSet.has(`${p}|||${esp}`)) continue
      const aut = parseFloat(String(r["Qtd autorizada"] || "0")) || 0
      if (aut > 0) comAutorizacao.add(p)
    }
    return [...comAutorizacao].filter(p => !agendPacs.has(p)).sort()
  }, [lRows, agendPacs, suspensaoSet])

  // id_favorecido do laudo — única forma de resolver o paciente na TiTa quando
  // ele ainda não tem nenhuma linha Agendado (ver resolverIdFavorecido).
  const idFavorecidoPorPac = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of lRows) {
      const p = String(r["Paciente"] || "").trim()
      if (!p || m.has(p) || r["ID Favorecido"] == null) continue
      const n = Number(r["ID Favorecido"])
      if (Number.isFinite(n)) m.set(p, n)
    }
    return m
  }, [lRows])

  const idFavorecidoSel = paciente ? idFavorecidoPorPac.get(paciente) : undefined

  // Situação de um paciente: casa primeiro por id_favorecido (chave estável) e só
  // recorre ao nome quando o laudo não trouxe id. Paciente que não aparece no
  // cadastro da TiTa fica como null — indeterminado, e por isso não é bloqueado.
  const situacaoDe = useCallback((pac: string): "Ativo" | "Inativo" | null => {
    if (situacoes.estado !== "ok") return null
    const id = idFavorecidoPorPac.get(pac)
    if (id != null) {
      const porId = situacoes.porId.get(id)
      if (porId) return porId
    }
    return situacoes.porNome.get(pac.trim().toLowerCase()) ?? null
  }, [situacoes, idFavorecidoPorPac])

  const inativoSelecionado = !!paciente && situacaoDe(paciente) === "Inativo"
  const totalAtivos = useMemo(
    () => candidatos.filter(p => situacaoDe(p) !== "Inativo").length,
    [candidatos, situacaoDe],
  )

  const livreSlots = useMemo(() => {
    // Vaga "Livre" gêmea de um horário já agendado do mesmo profissional (ver
    // construirProfissionaisOcupados em helpers.ts) — a TiTa mantém uma linha
    // por terapia ofertada, então preencher um horário não apaga as outras
    // linhas "Livre" do mesmo profissional nesse dia/hora.
    const profOcupado = construirProfissionaisOcupados(cRows)
    return cRows.filter(r =>
      r["Status do Agendamento"] === "Livre"
      && !profissionalEstaOcupado(profOcupado, r["Profissional"], r["Dia da Semana"], String(r.HI_str || "")),
    )
  }, [cRows])

  function handleGerar() {
    if (!paciente || unidades.length === 0) return
    // Trava de negócio, não só de interface: cadastro inativo não recebe agenda
    // nova, mesmo que o laudo dele siga autorizado no relatório.
    if (inativoSelecionado) {
      toast.error("❌ Este paciente está inativo na clínica. Reative o cadastro na TiTa antes de montar o cronograma.")
      return
    }
    const r = buildSugestoesManual(paciente, unidades, turno, lRows, livreSlots, suspensaoSet)
    setResult(r)
    // Limpa seleção anterior.
    setSelectedIds(new Set())
    setProfSelIdx({})
    setEspSelIdx({})
    setVerApenasSelecionados(false)
  }

  // ── Dados ativos por sugestão (respeitando prof/esp selecionada) ──────────

  /** Retorna os dados ativos (tP, esp, prof, unidade, csvGradeId) de uma sugestão,
   * respeitando a seleção de profissional e terapia alternativa do usuário. */
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

  // ── Sessões no formato do workspace ───────────────────────────────────────

  const sessoesWorkspace = useMemo<WorkspaceSessao[]>(() => {
    if (!result) return []
    return result.sugestoes.map(s => {
      const ad = getActiveData(s)
      const tE = TERAPIA_TO_ESP[ad.tP] && TERAPIA_TO_ESP[ad.tP] !== ad.tP ? TERAPIA_TO_ESP[ad.tP] : undefined
      return {
        sugestaoId: s.id,
        dia: s.dia,
        hora: s.hora,
        unidade: ad.unidade,
        tP: ad.tP,
        prof: ad.prof,
        esp: ad.esp,
        tE,
        origTp: s.tP,
        origProf: s.prof,
        isVComp: false,
        tipo: "proposta",
      } as WorkspaceSessao
    })
  }, [result, getActiveData])

  // ── Contagem de selecionados por especialidade ────────────────────────────

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

  // ── espResumo refletindo a seleção atual ──────────────────────────────────

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

  // ── Controle de excesso ───────────────────────────────────────────────────

  const excessoEsps = useMemo<Set<string>>(() => {
    if (!result) return new Set()
    return new Set(
      espResumo.filter(g => g.of > g.aut).map(g => g.esp),
    )
  }, [result, espResumo])

  const hasExcesso = excessoEsps.size > 0

  // ── Controle de >3 profissionais por terapia (alerta, não bloqueia) ───────

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
  // Dentro do mesmo dia, todas as sessões selecionadas devem ser da mesma unidade.
  // Ao selecionar o primeiro card de um dia, a unidade daquele dia fica travada.

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

  // ── Mapas de alternativas para o workspace ────────────────────────────────

  const profAltsMap = useMemo<Record<string, import("@/lib/cronograma/novoCronograma").ProfAlt[]>>(() => {
    if (!result) return {}
    const m: Record<string, import("@/lib/cronograma/novoCronograma").ProfAlt[]> = {}
    for (const s of result.sugestoes) {
      const ei = espSelIdx[s.id] || 0
      if (ei > 0 && s.espAlts[ei - 1]) {
        m[s.id] = s.espAlts[ei - 1].profAlts
      } else {
        m[s.id] = s.profAlts
      }
    }
    return m
  }, [result, espSelIdx])

  const espAltsMap = useMemo<Record<string, import("@/lib/cronograma/novoCronograma").EspAltManual[]>>(() => {
    if (!result) return {}
    const m: Record<string, import("@/lib/cronograma/novoCronograma").EspAltManual[]> = {}
    for (const s of result.sugestoes) m[s.id] = s.espAlts
    return m
  }, [result])

  // ── Callbacks de seleção/alternativa ──────────────────────────────────────

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
    // Reset profissional ao trocar terapia.
    setProfSelIdx(prev => ({ ...prev, [id]: 0 }))
  }, [])

  const handleSelectAll = useCallback(() => {
    if (!result) return
    // Seleciona tudo respeitando a restrição de unidade por dia: para cada dia,
    // a primeira sugestão na ordem define a unidade do dia inteiro.
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

  // ── Avisos do workspace ───────────────────────────────────────────────────

  const avisos = useMemo(() => (result ? result.alertas.map(a => a.msg) : []), [result])

  const canGerar = !!paciente && !inativoSelecionado && unidades.length > 0 && lRows.length > 0 && cRows.length > 0

  // ── Implantação ───────────────────────────────────────────────────────────

  function abrirConfirmacao() {
    if (!result || totalSelecionado === 0) return

    const sessoes: AceiteSessao[] = []
    const semGradeId: string[] = []
    for (const s of result.sugestoes) {
      if (!selectedIds.has(s.id)) continue
      const d = getActiveData(s)
      if (!d.csvGradeId) semGradeId.push(`${s.dia} ${s.hora}`)
      sessoes.push({
        dia: s.dia, hora: s.hora, tP: d.tP, prof: d.prof,
        unidade: d.unidade,
        csvGradeId: d.csvGradeId ?? "",
        idFavorecidoFallback: idFavorecidoSel,
      })
    }
    if (semGradeId.length > 0) {
      toast.error(`❌ ${semGradeId.length} horário(s) ainda não sincronizado(s) para implantação. Gere uma nova sugestão e tente novamente.`)
      return
    }
    if (idFavorecidoSel == null) {
      toast.error("❌ O laudo deste paciente não traz o ID Favorecido — não é possível implantar na TiTa.")
      return
    }

    // Mesmo aviso de OcupPacMode: terapia com 3+ profissionais diferentes não
    // bloqueia, só alerta.
    const profsPorTerapia = new Map<string, Set<string>>()
    for (const s of sessoes) {
      if (!profsPorTerapia.has(s.tP)) profsPorTerapia.set(s.tP, new Set())
      profsPorTerapia.get(s.tP)!.add(s.prof)
    }
    const avisoMultiProf: AvisoMultiProf[] = [...profsPorTerapia.entries()]
      .filter(([, profs]) => profs.size >= 3)
      .map(([tP, profs]) => ({ tP, profs: [...profs] }))

    setPendingConfirm({ sessoes, avisoMultiProf })
  }

  async function confirmarImplantacao() {
    if (!pendingConfirm || confirmando) return
    const { sessoes } = pendingConfirm

    setConfirmando(true)
    try {
      const resp = await fetch("/api/tita/confirmar-agendamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Ver o comentário gêmeo em OcupPacMode: alimenta o card de inclusão que
        // avisa o cronograma.
        body: JSON.stringify({ pac: paciente, sessoes, modalidade: "novo" }),
      })
      const body = await resp.json().catch(() => null) as {
        ok: boolean
        error?: string
        mensagem?: string
        implantadoPor?: string
        implantadoPorEmail?: string | null
      } | null

      if (!resp.ok || !body?.ok) {
        const mensagem =
          body?.mensagem ??
          (body?.error === "not_authenticated" ? "Sua sessão expirou. Recarregue a página e entre novamente."
            : body?.error === "sessao_sem_csv_grade_id" ? "Um dos horários ainda não está sincronizado para implantação. Gere uma nova sugestão e tente novamente."
            : "Não foi possível concluir a integração com a TiTa. Tente novamente.")
        toast.error(`❌ ${mensagem}`)
        return
      }

      const bundle: AceitePacBundle = {
        id: `${Date.now()}_${paciente.slice(0, 8)}`,
        pac: paciente, ts: Date.now(),
        origem: "ocp-paciente",
        sessoes,
        status: "confirmado",
        inviavelSlots: [],
        implantadoPor: body?.implantadoPor,
        implantadoPorEmail: body?.implantadoPorEmail ?? undefined,
      }
      persistPacBundles([...pacBundles, bundle])
      setPendingConfirm(null)
      setResult(null)
      setPaciente("")
      setSelectedIds(new Set())
      setProfSelIdx({})
      setEspSelIdx({})
      toast(`✅ ${body?.mensagem ?? "Implantação realizada com sucesso."}`)
    } catch (err) {
      console.error("[ocupacao-paciente:novo] falha ao implantar na TiTa", err)
      toast.error("❌ Não foi possível concluir a implantação agora. Verifique a conexão e tente novamente.")
    } finally {
      setConfirmando(false)
    }
  }

  const faltando: string[] = []
  if (lRows.length === 0) faltando.push("Laudos")
  if (cRows.length === 0) faltando.push("Grade")

  // ── Sessões filtradas: no workspace só aparecem as do paciente selecionado,
  // e opcionalmente só as marcadas (toggle "Ver apenas selecionados") ────────
  const sessoesParaWorkspace = useMemo(
    () => verApenasSelecionados
      ? sessoesWorkspace.filter(s => s.sugestaoId && selectedIds.has(s.sugestaoId))
      : sessoesWorkspace,
    [sessoesWorkspace, verApenasSelecionados, selectedIds],
  )

  // Motivo de bloqueio do botão de implantação — feedback para o operador.
  const motivoBloqueio = hasExcesso
    ? `Reduza a seleção: ${[...excessoEsps].join(", ")} ${excessoEsps.size === 1 ? "está" : "estão"} acima do autorizado.`
    : null

  return (
    <>
      <WorkbenchBar colunas="31fr 14fr 17fr 23fr 15fr">
        <WorkbenchArea label="Paciente">
          <SearchCombobox
            value={paciente}
            onChange={v => { setPaciente(v); setResult(null); setSelectedIds(new Set()); setProfSelIdx({}); setEspSelIdx({}) }}
            opcoes={candidatos}
            placeholder="Buscar paciente..."
            ariaLabel="Buscar paciente"
            variante="ocupacao"
            disabled={candidatos.length === 0}
            sufixoOpcao={pac => situacaoDe(pac) === "Inativo"
              ? <span style={{ ...badgeTriad("erro"), flexShrink: 0, borderRadius: "4px", padding: "0 5px", fontSize: "9px", fontWeight: 800, lineHeight: "1.6" }}>Inativo</span>
              : null}
          />
          {inativoSelecionado && (
            <div style={{ ...badgeTriad("erro"), borderRadius: "8px", padding: "6px 8px", fontSize: "10px", fontWeight: 700, lineHeight: 1.35 }}>
              ⚠ Cadastro inativo na clínica — reative na TiTa para montar o cronograma.
            </div>
          )}
          {situacoes.estado === "erro" && (
            <div style={{ fontSize: "10px", color: "#d97706", fontWeight: 700, lineHeight: 1.35 }}>
              ⚠ Não foi possível verificar quem está ativo agora. Confira a situação do cadastro na TiTa antes de implantar.
            </div>
          )}
          {faltando.length > 0 && (
            <div style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
              Carregue <strong style={{ color: "var(--card-foreground)" }}>{faltando.join(" e ")}</strong> nos badges do topo.
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
          <WorkbenchKpi
            rotulo="Pacientes elegíveis"
            valor={situacoes.estado === "ok" ? totalAtivos : candidatos.length}
            legenda={situacoes.estado === "ok" ? "Ativos, sem sessão agendada" : "Sem sessão agendada"}
          />
          <button
            type="button"
            onClick={handleGerar}
            disabled={!canGerar}
            style={{
              padding: "8px 14px", borderRadius: "9px", fontSize: "12px",
              fontFamily: "inherit", ...ctaPrimariaStyle(!canGerar),
            }}
          >
            Gerar cronograma
          </button>
        </WorkbenchArea>
      </WorkbenchBar>

      {!result && (
        <WorkspaceEmptyState
          emoji="🗓"
          titulo="Selecione um paciente"
          subtitulo="Apenas pacientes com laudo autorizado e nenhuma sessão agendada aparecem na lista."
        />
      )}

      {result && (
        <>
          <CronogramaWorkspace
            sessoes={sessoesParaWorkspace}
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
            actionBar={totalSelecionado > 0 ? (
              <WorkspaceActionBar
                titulo={`${totalSelecionado} ${totalSelecionado === 1 ? "sessão selecionada" : "sessões selecionadas"}`}
                subtitulo={motivoBloqueio ?? "Revise a seleção antes de confirmar."}
              >
                <button
                  type="button"
                  onClick={abrirConfirmacao}
                  disabled={hasExcesso}
                  style={{
                    padding: "8px 16px", borderRadius: "9px", fontSize: "12px",
                    fontFamily: "inherit", ...ctaPrimariaStyle(hasExcesso),
                  }}
                >
                  Confirmar implantação ({totalSelecionado})
                </button>
              </WorkspaceActionBar>
            ) : undefined}
          />
        </>
      )}

      {pendingConfirm && (
        <ConfirmarImplantacaoModal
          pac={paciente}
          sessoesAtuais={0}
          sessoes={pendingConfirm.sessoes}
          avisoMultiProf={pendingConfirm.avisoMultiProf}
          confirming={confirmando}
          onConfirm={confirmarImplantacao}
          onCancel={() => { if (!confirmando) setPendingConfirm(null) }}
        />
      )}
    </>
  )
}
