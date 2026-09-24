"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { SK, SK_SAIDA, SK_PREENCHER, DEFAULT_MCAP, buildSaidaKey, splitSaidaKey } from "@/lib/cronograma/constants"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { CsvRow, LaudoRow, DispRow, WaMap, RecItem, InvItem, CfgState, StatusMap, StatusEntry } from "@/types/cronograma"
import type { AceitePacBundle, ConfItem } from "@/types/acompanhamento"

const DEFAULT_CFG: CfgState = {
  terapiasPrio: [],
  profsPrioExtras: [],
  musicoCap: DEFAULT_MCAP,
  judicialMap: {},
  isolarAssim: false,
  apiToken: "",
}

type SavePayload = { rec: RecItem[]; inv: InvItem[]; waMap: WaMap; cfg: CfgState }

function saveLocal(data: SavePayload): { savedAt: string; savedAtIso: string; localErr: string | null } {
  const savedAt = new Date().toLocaleTimeString("pt-BR")
  const savedAtIso = new Date().toISOString()
  let localErr: string | null = null
  try {
    localStorage.setItem(SK, JSON.stringify({ ...data, savedAt, savedAtIso }))
  } catch {
    localErr = "localStorage cheio — dado não salvo localmente"
  }
  return { savedAt, savedAtIso, localErr }
}

async function saveRemote(data: SavePayload): Promise<string | null> {
  try {
    const sb = getSupabaseClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return null
    const { error } = await sb
      .from("cronograma_estado")
      .upsert(
        { user_id: user.id, dados: data, atualizado_em: new Date().toISOString() },
        { onConflict: "user_id" },
      )
    return error ? `Falha ao sincronizar: ${error.message}` : null
  } catch (e) {
    return `Falha ao sincronizar: ${(e as Error).message}`
  }
}

// Tabela remota ausente — para de tentar sincronizar após o primeiro erro de schema
let remoteTableMissing = false
let saidaTableMissing = false
let acompTableMissing = false

// ─── Saída de Profissional (statusMap → tabela compartilhada saida_aceites) ────
type SaidaRow = { paciente: string; dia: string; hora: string; terapia: string; dados: StatusEntry }

function statusMapFromRows(rows: SaidaRow[]): StatusMap {
  const m: StatusMap = {}
  for (const r of rows) {
    m[`${r.paciente}|||${r.dia}|||${r.hora}|||${r.terapia}`] = (r.dados ?? {}) as StatusEntry
  }
  return m
}

function isSaidaTableError(msg: string): boolean {
  return msg.includes("saida_aceites") || msg.includes("schema cache")
}

function isAcompTableError(msg: string): boolean {
  return msg.includes("acomp_") || msg.includes("schema cache")
}

const SAIDA_OFFLINE_MSG =
  "Sincronização remota desativada: tabela saida_aceites não existe no banco. Dados salvos localmente. Execute a migration SQL para reativar."

const ACOMP_OFFLINE_MSG =
  "Sincronização remota desativada: tabelas acomp_* não existem. Execute a migration 20260630000000_acomp_tables.sql para reativar."

function triggerSave(
  data: SavePayload,
  hasSavedRef: React.MutableRefObject<boolean>,
  setSavedAt: (v: string) => void,
  setSaveError: (v: string | null) => void,
) {
  hasSavedRef.current = true
  const { savedAt, localErr } = saveLocal(data)
  setSavedAt(savedAt)
  if (localErr) setSaveError(localErr)
  if (remoteTableMissing) return
  saveRemote(data).then(remoteErr => {
    if (remoteErr) {
      if (remoteErr.includes("cronograma_estado") || remoteErr.includes("schema cache")) {
        remoteTableMissing = true
        setSaveError("Sincronização remota desativada: tabela cronograma_estado não existe no banco. Dados salvos localmente. Execute a migration SQL para reativar.")
      } else {
        setSaveError(remoteErr)
      }
    } else if (!localErr) {
      setSaveError(null)
    }
  })
}

// ─── Chaves localStorage legadas (apenas para migração) ───────────────────────
const SK_PROF_LEGACY     = "aba_ocup_prof_status_v1"
const SK_BUNDLES_LEGACY  = "aba_ocup_pac_aceites_v1"
const SK_CONF_LEGACY     = "aba_confirmados_v1"

// ─── Helper: id simples para ConfItem ─────────────────────────────────────────
export function genConfId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export interface CronogramaDataContextValue {
  cRows: CsvRow[]
  lRows: LaudoRow[]
  dispRows: DispRow[]
  rec: RecItem[]
  inv: InvItem[]
  waMap: WaMap
  cfg: CfgState
  /** Aceites da Saída de Profissional — compartilhado entre a equipe via tabela saida_aceites */
  statusMap: StatusMap
  /** statusMap de acompanhamento por profissional — compartilhado via acomp_prof_map */
  profMap: Record<string, string>
  /** Bundles de aceite do OcupPacMode — compartilhado via acomp_pac_bundles */
  pacBundles: AceitePacBundle[]
  /** Sessões confirmadas — compartilhado via acomp_conf */
  conf: ConfItem[]
  savedAt: string | null
  saveError: string | null
  clearSaveError: () => void
  setCRows: (rows: CsvRow[]) => void
  setLRows: (rows: LaudoRow[]) => void
  setDispRows: (rows: DispRow[]) => void
  /** Mescla o XLSX importado ao estado existente (dedup). Retorna mensagem de resultado. */
  onImport: (data: { rec: RecItem[]; inv: InvItem[]; waMap: WaMap }) => string
  sRec: (rec: RecItem[]) => void
  sInv: (inv: InvItem[]) => void
  sWa: (waMap: WaMap) => void
  sCfg: (cfg: CfgState) => void
  /** Grava os aceites da Saída (diff por linha contra saida_aceites). */
  persistStatus: (map: StatusMap) => void
  /** Grava o statusMap de acompanhamento por profissional (diff contra acomp_prof_map). */
  persistProfMap: (map: Record<string, string>) => void
  /** Grava os bundles de aceite do OcupPacMode (upsert + delete contra acomp_pac_bundles). */
  /** Aceita array ou função de atualização; a forma de função parte sempre do estado
   *  mais recente e é a correta para ações em sequência (ver a implementação). */
  persistPacBundles: (bundles: AceitePacBundle[] | ((prev: AceitePacBundle[]) => AceitePacBundle[])) => void
  /** Grava sessões confirmadas (somente insere novas, nunca deleta). */
  persistConf: (items: ConfItem[]) => void
}

const CronogramaDataContext = createContext<CronogramaDataContextValue | null>(null)

export function CronogramaDataProvider({ children }: { children: React.ReactNode }) {
  const [cRows, setCRows] = useState<CsvRow[]>([])
  const [lRows, setLRows] = useState<LaudoRow[]>([])
  const [dispRows, setDispRows] = useState<DispRow[]>([])
  const [rec, setRec] = useState<RecItem[]>([])
  const [inv, setInv] = useState<InvItem[]>([])
  const [waMap, setWaMap] = useState<WaMap>({})
  const [cfg, setCfgState] = useState<CfgState>(DEFAULT_CFG)
  const [statusMap, setStatusMap] = useState<StatusMap>({})
  const [profMap, setProfMap] = useState<Record<string, string>>({})
  const [pacBundles, setPacBundles] = useState<AceitePacBundle[]>([])
  const [conf, setConf] = useState<ConfItem[]>([])

  const statusMapRef = useRef<StatusMap>({})
  statusMapRef.current = statusMap
  const profMapRef = useRef<Record<string, string>>({})
  profMapRef.current = profMap
  const confRef = useRef<ConfItem[]>([])
  confRef.current = conf
  const pacBundlesRef = useRef<AceitePacBundle[]>([])
  pacBundlesRef.current = pacBundles

  const hasRealtimeFiredRef = useRef(false)
  // Evita que o load inicial de profMap/pacBundles/conf (fase 4, async) sobrescreva
  // com um snapshot antigo do banco um aceite que o usuário já fez em memória
  // enquanto esse fetch ainda estava em voo (ex.: aceitar uma sugestão em
  // OcupPacMode antes do loadAcomp() terminar apagava o aceite ao resolver).
  const hasAcompActedRef = useRef(false)
  const pendingWriteKeys = useRef(new Set<string>())
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const hasSavedRef = useRef(false)

  const clearSaveError = useCallback(() => setSaveError(null), [])

  // Fase 1: carrega localStorage imediatamente (síncrono, sem latência)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SK)
      let waInicial: WaMap = {}
      if (raw) {
        const p = JSON.parse(raw)
        if (p.rec?.length) setRec(p.rec)
        if (p.inv?.length) setInv(p.inv)
        if (p.waMap && Object.keys(p.waMap).length) waInicial = p.waMap
        if (p.cfg) setCfgState(prev => ({ ...prev, ...p.cfg }))
        if (p.savedAt) setSavedAt(p.savedAt)
      }
      // SK_PREENCHER era um blob legado que NUNCA foi escrito por este código — só
      // lido, e mesclado no waMap a cada carregamento. Efeito: cancelar um item de
      // "Aguardando" (Ocupação Clínica) funcionava na tela, mas o item voltava no
      // próximo refresh, porque a chave sobrevivia nesse blob e era remesclada aqui.
      // Não há o que migrar (o formato é o mesmo do waMap salvo em SK), então a
      // limpeza é remover a chave de vez — senão o resquício continua ressuscitando
      // para quem já o tem no navegador.
      try { localStorage.removeItem(SK_PREENCHER) } catch {}
      if (Object.keys(waInicial).length) setWaMap(waInicial)
    } catch {}

    // Migração local: lê legado de localStorage para exibição imediata enquanto Supabase carrega
    try {
      const rawProf = localStorage.getItem(SK_PROF_LEGACY)
      if (rawProf) { const p = JSON.parse(rawProf); if (p && typeof p === "object") setProfMap(p) }
    } catch {}
    try {
      const rawBundles = localStorage.getItem(SK_BUNDLES_LEGACY)
      if (rawBundles) { const b = JSON.parse(rawBundles); if (Array.isArray(b)) setPacBundles(b) }
    } catch {}
    try {
      const rawConf = localStorage.getItem(SK_CONF_LEGACY)
      if (rawConf) { const c = JSON.parse(rawConf); if (Array.isArray(c)) setConf(c) }
    } catch {}
  }, [])

  // Fase 2: carrega do Supabase (async, sobrescreve local se remoto for mais recente)
  useEffect(() => {
    async function loadRemote() {
      try {
        const sb = getSupabaseClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return

        const { data, error } = await sb
          .from("cronograma_estado")
          .select("dados, atualizado_em")
          .eq("user_id", user.id)
          .single()
        if (error || !data?.dados) return

        if (hasSavedRef.current) return

        const raw = localStorage.getItem(SK)
        const localIso: string | null = raw
          ? ((JSON.parse(raw) as { savedAtIso?: string }).savedAtIso ?? null)
          : null
        const remoteMs = new Date(data.atualizado_em as string).getTime()
        const localMs = localIso ? new Date(localIso).getTime() : 0
        if (remoteMs <= localMs) return

        const p = data.dados as Partial<SavePayload> & { savedAt?: string }
        if (p.rec?.length) setRec(p.rec)
        if (p.inv?.length) setInv(p.inv)
        if (p.waMap && Object.keys(p.waMap).length) setWaMap(p.waMap)
        if (p.cfg) setCfgState(prev => ({ ...prev, ...p.cfg }))
        if (p.savedAt) setSavedAt(p.savedAt)
      } catch {}
    }
    loadRemote()
  }, [])

  // Fase 3: carrega saida_aceites + migra legado do localStorage
  useEffect(() => {
    async function loadSaida() {
      let legacy: StatusMap = {}
      try { legacy = JSON.parse(localStorage.getItem(SK_SAIDA) || "{}") } catch {}

      try {
        const sb = getSupabaseClient()
        const { data: { user } } = await sb.auth.getUser()
        const { data, error } = await sb
          .from("saida_aceites")
          .select("paciente,dia,hora,terapia,dados")
        if (error) {
          if (isSaidaTableError(error.message)) saidaTableMissing = true
          if (Object.keys(legacy).length) setStatusMap(legacy)
          return
        }

        const remote = statusMapFromRows((data ?? []) as SaidaRow[])

        const faltantes = Object.keys(legacy).filter(k => !(k in remote))
        if (faltantes.length && user) {
          const nowIso = new Date().toISOString()
          const rows = faltantes.flatMap(k => {
            const parts = splitSaidaKey(k)
            if (!parts) return []
            const entry = legacy[k]
            return [{ ...parts, status: entry.status, dados: entry, criado_por: user.id, atualizado_por: user.id, atualizado_em: nowIso }]
          })
          if (rows.length) {
            const { error: upErr } = await sb.from("saida_aceites").upsert(rows, { onConflict: "paciente,dia,hora,terapia" })
            if (!upErr) for (const k of faltantes) remote[k] = legacy[k]
          }
        }

        if (!hasRealtimeFiredRef.current) {
          setStatusMap(remote)
          try { localStorage.setItem(SK_SAIDA, JSON.stringify(remote)) } catch {}
        }
      } catch {
        if (Object.keys(legacy).length) setStatusMap(legacy)
      }
    }
    loadSaida()
  }, [])

  // Fase 4: carrega dados de acompanhamento (profMap, pacBundles, conf) do Supabase
  // Lê localStorage diretamente (não via estado React) para garantir dados corretos no async
  useEffect(() => {
    async function loadAcomp() {
      if (acompTableMissing) return

      // Leitura síncrona do localStorage antes de qualquer await
      let legacyProf: Record<string, string> = {}
      let legacyConf: ConfItem[] = []
      try { legacyProf    = JSON.parse(localStorage.getItem(SK_PROF_LEGACY)    || "{}") } catch {}
      try { legacyConf    = JSON.parse(localStorage.getItem(SK_CONF_LEGACY)    || "[]") } catch {}

      try {
        const sb = getSupabaseClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return

        const [rProf, rBundles, rConf] = await Promise.all([
          sb.from("acomp_prof_map").select("id,status"),
          sb.from("acomp_pac_bundles").select("id,dados,pac,status"),
          sb.from("acomp_conf").select("id,dados"),
        ])

        // profMap
        if (rProf.error) {
          if (isAcompTableError(rProf.error.message)) { acompTableMissing = true; return }
        } else {
          const remoteProf: Record<string, string> = {}
          for (const row of (rProf.data ?? [])) remoteProf[row.id] = row.status
          const novasProf = Object.keys(legacyProf).filter(k => !(k in remoteProf))
          if (novasProf.length) {
            const nowIso = new Date().toISOString()
            const rows = novasProf.map(k => ({ id: k, status: legacyProf[k], atualizado_por: user.id, atualizado_em: nowIso }))
            await sb.from("acomp_prof_map").upsert(rows, { onConflict: "id" })
            for (const k of novasProf) remoteProf[k] = legacyProf[k]
          }
          if (!hasAcompActedRef.current) setProfMap(remoteProf)
        }

        // pacBundles
        if (rBundles.error) {
          if (isAcompTableError(rBundles.error.message)) { acompTableMissing = true; return }
        } else {
          // O banco é a fonte de verdade. Bundles que só existem no localStorage NÃO
          // são regravados: esse caminho era a migração de 30/06, e depois dela só
          // servia para ressuscitar o que outro usuário tinha cancelado/removido.
          const remoteBundles: AceitePacBundle[] = (rBundles.data ?? []).map(r => r.dados as AceitePacBundle)
          if (!hasAcompActedRef.current) setPacBundles(remoteBundles)
        }

        // conf
        if (rConf.error) {
          if (isAcompTableError(rConf.error.message)) { acompTableMissing = true; return }
        } else {
          const remoteConf: ConfItem[] = (rConf.data ?? []).map(r => ({ id: r.id, ...(r.dados as object) } as ConfItem))
          const remoteConfIds = new Set(remoteConf.map(c => c.id))
          const novasConf = legacyConf.filter(c => (c as { id?: string }).id && !remoteConfIds.has((c as { id: string }).id))
          if (novasConf.length) {
            const nowIso = new Date().toISOString()
            const rows = novasConf.map(c => ({ id: (c as { id: string }).id, dados: c, atualizado_por: user.id, atualizado_em: nowIso }))
            await sb.from("acomp_conf").upsert(rows, { onConflict: "id" })
            remoteConf.push(...novasConf)
          }
          if (!hasAcompActedRef.current) setConf(remoteConf)
        }
      } catch (e) {
        const msg = (e as Error).message || ""
        if (isAcompTableError(msg)) { acompTableMissing = true; setSaveError(ACOMP_OFFLINE_MSG) }
      }
    }
    loadAcomp()
  }, [])

  // Saída: realtime — recarrega (debounced) quando outro usuário grava
  useEffect(() => {
    const sb = getSupabaseClient()
    let t: ReturnType<typeof setTimeout> | null = null
    const channel = sb
      .channel("saida_aceites_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "saida_aceites" }, () => {
        if (t) clearTimeout(t)
        t = setTimeout(async () => {
          try {
            const { data, error } = await sb
              .from("saida_aceites")
              .select("paciente,dia,hora,terapia,dados")
            if (error) return
            const m = statusMapFromRows((data ?? []) as SaidaRow[])
            hasRealtimeFiredRef.current = true
            setStatusMap(prev => {
              const next: StatusMap = {}
              for (const [k, v] of Object.entries(m)) {
                next[k] = pendingWriteKeys.current.has(k) ? (prev[k] ?? v) : v
              }
              for (const k of pendingWriteKeys.current) {
                if (!(k in next) && k in prev) next[k] = prev[k]
              }
              return next
            })
            try { localStorage.setItem(SK_SAIDA, JSON.stringify(m)) } catch {}
          } catch {}
        }, 400)
      })
      .subscribe()
    return () => {
      if (t) clearTimeout(t)
      sb.removeChannel(channel)
    }
  }, [])

  const sRec = useCallback((newRec: RecItem[]) => {
    setRec(newRec)
    triggerSave({ rec: newRec, inv, waMap, cfg }, hasSavedRef, setSavedAt, setSaveError)
  }, [inv, waMap, cfg])

  const sInv = useCallback((newInv: InvItem[]) => {
    setInv(newInv)
    triggerSave({ rec, inv: newInv, waMap, cfg }, hasSavedRef, setSavedAt, setSaveError)
  }, [rec, waMap, cfg])

  const sWa = useCallback((newWaMap: WaMap) => {
    setWaMap(newWaMap)
    triggerSave({ rec, inv, waMap: newWaMap, cfg }, hasSavedRef, setSavedAt, setSaveError)
  }, [rec, inv, cfg])

  const sCfg = useCallback((newCfg: CfgState) => {
    setCfgState(newCfg)
    triggerSave({ rec, inv, waMap, cfg: newCfg }, hasSavedRef, setSavedAt, setSaveError)
  }, [rec, inv, waMap])

  // Grava aceites da Saída por diff de linhas
  const persistStatus = useCallback((next: StatusMap) => {
    const prev = statusMapRef.current
    setStatusMap(next)
    try { localStorage.setItem(SK_SAIDA, JSON.stringify(next)) } catch {}

    if (saidaTableMissing) { setSaveError(SAIDA_OFFLINE_MSG); return }

    const upserts = Object.keys(next).filter(k => !(k in prev) || JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
    const deletes = Object.keys(prev).filter(k => !(k in next))
    if (!upserts.length && !deletes.length) return

    for (const k of upserts) pendingWriteKeys.current.add(k)

    ;(async () => {
      try {
        const sb = getSupabaseClient()
        const { data: { user } } = await sb.auth.getUser()
        const nowIso = new Date().toISOString()

        if (upserts.length) {
          const rows = upserts.flatMap(k => {
            const parts = splitSaidaKey(k)
            if (!parts) return []
            const entry = next[k]
            return [{ ...parts, status: entry.status, dados: entry, atualizado_por: user?.id ?? null, atualizado_em: nowIso }]
          })
          const { error } = await sb.from("saida_aceites").upsert(rows, { onConflict: "paciente,dia,hora,terapia" })
          if (error) throw error
        }

        if (deletes.length) {
          const results = await Promise.all(
            deletes.map(k => {
              const parts = splitSaidaKey(k)
              if (!parts) return Promise.resolve({ error: null })
              return sb.from("saida_aceites").delete().match(parts)
            })
          )
          const firstError = results.find(r => r.error)?.error
          if (firstError) throw firstError
        }

        saidaTableMissing = false
        setSaveError(null)
      } catch (e) {
        const msg = (e as Error).message || ""
        if (isSaidaTableError(msg)) { saidaTableMissing = true; setSaveError(SAIDA_OFFLINE_MSG) }
        else setSaveError(`Falha ao sincronizar saída: ${msg}`)
      } finally {
        for (const k of upserts) pendingWriteKeys.current.delete(k)
        for (const k of deletes) pendingWriteKeys.current.delete(k)
      }
    })()
  }, [])

  // Grava statusMap de acompanhamento por profissional, por diff de linhas
  const persistProfMap = useCallback((next: Record<string, string>) => {
    hasAcompActedRef.current = true
    const prev = profMapRef.current
    setProfMap(next)
    try { localStorage.setItem(SK_PROF_LEGACY, JSON.stringify(next)) } catch {}

    if (acompTableMissing) return

    const upserts = Object.keys(next).filter(k => !(k in prev) || prev[k] !== next[k])
    const deletes = Object.keys(prev).filter(k => !(k in next))
    if (!upserts.length && !deletes.length) return

    ;(async () => {
      try {
        const sb = getSupabaseClient()
        const { data: { user } } = await sb.auth.getUser()
        const nowIso = new Date().toISOString()

        if (upserts.length) {
          const rows = upserts.map(k => ({ id: k, status: next[k], atualizado_por: user?.id ?? null, atualizado_em: nowIso }))
          const { error } = await sb.from("acomp_prof_map").upsert(rows, { onConflict: "id" })
          if (error) throw error
        }
        if (deletes.length) {
          // Mesma correção de acomp_pac_bundles: erro de exclusão não pode passar batido.
          const resultados = await Promise.all(deletes.map(k => sb.from("acomp_prof_map").delete().eq("id", k)))
          const erroDelete = resultados.find(r => r.error)?.error
          if (erroDelete) throw erroDelete
        }
      } catch (e) {
        const msg = (e as Error).message || ""
        if (isAcompTableError(msg)) { acompTableMissing = true; setSaveError(ACOMP_OFFLINE_MSG) }
        else setSaveError(`Falha ao sincronizar profMap: ${msg}`)
      }
    })()
  }, [])

  // Grava bundles de aceite do OcupPacMode (upsert dos alterados, delete dos removidos)
  // Aceita array OU função de atualização. A forma de função é a correta para
  // ações em sequência (ex.: cancelar vários itens de "Aguardando" em cliques
  // seguidos): o handler da tela fecha sobre o `pacBundles` do render, então dois
  // cliques antes do re-render partiam do MESMO array e o segundo ressuscitava o
  // que o primeiro tinha removido — o item sumia da tela e voltava no refresh.
  // Resolvendo pelo ref, cada chamada parte sempre do estado mais recente.
  const persistPacBundles = useCallback((entrada: AceitePacBundle[] | ((prev: AceitePacBundle[]) => AceitePacBundle[])) => {
    hasAcompActedRef.current = true
    // Capturado ANTES do setState — é o estado que estava persistido, base do diff.
    const prev = pacBundlesRef.current
    const next = typeof entrada === "function" ? entrada(prev) : entrada
    pacBundlesRef.current = next
    setPacBundles(next)
    try { localStorage.setItem(SK_BUNDLES_LEGACY, JSON.stringify(next)) } catch {}

    if (acompTableMissing) return

    ;(async () => {
      try {
        const sb = getSupabaseClient()
        const { data: { user } } = await sb.auth.getUser()
        const nowIso = new Date().toISOString()

        const nextIds = new Set(next.map(b => b.id))

        // Só faz upsert dos bundles NOVOS ou de fato ALTERADOS (identidade de
        // referência: os fluxos atualizam de forma imutável, reusando objetos
        // inalterados). Sem isso, cada persist reescrevia atualizado_por/atualizado_em
        // de TODAS as linhas, transformando atualizado_por num carimbo coletivo do
        // último a sincronizar — inútil para auditoria (a autoria real vive em
        // dados->>'implantadoPor').
        const prevById = new Map(prev.map(b => [b.id, b]))
        const toUpsert = next.filter(b => prevById.get(b.id) !== b)
        // Só apaga o que ESTA ação tirou da lista. Comparar com a tabela inteira
        // fazia um navegador desatualizado apagar tudo que ele não conhecia —
        // inclusive o que um colega tinha acabado de implantar.
        const toDelete = prev.map(b => b.id).filter(id => !nextIds.has(id))

        if (toUpsert.length) {
          const rows = toUpsert.map(b => ({ id: b.id, dados: b, pac: b.pac, status: b.status, atualizado_por: user?.id ?? null, atualizado_em: nowIso }))
          const { error } = await sb.from("acomp_pac_bundles").upsert(rows, { onConflict: "id" })
          if (error) throw error
        }
        if (toDelete.length) {
          // Erro verificado: sem isso a exclusão falhava em SILÊNCIO — o item sumia
          // da tela, continuava no banco, e voltava no próximo carregamento.
          const { error } = await sb.from("acomp_pac_bundles").delete().in("id", toDelete)
          if (error) throw error
        }
      } catch (e) {
        const msg = (e as Error).message || ""
        if (isAcompTableError(msg)) { acompTableMissing = true; setSaveError(ACOMP_OFFLINE_MSG) }
        else setSaveError(`Falha ao sincronizar bundles: ${msg}`)
      }
    })()
  }, [])

  // Grava itens confirmados — upsert de tudo (reflete updates, ex.: reservaPendente
  // virando implantada) e apaga da tabela os que saíram da lista (ex.: bundle
  // cancelado/recusado desfazendo uma Reserva Pendente) — mesma estratégia de
  // persistPacBundles, para não deixar linhas órfãs que ressuscitam no próximo load.
  const persistConf = useCallback((next: ConfItem[]) => {
    hasAcompActedRef.current = true
    const prev = confRef.current
    setConf(next)
    try { localStorage.setItem(SK_CONF_LEGACY, JSON.stringify(next)) } catch {}

    if (acompTableMissing) return

    const prevIds = new Set(prev.map(c => c.id))
    const nextIds = new Set(next.map(c => c.id))
    const toUpsert = next.filter(c => c.id)
    const toDelete = [...prevIds].filter(id => !nextIds.has(id))
    if (!toUpsert.length && !toDelete.length) return

    ;(async () => {
      try {
        const sb = getSupabaseClient()
        const { data: { user } } = await sb.auth.getUser()
        const nowIso = new Date().toISOString()

        if (toUpsert.length) {
          const rows = toUpsert.map(c => ({ id: c.id, dados: c, atualizado_por: user?.id ?? null, atualizado_em: nowIso }))
          const { error } = await sb.from("acomp_conf").upsert(rows, { onConflict: "id" })
          if (error) throw error
        }
        if (toDelete.length) {
          const { error } = await sb.from("acomp_conf").delete().in("id", toDelete)
          if (error) throw error
        }
      } catch (e) {
        const msg = (e as Error).message || ""
        if (isAcompTableError(msg)) { acompTableMissing = true; setSaveError(ACOMP_OFFLINE_MSG) }
        else setSaveError(`Falha ao sincronizar conf: ${msg}`)
      }
    })()
  }, [])

  const onImport = useCallback((data: { rec: RecItem[]; inv: InvItem[]; waMap: WaMap }): string => {
    const rM = [...rec]
    for (const r of data.rec) {
      if (!rM.some(x => x.paciente === r.paciente && x.profissional === r.profissional && x.dia === r.dia && x.hora === r.hora))
        rM.push(r)
    }
    const iM = [...inv]
    for (const i of data.inv) {
      if (!iM.some(x => x.paciente === i.paciente)) iM.push(i)
    }
    const wM = { ...waMap, ...data.waMap }
    setRec(rM)
    setInv(iM)
    setWaMap(wM)
    triggerSave({ rec: rM, inv: iM, waMap: wM, cfg }, hasSavedRef, setSavedAt, setSaveError)
    return `✅ ${data.rec.length} recusados + ${data.inv.length} inviáveis + ${Object.keys(data.waMap).length} status WA importados.`
  }, [rec, inv, waMap, cfg])

  const value: CronogramaDataContextValue = {
    cRows, lRows, dispRows, rec, inv, waMap, cfg, statusMap,
    profMap, pacBundles, conf,
    savedAt, saveError, clearSaveError,
    setCRows, setLRows, setDispRows,
    onImport, sRec, sInv, sWa, sCfg,
    persistStatus, persistProfMap, persistPacBundles, persistConf,
  }

  return (
    <CronogramaDataContext.Provider value={value}>
      {children}
    </CronogramaDataContext.Provider>
  )
}

export function useCronogramaData(): CronogramaDataContextValue {
  const ctx = useContext(CronogramaDataContext)
  if (!ctx) throw new Error("useCronogramaData deve ser usado dentro de CronogramaDataProvider")
  return ctx
}
