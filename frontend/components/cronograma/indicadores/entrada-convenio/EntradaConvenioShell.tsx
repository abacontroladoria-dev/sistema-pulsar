"use client"

// Painel de Entrada de Pacientes de Convênio (Leve, ASSIM, FUSEx) — aba
// /cronograma/indicadores?tab=entrada-convenio.
//
// Mostra a última rodada calculada pela tarefa agendada da Carol (calc.py, fluxo
// v4) e copiada do Doc do ClickUp pela Edge Function painel-entrada-convenio.
//
// A tela responde, nesta ordem: de quando são os dados (Frescor), quantos estão
// fora do prazo e onde (Manchete), e quem precisa agir em cada paciente (um
// bloco por setor, com as pessoas e a próxima ação). O que é consulta (avisos
// de registro, etapas do fluxo, concluídos, regras) fica recolhido no fim.
//
// Nada aqui recalcula prazo: se o número parecer errado, a correção é no
// registro do ClickUp (ou na tarefa da Carol), não nesta tela.

import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { AlertTriangle, Clock, FileWarning, Loader2, RefreshCw, Settings } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { usePainelEntradaConvenio } from "@/hooks/usePainelEntradaConvenio"
import {
  FILTRO_INICIAL,
  TODOS,
  blocosPorSetor,
  conveniosEmAndamento,
  fmtDataHora,
  manchete,
  mapaDisponibilidade,
  type FiltroPainel,
  type PacienteEntrada,
  type StatusFiltro,
} from "@/lib/indicadores/entradaConvenio"
import { BlocoSetor } from "./BlocoSetor"
import { Frescor } from "./Frescor"
import { Manchete } from "./Manchete"
import { PacienteEntradaDrawer } from "./PacienteEntradaDrawer"
import { PlacarSetores } from "./PlacarSetores"
import { PrazosDrawer } from "./PrazosDrawer"
import { AvisosDeRegistro, ComoEstaOFluxo, Regras } from "./Recolhidos"

const ROTULO_FILTRO_STATUS: Record<StatusFiltro, string> = {
  "atrasado": "atrasados",
  "vence hoje": "os que vencem hoje",
  "no prazo": "no prazo",
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function EntradaConvenioShell() {
  const { loading, erro, instalado, podeAtualizar, painel, atualizando, atualizar, recarregar } = usePainelEntradaConvenio()
  const { setRightContent } = useHeader()
  const [filtro, setFiltro] = useState<FiltroPainel>(FILTRO_INICIAL)
  const [aberto, setAberto] = useState<PacienteEntrada | null>(null)
  const [prazosAberto, setPrazosAberto] = useState(false)
  const temRodada = !!painel?.snapshot

  const disp = useMemo(() => mapaDisponibilidade(painel?.disponibilidade ?? []), [painel])
  const pacs = useMemo(() => painel?.snapshot?.dados.pacientes ?? [], [painel])
  const resumoManchete = useMemo(() => manchete(pacs), [pacs])
  const blocos = useMemo(() => blocosPorSetor(pacs, filtro), [pacs, filtro])
  const convenios = useMemo(() => conveniosEmAndamento(pacs), [pacs])

  useEffect(() => {
    setRightContent(
      <div className="flex flex-wrap items-center gap-2">
        {temRodada && (
          <button
            type="button"
            onClick={() => setPrazosAberto(true)}
            title="Prazos das etapas 0 a 7: mediana real, prazo atual e histórico"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            <Settings size={13} aria-hidden />
            Prazos
          </button>
        )}
        {podeAtualizar && (
          <button
            type="button"
            disabled={atualizando}
            onClick={async () => {
              const r = await atualizar()
              if (r.ok) toast.success(r.mensagem)
              else toast.error(r.mensagem)
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 dark:bg-sky-600 dark:hover:bg-sky-700"
          >
            <RefreshCw size={13} className={atualizando ? "animate-spin" : ""} aria-hidden />
            Atualizar agora
          </button>
        )}
      </div>,
    )
    return () => setRightContent(null)
  }, [temRodada, podeAtualizar, atualizando, atualizar, setRightContent])

  // Link com #setor-<slug> (mandado pelo gestor) rola até o bloco quando os dados chegam.
  const snapshotId = painel?.snapshot?.id
  useEffect(() => {
    if (snapshotId == null) return
    const hash = window.location.hash
    if (!hash.startsWith("#setor-")) return
    const t = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 50)
    return () => window.clearTimeout(t)
  }, [snapshotId])

  if (loading && !painel) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Carregando o painel de entrada...
      </div>
    )
  }
  if (erro) return <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{erro}</div>
  if (!instalado) {
    return (
      <InlineNotice tone="amber" icon={<AlertTriangle size={14} />}>
        O painel ainda não foi instalado no banco (migration 20261013100000_painel_entrada_convenio.sql pendente).
      </InlineNotice>
    )
  }
  if (!painel?.snapshot) {
    const l = painel?.ultima_leitura
    return (
      <div className="flex flex-col gap-3">
        <InlineNotice tone="blue" icon={<Clock size={14} />}>
          Ainda não há rodada copiada do ClickUp. O Pulsar lê o Doc pela manhã (7h55, 8h25 e 9h25) e à tarde (12h55, 13h25 e 13h55), de segunda a sexta
          {podeAtualizar ? ', ou na hora pelo botão "Atualizar agora"' : ""}.
        </InlineNotice>
        {l && (
          <InlineNotice tone={l.status === "erro" ? "red" : "slate"} icon={<FileWarning size={14} />}>
            Última tentativa em {fmtDataHora(l.lido_em)}: {l.erro ?? l.status}.
          </InlineNotice>
        )}
      </div>
    )
  }

  const d = painel.snapshot.dados
  const filtrando = filtro.status !== null || filtro.convenio !== TODOS

  return (
    <div className="flex flex-col gap-5">
      <Frescor painel={painel} />

      <Manchete
        m={resumoManchete}
        mediana={d.resumo.mediana_total_uteis}
        meta={d.resumo.meta_total_uteis}
        status={filtro.status}
        onStatus={status => setFiltro(f => ({ ...f, status }))}
      />

      <section aria-labelledby="entrada-quem-age" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="entrada-quem-age" className="text-base font-black text-foreground">Quem precisa agir</h2>
            <p className="text-xs text-muted-foreground">Cada setor responde pela etapa em que o paciente está. Toque no setor para ver a lista dele.</p>
          </div>
          {convenios.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Convênio:</span>
              <SegmentedTabs
                ariaLabel="Filtrar por convênio"
                value={filtro.convenio}
                onChange={convenio => setFiltro(f => ({ ...f, convenio }))}
                tabs={[{ value: TODOS, label: TODOS }, ...convenios.map(c => ({ value: c, label: c }))]}
              />
            </div>
          )}
        </div>

        {filtrando && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
            <span>
              Mostrando só{" "}
              <b>{[filtro.status && ROTULO_FILTRO_STATUS[filtro.status], filtro.convenio !== TODOS && filtro.convenio].filter(Boolean).join(" · ")}</b>
              {" "}({blocos.reduce((s, b) => s + b.total, 0)} de {resumoManchete.total} pacientes).
            </span>
            <button
              type="button"
              onClick={() => setFiltro(FILTRO_INICIAL)}
              className="min-h-11 font-semibold underline-offset-2 hover:underline sm:min-h-0"
            >
              Mostrar todos
            </button>
          </p>
        )}

        {blocos.length > 0 && <PlacarSetores blocos={blocos} />}

        {blocos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {filtrando ? "Nenhum paciente com esse filtro." : "Nenhum paciente em andamento."}
            {filtrando && (
              <button
                type="button"
                onClick={() => setFiltro(FILTRO_INICIAL)}
                className="min-h-11 rounded-lg px-3 text-xs font-semibold text-sky-700 hover:underline sm:min-h-0 dark:text-sky-400"
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {blocos.map(b => (
              <BlocoSetor key={b.slug} bloco={b} disp={disp} onAbrir={setAberto} />
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3">
        <AvisosDeRegistro pacs={d.pacientes} onAbrir={setAberto} />
        <ComoEstaOFluxo d={d} onAbrir={setAberto} />
        <Regras etapas={d.etapas} />
      </div>

      {prazosAberto && (
        <PrazosDrawer dados={d} onClose={() => setPrazosAberto(false)} onAlterado={() => void recarregar()} />
      )}

      {aberto && (
        <PacienteEntradaDrawer
          paciente={aberto}
          disp={disp.get(aberto.paciente)}
          etapas={d.etapas}
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  )
}
