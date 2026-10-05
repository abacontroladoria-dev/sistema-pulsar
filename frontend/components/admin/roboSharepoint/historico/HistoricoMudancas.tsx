'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileMinus2, FilePlus2, History, Loader2, Lock, Timer, Undo2 } from 'lucide-react'
import { DateRangePicker, type AtalhoPeriodo } from '@/components/ui/date-range-picker'
import { MultiSearchCombobox } from '@/components/cronograma/ui/MultiSearchCombobox'
import { SegmentedTabs } from '@/components/cronograma/ui/SegmentedTabs'
import { TONE_CHIP } from '@/components/ui/tones'
import { dataHora, numero } from '@/lib/roboSharepoint/rotulos'
import { listarEventosEvidencias, obterHistoricoEvidencias } from '@/services/roboSharepoint.service'
import type { EventoEvidencia, EventoEvidenciaTipo, HistoricoEvidencias } from '@/types/roboSharepoint'
import { CartaoEvento } from './CartaoEvento'
import { GraficoMudancas, LegendaMudancas } from './GraficoMudancas'

// "Histórico de mudanças" (/admin/robo-sharepoint, pedido de 02/10/2026): o
// que mudou nas evidências do SharePoint — apareceu, sumiu, voltou, mudou de
// nome ou de pasta — e o que isso fez com as entregas, por dia ou por mês.
// O retrato do que está na pasta fica na tela Entregas PEP; aqui é o filme.
// Dados: sp_pep_evidencias_historico e sp_pep_retrato_diario (20261003100000).

type Grao = 'dia' | 'mes'
type FiltroEvento = 'todos' | 'sairam' | 'retiradas' | 'entraram' | 'mudaram'

const FILTROS: Record<FiltroEvento, { rotulo: string; eventos: EventoEvidenciaTipo[] }> = {
  todos: { rotulo: 'Tudo', eventos: [] },
  sairam: { rotulo: 'Saíram', eventos: ['sumiu', 'deixou_de_ser_evidencia'] },
  retiradas: { rotulo: 'Entregas retiradas', eventos: ['entrega_desfeita', 'mes_liberado_mantido'] },
  entraram: { rotulo: 'Entraram', eventos: ['apareceu', 'voltou'] },
  mudaram: { rotulo: 'Nome ou pasta', eventos: ['renomeou', 'moveu', 'saiu_do_padrao'] },
}

const TAMANHO = 15

/** 'AAAA-MM-DD' de hoje em Brasília. */
const hojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const somarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
const inicioDoMes = (iso: string, mesesAtras: number) => {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - mesesAtras)
  return d.toISOString().slice(0, 10)
}
const periodoPadrao = (grao: Grao) => {
  const hoje = hojeBR()
  return grao === 'mes' ? { inicio: inicioDoMes(hoje, 11), fim: hoje } : { inicio: somarDias(hoje, -29), fim: hoje }
}

const ATALHOS: AtalhoPeriodo[] = [
  { rotulo: 'Últimos 7 dias', intervalo: () => ({ inicio: somarDias(hojeBR(), -6), fim: hojeBR() }) },
  { rotulo: 'Últimos 30 dias', intervalo: () => ({ inicio: somarDias(hojeBR(), -29), fim: hojeBR() }) },
  { rotulo: 'Este mês', intervalo: () => ({ inicio: inicioDoMes(hojeBR(), 0), fim: hojeBR() }) },
  { rotulo: 'Últimos 12 meses', intervalo: () => ({ inicio: inicioDoMes(hojeBR(), 11), fim: hojeBR() }) },
]

function Total({ icone: Icone, tom, valor, rotulo, sub }: { icone: typeof History; tom: keyof typeof TONE_CHIP; valor: number; rotulo: string; sub?: string }) {
  const t = TONE_CHIP[tom]
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.text}`}><Icone className="h-5 w-5" aria-hidden /></span>
      <span className="min-w-0">
        <span className="block text-2xl font-black leading-none tabular-nums text-foreground">{numero(valor)}</span>
        <span className="mt-1 block text-xs font-semibold leading-tight text-muted-foreground">{rotulo}</span>
        {sub && <span className="block text-[11px] leading-tight text-muted-foreground/80">{sub}</span>}
      </span>
    </div>
  )
}

/** `tituloId`: quem embrulha a seção num recolhível já mostra título e
 *  descrição no botão — passa o id dele e o cabeçalho daqui não se repete. */
export function HistoricoMudancas({ tituloId }: { tituloId?: string } = {}) {
  const [grao, setGrao] = useState<Grao>('dia')
  const [periodo, setPeriodo] = useState(() => periodoPadrao('dia'))
  const [prestadores, setPrestadores] = useState<Set<string>>(new Set())
  const [filtro, setFiltro] = useState<FiltroEvento>('todos')
  const [pagina, setPagina] = useState(0)

  // undefined = carregando; null = migration pendente.
  const [historico, setHistorico] = useState<HistoricoEvidencias | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [lista, setLista] = useState<{ eventos: EventoEvidencia[]; total: number } | null>(null)
  const [carregandoLista, setCarregandoLista] = useState(true)

  const selecionados = useMemo(() => [...prestadores].sort(), [prestadores])
  const chaveSel = selecionados.join('|')

  useEffect(() => {
    let vivo = true
    obterHistoricoEvidencias({ de: periodo.inicio, ate: periodo.fim, grao, prestadores: selecionados })
      .then(h => { if (vivo) { setHistorico(h); setErro(null) } })
      .catch(e => { if (vivo) { setErro(e instanceof Error ? e.message : 'Não foi possível carregar o histórico'); setHistorico(null) } })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chaveSel representa `selecionados`
  }, [periodo.inicio, periodo.fim, grao, chaveSel])

  useEffect(() => {
    let vivo = true
    const id = setTimeout(async () => {
      setCarregandoLista(true)
      try {
        const r = await listarEventosEvidencias({
          de: periodo.inicio, ate: periodo.fim, eventos: FILTROS[filtro].eventos, prestadores: selecionados, pagina, tamanho: TAMANHO,
        })
        if (vivo) setLista(r ?? { eventos: [], total: 0 })
      } catch (e) {
        if (vivo) { setErro(e instanceof Error ? e.message : 'Não foi possível carregar a lista'); setLista({ eventos: [], total: 0 }) }
      } finally {
        if (vivo) setCarregandoLista(false)
      }
    }, 0)
    return () => { vivo = false; clearTimeout(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chaveSel representa `selecionados`
  }, [periodo.inicio, periodo.fim, filtro, chaveSel, pagina])

  const mudarGrao = (g: Grao) => { setGrao(g); setPeriodo(periodoPadrao(g)); setPagina(0) }
  const opcoesPrestador = useMemo(() => (historico?.prestadores ?? []).map(n => ({ id: n, nome: n })), [historico?.prestadores])
  const totais = historico?.totais
  const paginas = Math.max(1, Math.ceil((lista?.total ?? 0) / TAMANHO))

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6" aria-labelledby={tituloId ?? 'titulo-historico-mudancas'}>
      {!tituloId && (
      <div className="mb-4 flex flex-col gap-1">
        <h2 id="titulo-historico-mudancas" className="flex items-center gap-2 text-base font-bold text-slate-800">
          <History className="h-4 w-4 text-brand-fg" aria-hidden /> Histórico de mudanças nas evidências
        </h2>
        <p className="text-xs text-slate-500">
          O que entrou, saiu, voltou ou mudou de nome nas pastas dos itens do PEP — e o que isso fez com as entregas.
          O que está na pasta agora fica na tela Entregas PEP.
        </p>
      </div>
      )}

      {historico === null && !erro && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          O histórico começa quando a atualização de 03/10/2026 (migration 20261003100000) for aplicada no banco.
        </p>
      )}
      {erro && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{erro}</p>}

      {historico !== null && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <SegmentedTabs<Grao> value={grao} onChange={mudarGrao} ariaLabel="Agrupar por"
              tabs={[{ value: 'dia', label: 'Por dia' }, { value: 'mes', label: 'Por mês' }]} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <DateRangePicker inicio={periodo.inicio} fim={periodo.fim} atalhos={ATALHOS} padrao={() => periodoPadrao(grao)} align="end"
                onChange={p => { setPeriodo(p); setPagina(0) }} />
              <div className="sm:w-64">
                <MultiSearchCombobox<string>
                  opcoes={opcoesPrestador}
                  selecionados={prestadores}
                  onToggle={id => { setPrestadores(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }); setPagina(0) }}
                  onDesmarcarTodos={() => { setPrestadores(new Set()); setPagina(0) }}
                  placeholder="Todos os prestadores"
                  ariaLabel="Filtrar por prestador"
                  nomePlural="prestadores"
                  adjetivoResumo="selecionados"
                />
              </div>
            </div>
          </div>

          {historico === undefined ? (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Carregando o histórico…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                <Total icone={FilePlus2} tom="green" valor={(totais?.apareceram ?? 0) + (totais?.voltaram ?? 0)} rotulo="entraram"
                  sub={totais?.voltaram ? `${numero(totais.voltaram)} voltaram depois de apagadas` : undefined} />
                <Total icone={FileMinus2} tom="red" valor={totais?.sumiram ?? 0} rotulo="saíram"
                  sub={totais?.sumiram_depois_de_entregues ? `${numero(totais.sumiram_depois_de_entregues)} já eram entrega` : undefined} />
                <Total icone={Timer} tom="amber" valor={totais?.sumiram_em_ate_7_dias ?? 0} rotulo="saíram em até 7 dias" sub="entraram e foram apagadas rápido" />
                <Total icone={Undo2} tom="red" valor={totais?.entregas_desfeitas ?? 0} rotulo="entregas retiradas" sub="a entrega acompanhou a pasta" />
                <Total icone={Lock} tom="gray" valor={totais?.mantidas_mes_liberado ?? 0} rotulo="mantidas (mês liberado)" sub="o mês liberado não muda" />
              </div>

              <div>
                <GraficoMudancas serie={historico.serie} grao={grao} />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <LegendaMudancas />
                  {historico.primeiro_retrato && (
                    <span className="text-[11px] text-muted-foreground">histórico desde {dataHora(`${historico.primeiro_retrato}T12:00:00Z`).slice(0, 5)}</span>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SegmentedTabs<FiltroEvento> value={filtro} onChange={f => { setFiltro(f); setPagina(0) }} ariaLabel="Que mudanças mostrar"
                tabs={(Object.keys(FILTROS) as FiltroEvento[]).map(k => ({ value: k, label: FILTROS[k].rotulo }))} />
              <span className="text-xs text-muted-foreground" aria-live="polite">{numero(lista?.total ?? 0)} registro(s)</span>
            </div>

            {!lista && carregandoLista && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
            {lista && lista.eventos.length === 0 && !carregandoLista && (
              <p className="rounded-xl border border-border px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma mudança neste período.</p>
            )}
            <ul className={`space-y-2 transition-opacity ${carregandoLista && lista ? 'opacity-50' : ''}`} aria-busy={carregandoLista}>
              {lista?.eventos.map(e => <li key={e.id}><CartaoEvento e={e} /></li>)}
            </ul>

            {paginas > 1 && (
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>página {pagina + 1} de {paginas}</span>
                <div className="flex gap-1.5">
                  <button type="button" disabled={pagina === 0 || carregandoLista} onClick={() => setPagina(p => p - 1)}
                    className="inline-flex h-11 items-center gap-1 rounded-lg border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-muted disabled:opacity-40">
                    <ChevronLeft className="h-4 w-4" aria-hidden /> Anterior
                  </button>
                  <button type="button" disabled={pagina + 1 >= paginas || carregandoLista} onClick={() => setPagina(p => p + 1)}
                    className="inline-flex h-11 items-center gap-1 rounded-lg border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-muted disabled:opacity-40">
                    Próxima <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
