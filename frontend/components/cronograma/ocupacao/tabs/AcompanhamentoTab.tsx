"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  Ban, BarChart3, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronUp,
  ClipboardList, Clock, DoorOpen, Inbox, Search, User, X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { B, SK_SAIDA, HORAS_GRID, DIAS_LIST, DIAS_ORD } from "@/lib/cronograma/constants"
import { waKey, fmtName, parseSlotReservado } from "@/lib/cronograma/helpers"
import { useCronogramaData, genConfId } from "@/contexts/CronogramaDataContext"
import { RecusadosTab } from "./RecusadosTab"
import { InviavelTab } from "./InviavelTab"
import type { AlgorithmResult, Sugestao, WaMap, WaStatus, StatusMap, CsvRow, OpcaoEstrategia, MovimentoSessao, AfetadaItem, SessPacItem, AnaliseResult, StatusEntry, OpcaoSwap, OpcaoDiaMigracao, RecItem, InvItem } from "@/types/cronograma"
import type { AceitePacBundle, AceiteSessao, ConfItem, SlotStatus } from "@/types/acompanhamento"
import { SaidaCronModal } from "@/components/cronograma/solicitacoes/SaidaCronModal"
import { ConfirmDialog } from "@/components/cronograma/ui/ConfirmDialog"
import { ListCard, EmptyState, GroupHeader, TimeBadge, SearchInput, rowStyle, rowClass } from "@/components/cronograma/ui/DataTable"
import { registrarRecusa, registrarReativacao } from "@/services/cronogramaRecusasAuditoria.service"
import { reativarRecusaPaciente } from "@/lib/cronograma/reativarRecusaPaciente"

const SLOT_META: Record<SlotStatus, { label: string; bg: string; c: string; bd: string }> = {
  confirmado: { label: "Confirmou",  bg: "#dcfce7", c: "#14532d", bd: "#86efac" },
  recusado:   { label: "Recusou",    bg: "#fee2e2", c: "#7f1d1d", bd: "#fca5a5" },
  inviavel:   { label: "Inviável",   bg: "var(--muted)", c: "var(--muted-foreground)", bd: "var(--border)" },
}

// CRON-008: itens derivados de uma Reserva Pendente (pacBundles) carregam esse
// prefixo no id — não existem como linha própria em `conf` (ver pacConfDerived).
// É o único jeito de distinguir a origem sem precisar de outra flag.
const RESERVA_PENDENTE_PREFIX = "pacres_"
function isReservaPendenteItem(c: ConfItem): boolean {
  return c.id.startsWith(RESERVA_PENDENTE_PREFIX)
}

interface Props {
  res: AlgorithmResult | null
  onWA: (s: Sugestao) => void
  onWAUndo: (s: Sugestao) => void
  onWAStatus: (s: Sugestao, st: WaStatus) => void
  onRec: (s: Sugestao) => void
  onInv: (s: Sugestao) => void
  onCron: (s: Sugestao) => void
}

type Sub = "aguardando" | "recusados" | "inviavel" | "confirmados"
type Origem = "ocupacao" | "ocp-prof" | "ocp-pac" | "saida"

const ORIGEM_ICON: Record<Origem, LucideIcon> = {
  ocupacao: ClipboardList, "ocp-prof": BarChart3, "ocp-pac": User, saida: DoorOpen,
}

const ORIGEM_COLOR: Record<Origem, string> = {
  ocupacao: B.blue, "ocp-prof": B.orange, "ocp-pac": "#4d7c0f", saida: B.purple,
}

// ConfItem.origem chega como texto livre (gravado nos handlers abaixo) — este
// mapa liga cada valor gravado ao mesmo ícone/cor usado nas seções de
// "Aguardando", para que a origem continue identificável nas outras sub-abas.
const CONF_ORIGEM_META: Record<string, { icon: LucideIcon; color: string }> = {
  "Ocp. Clínica":       { icon: ORIGEM_ICON.ocupacao, color: ORIGEM_COLOR.ocupacao },
  "Ocp. Profissional":  { icon: ORIGEM_ICON["ocp-prof"], color: ORIGEM_COLOR["ocp-prof"] },
  "Ocp. Paciente":      { icon: ORIGEM_ICON["ocp-pac"], color: ORIGEM_COLOR["ocp-pac"] },
  "Saída Profissional": { icon: ORIGEM_ICON.saida, color: ORIGEM_COLOR.saida },
}
const DEFAULT_ORIGEM_META = { icon: CheckCircle2, color: "#15803d" }

// ─── Primitivas visuais compartilhadas por esta aba ────────────────────────

function RailCard({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div style={{ position: "relative", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "12px 16px 12px 20px", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "3px", background: color }} />
      {children}
    </div>
  )
}

function OriginTag({ icon: Icon, label, color }: { icon: LucideIcon; label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", color, whiteSpace: "nowrap" }}>
      <Icon size={11} />
      {label}
    </span>
  )
}

type BtnKind = "confirm" | "reject" | "neutral" | "cancel"

// Mesma paleta de pílulas suaves usada nos botões de sessão do bloco Ocupação
// Paciente (ver slotBtn em PacBundleItem) — mantém a cor consistente em todas
// as origens da aba Aguardando.
const BTN_VARIANTS: Record<BtnKind, CSSProperties> = {
  confirm: { background: "#dcfce7", color: "#14532d", border: "1px solid #86efac", fontWeight: "var(--weight-bold)" },
  reject:  { background: "#fee2e2", color: "#7f1d1d", border: "1px solid #fca5a5", fontWeight: "var(--weight-bold)" },
  neutral: { background: "var(--muted)", color: "var(--muted-foreground)", border: "1px solid var(--border)", fontWeight: "var(--weight-medium)" },
  cancel:  { background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", fontWeight: "var(--weight-semibold)" },
}

function ActionBtn({ kind, onClick, children, title, style }: {
  kind: BtnKind; onClick: () => void; children: ReactNode; title?: string; style?: CSSProperties
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        fontSize: "var(--text-sm)", padding: "10px 14px", minHeight: "40px", borderRadius: "var(--radius-md)",
        cursor: "pointer", fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
        ...BTN_VARIANTS[kind], ...style,
      }}
    >
      {children}
    </button>
  )
}

function SectionToggle({ icon: Icon, label, color, count, open, onToggle, controls }: {
  icon: LucideIcon; label: string; color: string; count: number; open: boolean; onToggle: () => void; controls: string
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      style={{
        display: "flex", alignItems: "center", gap: "8px", width: "100%",
        padding: "6px 2px", background: "transparent", border: "none",
        cursor: "pointer", fontFamily: "inherit", textAlign: "left",
      }}
    >
      <Icon size={14} style={{ color, flexShrink: 0 }} />
      <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: "var(--foreground)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color, background: `${color}18`, borderRadius: "999px", padding: "1px 7px", flexShrink: 0 }}>
        {count}
      </span>
      <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
      {open ? <ChevronUp size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />}
    </button>
  )
}

export function AcompanhamentoTab({ res, onWA, onWAUndo, onWAStatus, onRec, onInv, onCron }: Props) {
  const {
    cRows, rec, inv, waMap, statusMap, sRec, sInv, sWa, persistStatus,
    profMap, pacBundles, conf, persistProfMap, persistPacBundles, persistConf,
  } = useCronogramaData()
  // Abre em "recusados": é a única aba visível hoje (ver SUBS_VISIVEIS abaixo).
  // Se outra aba voltar a ser exibida, este padrão continua válido.
  const [sub, setSub] = useState<Sub>("recusados")
  const [ocupOpen, setOcupOpen] = useState(false)
  const [saidaOpen, setSaidaOpen] = useState(false)
  const [ocupProfOpen, setOcupProfOpen] = useState(false)
  const [ocupPacOpen, setOcupPacOpen] = useState(false)
  const [invModalPac, setInvModalPac] = useState<string | null>(null)
  const [invMotivo, setInvMotivo] = useState("")

  const hoje = () => new Date().toLocaleDateString("pt-BR")


  // waMap "aguardando" items — cross-reference with res for full details
  const aguardandoOcup = useMemo(() => {
    const allSugs = [...(res?.vagasAgora ?? []), ...(res?.filaEspera ?? [])]
    return Object.entries(waMap)
      .filter(([, v]) => v === "aguardando")
      .map(([key]) => {
        const [pac, prof, dia, hora] = key.split("|||")
        const sug = allSugs.find(s => waKey(s) === key) ?? null
        return { key, pac, prof, dia, hora, sug }
      })
  }, [waMap, res])

  const aguardandoSaidaItems = Object.entries(statusMap).filter(([, v]) => v.status === "aguardando" || v.status === "pendente")
  const aguardandoSaidaCount = aguardandoSaidaItems.length
  const aguardandoProfItems = Object.entries(profMap).filter(([, v]) => v === "acompanhamento")
  const aguardandoPacBundles = pacBundles.filter(b => b.status === "pendente")
  const aguardandoCount = aguardandoOcup.length + aguardandoSaidaCount + aguardandoProfItems.length + aguardandoPacBundles.length

  // Busca por paciente dentro de "Aguardando" — substitui o antigo filtro por
  // origem (a origem já é identificável pelo ícone/cor de cada seção; buscar
  // pelo nome é o que o coordenador de fato precisa ao procurar um paciente).
  const [filtroPac, setFiltroPac] = useState("")
  const filtroPacNorm = filtroPac.trim().toLowerCase()
  const aguardandoOcupView = useMemo(
    () => filtroPacNorm ? aguardandoOcup.filter(o => o.pac.toLowerCase().includes(filtroPacNorm)) : aguardandoOcup,
    [aguardandoOcup, filtroPacNorm],
  )
  const aguardandoProfItemsView = useMemo(
    () => filtroPacNorm ? aguardandoProfItems.filter(([key]) => key.split("|||")[0].toLowerCase().includes(filtroPacNorm)) : aguardandoProfItems,
    [aguardandoProfItems, filtroPacNorm],
  )
  const aguardandoPacBundlesView = useMemo(
    () => filtroPacNorm ? aguardandoPacBundles.filter(b => b.pac.toLowerCase().includes(filtroPacNorm)) : aguardandoPacBundles,
    [aguardandoPacBundles, filtroPacNorm],
  )
  const aguardandoSaidaItemsView = useMemo(
    () => filtroPacNorm ? aguardandoSaidaItems.filter(([key]) => key.split("|||")[0].toLowerCase().includes(filtroPacNorm)) : aguardandoSaidaItems,
    [aguardandoSaidaItems, filtroPacNorm],
  )
  const aguardandoViewCount = aguardandoOcupView.length + aguardandoProfItemsView.length + aguardandoPacBundlesView.length + aguardandoSaidaItemsView.length

  // Itens de saida_aceites que não foram propagados para conf/rec/inv (ex: processados por outro usuário)
  const saidaConfDerived = useMemo((): ConfItem[] => (
    Object.entries(statusMap)
      .filter(([, v]) => v.status === "resolvido")
      .map(([key, v]) => {
        const [pac, dia, hora, terapia] = key.split("|||")
        const { prof: profRes, dia: diaRes, hora: horaRes } = parseSlotReservado(v.slotReservado)
        return {
          id: `saida_${key}`,
          pac,
          prof: profRes || "",
          esp: terapia,
          unidade: v.afetada?.unidade || "",
          dia: diaRes || dia,
          hora: horaRes || hora,
          origem: "Saída Profissional",
          registradoEm: v.atualizadoEm ? new Date(v.atualizadoEm).toLocaleDateString("pt-BR") : "—",
          obs: v.obsAceite,
        }
      })
      .filter(item => !conf.some(c => c.pac === item.pac && c.dia === item.dia && c.hora === item.hora && c.esp === item.esp))
  ), [statusMap, conf])

  const saidaRecDerived = useMemo((): RecItem[] => (
    Object.entries(statusMap)
      .filter(([, v]) => v.status === "recusado")
      .map(([key, v]) => {
        const [pac, dia, hora, terapia] = key.split("|||")
        const firstSlot = (v.slotReservado || "").split(";;")[0] || ""
        const profRes = firstSlot.split("|||")[0] || ""
        return {
          paciente: pac,
          profissional: profRes,
          especialidade: terapia,
          unidade: v.afetada?.unidade || "",
          dia,
          hora,
          registradoEm: v.atualizadoEm ? new Date(v.atualizadoEm).toLocaleDateString("pt-BR") : "—",
          obs: v.obsAceite,
        }
      })
      .filter(item => !rec.some(r => r.paciente === item.paciente && r.dia === item.dia && r.hora === item.hora))
  ), [statusMap, rec])

  const saidaInvDerived = useMemo((): InvItem[] => (
    Object.entries(statusMap)
      .filter(([, v]) => v.status === "sem_solucao")
      .map(([key, v]) => {
        const [pac, dia, hora] = key.split("|||")
        return {
          paciente: pac,
          motivo: v.obsAceite || "Sem solução encontrada",
          dia,
          hora,
          registradoEm: v.atualizadoEm ? new Date(v.atualizadoEm).toLocaleDateString("pt-BR") : "—",
        }
      })
      .filter(item => !inv.some(i => i.paciente === item.paciente && i.dia === item.dia && i.hora === item.hora))
  ), [statusMap, inv])

  // CRON-008: Reserva Pendente (Ocp. Paciente) não é gravada em `conf` — pacBundles
  // é a única fonte de verdade. Aqui só derivamos uma representação de leitura para
  // a aba Confirmados, no mesmo padrão de saidaConfDerived (sem duplicar estado).
  const pacConfDerived = useMemo((): ConfItem[] => (
    pacBundles
      .filter(b => b.status === "confirmado")
      .flatMap(b => b.sessoes.map(s => ({
        id: `${RESERVA_PENDENTE_PREFIX}${b.id}|||${s.dia}|||${s.hora}`,
        pac: b.pac,
        prof: s.prof,
        esp: s.tP,
        unidade: s.unidade,
        dia: s.dia,
        hora: s.hora,
        origem: "Ocp. Paciente",
        registradoEm: new Date(b.ts).toLocaleDateString("pt-BR"),
      })))
  ), [pacBundles])

  // Bundles cuja série foi excluída no TiTa e detectada pela reconciliação
  // (ver OcupPacMode.tsx). Não são mais "Implantado" — surfaced à parte, só leitura,
  // com opção de dispensar o aviso (remove o bundle da fonte de verdade).
  const pacRemovidoDerived = useMemo((): ConfItem[] => (
    pacBundles
      .filter(b => b.status === "removido_tita")
      .flatMap(b => b.sessoes.map(s => ({
        id: `${RESERVA_PENDENTE_PREFIX}${b.id}|||${s.dia}|||${s.hora}`,
        pac: b.pac,
        prof: s.prof,
        esp: s.tP,
        unidade: s.unidade,
        dia: s.dia,
        hora: s.hora,
        origem: "Ocp. Paciente",
        registradoEm: new Date(b.ts).toLocaleDateString("pt-BR"),
      })))
  ), [pacBundles])

  // Recusas vindas dos bundles COMPARTILHADOS (acomp_pac_bundles), no mesmo padrão
  // de pacConfDerived. Sem isto a aba mostrava só `rec`, que vive no localStorage
  // de cada navegador (a tabela cronograma_estado não existe no banco): o motor de
  // sugestões bloqueava por bundle — visível para todo mundo — mas a tela listava
  // apenas as recusas registradas NESTE navegador. Resultado observado no paciente
  // Arthur Luiz Maciel Fortes: 17 slots bloqueados, 4 visíveis, e nenhuma forma de
  // reativar os outros 13 nem de entender por que as sugestões sumiram.
  // Dedup contra `rec` pela coordenada, porque a mesma recusa costuma existir nos
  // dois lugares (handleAcaoDireta grava em ambos) e apareceria duplicada.
  const pacRecDerived = useMemo((): RecItem[] => {
    const jaEmRec = new Set(rec.map(r => `${r.paciente}|||${r.profissional}|||${r.dia}|||${r.hora}`))
    const vistos = new Set<string>()
    const out: RecItem[] = []
    for (const b of pacBundles) {
      for (const s of b.sessoes) {
        const recusadoNoSlot = b.slotStatus?.[`${s.dia}|||${s.hora}`] === "recusado"
        if (b.status !== "recusado" && !recusadoNoSlot) continue
        const chave = `${b.pac}|||${s.prof}|||${s.dia}|||${s.hora}`
        if (jaEmRec.has(chave) || vistos.has(chave)) continue
        vistos.add(chave)
        out.push({
          paciente: b.pac, profissional: s.prof, especialidade: s.tP, unidade: s.unidade,
          dia: s.dia, hora: s.hora,
          registradoEm: new Date(b.ts).toLocaleDateString("pt-BR"),
          obs: b.motivo || undefined,
        })
      }
    }
    return out
  }, [pacBundles, rec])

  const allConf = useMemo(() => [...conf, ...saidaConfDerived, ...pacConfDerived], [conf, saidaConfDerived, pacConfDerived])
  const allRec  = useMemo(() => [...rec,  ...saidaRecDerived, ...pacRecDerived],  [rec,  saidaRecDerived, pacRecDerived])
  const allInv  = useMemo(() => [...inv,  ...saidaInvDerived],  [inv,  saidaInvDerived])

  // CRON-008: remover um Confirmado derivado de Reserva Pendente precisa reverter a
  // implantação na origem — pacBundles é a única fonte de verdade, então a remoção
  // acontece ali (removendo a sessão do bundle, ou o bundle inteiro se for a última).
  // Itens derivados de Saída Profissional seguem read-only aqui, como já era.
  function handleRemoverConfirmado(item: ConfItem) {
    if (isReservaPendenteItem(item)) {
      const sep = item.id.indexOf("|||")
      const bundleId = item.id.slice(RESERVA_PENDENTE_PREFIX.length, sep)
      const atualizados = pacBundles
        .map(b => b.id === bundleId
          ? { ...b, sessoes: b.sessoes.filter(s => !(s.dia === item.dia && s.hora === item.hora && s.prof === item.prof && s.tP === item.esp)) }
          : b)
        .filter(b => b.id !== bundleId || b.sessoes.length > 0)
      persistPacBundles(atualizados)
      return
    }
    if (item.id.startsWith("saida_")) return
    const idx = conf.findIndex(c => c.id === item.id)
    if (idx !== -1) persistConf(conf.filter((_, j) => j !== idx))
  }

  const TODAS_SUBS: { key: Sub; label: string; count: number; icon: LucideIcon }[] = [
    { key: "aguardando",  label: "Aguardando",          count: aguardandoCount,  icon: Clock },
    { key: "confirmados", label: "Confirmados",          count: allConf.length,   icon: CheckCircle2 },
    { key: "recusados",   label: "Recusados",            count: allRec.length,    icon: X },
    { key: "inviavel",    label: "Inviáveis",             count: allInv.length,    icon: Ban },
  ]

  // Abas visíveis — decisão do usuário em 2026-08-20: a operação usa só "Recusados".
  // OCULTAR, não apagar: nenhum dado é excluído e nenhuma lógica é removida; as
  // outras abas continuam sendo alimentadas normalmente e voltam ao ar bastando
  // acrescentar a chave aqui. Medição que embasou a decisão (ação por mês):
  //   Recusados   243 registros — 5 jun / 47 jul / 191 ago  (uso intenso)
  //   Confirmados  34 bundles   —      8 jul /  26 ago      (uso ativo)
  //   Aguardando   13 bundles   — 3 jun /  9 jul /   1 ago  (praticamente parada)
  //   Inviáveis     0 bundles no banco (os itens exibidos vinham do localStorage)
  // Registro de divergência: "Confirmados" tinha 26 implantações em agosto e é o
  // registro visível do que foi escrito no TiTa; recomendei mantê-la e o usuário
  // optou por ocultar assim mesmo. Reverter = devolver "confirmados" a esta lista.
  const SUBS_VISIVEIS: Sub[] = ["recusados"]
  const SUBS = TODAS_SUBS.filter(s => SUBS_VISIVEIS.includes(s.key))

  function handleOcupAceito(key: string, sug: { pac: string; prof: string; tP?: string; esp?: string; unidade?: string; dia?: string; hora?: string } | null) {
    sWa({ ...waMap, [key]: "aceito" as WaStatus })
    if (sug) {
      const [, , dia, hora] = key.split("|||")
      persistConf([...conf, { id: genConfId(), pac: sug.pac, prof: sug.prof, esp: sug.tP ?? sug.esp ?? "", unidade: sug.unidade ?? "", dia: sug.dia ?? dia, hora: sug.hora ?? hora, origem: "Ocp. Clínica", registradoEm: hoje() }])
    }
  }
  function handleOcupRecusado(key: string, sug: Sugestao | null) {
    const next = { ...waMap, [key]: "recusado" as WaStatus }
    sWa(next)
    if (sug) {
      sRec([...rec, {
        paciente: sug.pac, profissional: sug.prof, especialidade: sug.esp,
        unidade: sug.unidade, dia: sug.dia, hora: sug.hora,
        registradoEm: new Date().toLocaleDateString("pt-BR"),
      }])
      registrarRecusa({
        origem: "ocp-clinica", paciente: sug.pac, profissional: sug.prof,
        especialidade: sug.esp, unidade: sug.unidade, dia: sug.dia, hora: sug.hora,
      })
    }
  }
  function handleOcupCancelar(key: string) {
    const next = { ...waMap }
    delete next[key]
    sWa(next)
  }
  function handleOcupInviavel(pac: string) {
    setInvModalPac(pac)
    setInvMotivo("")
  }
  function confirmarInviavel() {
    if (!invModalPac) return
    const next = Object.fromEntries(Object.entries(waMap).filter(([k]) => !k.startsWith(`${invModalPac}|||`)))
    sWa(next)
    sInv([...inv, { paciente: invModalPac, motivo: invMotivo, registradoEm: new Date().toLocaleDateString("pt-BR") }])
    setInvModalPac(null)
    setInvMotivo("")
  }

  function handleProfConfirmar(key: string) {
    persistProfMap({ ...profMap, [key]: "aceito" })
    const [pac, prof, dia, hora] = key.split("|||")
    persistConf([...conf, { id: genConfId(), pac, prof, esp: "", unidade: "", dia, hora, origem: "Ocp. Profissional", registradoEm: hoje() }])
  }
  function handleProfRecusar(key: string) {
    persistProfMap({ ...profMap, [key]: "recusado" })
    const [pac, prof, dia, hora] = key.split("|||")
    sRec([...rec, { paciente: pac, profissional: prof, especialidade: "", unidade: "", dia, hora, registradoEm: hoje() }])
    registrarRecusa({ origem: "ocp-profissional", paciente: pac, profissional: prof, dia, hora })
  }
  function handleProfInviavel(key: string) {
    persistProfMap({ ...profMap, [key]: "inviavel" })
    const [pac, prof, dia, hora] = key.split("|||")
    sInv([...inv, { paciente: pac, motivo: `${prof} (Ocp. Profissional)`, dia, hora, registradoEm: hoje() }])
  }
  function handleProfCancelar(key: string) {
    const next = { ...profMap }
    delete next[key]
    persistProfMap(next)
  }

  function handlePacCancelar(id: string) {
    // Forma de função: cancelar vários itens em cliques seguidos parte sempre do
    // estado mais recente, não do array capturado no render (ver persistPacBundles).
    persistPacBundles(prev => prev.filter(b => b.id !== id))
  }
  function handlePacSlotStatus(id: string, slotKey: string, status: SlotStatus | null) {
    const bundle = pacBundles.find(b => b.id === id)
    const sessao = bundle?.sessoes.find(s => `${s.dia}|||${s.hora}` === slotKey)
    // Capturado ANTES do persistPacBundles: é o que diz se `status === null`
    // (toggle-off do botão "Recusou") é uma reativação de verdade ou um clique
    // sem efeito (slot que já não estava recusado).
    const statusAnterior = bundle?.slotStatus?.[slotKey]
    persistPacBundles(prev => prev.map(b => {
      if (b.id !== id) return b
      const slotStatus = { ...(b.slotStatus ?? {}) }
      if (status === null) delete slotStatus[slotKey]
      else slotStatus[slotKey] = status
      // Recusar slot a slot também tem que marcar o bundle como recusado quando
      // TODAS as sessões dele foram recusadas — buildSugestoes bloqueia reoferta
      // por bundle.status, então sem isso um bundle inteiro recusado slot a slot
      // continuava sendo reofertado.
      const todasRecusadas = b.sessoes.every(s => slotStatus[`${s.dia}|||${s.hora}`] === "recusado")
      return { ...b, slotStatus, status: todasRecusadas ? "recusado" as const : b.status }
    }))
    if (bundle && sessao) {
      const d = hoje()
      if (status === "confirmado")
        persistConf([...conf, { id: genConfId(), pac: bundle.pac, prof: sessao.prof, esp: sessao.tP, unidade: sessao.unidade, dia: sessao.dia, hora: sessao.hora, origem: "Ocp. Paciente", registradoEm: d }])
      else if (status === "recusado") {
        sRec([...rec, { paciente: bundle.pac, profissional: sessao.prof, especialidade: sessao.tP, unidade: sessao.unidade, dia: sessao.dia, hora: sessao.hora, registradoEm: d }])
        registrarRecusa({ origem: "ocp-paciente", paciente: bundle.pac, profissional: sessao.prof, especialidade: sessao.tP, unidade: sessao.unidade, dia: sessao.dia, hora: sessao.hora })
      } else if (status === "inviavel")
        sInv([...inv, { paciente: bundle.pac, motivo: sessao.tP, dia: sessao.dia, hora: sessao.hora, registradoEm: d }])
      else if (status === null && statusAnterior === "recusado") {
        // Mesma correção do bug em OcupPacMode.tsx (reativarCombo): sem limpar
        // `rec` aqui, o item ficava aparecendo em "Recusados" e "Reativados"
        // ao mesmo tempo — o toggle só desfazia o bundle, não a entrada em rec
        // que handlePacSlotStatus grava junto ao recusar (linha 469 acima).
        sRec(rec.filter(r => !(r.paciente === bundle.pac && r.profissional === sessao.prof && r.dia === sessao.dia && r.hora === sessao.hora)))
        registrarReativacao({ origem: "ocp-paciente", paciente: bundle.pac, profissional: sessao.prof, especialidade: sessao.tP, unidade: sessao.unidade, dia: sessao.dia, hora: sessao.hora })
      }
    }
  }
  function handlePacSlotRemove(id: string, slotKey: string) {
    persistPacBundles(prev => prev.map(b => {
      if (b.id !== id) return b
      const sessoes = b.sessoes.filter(s => `${s.dia}|||${s.hora}` !== slotKey)
      const slotStatus = { ...(b.slotStatus ?? {}) }
      delete slotStatus[slotKey]
      return { ...b, sessoes, slotStatus }
    }))
  }
  function handlePacBulkStatus(id: string, status: SlotStatus | "cancelar") {
    if (status === "cancelar") { handlePacCancelar(id); return }
    const bundle = pacBundles.find(b => b.id === id)
    persistPacBundles(prev => prev.map(b => {
      if (b.id !== id) return b
      const slotStatus: Record<string, SlotStatus> = {}
      for (const s of b.sessoes) slotStatus[`${s.dia}|||${s.hora}`] = status
      const bundleStatus = status === "confirmado" ? "confirmado" as const
        : status === "recusado" ? "recusado" as const : b.status
      return { ...b, slotStatus, status: bundleStatus }
    }))
    if (!bundle) return
    const d = hoje()
    // CRON-008: "confirmado" não grava mais em conf — o bundle (agora com
    // status "confirmado") já é surfaced na aba Confirmados via pacConfDerived.
    // Gravar aqui também duplicaria a linha (uma real + uma derivada) e reabriria
    // o mesmo problema de duas fontes de verdade para a mesma reserva.
    if (status === "recusado") {
      sRec([...rec, ...bundle.sessoes.map(s => ({ paciente: bundle.pac, profissional: s.prof, especialidade: s.tP, unidade: s.unidade, dia: s.dia, hora: s.hora, registradoEm: d }))])
      for (const s of bundle.sessoes)
        registrarRecusa({ origem: "ocp-paciente", paciente: bundle.pac, profissional: s.prof, especialidade: s.tP, unidade: s.unidade, dia: s.dia, hora: s.hora })
    } else if (status === "inviavel")
      sInv([...inv, ...bundle.sessoes.map(s => ({ paciente: bundle.pac, motivo: s.tP, dia: s.dia, hora: s.hora, registradoEm: d }))])
  }

  function handleSaidaConfirmar(key: string, obsAceite?: string) {
    const val = statusMap[key]
    if (!val) return
    persistStatus({ ...statusMap, [key]: { ...val, status: "resolvido" as any, obsAceite, atualizadoEm: Date.now() } })
    const [pac, dia, hora, terapia] = key.split("|||")
    const { prof: profRes, dia: diaRes, hora: horaRes } = parseSlotReservado(val.slotReservado)
    persistConf([...conf, { id: genConfId(), pac, prof: profRes || "", esp: terapia, unidade: "", dia: diaRes || dia, hora: horaRes || hora, origem: "Saída Profissional", registradoEm: hoje(), obs: obsAceite }])
  }
  function handleSaidaRecusar(key: string, obsAceite?: string) {
    const val = statusMap[key]
    if (!val) return
    persistStatus({ ...statusMap, [key]: { ...val, status: "recusado" as any, obsAceite, slotReservado: null, atualizadoEm: Date.now() } })
    const [pac, dia, hora, terapia] = key.split("|||")
    const { prof: profRes } = parseSlotReservado(val.slotReservado)
    sRec([...rec, { paciente: pac, profissional: profRes || "", especialidade: terapia, unidade: "", dia, hora, registradoEm: hoje(), obs: obsAceite }])
    registrarRecusa({ origem: "saida-profissional", paciente: pac, profissional: profRes || "", especialidade: terapia, dia, hora, motivo: obsAceite })
  }
  function handleSaidaInviavel(key: string, obsAceite: string) {
    const val = statusMap[key]
    if (!val) return
    persistStatus({ ...statusMap, [key]: { ...val, status: "sem_solucao" as any, obsAceite, atualizadoEm: Date.now() } })
    const [pac, dia, hora] = key.split("|||")
    sInv([...inv, { paciente: pac, motivo: obsAceite, dia, hora, registradoEm: hoje() }])
  }
  function handleSaidaCancelar(key: string) {
    const next = { ...statusMap }
    delete next[key]
    persistStatus(next)
  }

  function handleExportCSV() {
    const L: string[][] = [["Origem", "Paciente", "Terapia/Especialidade", "Profissional", "Dia", "Hora", "Status"]]
    for (const [key, status] of Object.entries(waMap)) {
      const [pac, prof, dia, hora] = key.split("|||")
      L.push(["Ocp. Clínica", pac, "", prof, dia, hora, status])
    }
    for (const [key, status] of Object.entries(profMap)) {
      const [pac, prof, dia, hora] = key.split("|||")
      L.push(["Ocp. Profissional", pac, "", prof, dia, hora, status])
    }
    for (const bundle of pacBundles) {
      for (const s of bundle.sessoes) {
        const slotKey = `${s.dia}|||${s.hora}`
        const st = (bundle.slotStatus ?? {})[slotKey] ?? (bundle.inviavelSlots?.includes(slotKey) ? "inviavel" : null)
        L.push(["Ocp. Paciente", bundle.pac, s.tP, s.prof, s.dia, s.hora, st ?? bundle.status])
      }
    }
    for (const [key, val] of Object.entries(statusMap)) {
      const [pac, dia, hora, terapia] = key.split("|||")
      const { prof: profRes, dia: diaRes, hora: horaRes } = parseSlotReservado(val.slotReservado)
      L.push(["Saída Profissional", pac, terapia, profRes || "", diaRes || dia, horaRes || hora, val.status || "pendente"])
    }
    const csv = L.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const a = document.createElement("a")
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent("﻿" + csv)
    a.download = "aceites_e_recusas.csv"
    a.click()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Sub-abas em formato de planilha + painel — agrupadas num único wrapper para
          não herdar o "gap" do container pai, já que a aba ativa precisa tocar o painel */}
      <div>
      {/* Com uma única sub-aba visível (SUBS_VISIVEIS), a pastilha de abas não
          seleciona nada — só repetia o título já mostrado no painel abaixo.
          Só volta a aparecer se outra sub-aba for reativada. "Exportar CSV"
          mudou de lugar: agora é uma action do próprio painel (ao lado da
          busca), não uma barra solta acima dele. */}
      {SUBS.length > 1 && (
        <div style={{ display: "flex", gap: "3px", overflowX: "auto" }}>
          {SUBS.map(s => {
            const active = sub === s.key
            return (
              <button key={s.key} onClick={() => setSub(s.key)} style={{
                display: "flex", alignItems: "center", gap: "7px",
                padding: "9px 16px",
                borderTopLeftRadius: "var(--radius-lg)", borderTopRightRadius: "var(--radius-lg)",
                border: "1px solid var(--border)",
                borderBottom: active ? "1px solid var(--card)" : "1px solid var(--border)",
                background: active ? "var(--card)" : "var(--muted)",
                cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                color: active ? B.blue : "var(--muted-foreground)",
                fontSize: "var(--text-md)", fontWeight: active ? "var(--weight-bold)" : "var(--weight-medium)",
                position: "relative", marginBottom: "-1px", zIndex: active ? 2 : 1,
              }}>
                <s.icon size={15} />
                {s.label}
                {s.count > 0 && (
                  <span style={{
                    fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)",
                    background: active ? B.blue : "var(--muted)",
                    color: active ? "white" : "var(--muted-foreground)",
                    borderRadius: "999px", padding: "0 6px", minWidth: "18px", textAlign: "center",
                  }}>
                    {s.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Painel conectado à aba ativa (mesma cor de fundo, sem costura na borda) —
          só faz sentido "colar" quando existe uma pastilha de aba acima dela. */}
      <div style={{ marginTop: SUBS.length > 1 ? "-1px" : 0, position: "relative", zIndex: 1 }}>
      {sub === "aguardando" && (
        <ListCard icon={Clock} title="Aguardando confirmação"
          count={aguardandoCount} titleColor={B.blue}
          actions={<SearchInput value={filtroPac} onChange={setFiltroPac} />}
        >
        <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {aguardandoCount === 0 && <EmptyState icon={Inbox} text="Nenhum item aguardando resposta" />}
          {aguardandoCount > 0 && aguardandoViewCount === 0 && (
            <EmptyState icon={Search} text={`Nenhum resultado para "${filtroPac}"`} />
          )}

          {/* Seção Ocupação Clínica */}
          {aguardandoOcupView.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <SectionToggle icon={ORIGEM_ICON.ocupacao} label="Ocupação Clínica" color={ORIGEM_COLOR.ocupacao}
                count={aguardandoOcupView.length} open={ocupOpen} onToggle={() => setOcupOpen(o => !o)} controls="secao-ocup" />
              {ocupOpen && (
                <div id="secao-ocup" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {aguardandoOcupView.map(({ key, pac, prof, dia, hora, sug }) => (
                    <OcupItem key={key}
                      pac={pac} prof={prof} dia={dia} hora={hora}
                      esp={sug?.esp} unidade={sug?.unidade} tP={sug?.tP} conv={sug?.conv}
                      onAceito={() => handleOcupAceito(key, sug)}
                      onRecusado={() => handleOcupRecusado(key, sug)}
                      onInviavel={() => handleOcupInviavel(pac)}
                      onCancelar={() => handleOcupCancelar(key)}
                      onVer={() => sug && onCron(sug)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Seção Ocupação Profissional */}
          {aguardandoProfItemsView.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <SectionToggle icon={ORIGEM_ICON["ocp-prof"]} label="Ocupação Profissional" color={ORIGEM_COLOR["ocp-prof"]}
                count={aguardandoProfItemsView.length} open={ocupProfOpen} onToggle={() => setOcupProfOpen(o => !o)} controls="secao-ocup-prof" />
              {ocupProfOpen && (
                <div id="secao-ocup-prof" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {aguardandoProfItemsView.map(([key]) => {
                    const [pac, prof, dia, hora] = key.split("|||")
                    return (
                      <ProfItem key={key} pac={pac} prof={prof} dia={dia} hora={hora}
                        onConfirmar={() => handleProfConfirmar(key)}
                        onRecusar={() => handleProfRecusar(key)}
                        onInviavel={() => handleProfInviavel(key)}
                        onCancelar={() => handleProfCancelar(key)}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Seção Ocupação Paciente */}
          {aguardandoPacBundlesView.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <SectionToggle icon={ORIGEM_ICON["ocp-pac"]} label="Ocupação Paciente" color={ORIGEM_COLOR["ocp-pac"]}
                count={aguardandoPacBundlesView.length} open={ocupPacOpen} onToggle={() => setOcupPacOpen(o => !o)} controls="secao-ocup-pac" />
              {ocupPacOpen && (
                <div id="secao-ocup-pac" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {aguardandoPacBundlesView.map(bundle => (
                    <PacBundleItem key={bundle.id} bundle={bundle} cRows={cRows}
                      onCancelar={() => handlePacCancelar(bundle.id)}
                      onSlotStatus={(slotKey, st) => handlePacSlotStatus(bundle.id, slotKey, st)}
                      onSlotRemove={(slotKey) => handlePacSlotRemove(bundle.id, slotKey)}
                      onBulkStatus={(st) => handlePacBulkStatus(bundle.id, st)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Seção Saída de Profissional */}
          {aguardandoSaidaItemsView.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <SectionToggle icon={ORIGEM_ICON.saida} label="Saída de Profissional" color={ORIGEM_COLOR.saida}
                count={aguardandoSaidaItemsView.length} open={saidaOpen} onToggle={() => setSaidaOpen(o => !o)} controls="secao-saida" />
              {saidaOpen && (
                <div id="secao-saida" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {aguardandoSaidaItemsView.map(([key, val]) => {
                    const [pac, dia, hora, terapia] = key.split("|||")
                    const { prof: profRes, dia: diaRes, hora: horaRes } = parseSlotReservado(val.slotReservado)
                    return (
                      <SaidaItem key={key}
                        pac={pac} dia={dia} hora={hora} terapia={terapia}
                        profRes={profRes} diaRes={diaRes} horaRes={horaRes} obs={val.obs}
                        estrategiaSel={val.estrategiaSel}
                        opcao={val.opcao}
                        movimentos={val.movimentos}
                        statusEntry={val}
                        onConfirmar={(obs) => handleSaidaConfirmar(key, obs)}
                        onRecusar={(obs) => handleSaidaRecusar(key, obs)}
                        onInviavel={(obs) => handleSaidaInviavel(key, obs)}
                        onCancelar={() => handleSaidaCancelar(key)}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        </ListCard>
      )}

      {sub === "confirmados" && (
        <ConfirmadosTab conf={allConf} removidos={pacRemovidoDerived} onRemove={handleRemoverConfirmado} />
      )}
      {sub === "recusados" && (
        <RecusadosTab rec={allRec} inv={allInv} waMap={waMap} onExportCSV={handleExportCSV}
          onRemove={i => {
            // allRec = [...rec, ...saidaRecDerived, ...pacRecDerived]. O item pode vir
            // de qualquer um dos três; só `rec` é editável diretamente (localStorage),
            // os derivados são reflexo dos bundles compartilhados. Em ambos os casos o
            // que precisa sair é o bloqueio no bundle — senão "Reativar sugestão"
            // limparia só a auditoria e o slot continuaria preso.
            const item = allRec[i]
            if (!item) return
            if (i < rec.length) sRec(rec.filter((_, j) => j !== i))
            const antes = pacBundles
            const depois = reativarRecusaPaciente(pacBundles, item)
            persistPacBundles(depois)
            // `rec` mistura as 3 origens sem guardar qual — melhor sinal disponível:
            // se a limpeza acima realmente tirou algo de um bundle, é Ocupação
            // Paciente; senão, se havia um registro "recusado" em statusMap pra essa
            // combinação, é Saída de Profissional; caso contrário, Ocupação Clínica
            // (a mais comum das que sobram).
            const chaveSaida = `${item.paciente}|||${item.dia}|||${item.hora}|||${item.especialidade ?? ""}`
            const origem = depois.length !== antes.length || depois.some((b, j) => b !== antes[j])
              ? "ocp-paciente"
              : statusMap[chaveSaida]?.status === "recusado" ? "saida-profissional" : "ocp-clinica"
            registrarReativacao({
              origem, paciente: item.paciente, profissional: item.profissional,
              especialidade: item.especialidade, unidade: item.unidade, dia: item.dia, hora: item.hora,
            })
          }} />
      )}
      {sub === "inviavel" && (
        <InviavelTab inv={allInv} rec={allRec} waMap={waMap}
          onRemove={i => { if (i < inv.length) sInv(inv.filter((_, j) => j !== i)) }} />
      )}
      </div>
      </div>

      {/* Modal Inviável (waMap items) */}
      {invModalPac && (
        <InviavelModal
          pac={invModalPac}
          motivo={invMotivo}
          onMotivoChange={setInvMotivo}
          onConfirmar={confirmarInviavel}
          onClose={() => { setInvModalPac(null); setInvMotivo("") }}
        />
      )}
    </div>
  )
}

function InviavelModal({ pac, motivo, onMotivoChange, onConfirmar, onClose }: {
  pac: string; motivo: string
  onMotivoChange: (v: string) => void
  onConfirmar: () => void
  onClose: () => void
}) {
  const firstBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inv-modal-title"
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)", padding: "16px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: "var(--card)", borderRadius: "var(--radius-xl)", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "380px", width: "100%", padding: "20px" }}>
        <div id="inv-modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "var(--weight-heavy)", fontSize: "var(--text-lg)", marginBottom: "4px" }}>
          <Ban size={17} style={{ color: "#b45309" }} /> Marcar como Inviável
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginBottom: "10px" }}>Removido de TODAS as sugestões até tirado da lista.</div>
        <div style={{ background: "var(--muted)", borderRadius: "var(--radius-md)", padding: "10px 12px", fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", marginBottom: "10px" }}>{pac}</div>
        <label htmlFor="inv-motivo" style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", display: "block", marginBottom: "4px" }}>Motivo (opcional)</label>
        <textarea id="inv-motivo" value={motivo} onChange={e => onMotivoChange(e.target.value)} placeholder="ex: família faltando muito..." rows={2}
          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: "var(--text-sm)", fontFamily: "inherit", resize: "none", marginBottom: "14px", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: "8px" }}>
          <button ref={firstBtnRef} onClick={onConfirmar} style={{ padding: "8px 16px", borderRadius: "var(--radius-md)", background: B.navy, color: "white", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-bold)", fontSize: "var(--text-sm)" }}>
            Confirmar
          </button>
          <button onClick={onClose} style={{ flex: 1, padding: "8px 16px", borderRadius: "var(--radius-md)", background: "var(--muted)", color: "var(--card-foreground)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-semibold)" }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmadosTab({ conf, removidos, onRemove }: { conf: ConfItem[]; removidos: ConfItem[]; onRemove: (item: ConfItem) => void }) {
  const [removendo, setRemovendo] = useState<ConfItem | null>(null)
  const [filtro, setFiltro] = useState("")
  const [diasFechados, setDiasFechados] = useState<Set<string>>(new Set())
  const toggleDia = (dia: string) => setDiasFechados(prev => {
    const next = new Set(prev)
    if (next.has(dia)) next.delete(dia)
    else next.add(dia)
    return next
  })

  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return q ? conf.filter(c => c.pac.toLowerCase().includes(q)) : conf
  }, [conf, filtro])

  // Agrupado por dia da semana (ordem útil) — cada linha lê como uma frase
  // "quando → quem → o quê", em vez de uma grade de colunas soltas.
  const groups = useMemo(() => {
    const map = new Map<string, ConfItem[]>()
    for (const c of filtrados) {
      const arr = map.get(c.dia) ?? []
      arr.push(c)
      map.set(c.dia, arr)
    }
    return [...map.entries()]
      .sort(([a], [b]) => (DIAS_ORD[a] ?? 99) - (DIAS_ORD[b] ?? 99))
      .map(([dia, items]) => [dia, items.slice().sort((a, b) => a.hora.localeCompare(b.hora))] as const)
  }, [filtrados])

  return (
    <>
    {removidos.length > 0 && (
      <ListCard icon={Ban} title="Removidos no TiTa" count={removidos.length} titleColor="#b45309">
        <div style={{ padding: "8px 12px 4px", fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
          Estas sessões estavam implantadas, mas a série foi excluída diretamente no TiTa. Os horários já foram liberados — dispense o aviso quando quiser.
        </div>
        {removidos.map((c, i) => (
          <div key={c.id || i} className={rowClass} style={rowStyle}>
            <TimeBadge hora={c.hora} color="#b45309" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: "var(--weight-heavy)", fontSize: "var(--text-base)", color: "var(--foreground)" }}>{c.pac}</span>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginTop: "2px" }}>
                {c.esp || "—"} · {fmtName(c.prof)}
              </div>
            </div>
            <div style={{ flexShrink: 0, width: "190px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
              <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", color: "#b45309", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "var(--radius-sm)", padding: "2px 8px", whiteSpace: "nowrap" }}>
                Removido no TiTa
              </span>
              <button onClick={() => onRemove(c)} style={{
                fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", whiteSpace: "nowrap",
                color: "var(--muted-foreground)", background: "var(--muted)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", padding: "5px 10px", cursor: "pointer", fontFamily: "inherit",
              }}>
                Dispensar aviso
              </button>
            </div>
          </div>
        ))}
      </ListCard>
    )}
    <ListCard
      icon={CheckCircle2}
      title="Confirmados"
      count={conf.length}
      titleColor="#15803d"
      actions={<SearchInput value={filtro} onChange={setFiltro} />}
    >
      {!conf.length ? (
        <EmptyState icon={Inbox} text="Nenhuma confirmação registrada" />
      ) : !filtrados.length ? (
        <EmptyState icon={Search} text={`Nenhum resultado para "${filtro}"`} />
      ) : (
        <div>
          {groups.map(([dia, items]) => (
            <div key={dia}>
              <GroupHeader label={dia} count={items.length} open={!diasFechados.has(dia)} onToggle={() => toggleDia(dia)} />
              {!diasFechados.has(dia) && items.map((c, i) => {
                const origemMeta = CONF_ORIGEM_META[c.origem] ?? DEFAULT_ORIGEM_META
                return (
                  <div key={c.id || i} className={rowClass} style={rowStyle}>
                    <TimeBadge hora={c.hora} color={origemMeta.color} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: "var(--weight-heavy)", fontSize: "var(--text-base)", color: "var(--foreground)" }}>{c.pac}</span>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginTop: "2px" }}>
                        {c.esp || "—"} · {fmtName(c.prof)}
                      </div>
                      {c.obs && (
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", fontStyle: "italic", marginTop: "4px" }}>{`"${c.obs}"`}</div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, width: "190px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                      <OriginTag icon={origemMeta.icon} label={c.origem} color={origemMeta.color} />
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{c.registradoEm}</span>
                      <button onClick={() => setRemovendo(c)} style={{
                        fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", whiteSpace: "nowrap",
                        color: "#dc2626", background: "#fef2f2", border: "1px solid #fca5a5",
                        borderRadius: "var(--radius-sm)", padding: "5px 10px", cursor: "pointer", fontFamily: "inherit",
                      }}>
                        Cancelar agendamento
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </ListCard>
    {removendo && (
      <ConfirmDialog
        title="Remover registro?"
        description={
          isReservaPendenteItem(removendo)
            ? "Isso reverte a implantação: a sessão deixa de estar reservada, volta a aparecer como sugestão para este paciente e a vaga fica disponível para outros."
            : "O registro será removido da lista de confirmados."
        }
        confirmLabel="Remover"
        confirmColor="#dc2626"
        onConfirm={() => { onRemove(removendo); setRemovendo(null) }}
        onCancel={() => setRemovendo(null)}
      />
    )}
    </>
  )
}

function ProfItem({
  pac, prof, dia, hora, onConfirmar, onRecusar, onInviavel, onCancelar,
}: {
  pac: string; prof: string; dia: string; hora: string
  onConfirmar: () => void; onRecusar: () => void; onInviavel: () => void; onCancelar: () => void
}) {
  return (
    <RailCard color={ORIGEM_COLOR["ocp-prof"]}>
      <div style={{ marginBottom: "8px" }}>
        <OriginTag icon={ORIGEM_ICON["ocp-prof"]} label="Ocupação Profissional" color={ORIGEM_COLOR["ocp-prof"]} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: "var(--weight-heavy)", fontSize: "var(--text-base)", color: "var(--foreground)" }}>{pac}</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginTop: "2px" }}>{prof}</div>
          <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: "var(--foreground)", marginTop: "2px" }}>{dia} {hora}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <ActionBtn kind="confirm" onClick={onConfirmar}><Check size={14} /> Confirmou</ActionBtn>
          <ActionBtn kind="reject" onClick={onRecusar}><X size={14} /> Recusou</ActionBtn>
          <ActionBtn kind="neutral" onClick={onInviavel}><Ban size={14} /> Inviável</ActionBtn>
          <ActionBtn kind="cancel" onClick={onCancelar} title="Desfaz o aceite — volta como sugestão em Aumentar Ocupação (Profissional)">Cancelar</ActionBtn>
        </div>
      </div>
    </RailCard>
  )
}

function PacBundleItem({
  bundle, cRows, onCancelar, onSlotStatus, onSlotRemove, onBulkStatus,
}: {
  bundle: AceitePacBundle
  cRows: CsvRow[]
  onCancelar: () => void
  onSlotStatus: (slotKey: string, status: SlotStatus | null) => void
  onSlotRemove: (slotKey: string) => void
  onBulkStatus: (status: SlotStatus | "cancelar") => void
}) {
  const [showVer, setShowVer] = useState(false)
  const dt = new Date(bundle.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  const slotStatus = bundle.slotStatus ?? {}

  const slotBtn = (bg: string, c: string, bd: string, active?: boolean): CSSProperties => ({
    fontSize: "var(--text-xs)", padding: "6px 10px", minHeight: "32px", borderRadius: "var(--radius-sm)", cursor: "pointer",
    whiteSpace: "nowrap", fontFamily: "inherit",
    background: active ? bg : "var(--muted)", color: active ? c : "var(--muted-foreground)",
    border: `1px solid ${active ? bd : "var(--border)"}`, fontWeight: active ? "var(--weight-bold)" : "var(--weight-medium)",
  })

  return (
    <RailCard color={ORIGEM_COLOR["ocp-pac"]}>

      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <OriginTag icon={ORIGEM_ICON["ocp-pac"]} label="Ocupação Paciente" color={ORIGEM_COLOR["ocp-pac"]} />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>{dt}</span>
        </div>
        <button onClick={() => setShowVer(true)} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--text-sm)", padding: "8px 12px", minHeight: "36px", borderRadius: "var(--radius-md)", background: "transparent", color: B.blue, border: `1px solid ${B.blue}33`, cursor: "pointer", fontWeight: "var(--weight-semibold)", fontFamily: "inherit" }}>
          <CalendarDays size={13} /> Ver
        </button>
      </div>

      <div style={{ fontWeight: "var(--weight-heavy)", fontSize: "var(--text-base)", color: "var(--foreground)", marginBottom: "10px" }}>{bundle.pac}</div>

      {/* Sessões individuais */}
      <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "12px" }}>
        {bundle.sessoes.map(s => {
          const slotKey = `${s.dia}|||${s.hora}`
          const st = slotStatus[slotKey] as SlotStatus | undefined
          const meta = st ? SLOT_META[st] : null
          return (
            <div key={slotKey} style={{ background: "var(--muted)", borderRadius: "var(--radius-sm)", padding: "7px 10px", opacity: st === "inviavel" ? 0.65 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--text-md)", color: "var(--foreground)" }}>{s.dia.replace("-feira", "")} {s.hora}</span>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--card-foreground)", marginLeft: "6px" }}>{s.tP}</span>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginLeft: "4px" }}>· {fmtName(s.prof)}</span>
                  {meta && (
                    <span style={{ marginLeft: "8px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", padding: "1px 6px", borderRadius: "var(--radius-sm)", background: meta.bg, color: meta.c, border: `1px solid ${meta.bd}` }}>
                      {meta.label}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", flexShrink: 0 }}>
                  <button onClick={() => onSlotStatus(slotKey, st === "confirmado" ? null : "confirmado")}
                    style={slotBtn("#dcfce7", "#14532d", "#86efac", st === "confirmado")}>✓ Confirmou</button>
                  <button onClick={() => onSlotStatus(slotKey, st === "recusado" ? null : "recusado")}
                    style={slotBtn("#fee2e2", "#7f1d1d", "#fca5a5", st === "recusado")}>✗ Recusou</button>
                  <button onClick={() => onSlotStatus(slotKey, st === "inviavel" ? null : "inviavel")}
                    style={slotBtn("var(--muted)", "var(--muted-foreground)", "var(--border)", st === "inviavel")}>Inviável</button>
                  <button onClick={() => onSlotRemove(slotKey)}
                    style={{ ...slotBtn("#fef2f2", "#dc2626", "#fca5a5", true) }}>× Remover</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Ações em lote */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", fontWeight: "var(--weight-semibold)", display: "block", marginBottom: "6px" }}>Aplicar a todas as sessões:</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <ActionBtn kind="confirm" onClick={() => onBulkStatus("confirmado")}><Check size={14} /> Confirmou tudo</ActionBtn>
          <ActionBtn kind="reject" onClick={() => onBulkStatus("recusado")}><X size={14} /> Recusou tudo</ActionBtn>
          <ActionBtn kind="neutral" onClick={() => onBulkStatus("inviavel")}><Ban size={14} /> Inviável</ActionBtn>
          <ActionBtn kind="cancel" onClick={onCancelar} title="Remove este lote da lista">Cancelar tudo</ActionBtn>
        </div>
      </div>

      {showVer && (
        <PacVerModal pac={bundle.pac} cRows={cRows} bundle={bundle} onClose={() => setShowVer(false)} />
      )}
    </RailCard>
  )
}

function PacVerModal({ pac, cRows, bundle, onClose }: {
  pac: string; cRows: CsvRow[]; bundle: AceitePacBundle; onClose: () => void
}) {
  const DIAS_UTIL = DIAS_LIST.slice(0, 5)
  const DIAS_ABR: Record<string, string> = {
    "Segunda-feira": "Segunda", "Terça-feira": "Terça", "Quarta-feira": "Quarta",
    "Quinta-feira": "Quinta", "Sexta-feira": "Sexta",
  }

  // Sessões existentes do paciente
  const existMap: Record<string, { tP: string; prof: string }[]> = {}
  for (const r of cRows) {
    if (String(r["Nome Favorecido"] ?? "") !== pac) continue
    if (String(r["Status do Agendamento"]) !== "Agendado") continue
    const h = String(r.HI_str ?? r["Hora Inicial"] ?? "").slice(0, 5)
    if (!h) continue
    const k = `${r["Dia da Semana"]}|||${h}`
    if (!existMap[k]) existMap[k] = []
    existMap[k].push({ tP: String(r["Terapia"] ?? ""), prof: String(r["Profissional"] ?? "") })
  }

  // Sessões do lote
  const slotStatus = bundle.slotStatus ?? {}
  const bundleMap: Record<string, { sessao: AceiteSessao; st: SlotStatus | "pendente" }> = {}
  for (const s of bundle.sessoes) {
    const k = `${s.dia}|||${s.hora}`
    bundleMap[k] = { sessao: s, st: (slotStatus[k] as SlotStatus) ?? "pendente" }
  }

  const activeHoras = HORAS_GRID.filter(h =>
    DIAS_UTIL.some(d => (existMap[`${d}|||${h}`]?.length ?? 0) > 0 || bundleMap[`${d}|||${h}`])
  )

  function cellBg(st: "exist" | "pendente" | SlotStatus) {
    if (st === "exist")      return "var(--muted)"
    if (st === "pendente")   return B.limeLt
    return SLOT_META[st].bg
  }
  function cellBd(st: "exist" | "pendente" | SlotStatus) {
    if (st === "exist")      return "var(--border)"
    if (st === "pendente")   return B.lime
    return SLOT_META[st].bd
  }
  function cellLabel(st: "pendente" | SlotStatus) {
    if (st === "pendente") return "Proposta"
    return SLOT_META[st].label
  }
  function cellLabelColor(st: "pendente" | SlotStatus) {
    if (st === "pendente") return "#4d7c0f"
    return SLOT_META[st].c
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.5)", padding: "12px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: "var(--card)", borderRadius: "var(--radius-xl)", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "880px", width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>

        {/* Cabeçalho */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: "var(--muted)", borderRadius: "var(--radius-xl) var(--radius-xl) 0 0" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "var(--weight-heavy)", fontSize: "var(--text-lg)", color: "var(--foreground)" }}>
              <CalendarDays size={16} /> {pac}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: "2px" }}>Agenda existente + propostas enviadas para acompanhamento</div>
            <div style={{ display: "flex", gap: "10px", marginTop: "6px", flexWrap: "wrap" }}>
              {([["exist", "Existente"], ["pendente", "Proposta"], ["confirmado", "Confirmou"], ["recusado", "Recusou"], ["inviavel", "Inviável"]] as [string, string][]).map(([k, lbl]) => (
                <span key={k} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
                  <span style={{ display: "inline-block", width: "9px", height: "9px", borderRadius: "2px", background: cellBg(k as any), border: `1px solid ${cellBd(k as any)}` }} />
                  {lbl}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "none", background: "var(--muted)", cursor: "pointer", color: "var(--muted-foreground)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={16} />
          </button>
        </div>

        {/* Grid */}
        <div style={{ overflow: "auto", padding: "16px" }}>
          {!activeHoras.length ? (
            <div style={{ textAlign: "center", color: "var(--muted-foreground)", padding: "32px" }}>Nenhuma sessão encontrada.</div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", minWidth: `${52 + DIAS_UTIL.length * 130}px` }}>
              <colgroup>
                <col style={{ width: "48px" }} />
                {DIAS_UTIL.map(d => <col key={d} style={{ width: "130px" }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ paddingBottom: "8px", textAlign: "right", paddingRight: "8px", fontSize: "var(--text-xs)", color: "var(--muted-foreground)", fontWeight: "var(--weight-regular)" }}>Hora</th>
                  {DIAS_UTIL.map(d => (
                    <th key={d} style={{ paddingBottom: "8px", textAlign: "center", fontSize: "var(--text-md)", color: "var(--foreground)", fontWeight: "var(--weight-heavy)" }}>
                      {DIAS_ABR[d] ?? d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeHoras.map(hora => (
                  <tr key={hora} style={{ borderTop: hora === "13:00" ? "2px solid var(--border)" : "1px solid var(--border)" }}>
                    <td style={{ textAlign: "right", paddingRight: "8px", verticalAlign: "top", paddingTop: "6px", fontFamily: "monospace", fontSize: "var(--text-sm)", fontWeight: "var(--weight-heavy)", color: "var(--foreground)" }}>{hora}</td>
                    {DIAS_UTIL.map(d => {
                      const k = `${d}|||${hora}`
                      const exists = existMap[k] ?? []
                      const bp = bundleMap[k]
                      return (
                        <td key={d} style={{ padding: "2px", verticalAlign: "top" }}>
                          {exists.map((e, i) => (
                            <div key={i} style={{ background: cellBg("exist"), border: `1px solid ${cellBd("exist")}`, borderRadius: "7px", padding: "4px 7px", marginBottom: "2px" }}>
                              <div title={e.tP} style={{ fontSize: "10px", fontWeight: 700, color: "var(--card-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.tP}</div>
                              <div title={e.prof} style={{ fontSize: "9px", color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtName(e.prof)}</div>
                            </div>
                          ))}
                          {bp && (
                            <div style={{ background: cellBg(bp.st), border: `1px solid ${cellBd(bp.st)}`, borderRadius: "7px", padding: "4px 7px" }}>
                              <div title={bp.sessao.tP} style={{ fontSize: "10px", fontWeight: 700, color: "var(--card-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bp.sessao.tP}</div>
                              <div title={bp.sessao.prof} style={{ fontSize: "9px", color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtName(bp.sessao.prof)}</div>
                              <div style={{ fontSize: "9px", fontWeight: 700, color: cellLabelColor(bp.st), marginTop: "2px" }}>{cellLabel(bp.st)}</div>
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function buildReadOnlyAnalise(entry: StatusEntry): AnaliseResult {
  const { estrategiaSel, opcaoSel = 0, opcao, movimentos, sessPac: sp = [], afetada } = entry
  const pacUnidade = afetada?.unidade && afetada.unidade !== "Desconhecida"
    ? afetada.unidade
    : (sp.find(s => s.unidade && s.unidade !== "Desconhecida")?.unidade ?? null)

  const simpleOpcoes: OpcaoEstrategia[] = opcao ? [opcao] : []
  const swapOpcoes: OpcaoSwap[] = movimentos?.length
    ? [{ movimentos, profissionaisAlterados: [] }]
    : []
  const diaOpcoes: OpcaoDiaMigracao[] = movimentos?.length
    ? [{ diaOrigem: movimentos[0].deDia, diaDestino: movimentos[0].paraDia, movimentos, profissionaisAlterados: [] }]
    : []

  const e1 = estrategiaSel === "e1" && simpleOpcoes.length ? { tipo: "e1" as const, label: "#1 Mesma terapia, mesmo horário", opcoes: simpleOpcoes } : null
  const e2 = estrategiaSel === "e2" && swapOpcoes.length ? { tipo: "e2" as const, label: "#2 Qt. de Terapias: mantido. Posições: alterado. Profissionais: mantido.", opcoes: swapOpcoes } : null
  const e3 = estrategiaSel === "e3" && simpleOpcoes.length ? { tipo: "e3" as const, label: "#3 Mesma terapia, horário adjacente", opcoes: simpleOpcoes } : null
  const e4 = estrategiaSel?.startsWith("e4_") && simpleOpcoes.length
    ? [{ tipo: "e4" as const, label: `#4 Outra terapia — ${opcao?.terapia ?? ""}`, esp: opcao?.terapia ?? "", opcoes: simpleOpcoes }]
    : []
  const e5 = estrategiaSel === "e5" && swapOpcoes.length ? { tipo: "e5" as const, label: "#5 Qt. de Terapias: mantido. Posições: alterado. Profissionais: alterado.", opcoes: swapOpcoes } : null
  const e6 = estrategiaSel === "e6" && diaOpcoes.length ? { tipo: "e6" as const, label: "#6 Alterar dia de tratamento, mesmos profissionais.", opcoes: diaOpcoes } : null
  const e7 = estrategiaSel === "e7" && diaOpcoes.length ? { tipo: "e7" as const, label: "#7 Alterar dia de tratamento, profissionais diferentes.", opcoes: diaOpcoes } : null

  return {
    sessPac: sp, sessDiaClin: [], buracoSiRemover: false, min2Violation: false,
    pacTurno: "manhã", pacUnidade, inconsistencias: [],
    e1, e2, e3, e4, e5, e6, e7, semSolucao: false,
  }
}

const E_LABELS_SAIDA: Record<string, string> = {
  e1: "E1 · Substituição Direta", e2: "E2 · Rearranjo Interno", e3: "E3 · Novo Horário",
  e4: "E4 · Autorização Pendente", e5: "E5 · Reposição Cruzada",
  e6: "E6 · Migração de Dia", e7: "E7 · Migração com Troca",
}
const E_TIPS_SAIDA: Record<string, string> = {
  e1: "Outro profissional assume a mesma terapia, no mesmo dia e horário. Sem mudança na rotina do paciente.",
  e2: "As sessões existentes do paciente são reposicionadas entre si — os terapeutas ficam, mas trocam de horário.",
  e3: "A terapia continua com outro profissional em dia/horário diferente, respeitando o turno e evitando lacunas.",
  e4: "O horário vago é preenchido com outra terapia que o paciente tem autorização pendente. A terapia perdida fica sem reposição.",
  e5: "Reposição cruzada possível, mas com troca de pelo menos um terapeuta existente. Risco de recusa pela família.",
  e6: "Todas as sessões do dia afetado migram para um novo dia, com os mesmos terapeutas.",
  e7: "Todas as sessões do dia afetado migram para um novo dia, mas pelo menos um terapeuta precisa ser trocado.",
}
const E_CORES_SAIDA: Record<string, string> = {
  e1: B.lime, e2: "#0ea5e9", e3: B.blue, e4: B.purple,
  e5: "#f97316", e6: "#8b5cf6", e7: "#ec4899",
}

function SaidaItem({
  pac, dia, hora, terapia, profRes, diaRes, horaRes, obs,
  estrategiaSel, opcao, movimentos, statusEntry,
  onConfirmar, onRecusar, onInviavel, onCancelar,
}: {
  pac: string; dia: string; hora: string; terapia: string
  profRes?: string; diaRes?: string; horaRes?: string; obs?: string
  estrategiaSel?: string | null
  opcao?: OpcaoEstrategia | null
  movimentos?: MovimentoSessao[] | null
  statusEntry?: StatusEntry
  onConfirmar: (obs?: string) => void
  onRecusar: (obs?: string) => void
  onInviavel: (obs: string) => void
  onCancelar: () => void
}) {
  const [showVer, setShowVer] = useState(false)
  const [dialog, setDialog] = useState<"confirmar" | "recusar" | "inviavel" | null>(null)
  const hasDetails = !!(estrategiaSel || opcao || statusEntry?.afetada)

  return (
    <>
    <RailCard color={ORIGEM_COLOR.saida}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", justifyContent: "space-between" }}>

        {/* Coluna de informação — badge + dados */}
        <div style={{ flex: 1, minWidth: "180px", display: "flex", flexDirection: "column", gap: "3px" }}>
          <div style={{ marginBottom: "3px" }}>
            <OriginTag icon={ORIGEM_ICON.saida} label="Saída de Profissional" color={ORIGEM_COLOR.saida} />
          </div>
          <div style={{ fontWeight: "var(--weight-heavy)", fontSize: "var(--text-base)", color: "var(--foreground)" }}>{pac}</div>
          <div style={{ fontSize: "var(--text-md)", color: "var(--muted-foreground)" }}>{terapia} · {dia} {hora}</div>
          {profRes && <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", color: "var(--foreground)" }}>→ {profRes} · {diaRes} {horaRes}</div>}
          {obs && <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", fontStyle: "italic" }}>"{obs}"</div>}
        </div>

        {/* Ações — todas lado a lado, mesmo padrão de Ocupação Paciente */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", flexShrink: 0 }}>
          {hasDetails && (
            <button onClick={() => setShowVer(true)} style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              fontSize: "var(--text-sm)", padding: "10px 14px", minHeight: "40px", borderRadius: "var(--radius-md)",
              background: "transparent", color: B.purple, border: `1px solid ${B.purple}44`,
              cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-semibold)",
            }}>
              <CalendarDays size={14} /> Ver detalhes
            </button>
          )}
          <ActionBtn kind="confirm" onClick={() => setDialog("confirmar")}><Check size={14} /> Confirmou</ActionBtn>
          <ActionBtn kind="reject" onClick={() => setDialog("recusar")}><X size={14} /> Recusou</ActionBtn>
          <ActionBtn kind="neutral" onClick={() => setDialog("inviavel")}><Ban size={14} /> Inviável</ActionBtn>
          <ActionBtn kind="cancel" onClick={onCancelar} title="Remove o item do acompanhamento">Cancelar</ActionBtn>
        </div>
      </div>
      {showVer && statusEntry?.afetada && (
        <SaidaCronModal
          pac={pac}
          afetada={statusEntry.afetada}
          analise={buildReadOnlyAnalise(statusEntry)}
          statusAtual={statusEntry}
          readOnly
          onClose={() => setShowVer(false)}
          onStatus={() => {}}
        />
      )}
      {showVer && !statusEntry?.afetada && (
        <SaidaVerModal pac={pac} dia={dia} hora={hora} terapia={terapia}
          estrategiaSel={estrategiaSel} opcao={opcao} movimentos={movimentos} obs={obs}
          onClose={() => setShowVer(false)} />
      )}
    </RailCard>

    {dialog === "confirmar" && (
      <ConfirmDialog
        title="Confirmar que aceitou?"
        obsLabel="Observação (opcional)"
        obsPlaceholder="Ex.: combinado por WhatsApp..."
        confirmLabel="Confirmou"
        confirmColor="#16a34a"
        onConfirm={(o) => { onConfirmar(o || undefined); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
    )}
    {dialog === "recusar" && (
      <ConfirmDialog
        title="Confirmar que recusou?"
        obsLabel="Observação (opcional)"
        obsPlaceholder="Ex.: não aceita mudança de horário..."
        confirmLabel="Recusou"
        confirmColor="#dc2626"
        onConfirm={(o) => { onRecusar(o || undefined); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
    )}
    {dialog === "inviavel" && (
      <ConfirmDialog
        title="Marcar como Inviável"
        obsLabel="Motivo"
        obsRequired
        obsPlaceholder="Descreva o motivo da inviabilidade..."
        confirmLabel="Confirmar Inviável"
        confirmColor="#b45309"
        onConfirm={(o) => { onInviavel(o); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
    )}
    </>
  )
}

function SaidaVerModal({ pac, dia, hora, terapia, estrategiaSel, opcao, movimentos, obs, onClose }: {
  pac: string; dia: string; hora: string; terapia: string
  estrategiaSel?: string | null
  opcao?: OpcaoEstrategia | null
  movimentos?: MovimentoSessao[] | null
  obs?: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const eColor = estrategiaSel ? (E_CORES_SAIDA[estrategiaSel] ?? B.purple) : B.purple
  const eLabel = estrategiaSel ? (E_LABELS_SAIDA[estrategiaSel] ?? estrategiaSel.toUpperCase()) : null
  const eTip   = estrategiaSel ? (E_TIPS_SAIDA[estrategiaSel] ?? null) : null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="saida-ver-title"
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.5)", padding: "16px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: "var(--card)", borderRadius: "var(--radius-xl)", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "520px", width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>

        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: "var(--muted)", borderRadius: "var(--radius-xl) var(--radius-xl) 0 0" }}>
          <div>
            <div id="saida-ver-title" style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "var(--weight-heavy)", fontSize: "var(--text-lg)", color: "var(--foreground)" }}>
              <CalendarDays size={16} /> {pac}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: "2px" }}>Detalhes da substituição</div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Fechar"
            style={{ width: "30px", height: "30px", borderRadius: "50%", border: "none", background: "var(--muted)", cursor: "pointer", color: "var(--muted-foreground)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>

          <div>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "6px" }}>Sessão afetada</div>
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "var(--radius-md)", padding: "10px 14px" }}>
              <div style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--text-md)", color: "#7f1d1d" }}>{terapia}</div>
              <div style={{ fontSize: "var(--text-sm)", color: "#991b1b", marginTop: "2px" }}>{dia} · {hora}</div>
            </div>
          </div>

          {eLabel && (
            <div>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "6px" }}>Estratégia selecionada</div>
              <div style={{ background: "var(--card)", border: `1px solid ${eColor}33`, borderRadius: "var(--radius-md)", padding: "10px 14px" }}>
                <span style={{ background: `${eColor}22`, color: eColor, borderRadius: "999px", padding: "2px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-black)" }}>{eLabel}</span>
                {eTip && <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginTop: "8px" }}>{eTip}</div>}
              </div>
            </div>
          )}

          {opcao && (
            <div>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "6px" }}>Solução adotada</div>
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "var(--radius-md)", padding: "10px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--text-md)", color: "#14532d" }}>{fmtName(opcao.prof)}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "#166534", marginTop: "2px" }}>{opcao.terapia} · {opcao.dia} {opcao.hora}</div>
                {opcao.unidade && <div style={{ fontSize: "var(--text-xs)", color: "#166534", marginTop: "2px" }}>{opcao.unidade}</div>}
              </div>
            </div>
          )}

          {movimentos && movimentos.length > 0 && (
            <div>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "6px" }}>Movimentos ({movimentos.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {movimentos.map((m, i) => (
                  <div key={i} style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: "var(--text-sm)" }}>
                    <div style={{ color: "var(--card-foreground)", fontWeight: "var(--weight-semibold)" }}>{m.deTerapia}</div>
                    <div style={{ color: "var(--muted-foreground)", marginTop: "2px" }}>
                      {m.deDia} {m.deHora} → {m.paraDia} {m.paraHora}
                      {m.profMudou && <span style={{ color: B.orange, fontWeight: "var(--weight-bold)", marginLeft: "6px" }}>· trocou prof</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {obs && (
            <div>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "6px" }}>Observação</div>
              <div style={{ background: "var(--muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 14px", fontSize: "var(--text-sm)", color: "var(--card-foreground)", fontStyle: "italic" }}>
                "{obs}"
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function OcupItem({
  pac, prof, dia, hora, esp, unidade, tP, conv,
  onAceito, onRecusado, onInviavel, onCancelar, onVer,
}: {
  pac: string; prof: string; dia: string; hora: string
  esp?: string; unidade?: string; tP?: string; conv?: string
  onAceito: () => void; onRecusado: () => void; onInviavel: () => void; onCancelar: () => void; onVer: () => void
}) {
  return (
    <RailCard color={ORIGEM_COLOR.ocupacao}>
      {/* Badge de origem */}
      <div style={{ marginBottom: "8px" }}>
        <OriginTag icon={ORIGEM_ICON.ocupacao} label="Ocupação Clínica" color={ORIGEM_COLOR.ocupacao} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: "var(--weight-heavy)", fontSize: "var(--text-base)", color: "var(--foreground)" }}>{pac}</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginTop: "2px" }}>
            {tP || esp || "—"} · {prof}
          </div>
          <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: "var(--foreground)", marginTop: "2px" }}>
            {dia} {hora}{unidade ? ` · ${unidade}` : ""}{conv ? ` · ${conv}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <button onClick={onVer} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "var(--text-sm)", padding: "10px 14px", minHeight: "40px", borderRadius: "var(--radius-md)", background: "transparent", color: B.blue, border: `1px solid ${B.blue}33`, cursor: "pointer", fontFamily: "inherit", fontWeight: "var(--weight-semibold)" }}>
            <CalendarDays size={14} /> Ver
          </button>
          <ActionBtn kind="confirm" onClick={onAceito}><Check size={14} /> Confirmou</ActionBtn>
          <ActionBtn kind="reject" onClick={onRecusado}><X size={14} /> Recusou</ActionBtn>
          <ActionBtn kind="neutral" onClick={onInviavel}><Ban size={14} /> Inviável</ActionBtn>
          <ActionBtn kind="cancel" onClick={onCancelar} title="Desfaz o aceite — volta como sugestão não trabalhada em Aumentar Ocupação (Clínica)">Cancelar</ActionBtn>
        </div>
      </div>
    </RailCard>
  )
}
