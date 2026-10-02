'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Target } from 'lucide-react'
import { MultiSearchCombobox } from '@/components/cronograma/ui/MultiSearchCombobox'
import { SegmentedTabs } from '@/components/cronograma/ui/SegmentedTabs'
import { rotuloMes } from '@/lib/roboSharepoint/relatorioPrestador'
import { nomeCurtoPrestador, numero } from '@/lib/roboSharepoint/rotulos'
import {
  esperadasDoAno, esperadasPorEntrega, evidenciasEsperadasPorAnalista,
  type DadosAno, type DadosSituacao, type EvidenciaDoMes,
} from '@/lib/remuneracao/situacaoEntregasPep'
import type { AnalistaDaGrade } from '@/lib/remuneracao/visaoGeralPep'
import { carregarDadosAno, carregarDadosSituacao, listarEvidenciasDoMes } from '@/services/pepSituacao.service'
import { EsperadasChart } from './EsperadasChart'

// Evidências ESPERADAS × na pasta, por tipo de entrega, para o mês aberto na
// tela ou para o ano inteiro, de todos os profissionais ou só dos escolhidos
// (pedido de 02/10/2026). O texto de cima diz sempre de qual período e de
// quantos profissionais são os números — "esperado" é a meta do período, não o
// que já está na pasta.

type Periodo = 'mes' | 'ano'

export function PainelEsperadas({ competencia, analistas, idRetrato }: {
  competencia: string
  analistas: AnalistaDaGrade[]
  /** Muda quando uma leitura termina: recarrega o que está na pasta. */
  idRetrato?: string | null
}) {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set())
  const [mes, setMes] = useState<{ dados: DadosSituacao; evidencias: EvidenciaDoMes[] } | null | undefined>(undefined)
  const [ano, setAno] = useState<{ dados: DadosAno; evidencias: EvidenciaDoMes[] } | null | undefined>(undefined)
  const anoNum = Number(competencia.split('-')[0])

  useEffect(() => {
    let vivo = true
    setMes(undefined)
    Promise.all([carregarDadosSituacao(competencia), listarEvidenciasDoMes(competencia)])
      .then(([dados, evidencias]) => { if (vivo) setMes(dados ? { dados, evidencias } : null) })
      .catch(() => { if (vivo) setMes(null) })
    return () => { vivo = false }
  }, [competencia, idRetrato])

  // O ano só é lido quando alguém pede (12 calendários + um ano de evidências).
  useEffect(() => {
    if (periodo !== 'ano') return
    let vivo = true
    setAno(undefined)
    carregarDadosAno(anoNum)
      .then(r => { if (vivo) setAno(r) })
      .catch(() => { if (vivo) setAno(null) })
    return () => { vivo = false }
  }, [periodo, anoNum, idRetrato])

  const filtrados = useMemo(
    () => (escolhidos.size === 0 ? analistas : analistas.filter(a => escolhidos.has(a.nome))),
    [analistas, escolhidos],
  )
  const opcoes = useMemo(() => analistas.map(a => ({ id: a.nome, nome: a.nome })), [analistas])

  const fonte = periodo === 'mes' ? mes : ano
  const resultado = useMemo(() => {
    if (!fonte) return null
    const lista = periodo === 'mes'
      ? evidenciasEsperadasPorAnalista(filtrados, (fonte as NonNullable<typeof mes>).dados, fonte.evidencias, competencia)
      : esperadasDoAno(filtrados, (fonte as NonNullable<typeof ano>).dados, fonte.evidencias, anoNum)
    const catalogo = periodo === 'mes' ? (fonte as NonNullable<typeof mes>).dados.catalogo : (fonte as NonNullable<typeof ano>).dados.catalogo
    const porEntrega = esperadasPorEntrega(lista, catalogo)
    return {
      porEntrega,
      esperadas: porEntrega.reduce((s, e) => s + e.esperadas, 0),
      naPasta: porEntrega.reduce((s, e) => s + e.naPasta, 0),
      foraDoPadrao: lista.reduce((s, a) => s + a.foraDoPadrao, 0),
    }
  }, [fonte, periodo, filtrados, competencia, anoNum])

  if (analistas.length === 0 || mes === null) return null

  const rotuloPeriodo = periodo === 'mes' ? rotuloMes(competencia) : `o ano de ${anoNum}`
  const rotuloCurto = periodo === 'mes' ? rotuloMes(competencia) : String(anoNum)
  const quem = escolhidos.size === 0
    ? `todos os ${numero(analistas.length)} profissionais`
    : escolhidos.size === 1 ? nomeCurtoPrestador([...escolhidos][0]) : `${numero(escolhidos.size)} profissionais escolhidos`
  const pct = resultado && resultado.esperadas > 0 ? Math.round((resultado.naPasta / resultado.esperadas) * 100) : 0

  return (
    <div className="rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-slate-800">
            <Target className="h-4 w-4 text-brand-fg" aria-hidden />
            Evidências esperadas
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">{rotuloCurto}</span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            O que se <strong className="font-semibold text-slate-800">espera</strong> para {rotuloPeriodo}, de {quem}, comparado com o que já está na pasta.
            {' '}Supervisão e estudo por semana do mês, TAP e TOP por paciente (os da Grade de {rotuloMes(competencia)}), e semestrais com planejamento cadastrado
            {periodo === 'mes' ? ' que já venceram' : ' que vencem no ano'}. Conta só o nome no padrão.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:shrink-0">
          <SegmentedTabs<Periodo> value={periodo} onChange={setPeriodo} ariaLabel="Período do esperado"
            tabs={[{ value: 'mes', label: rotuloMes(competencia) }, { value: 'ano', label: `Ano ${anoNum}` }]} />
          <div className="sm:w-64">
            <MultiSearchCombobox<string>
              opcoes={opcoes}
              selecionados={escolhidos}
              onToggle={id => setEscolhidos(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
              onDesmarcarTodos={() => setEscolhidos(new Set())}
              placeholder="Todos os profissionais"
              ariaLabel="Filtrar o esperado por profissional"
              nomePlural="profissionais"
              adjetivoResumo="escolhidos"
            />
          </div>
        </div>
      </div>

      {fonte === undefined || !resultado ? (
        <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Calculando o esperado de {rotuloPeriodo}…</p>
      ) : fonte === null ? (
        <p className="py-4 text-sm text-slate-600">Não foi possível calcular o esperado de {rotuloPeriodo}.</p>
      ) : resultado.esperadas === 0 ? (
        <p className="py-4 text-sm text-slate-600">Nada esperado para {quem} em {rotuloPeriodo}.</p>
      ) : (
        <>
          <p className="mb-4 text-right">
            <span className="block text-3xl font-black leading-none tabular-nums text-slate-900 sm:text-4xl">
              {numero(resultado.naPasta)} <span className="text-lg font-bold text-slate-500">de {numero(resultado.esperadas)}</span>
            </span>
            <span className="mt-1 block text-xs font-semibold text-slate-600">
              esperadas em {rotuloCurto} já estão na pasta ({pct}%)
              {resultado.foraDoPadrao > 0 ? ` · ${numero(resultado.foraDoPadrao)} na pasta fora do padrão de nome não contam` : ''}
            </span>
          </p>
          <EsperadasChart entregas={resultado.porEntrega} />
          {periodo === 'ano' && (
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              No ano, os meses que ainda não chegaram entram no esperado e, por isso, aparecem como "ainda falta". Os pacientes de cada profissional são os da Grade do mês aberto.
            </p>
          )}
        </>
      )}
    </div>
  )
}
