"use client"

// ExclusividadeTerapiaModal — CRUD de "sala exclusiva de terapia" (pedido do
// usuário, 2026-08-11), com DUAS abas pra separar as duas direções da regra
// (pedido explícito do usuário, 2026-08-11 — a versão anterior misturava as
// duas numa lista só e confundia):
//
// "Por Salas"   — sala → terapias: aqui você diz quais terapias uma sala
//                 comporta. Uma sala com QUALQUER terapia marcada aqui SÓ
//                 aceita as terapias marcadas — nenhuma outra pode ser
//                 alocada nela, sempre, sem exceção.
// "Por Terapias" — terapia → modo: aqui você diz se essa terapia só pode
//                 usar as salas que a comportam ('obrigatoria') ou se
//                 prioriza essas salas mas pode cair em qualquer sala
//                 não-reservada por outra terapia ('preferencial'). Não
//                 controla QUAIS salas — isso é a aba "Por Salas".
//
// Essa exclusividade é lida direto por encontrarSalaLivre em
// sugestaoContratacao.ts (recomendação em Solicitações › Simulação) e por
// verificarExclusividade em AlocarSessaoModal.tsx (alocação manual na Grade).

import { useEffect, useMemo, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import {
  listarSalas, listarExclusividadesTerapia, criarExclusividadeTerapia,
  atualizarModoExclusividadeTerapia, excluirExclusividadeTerapia,
} from "@/services/salas.service"
import { TERAPIA_ID } from "@/lib/cronograma/constants"
import { MODO_TERAPIA_FIXO } from "@/lib/cronograma/exclusividadeTerapia"
import type { Sala, SalaTerapiaExclusiva, ModoExclusividadeTerapia } from "@/lib/cronograma/salasTypes"

interface Props {
  onClose: () => void
  /** Chamado sempre que algo muda — quem abriu o modal (a grade de ocupação e a simulação de contratação) deve recarregar suas próprias listas dependentes. */
  onChanged: () => void
}

// "OFERECER CONSULTA NUTRIÇÃO" é uma terapia interna/administrativa — não
// deve aparecer como opção de exclusividade de sala (pedido do usuário).
const TERAPIAS_OCULTAS = new Set(["OFERECER CONSULTA NUTRIÇÃO"])

const TERAPIAS_OPCOES = Object.entries(TERAPIA_ID)
  .filter(([nome]) => !TERAPIAS_OCULTAS.has(nome))
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([nome, id]) => ({ nome, id }))

const MODO_LABEL: Record<ModoExclusividadeTerapia, string> = { obrigatoria: "Obrigatória", preferencial: "Preferencial" }

export function ExclusividadeTerapiaModal({ onClose, onChanged }: Props) {
  const [tab, setTab] = useState<"salas" | "terapias">("salas")
  const [salas, setSalas] = useState<Sala[]>([])
  const [linhas, setLinhas] = useState<SalaTerapiaExclusiva[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function carregar() {
    setLoading(true)
    setError(null)
    Promise.all([listarSalas(), listarExclusividadesTerapia()])
      .then(([s, l]) => { setSalas(s); setLinhas(l) })
      .catch(e => setError(e instanceof Error ? e.message : "Erro ao carregar."))
      .finally(() => setLoading(false))
  }

  useEffect(carregar, [])

  function recarregar() {
    carregar()
    onChanged()
  }

  return (
    <ScheduleModal
      title="Exclusividade de salas com terapias"
      subtitle="Uma sala marcada com terapias SÓ aceita essas terapias — nenhuma outra entra nela. O modo (aba Por Terapias) só diz se a terapia pode ou não usar outras salas além das reservadas pra ela."
      maxWidth={680}
      onClose={onClose}
    >
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        ariaLabel="Direção da regra de exclusividade"
        tabs={[
          { value: "salas", label: "Por Salas" },
          { value: "terapias", label: "Por Terapias" },
        ]}
      />
      <div className="mt-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Carregando...
          </div>
        )}
        {!loading && tab === "salas" && <PorSalasTab salas={salas} linhas={linhas} onChanged={recarregar} />}
        {!loading && tab === "terapias" && <PorTerapiasTab salas={salas} linhas={linhas} onChanged={recarregar} />}
        {error && <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</div>}
      </div>
    </ScheduleModal>
  )
}

interface TabProps {
  salas: Sala[]
  linhas: SalaTerapiaExclusiva[]
  onChanged: () => void
}

/** "Por Salas" — escolhe uma sala e marca quais terapias ela comporta. Salvar
 *  reconcilia (cria as marcadas que faltam, remove as desmarcadas que existiam). */
function PorSalasTab({ salas, linhas, onChanged }: TabProps) {
  const [salaId, setSalaId] = useState("")
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const salaPorId = useMemo(() => new Map(salas.map(s => [s.id, s])), [salas])
  const linhasPorSala = useMemo(() => {
    const m = new Map<string, SalaTerapiaExclusiva[]>()
    for (const l of linhas) {
      if (!m.has(l.sala_id)) m.set(l.sala_id, [])
      m.get(l.sala_id)!.push(l)
    }
    return m
  }, [linhas])

  const labelDaSala = (s: Sala) => `${s.unidade_nome} · ${s.nome_exibicao}`
  const salaPorLabel = useMemo(() => new Map(salas.map(s => [labelDaSala(s), s])), [salas])
  const opcoesSala = useMemo(() => salas.map(labelDaSala).sort(), [salas])
  const salaAtual = salaId ? salaPorId.get(salaId) : undefined
  const salaLabelAtual = salaAtual ? labelDaSala(salaAtual) : ""

  // Ao trocar a sala escolhida, o checklist reflete o que já está cadastrado pra ela.
  useEffect(() => {
    setSelecionadas(new Set((linhasPorSala.get(salaId) ?? []).map(l => l.terapia_id)))
  }, [salaId, linhasPorSala])

  function alternar(id: number) {
    setSelecionadas(prev => {
      const proximo = new Set(prev)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  // Modo padrão pra uma terapia nova nesta sala: reaproveita o modo já usado
  // em qualquer outra sala pra essa mesma terapia (consistência — modo é
  // conceitualmente da terapia, não da sala), senão a regra fixa de negócio,
  // senão obrigatória.
  function modoPadraoPara(terapiaId: number): ModoExclusividadeTerapia {
    return linhas.find(l => l.terapia_id === terapiaId)?.modo ?? MODO_TERAPIA_FIXO[terapiaId] ?? "obrigatoria"
  }

  async function handleSalvar() {
    if (!salaId) return
    setSalvando(true)
    setError(null)
    try {
      const atuais = linhasPorSala.get(salaId) ?? []
      const atuaisIds = new Set(atuais.map(l => l.terapia_id))
      const paraAdicionar = [...selecionadas].filter(id => !atuaisIds.has(id))
      const paraRemover = atuais.filter(l => !selecionadas.has(l.terapia_id))

      for (const terapiaId of paraAdicionar) {
        const terapia = TERAPIAS_OPCOES.find(t => t.id === terapiaId)
        if (!terapia) continue
        await criarExclusividadeTerapia({ sala_id: salaId, terapia_id: terapiaId, terapia_nome: terapia.nome, modo: modoPadraoPara(terapiaId) })
      }
      for (const linha of paraRemover) {
        await excluirExclusividadeTerapia(linha.id)
      }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.")
    } finally {
      setSalvando(false)
    }
  }

  const salasComRegra = useMemo(
    () => [...linhasPorSala.keys()]
      .map(id => salaPorId.get(id))
      .filter((s): s is Sala => !!s)
      .sort((a, b) => a.unidade_nome.localeCompare(b.unidade_nome) || a.nome_exibicao.localeCompare(b.nome_exibicao)),
    [linhasPorSala, salaPorId],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <span className="text-xs font-semibold text-muted-foreground">Escolha a sala e marque quais terapias ela comporta</span>
        <SearchCombobox
          value={salaLabelAtual}
          onChange={label => setSalaId(salaPorLabel.get(label)?.id ?? "")}
          opcoes={opcoesSala}
          placeholder="Digite para buscar a sala..."
          ariaLabel="Sala"
        />

        {salaId && (
          <>
            <MultiSearchCombobox
              opcoes={TERAPIAS_OPCOES}
              selecionados={selecionadas}
              onToggle={alternar}
              placeholder="Nenhuma terapia selecionada"
              nomePlural="terapias"
              ariaLabel="Terapias que esta sala comporta"
            />
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 self-end rounded-lg bg-[#2B5E86] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#24506F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
            </button>
          </>
        )}
      </div>

      {salasComRegra.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Salas com regra cadastrada</span>
          {salasComRegra.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSalaId(s.id)}
              className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-sm hover:bg-muted/50"
            >
              <span className="font-semibold text-foreground">{s.unidade_nome} · {s.nome_exibicao}</span>
              <span className="truncate text-muted-foreground">— só comporta: {(linhasPorSala.get(s.id) ?? []).map(l => l.terapia_nome).sort().join(", ")}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  )
}

/** "Por Terapias" — escolhe uma terapia e diz se ela é obrigatória ou
 *  preferencial nas salas que já a comportam (as salas em si são definidas
 *  na aba "Por Salas" — aqui só o modo). Muda o modo de TODAS as linhas
 *  dessa terapia de uma vez, já que modo é conceitualmente da terapia. */
function PorTerapiasTab({ salas, linhas, onChanged }: TabProps) {
  const [terapiaId, setTerapiaId] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const salaPorId = useMemo(() => new Map(salas.map(s => [s.id, s])), [salas])
  const linhasPorTerapia = useMemo(() => {
    const m = new Map<number, SalaTerapiaExclusiva[]>()
    for (const l of linhas) {
      if (!m.has(l.terapia_id)) m.set(l.terapia_id, [])
      m.get(l.terapia_id)!.push(l)
    }
    return m
  }, [linhas])

  const opcoesTerapia = useMemo(() => TERAPIAS_OPCOES.map(t => t.nome), [])
  const idPorNomeTerapia = useMemo(() => new Map(TERAPIAS_OPCOES.map(t => [t.nome, t.id])), [])
  const nomeTerapiaAtual = terapiaId ? (TERAPIAS_OPCOES.find(t => String(t.id) === terapiaId)?.nome ?? "") : ""

  const idNum = terapiaId ? Number(terapiaId) : null
  const linhasDaTerapia = idNum !== null ? (linhasPorTerapia.get(idNum) ?? []) : []
  const modoFixo = idNum !== null ? MODO_TERAPIA_FIXO[idNum] : undefined
  const modoAtual: ModoExclusividadeTerapia = linhasDaTerapia[0]?.modo ?? modoFixo ?? "obrigatoria"

  async function handleEscolherModo(modo: ModoExclusividadeTerapia) {
    if (!linhasDaTerapia.length || modoFixo) return
    setSalvando(true)
    setError(null)
    try {
      for (const linha of linhasDaTerapia) {
        if (linha.modo !== modo) await atualizarModoExclusividadeTerapia(linha.id, modo)
      }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar modo.")
    } finally {
      setSalvando(false)
    }
  }

  const terapiasComRegra = useMemo(
    () => [...linhasPorTerapia.keys()].map(id => TERAPIAS_OPCOES.find(t => t.id === id)).filter((t): t is (typeof TERAPIAS_OPCOES)[number] => !!t),
    [linhasPorTerapia],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <span className="text-xs font-semibold text-muted-foreground">Escolha a terapia</span>
        <SearchCombobox
          value={nomeTerapiaAtual}
          onChange={nome => setTerapiaId(nome ? String(idPorNomeTerapia.get(nome) ?? "") : "")}
          opcoes={opcoesTerapia}
          placeholder="Digite para buscar a terapia..."
          ariaLabel="Terapia"
        />

        {idNum !== null && !linhasDaTerapia.length && (
          <div className="text-xs text-muted-foreground">
            Esta terapia ainda não está cadastrada em nenhuma sala — cadastre pelo menos uma na aba "Por Salas" antes de definir o modo.
          </div>
        )}

        {idNum !== null && linhasDaTerapia.length > 0 && (
          <>
            <div className="text-xs text-muted-foreground">
              Salas reservadas pra esta terapia: {linhasDaTerapia
                .map(l => { const s = salaPorId.get(l.sala_id); return s ? `${s.unidade_nome} · ${s.nome_exibicao}` : "sala removida" })
                .sort()
                .join(", ")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2 text-xs text-foreground">
                <input
                  type="radio" name="modo" className="mt-0.5"
                  checked={modoAtual === "obrigatoria"} disabled={!!modoFixo || salvando}
                  onChange={() => handleEscolherModo("obrigatoria")}
                />
                <span><strong>{MODO_LABEL.obrigatoria}</strong> — só pode ser alocada nas salas reservadas acima, nunca em outra.</span>
              </label>
              <label className="flex items-start gap-2 text-xs text-foreground">
                <input
                  type="radio" name="modo" className="mt-0.5"
                  checked={modoAtual === "preferencial"} disabled={!!modoFixo || salvando}
                  onChange={() => handleEscolherModo("preferencial")}
                />
                <span><strong>{MODO_LABEL.preferencial}</strong> — prioriza as salas reservadas acima, mas pode ir a qualquer outra sala que não seja reservada por outra terapia.</span>
              </label>
            </div>
            {modoFixo && (
              <div className="text-[11px] text-muted-foreground">Modo fixo por regra de negócio — não editável pra esta terapia.</div>
            )}
          </>
        )}
      </div>

      {terapiasComRegra.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Terapias com regra cadastrada</span>
          {terapiasComRegra.map(t => {
            const modo = linhasPorTerapia.get(t.id)![0].modo
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTerapiaId(String(t.id))}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-semibold text-foreground">{t.nome}</span>
                <span className="text-muted-foreground">{MODO_LABEL[modo]}</span>
              </button>
            )
          })}
        </div>
      )}

      {error && <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  )
}
