'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, CalendarRange, Check, FileCheck2, FileX, FolderOpen, Loader2, Target, UserRound, Users } from 'lucide-react'
import { AnelProgresso, BotaoAjuda, NumeroPastel, tom, type LinhaAjuda } from '@/components/ui/pastel/pecas'
import { MultiSearchCombobox } from '@/components/cronograma/ui/MultiSearchCombobox'
import { rotuloMes } from '@/lib/roboSharepoint/relatorioPrestador'
import { nomeCurtoPrestador, numero } from '@/lib/roboSharepoint/rotulos'
import {
  esperadasDoAno, esperadasPorEntrega, evidenciasEsperadasPorAnalista,
  type DadosAno, type DadosSituacao, type EsperadasPorEntrega, type EvidenciaDoMes,
} from '@/lib/remuneracao/situacaoEntregasPep'
import type { AnalistaDaGrade } from '@/lib/remuneracao/visaoGeralPep'
import { carregarDadosAno, carregarDadosSituacao, listarEvidenciasDoMes } from '@/services/pepSituacao.service'
import { EsperadasChart } from './EsperadasChart'

// Evidências ESPERADAS × na pasta, por tipo de entrega, para o mês aberto na
// tela ou para o ano inteiro, de todos os profissionais ou só dos escolhidos
// (pedido de 02/10/2026). O texto de cima diz sempre de qual período e de
// quantos profissionais são os números — "esperado" é a meta do período, não o
// que já está na pasta.

export type Periodo = 'mes' | 'ano'

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

  return (
    <ConteudoEsperadas
      competencia={competencia} anoNum={anoNum} periodo={periodo} onPeriodo={setPeriodo}
      filtro={
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
      }
      estado={fonte === undefined || !resultado ? 'carregando' : fonte === null ? 'erro' : resultado.esperadas === 0 ? 'vazio' : 'ok'}
      resultado={resultado} quem={quem} rotuloPeriodo={rotuloPeriodo} rotuloCurto={rotuloCurto}
    />
  )
}

export type ResultadoEsperadas = {
  porEntrega: EsperadasPorEntrega[]
  naPastaTotal: number
  ate: { esperadas: number; naPasta: number } | null
  esperadas: number
  naPasta: number
}

/** O desenho do painel, sem buscar nada (visual pastel, docs/PLANO_PEP_VISUAL_PASTEL.md fase 1). */
export function ConteudoEsperadas({ competencia, anoNum, periodo, onPeriodo, filtro, estado, resultado, quem, rotuloPeriodo, rotuloCurto }: {
  competencia: string
  anoNum: number
  periodo: Periodo
  onPeriodo: (p: Periodo) => void
  /** O filtro de profissionais (MultiSearchCombobox). */
  filtro: ReactNode
  estado: 'carregando' | 'erro' | 'vazio' | 'ok'
  resultado: ResultadoEsperadas | null
  quem: string
  rotuloPeriodo: string
  rotuloCurto: string
}) {
  const pct = resultado && resultado.esperadas > 0 ? Math.round((resultado.naPasta / resultado.esperadas) * 100) : 0
  const ajuda: LinhaAjuda[] = [
    { t: 'verde', Icone: CalendarDays, texto: <span className="flex flex-col gap-0.5"><strong className="font-extrabold leading-none">STC e ETC</strong> <span className="text-[12px] font-medium opacity-80">Uma por semana do mês (3 em mês de recesso).</span></span> },
    { t: 'amber', Icone: Users, texto: <span className="flex flex-col gap-0.5"><strong className="font-extrabold leading-none">TAP</strong> <span className="text-[12px] font-medium opacity-80">2 por paciente por mês.</span></span> },
    { t: 'amber', Icone: Users, texto: <span className="flex flex-col gap-0.5"><strong className="font-extrabold leading-none">TOP</strong> <span className="text-[12px] font-medium opacity-80">1 por paciente por mês.</span></span> },
    { t: 'teal', Icone: CalendarRange, texto: <span className="flex flex-col gap-0.5"><strong className="font-extrabold leading-none">PIC, RT e OE</strong> <span className="text-[12px] font-medium opacity-80">1 por planejamento semestral cadastrado{periodo === 'mes' ? ' que já venceu' : ' que vence no ano'}. Sem planejamento, não se espera.</span></span> },
    { t: 'aco', Icone: UserRound, texto: <span className="flex flex-col gap-0.5"><strong className="font-extrabold leading-none">Pacientes</strong> <span className="text-[12px] font-medium opacity-80">Os pacientes de cada profissional são os da Grade de {rotuloMes(competencia)}.</span></span> },
    { t: 'cinza', Icone: FileCheck2, texto: <span className="flex flex-col gap-0.5"><strong className="font-extrabold leading-none">Na pasta</strong> <span className="text-[12px] font-medium opacity-80">Conta só arquivo com o nome no padrão, no máximo o esperado de cada item.</span></span> },
  ]

  return (
    <div className="rounded-[20px] p-4 shadow-[inset_0_0_0_1px_var(--pp-border)] sm:p-5">
      <div className="mb-4 flex flex-col gap-3 @5xl:flex-row @5xl:items-start @5xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${tom('verde')} flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--c)] text-[var(--c-sobre)]`} aria-hidden>
              <Target className="h-[18px] w-[18px]" />
            </span>
            <h3 className="text-[17px] font-extrabold">Evidências esperadas</h3>
            <span className={`${tom('cinza')} pp-selo`}>{rotuloCurto}</span>
            <BotaoAjuda linhas={ajuda} rotulo="Como o esperado é calculado" />
          </div>
          <p className="mt-1.5 text-[13px] font-semibold leading-snug text-[var(--pp-ink-muted)]">
            O que se espera para {rotuloPeriodo}, de {quem}, e o que já está na pasta.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center @5xl:shrink-0">
          <div className="inline-flex rounded-[14px] bg-[var(--pp-muted)] p-1" role="group" aria-label="Período do esperado">
            <button type="button" aria-pressed={periodo === 'mes'} onClick={() => onPeriodo('mes')}
              className={`h-8 rounded-[10px] px-3.5 text-[13px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                periodo === 'mes' ? 'bg-[var(--pp-surface)] text-[var(--pp-ink)] shadow-sm' : 'text-[var(--pp-ink-muted)] hover:text-[var(--pp-ink)]'}`}>
              {rotuloMes(competencia)}
            </button>
            <button type="button" aria-pressed={periodo === 'ano'} onClick={() => onPeriodo('ano')}
              className={`h-8 rounded-[10px] px-3.5 text-[13px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                periodo === 'ano' ? 'bg-[var(--pp-surface)] text-[var(--pp-ink)] shadow-sm' : 'text-[var(--pp-ink-muted)] hover:text-[var(--pp-ink)]'}`}>
              Ano {anoNum}
            </button>
          </div>
          <div className="sm:w-64">{filtro}</div>
        </div>
      </div>

      {estado === 'carregando' || !resultado ? (
        <p className="flex items-center gap-2 py-6 text-sm font-semibold text-[var(--pp-ink-muted)]"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Calculando o esperado de {rotuloPeriodo}…</p>
      ) : estado === 'erro' ? (
        <p className="py-4 text-sm font-semibold text-[var(--pp-ink-muted)]">Não foi possível calcular o esperado de {rotuloPeriodo}.</p>
      ) : estado === 'vazio' ? (
        <p className="py-4 text-sm font-semibold text-[var(--pp-ink-muted)]">Nada esperado para {quem} em {rotuloPeriodo}.</p>
      ) : (
        <>
          <div className="mb-4 grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:items-center">
            {/* A conta que explica o total: do que está na pasta, só o nome no padrão conta. */}
            <div className="grid gap-2 @md:grid-cols-3">
              <NumeroPastel compacto t="cinza" Icone={FolderOpen} valor={numero(resultado.naPastaTotal)} rotulo={`na pasta (${rotuloCurto})`} />
              <NumeroPastel compacto t="verde" Icone={Check} valor={numero(resultado.naPasta)} rotulo="no padrão (contam)" />
              <NumeroPastel compacto t="amber" Icone={FileX} valor={numero(Math.max(0, resultado.naPastaTotal - resultado.naPasta))} rotulo="não contam"
                title="Fora do padrão, repetidas ou além do esperado" apoio="fora do padrão ou a mais" />
            </div>
            <AnelProgresso feitas={resultado.naPasta} total={resultado.esperadas} rotulo={`esperadas na pasta (${pct}%)`} />
          </div>
          {resultado.ate && (
            <p className={`${tom('aco')} mb-4 rounded-2xl bg-[var(--c-suave)] px-4 py-2.5 text-[13px] font-semibold leading-snug shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
              Até {rotuloMes(competencia)} já eram exigíveis <strong className="font-extrabold">{numero(resultado.ate.esperadas)}</strong>:{' '}
              <strong className="font-extrabold">{numero(resultado.ate.naPasta)}</strong> estão na pasta. O resto é de meses que ainda não chegaram.
            </p>
          )}
          <EsperadasChart entregas={resultado.porEntrega} />
        </>
      )}
    </div>
  )
}
