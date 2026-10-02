'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Target } from 'lucide-react'
import { InfoTooltip } from '@/components/cronograma/ui/InfoTooltip'
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
  // Cada resultado guarda a chave que o pediu: se a chave de agora é outra
  // (mês trocado, leitura nova), ele ainda está carregando — sem setState no
  // começo do efeito.
  const anoNum = Number(competencia.split('-')[0])
  const chaveMes = `${competencia}|${idRetrato ?? ''}`
  const chaveAno = `${anoNum}|${idRetrato ?? ''}`
  const [mesLido, setMesLido] = useState<{ chave: string; valor: { dados: DadosSituacao; evidencias: EvidenciaDoMes[] } | null } | null>(null)
  const [anoLido, setAnoLido] = useState<{ chave: string; valor: { dados: DadosAno; evidencias: EvidenciaDoMes[] } | null } | null>(null)
  const mes = mesLido?.chave === chaveMes ? mesLido.valor : undefined
  const ano = anoLido?.chave === chaveAno ? anoLido.valor : undefined

  useEffect(() => {
    let vivo = true
    Promise.all([carregarDadosSituacao(competencia), listarEvidenciasDoMes(competencia)])
      .then(([dados, evidencias]) => { if (vivo) setMesLido({ chave: chaveMes, valor: dados ? { dados, evidencias } : null }) })
      .catch(() => { if (vivo) setMesLido({ chave: chaveMes, valor: null }) })
    return () => { vivo = false }
  }, [competencia, chaveMes])

  // O ano só é lido quando alguém pede (12 calendários + um ano de evidências).
  useEffect(() => {
    if (periodo !== 'ano') return
    let vivo = true
    carregarDadosAno(anoNum)
      .then(r => { if (vivo) setAnoLido({ chave: chaveAno, valor: r }) })
      .catch(() => { if (vivo) setAnoLido({ chave: chaveAno, valor: null }) })
    return () => { vivo = false }
  }, [periodo, anoNum, chaveAno])

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
    // Tudo o que está na pasta no período para estes profissionais (qualquer nome):
    // é o que reconcilia com as "evidências na pasta" do retrato.
    const nomes = new Set(filtrados.map(a => a.nome))
    const naPastaTotal = fonte.evidencias.filter(e => nomes.has(e.prestador_nome)
      && (periodo === 'mes' || !!e.competencia?.startsWith(`${anoNum}-`))).length
    // No ano: quanto já era exigível até o mês aberto (meses futuros ainda não são falta).
    let ate: { esperadas: number; naPasta: number } | null = null
    if (periodo === 'ano') {
      const dadosAno = (fonte as NonNullable<typeof ano>).dados
      const porEntregaAte = esperadasPorEntrega(esperadasDoAno(filtrados, dadosAno, fonte.evidencias, anoNum, competencia), catalogo)
      ate = { esperadas: porEntregaAte.reduce((s, e) => s + e.esperadas, 0), naPasta: porEntregaAte.reduce((s, e) => s + e.naPasta, 0) }
    }
    return {
      porEntrega, naPastaTotal, ate,
      esperadas: porEntrega.reduce((s, e) => s + e.esperadas, 0),
      naPasta: porEntrega.reduce((s, e) => s + e.naPasta, 0),
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
            <InfoTooltip ariaLabel="Como o esperado é calculado" largura={360}>
              <p className="mb-1.5 text-xs font-bold text-foreground">Como o esperado é calculado</p>
              <ul className="list-disc space-y-1 pl-4 leading-snug text-muted-foreground">
                <li><strong className="text-foreground">STC e ETC:</strong> uma por semana do mês (3 em mês de recesso).</li>
                <li><strong className="text-foreground">TAP:</strong> 2 por paciente por mês. <strong className="text-foreground">TOP:</strong> 1 por paciente por mês.</li>
                <li><strong className="text-foreground">PIC, RT e OE:</strong> 1 por planejamento semestral cadastrado{periodo === 'mes' ? ' que já venceu' : ' que vence no ano'}. Sem planejamento cadastrado, não se espera.</li>
                <li>Os pacientes de cada profissional são os da Grade de {rotuloMes(competencia)}.</li>
                <li>&ldquo;Na pasta&rdquo; conta só arquivo com o nome no padrão, no máximo o esperado de cada item.</li>
              </ul>
            </InfoTooltip>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            O que se <strong className="font-semibold text-slate-800">espera</strong> para {rotuloPeriodo}, de {quem}, comparado com o que já está na pasta.
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
          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            {/* A conta que explica o total: do que está na pasta, só o nome no padrão conta. */}
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl bg-slate-50 p-2.5">
                <dt className="font-semibold text-slate-500">Na pasta ({rotuloCurto})</dt>
                <dd className="text-lg font-black tabular-nums text-slate-900">{numero(resultado.naPastaTotal)}</dd>
              </div>
              <div className="rounded-xl bg-emerald-50 p-2.5">
                <dt className="font-semibold text-emerald-800">no padrão (contam)</dt>
                <dd className="text-lg font-black tabular-nums text-emerald-900">{numero(resultado.naPasta)}</dd>
              </div>
              <div className="rounded-xl bg-amber-50 p-2.5">
                <dt className="font-semibold text-amber-800">não contam</dt>
                <dd className="text-lg font-black tabular-nums text-amber-900">{numero(Math.max(0, resultado.naPastaTotal - resultado.naPasta))}</dd>
                <dd className="text-[10px] leading-tight text-amber-800">fora do padrão, repetidas ou além do esperado</dd>
              </div>
            </dl>
            <p className="text-right">
              <span className="block text-3xl font-black leading-none tabular-nums text-slate-900 sm:text-4xl">
                {numero(resultado.naPasta)} <span className="text-lg font-bold text-slate-500">de {numero(resultado.esperadas)}</span>
              </span>
              <span className="mt-1 block text-xs font-semibold text-slate-600">esperadas em {rotuloCurto} já estão na pasta ({pct}%)</span>
            </p>
          </div>
          {resultado.ate && (
            <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Do ano, <strong className="font-semibold text-slate-900">{numero(resultado.ate.esperadas)}</strong> já eram exigíveis até {rotuloMes(competencia)} (janeiro até o mês aberto):{' '}
              <strong className="font-semibold text-slate-900">{numero(resultado.ate.naPasta)} de {numero(resultado.ate.esperadas)}</strong> estão na pasta.
              O resto é de meses que ainda não chegaram.
            </p>
          )}
          <EsperadasChart entregas={resultado.porEntrega} />
        </>
      )}
    </div>
  )
}
