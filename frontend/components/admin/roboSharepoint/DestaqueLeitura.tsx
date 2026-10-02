'use client'

import { ArrowRight, Camera, Clock, FileCheck2, FileText, FolderSearch, FolderTree, Loader2, RefreshCw, ScanSearch, TriangleAlert } from 'lucide-react'
import { dataHora, haQuanto, numero } from '@/lib/roboSharepoint/rotulos'
import type { ReactNode } from 'react'
import type { ResumoExecucao, RoboEtapaNome, RoboExecucao } from '@/types/roboSharepoint'

// O topo do painel: "O que o robô encontrou no SharePoint". É a 1ª coisa que
// se vê ao entrar (pedido de 02/10/2026), então fala de RESULTADO e não de
// desempenho: o tempo de cada etapa fica em "Informações técnicas".
//
// Desde 20261003100000 (pedido de 02/10/2026: "o que preciso saber é o que
// ESTÁ NA PASTA agora, não o que mudou"), com `estadoAtual` os números são o
// retrato da pasta — todos os arquivos, todos os prestadores — e "Ver o que
// foi lido" abre esse retrato. Sem a migration, volta ao de antes: o que a
// última execução leu.

const FAIXA = 'linear-gradient(90deg,#3aaa5c,#2A92C0)'

/**
 * Grande e convidativo, embaixo dos números (pedido de 02/10/2026): é a porta
 * para a lista dos arquivos. Steel cheio, texto branco — legível no claro e
 * no escuro.
 */
function BotaoVer({ onClick, sub }: { onClick: () => void; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-16 w-full items-center justify-center gap-4 rounded-2xl bg-brand-fg px-6 py-3.5 text-left text-white transition-[filter,transform] hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
        <FolderSearch className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-bold leading-tight">Ver o que foi lido</span>
        <span className="block text-sm text-white/80">{sub}</span>
      </span>
      <ArrowRight className="ml-auto h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1 motion-reduce:transform-none sm:ml-4" aria-hidden />
    </button>
  )
}

function Numero({ icone: Icone, valor, rotulo, sub, compacto = false }: { icone: typeof FileText; valor: string; rotulo: string; sub?: string; compacto?: boolean }) {
  return (
    <div className={`flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 ${compacto ? 'p-3.5' : 'p-4 sm:p-5'}`}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-fg ring-1 ring-slate-200">
        <Icone className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className={`block font-black leading-none tabular-nums text-slate-900 ${compacto ? 'text-3xl' : 'text-4xl sm:text-5xl'}`}>{valor}</span>
        <span className="mt-1.5 block text-sm font-semibold text-slate-700">{rotulo}</span>
        {sub && <span className="block text-xs text-slate-500">{sub}</span>}
      </span>
    </div>
  )
}

export function DestaqueLeitura({ execucao, estadoAtual, retratoDe, painelEsperadas, onAbrir }: {
  execucao: RoboExecucao | null
  /** O que está na pasta agora (sp_pep_resumo_execucao(NULL)). Ausente = migration pendente. */
  estadoAtual?: ResumoExecucao | null
  /** Leitura que tirou o retrato (a última concluída). */
  retratoDe?: RoboExecucao | null
  /** Painel das evidências esperadas × na pasta (PainelEsperadas). Ausente = sem Grade do mês. */
  painelEsperadas?: ReactNode
  onAbrir: (etapa: RoboEtapaNome) => void
}) {
  const etapa = execucao?.etapas.find(e => e.etapa === 'listar')
  const d = (etapa?.detalhe ?? null) as Record<string, unknown> | null
  const n = (k: string) => (d && typeof d[k] === 'number' ? (d[k] as number) : null)
  const arquivos = n('arquivos_novos_ou_alterados')
  const pastas = n('pastas')
  const completa = d?.leitura === 'completa'
  const erro = d && typeof d.erro === 'string' ? d.erro : null
  const lendo = execucao?.status === 'executando' && etapa?.status !== 'concluida'
  const pronta = etapa?.status === 'concluida' && !erro
  const atual = estadoAtual ?? null
  const quando = retratoDe ?? execucao

  if (atual && !lendo) {
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-labelledby="titulo-destaque">
        <div className="h-1.5 w-full" style={{ background: FAIXA }} aria-hidden />
        <div className="space-y-5 p-5 sm:p-6">
          {/* Título à esquerda, a porta para a lista à direita. */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-surface text-brand-fg">
                <FolderTree className="h-7 w-7" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 id="titulo-destaque" className="text-xl font-bold leading-tight text-slate-900">O que está no SharePoint agora</h2>
                {quando && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                    <Clock className="h-4 w-4 text-slate-400" aria-hidden />
                    retrato da leitura de {dataHora(quando.iniciado_em)} <span className="text-slate-400">·</span> {haQuanto(quando.iniciado_em)}
                  </p>
                )}
                <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand-surface px-2.5 py-1 text-xs font-semibold text-brand-fg">
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                  todos os arquivos de todos os prestadores
                </span>
              </div>
            </div>
            <div className="lg:w-[24rem] lg:shrink-0">
              <BotaoVer onClick={() => onAbrir('listar')} sub="tudo o que está na pasta, prestador por prestador" />
            </div>
          </div>

          <div className={`grid gap-4 ${painelEsperadas ? 'lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-start' : ''}`}>
            {/* O retrato: três números, lado a lado no celular e empilhados ao lado do gráfico. */}
            <div className={`grid gap-3 ${painelEsperadas ? 'sm:grid-cols-3 lg:grid-cols-1' : 'sm:grid-cols-3'}`}>
              <Numero compacto icone={FileText} valor={numero(atual.total)} rotulo={atual.total === 1 ? 'arquivo na pasta' : 'arquivos na pasta'} />
              <Numero compacto icone={FileCheck2} valor={numero(atual.por_tipo.evidencia ?? 0)} rotulo="evidências" sub="de todos os meses" />
              <Numero compacto icone={FolderTree} valor={numero(atual.pastas.total)} rotulo="pastas no site" sub="prestadores, seções e pacientes" />
            </div>

            {painelEsperadas}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-labelledby="titulo-destaque">
      <div className="h-1.5 w-full" style={{ background: FAIXA }} aria-hidden />
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)] lg:items-center lg:gap-8">
        <div className="flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-surface text-brand-fg">
            <FolderTree className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="titulo-destaque" className="text-xl font-bold leading-tight text-slate-900">O que o robô encontrou no SharePoint</h2>
            {execucao ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                <Clock className="h-4 w-4 text-slate-400" aria-hidden />
                {lendo ? 'lendo o site agora…' : <>leitura de {dataHora(execucao.iniciado_em)} <span className="text-slate-400">·</span> {haQuanto(execucao.iniciado_em)}</>}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-slate-600">O robô ainda não leu o site. Na primeira leitura, o resultado aparece aqui.</p>
            )}
            {pronta && (
              <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand-surface px-2.5 py-1 text-xs font-semibold text-brand-fg">
                {completa ? <ScanSearch className="h-3.5 w-3.5" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                {completa ? 'leitura completa do site' : 'só o que mudou desde a leitura anterior'}
              </span>
            )}
          </div>
        </div>

        {lendo ? (
          <div className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-800" aria-live="polite">
            <Loader2 className="h-6 w-6 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            <p className="text-sm font-semibold">O robô está percorrendo as pastas do SharePoint. Os números aparecem assim que esta etapa terminar.</p>
          </div>
        ) : erro ? (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p className="text-sm">A leitura do SharePoint falhou: {erro}</p>
          </div>
        ) : pronta ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Numero icone={FileText} valor={numero(arquivos)} rotulo={arquivos === 1 ? 'arquivo novo ou alterado' : 'arquivos novos ou alterados'}
                sub={arquivos === 0 ? 'nada mudou desde a leitura anterior' : undefined} />
              <Numero icone={FolderTree} valor={numero(pastas)} rotulo="pastas no site" sub="prestadores, seções e pacientes" />
            </div>
            <BotaoVer onClick={() => onAbrir('listar')} sub="a lista das pastas e dos arquivos, um por um" />
          </div>
        ) : (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            {execucao ? 'Esta execução não chegou a ler o SharePoint.' : 'Quando o robô rodar, aqui aparecem quantos arquivos novos ou alterados e quantas pastas ele encontrou.'}
          </p>
        )}
      </div>
    </section>
  )
}
