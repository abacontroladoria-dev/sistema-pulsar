"use client"

import { useEffect, useMemo, useState } from "react"
import { DoorOpen, Eye, History, Loader2, Plus, Settings2, ShieldCheck } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { StatCard } from "@/components/cronograma/ui/StatCard"
import { useOcupacaoSalas } from "@/hooks/useOcupacaoSalas"
import { resumoOcupacaoDeItens } from "@/lib/cronograma/salas"
import { SalasFiltros, SALAS_FILTROS_VAZIO, aplicarFiltrosSala, salaTemProfissional, type SalasFiltrosState } from "@/components/cronograma/salas/SalasFiltros"
import { SalasGridView } from "@/components/cronograma/salas/SalasGridView"
import { SalasHeatmapView } from "@/components/cronograma/salas/SalasHeatmapView"
import { RegularizacoesView } from "@/components/cronograma/salas/RegularizacoesView"
import { SalaEditModal } from "@/components/cronograma/salas/SalaEditModal"
import { GerenciarCategoriasModal } from "@/components/cronograma/salas/GerenciarCategoriasModal"
import { ExclusividadeTerapiaModal } from "@/components/cronograma/salas/ExclusividadeTerapiaModal"
import { HistoricoAuditoriaModal } from "@/components/cronograma/salas/HistoricoAuditoriaModal"
import { DIAS_DISPONIVEIS_PADRAO, STATUS_SLOT_EXCLUIDO, type Sala, type SalaComOcupacao, type SlotOcupacaoSala } from "@/lib/cronograma/salasTypes"
import { DOW_PT } from "@/lib/cronograma/ocupacaoConst"

/** true se a sala segue o padrão Seg-Sex, dia inteiro (ou não tem `dias_disponiveis` cadastrado) — usado para separar a grade principal (largura fixa) de uma seção à parte para salas fora do padrão (ex.: só quarta e sábado, ou sábado meio período), sem alargar a tabela de ninguém. */
function seguePadraoSemanal(sala: Sala): boolean {
  const dias = sala.dias_disponiveis?.length ? sala.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO
  if (dias.length !== DIAS_DISPONIVEIS_PADRAO.length) return false
  return dias.every(d => {
    const padrao = DIAS_DISPONIVEIS_PADRAO.find(p => p.dow === d.dow)
    return !!padrao && d.turnos.length === 2 && d.turnos.includes("Manhã") && d.turnos.includes("Tarde")
  })
}

/** Agrupa salas fora do padrão pelo conjunto exato de DIAS que atendem (ignora diferença de turno dentro do dia — a célula de um turno ausente já aparece vazia sozinha) — cada grupo vira uma mini-tabela com só essas colunas (ex.: só Qua+Sáb), nunca a semana inteira. */
function agruparPorDiasDisponiveis(itens: SalaComOcupacao[]): { chave: string; dias: { dow: number; label: string }[]; itens: SalaComOcupacao[] }[] {
  const grupos = new Map<string, { dias: { dow: number; label: string }[]; itens: SalaComOcupacao[] }>()
  itens.forEach(item => {
    const dows = [...new Set((item.sala.dias_disponiveis?.length ? item.sala.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO).map(d => d.dow))].sort((a, b) => a - b)
    const chave = dows.join(",")
    if (!grupos.has(chave)) grupos.set(chave, { dias: dows.map(dow => ({ dow, label: DOW_PT[dow] ?? String(dow) })), itens: [] })
    grupos.get(chave)!.itens.push(item)
  })
  return [...grupos.entries()].map(([chave, g]) => ({ chave, ...g }))
}

type ViewTab = "grade" | "mapa" | "regularizacoes"

export default function OcupacaoSalasPage() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("Ocupação de Salas", "Cadastro estrutural de salas cruzado com a agenda real")
    return () => setHeader("", "")
  }, [setHeader])

  const { salas, alocacoes, linhas, turnosBloqueioAdmin, exclusividades, profissionaisTodos, terapiasTodas, salasComOcupacao, loading, error, recarregarSalas, recarregarAlocacoes, encontrarAlocacaoDoProfissional } = useOcupacaoSalas()

  const [tab, setTab] = useState<ViewTab>("grade")
  const [filtros, setFiltros] = useState<SalasFiltrosState>(SALAS_FILTROS_VAZIO)
  const [editando, setEditando] = useState<Sala | null | "novo">(null)
  const [isolada, setIsolada] = useState<{ id: string; nome: string } | null>(null)
  const [somenteInconsistentes, setSomenteInconsistentes] = useState(false)
  const [gerenciandoCategorias, setGerenciandoCategorias] = useState(false)
  const [gerenciandoExclusividade, setGerenciandoExclusividade] = useState(false)
  const [verHistorico, setVerHistorico] = useState(false)

  const unidades = useMemo(() => [...new Set(salasComOcupacao.map(s => s.sala.unidade_nome))].sort(), [salasComOcupacao])
  const nucleos = useMemo(() => [...new Set(salasComOcupacao.map(s => s.sala.nucleo).filter((n): n is string => !!n))].sort(), [salasComOcupacao])
  const andares = useMemo(() => [...new Set(salasComOcupacao.map(s => s.sala.andar).filter((n): n is string => !!n))].sort(), [salasComOcupacao])
  const salasComExclusividade = useMemo(() => new Set(exclusividades.map(e => e.sala_id)), [exclusividades])

  function alternarIsolarSala(salaId: string, nome: string) {
    setIsolada(prev => (prev?.id === salaId ? null : { id: salaId, nome }))
  }

  const filtradas = useMemo(() => {
    return salasComOcupacao
      .filter(item => (isolada ? item.sala.id === isolada.id : true))
      .filter(item => aplicarFiltrosSala(filtros, item.sala) && salaTemProfissional(item, filtros.profissional))
      .filter(item => !somenteInconsistentes || item.slots.some((s: SlotOcupacaoSala) => s.inconsistente || s.violaExclusividade))
      .filter(item => !filtros.comExclusividade || salasComExclusividade.has(item.sala.id))
      .map(item => {
        let slots = item.slots
        if (filtros.turno.length) slots = slots.filter((s: SlotOcupacaoSala) => filtros.turno.includes(s.turno))
        if (filtros.semSessao) slots = slots.filter((s: SlotOcupacaoSala) => s.alocacoes.some(a => a.semCruzamentoCsv))
        return { ...item, slots }
      })
      .filter(item => !filtros.semSessao || item.slots.length > 0)
  }, [salasComOcupacao, filtros, isolada, somenteInconsistentes, salasComExclusividade])

  // Salas com dias diferentes do padrão Seg-Sex (ex.: só quarta e sábado) não
  // entram na grade/mapa principal — iriam aparecer "furadas" nos dias que não
  // atendem, ou forçar uma coluna de sábado pra todas as outras salas. Ganham
  // uma seção própria abaixo, agrupada pelo conjunto exato de dias que usam.
  const filtradasPadrao = useMemo(() => filtradas.filter(item => seguePadraoSemanal(item.sala)), [filtradas])
  const gruposEspeciais = useMemo(() => agruparPorDiasDisponiveis(filtradas.filter(item => !seguePadraoSemanal(item.sala))), [filtradas])

  // Os 4 cards respondem aos filtros atuais (unidade/núcleo/andar/capacidade/
  // turno/status/profissional/isolada) — calculados sobre `filtradas`, a mesma
  // lista que já alimenta a Grade e o Mapa de calor. Antes usavam
  // salasComOcupacao/resumoUnidades (agregado de TODAS as unidades, sem
  // nenhuma relação com o filtro selecionado na tela).
  const totalSalas = filtradas.length
  const totalBloqueadas = filtradas.filter(s => s.sala.status === "bloqueada").length
  const resumoFiltrado = useMemo(() => resumoOcupacaoDeItens(filtradas), [filtradas])
  const totalInconsistencias = resumoFiltrado.inconsistencias

  // Ocupação REAL (granular, por sessão/bloco de 40min) do recorte filtrado —
  // mesmo critério de exclusão (STATUS_SLOT_EXCLUIDO) e mesma soma de
  // slot.blocos usados em calcularResumoUnidades (salas.ts), só que sobre
  // `filtradas` em vez de agrupado por unidade. Não usa resumoFiltrado.pct
  // (esse é o binário "sala tem alguém alocado", que é o que já aparece em
  // "Salas que contém profissional" na aba Ocupação Clínica).
  const pctGranularFiltrado = useMemo(() => {
    let blocosTotal = 0, blocosPreenchidos = 0
    filtradas.forEach(item => {
      item.slots.forEach(slot => {
        if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return
        blocosTotal += slot.blocos.length
        blocosPreenchidos += slot.blocos.filter(b => b.status === "preenchido").length
      })
    })
    return blocosTotal > 0 ? blocosPreenchidos / blocosTotal : null
  }, [filtradas])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard tone="slate" icon={<DoorOpen size={15} />} label="Salas cadastradas">
          <div className="text-2xl font-black text-foreground">{totalSalas}</div>
        </StatCard>
        <StatCard tone="blue" icon={<DoorOpen size={15} />} label="Ocupação real do filtro">
          <div className="text-2xl font-black text-foreground">{pctGranularFiltrado !== null ? `${Math.round(pctGranularFiltrado * 100)}%` : "—"}</div>
        </StatCard>
        <StatCard tone="red" icon={<DoorOpen size={15} />} label="Salas bloqueadas">
          <div className="text-2xl font-black text-foreground">{totalBloqueadas}</div>
        </StatCard>
        <button type="button" onClick={() => setSomenteInconsistentes(v => !v)} className="text-left" aria-pressed={somenteInconsistentes}>
          <StatCard tone="amber" icon={<DoorOpen size={15} />} label="Alocações inconsistentes" className={somenteInconsistentes ? "ring-2 ring-inset ring-amber-500" : ""}>
            <div className="text-2xl font-black text-foreground">{totalInconsistencias}</div>
          </StatCard>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          ariaLabel="Visão de ocupação de salas"
          tabs={[
            { value: "grade", label: "Grade" },
            { value: "mapa", label: "Mapa de calor" },
            { value: "regularizacoes", label: "Regularizações" },
          ]}
        />
        <div className="flex items-center gap-3">
          {isolada && (
            <button
              type="button"
              onClick={() => setIsolada(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
            >
              <Eye size={13} /> Mostrando só <strong className="font-semibold text-foreground">{isolada.nome}</strong> · voltar para todas
            </button>
          )}
          <button
            type="button"
            onClick={() => setVerHistorico(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            <History size={14} /> Histórico
          </button>
          <button
            type="button"
            onClick={() => setGerenciandoCategorias(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            <Settings2 size={14} /> Gerenciar categorias
          </button>
          <button
            type="button"
            onClick={() => setGerenciandoExclusividade(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            <ShieldCheck size={14} /> Exclusividade de salas com terapias
          </button>
          <button
            type="button"
            onClick={() => setEditando("novo")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
          >
            <Plus size={14} /> Nova sala
          </button>
        </div>
      </div>

      {tab !== "regularizacoes" && (
        <div className="sticky top-0 z-40 -mx-6 -mt-1 bg-background px-6 pt-1 pb-2 shadow-[0_1px_0_theme(colors.border)]">
          <SalasFiltros value={filtros} onChange={setFiltros} unidades={unidades} nucleos={nucleos} andares={andares} />
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando salas e agenda...
        </div>
      )}
      {error && <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>}

      {!loading && !error && tab === "grade" && (
        <>
          {filtradasPadrao.length === 0 && gruposEspeciais.length > 0 ? null : (
          <SalasGridView
            salas={filtradasPadrao}
            onEditarSala={id => setEditando(salasComOcupacao.find(s => s.sala.id === id)?.sala ?? null)}
            onIsolarSala={alternarIsolarSala}
            salaIsoladaId={isolada?.id ?? null}
            encontrarAlocacaoDoProfissional={encontrarAlocacaoDoProfissional}
            onRecarregar={recarregarAlocacoes}
            buscaProfissional={filtros.profissional}
            salasComExclusividade={salasComExclusividade}
            salasTodas={salas}
            exclusividades={exclusividades}
            profissionaisTodos={profissionaisTodos}
            terapiasTodas={terapiasTodas}
          />
          )}
          {gruposEspeciais.map(grupo => (
            <div key={grupo.chave} className="flex flex-col gap-2">
              <h3 className="text-xs font-bold uppercase text-muted-foreground">
                Salas com dias diferenciados ({grupo.dias.map(d => d.label).join(" + ")})
              </h3>
              <SalasGridView
                salas={grupo.itens}
                dias={grupo.dias}
                onEditarSala={id => setEditando(salasComOcupacao.find(s => s.sala.id === id)?.sala ?? null)}
                onIsolarSala={alternarIsolarSala}
                salaIsoladaId={isolada?.id ?? null}
                encontrarAlocacaoDoProfissional={encontrarAlocacaoDoProfissional}
                onRecarregar={recarregarAlocacoes}
                buscaProfissional={filtros.profissional}
                salasComExclusividade={salasComExclusividade}
                salasTodas={salas}
                exclusividades={exclusividades}
                profissionaisTodos={profissionaisTodos}
                terapiasTodas={terapiasTodas}
              />
            </div>
          ))}
        </>
      )}
      {!loading && !error && tab === "mapa" && (
        <>
          {filtradasPadrao.length === 0 && gruposEspeciais.length > 0 ? null : (
          <SalasHeatmapView salas={filtradasPadrao} onIsolarSala={alternarIsolarSala} salaIsoladaId={isolada?.id ?? null} salasComExclusividade={salasComExclusividade} />
          )}
          {gruposEspeciais.map(grupo => (
            <div key={grupo.chave} className="flex flex-col gap-2">
              <h3 className="text-xs font-bold uppercase text-muted-foreground">
                Salas com dias diferenciados ({grupo.dias.map(d => d.label).join(" + ")})
              </h3>
              <SalasHeatmapView salas={grupo.itens} dias={grupo.dias} onIsolarSala={alternarIsolarSala} salaIsoladaId={isolada?.id ?? null} salasComExclusividade={salasComExclusividade} />
            </div>
          ))}
        </>
      )}
      {!loading && !error && tab === "regularizacoes" && (
        <RegularizacoesView
          alocacoes={alocacoes}
          linhas={linhas}
          turnosBloqueioAdmin={turnosBloqueioAdmin}
          onVerNaGrade={nome => {
            setFiltros(f => ({ ...f, profissional: nome }))
            setTab("grade")
          }}
        />
      )}

      {editando && (
        <SalaEditModal
          sala={editando === "novo" ? null : editando}
          todasSalas={salas}
          onClose={() => setEditando(null)}
          onSaved={recarregarSalas}
        />
      )}

      {gerenciandoCategorias && (
        <GerenciarCategoriasModal
          onClose={() => setGerenciandoCategorias(false)}
          onChanged={recarregarSalas}
        />
      )}

      {gerenciandoExclusividade && (
        <ExclusividadeTerapiaModal
          onClose={() => setGerenciandoExclusividade(false)}
          onChanged={recarregarSalas}
        />
      )}

      {verHistorico && <HistoricoAuditoriaModal onClose={() => setVerHistorico(false)} />}
    </div>
  )
}
