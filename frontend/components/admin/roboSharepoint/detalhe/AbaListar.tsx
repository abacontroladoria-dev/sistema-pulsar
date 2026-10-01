'use client'

import { useMemo, useState } from 'react'
import { Cloud, Download, Files, FolderOpen, FolderTree, Users } from 'lucide-react'
import { nomeCurtoPrestador, numero, segundos } from '@/lib/roboSharepoint/rotulos'
import type { ResumoExecucao, RoboEtapa, RoboExecucao } from '@/types/roboSharepoint'
import { Bloco, corBarra, Ladrilho, Ladrilhos, Lead, Rotulo } from './Blocos'
import { ExploradorPastas } from './ExploradorPastas'
import { ListaArquivos, type FiltroArquivos } from './ListaArquivos'

// Listar = o passeio pelo site: onde o robô andou, o que achou em cada
// prestador, e a lista inteira, arquivo por arquivo.

export function AbaListar({ execucao, etapa, resumo, competencia, simples = false }: {
  execucao: RoboExecucao; etapa?: RoboEtapa; resumo: ResumoExecucao
  /** Mês do PDF por prestador. */
  competencia?: string
  /** Tela PEP: sem tempo, sem números técnicos (chamadas, KB) e sem a composição das pastas. */
  simples?: boolean
}) {
  const d = (etapa?.detalhe ?? {}) as Record<string, number | string>
  const completa = d.leitura === 'completa'
  const [filtro, setFiltro] = useState<FiltroArquivos>({})
  const [destaque, setDestaque] = useState<'com' | 'sem' | null>(null)
  const comArquivo = resumo.prestadores.filter(p => p.arquivos > 0).length

  const pastasTotal = Number(d.pastas ?? resumo.pastas.total)
  const subpastas = Math.max(pastasTotal - resumo.pastas.prestadores - resumo.pastas.pacientes, 0)
  const kb = Math.round((execucao.metricas?.bytes_graph ?? 0) / 1024)

  const prestadores = useMemo(
    () => [...resumo.prestadores].sort((a, b) => b.arquivos - a.arquivos || a.nome.localeCompare(b.nome)),
    [resumo.prestadores],
  )
  const maxArquivos = Math.max(...prestadores.map(p => p.arquivos), 1)
  const composicao = [
    { chave: 'prest', rotulo: 'Pastas de prestador', n: resumo.pastas.prestadores, cor: corBarra('blue') },
    { chave: 'pac', rotulo: 'Pastas de paciente', n: resumo.pastas.pacientes, cor: 'bg-slate-500 dark:bg-slate-400' },
    { chave: 'sub', rotulo: 'Subpastas', n: subpastas, cor: 'bg-slate-300 dark:bg-slate-600', nota: 'Planejamento, Geral, Pacientes e as 7 de cada paciente' },
  ]

  return (
    <div className="space-y-5">
      <Lead>
        {completa ? 'Leitura completa: ' : 'Só o que mudou desde a leitura anterior: '}
        o robô percorreu <strong className="font-semibold text-foreground">{numero(pastasTotal)} pastas</strong> e encontrou{' '}
        <strong className="font-semibold text-foreground">{numero(resumo.total)} arquivo(s)</strong>{simples ? '' : ` em ${segundos(etapa?.duracao_ms, 2)}`}.
        Nada é baixado nesta etapa: ele lê só nome, pasta, data e autor de cada arquivo.
      </Lead>

      {!simples && <>
      <Ladrilhos>
        <Ladrilho icone={FolderTree} tom="gray" valor={pastasTotal} rotulo="pastas percorridas" />
        <Ladrilho icone={Files} tom="blue" valor={resumo.total} rotulo="arquivos encontrados" sub={completa ? 'leitura completa' : 'só o que mudou'} />
        <Ladrilho icone={Cloud} tom="gray" valor={execucao.metricas?.chamadas_graph ?? 0} rotulo="chamadas à Microsoft" />
        <Ladrilho icone={Download} tom="gray" valor={kb} rotulo="KB recebidos" formato={n => `${numero(n)}`} />
      </Ladrilhos>

      <Bloco icone={FolderTree} titulo="De que são feitas as pastas" subtitulo="estrutura do site hoje" contagem={numero(pastasTotal)}>
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted" role="img"
          aria-label={composicao.map(c => `${c.n} ${c.rotulo}`).join(', ')}>
          {composicao.filter(c => c.n > 0).map(c => (
            <span key={c.chave} className={`h-full ${c.cor}`} style={{ width: `${(c.n / Math.max(pastasTotal, 1)) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {composicao.map(c => (
            <li key={c.chave} className="flex items-start gap-2.5">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${c.cor}`} aria-hidden />
              <span>
                <span className="block text-lg font-black leading-none tabular-nums text-foreground">{numero(c.n)}</span>
                <span className="mt-1 block text-xs font-semibold text-muted-foreground">{c.rotulo}</span>
                {c.nota && <span className="block text-[11px] text-muted-foreground/80">{c.nota}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Bloco>
      </>}

      <Bloco icone={FolderOpen} titulo="Todas as pastas, prestador por prestador"
        subtitulo="abra um prestador e desça até cada pasta de paciente e suas 7 subpastas"
        contagem={`${numero(resumo.prestadores.length)} prestadores`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Rotulo>Pasta cinza e “vazia” = o robô passou por ela e não havia arquivo</Rotulo>
          <div className="inline-flex rounded-lg border border-border bg-background p-0.5" role="group" aria-label="Quais prestadores destacar">
            {([[null, 'Todos'], ['com', 'Com arquivo'], ['sem', 'Sem arquivo']] as const).map(([k, r]) => (
              <button key={r} type="button" aria-pressed={destaque === k} onClick={() => setDestaque(k)}
                className={`h-9 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  destaque === k ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>
                {r} <span className="tabular-nums opacity-70">{numero(k === 'com' ? comArquivo : k === 'sem' ? resumo.prestadores.length - comArquivo : resumo.prestadores.length)}</span>
              </button>
            ))}
          </div>
        </div>
        <ExploradorPastas execucaoId={execucao.id} resumoPrestadores={resumo.prestadores} filtroPrestador={destaque} competencia={competencia} />
      </Bloco>

      <Bloco icone={Users} titulo="Onde estão os arquivos" subtitulo="toque num prestador para ver só os arquivos dele na lista abaixo" contagem={`${numero(resumo.total)} arquivos`}>
        <ul className="space-y-1">
          {prestadores.filter(p => p.arquivos > 0).map(p => {
            const ativo = filtro.prestadorPastaId === p.pasta_id
            const apagado = !!filtro.prestadorPastaId && !ativo
            return (
              <li key={p.pasta_id}>
                <button type="button" aria-pressed={ativo}
                  onClick={() => setFiltro(ativo ? {} : { prestadorPastaId: p.pasta_id, rotulo: nomeCurtoPrestador(p.nome) })}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-2 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,30fr)_minmax(0,50fr)_auto] ${
                    ativo ? 'bg-muted/60' : ''} ${apagado ? 'opacity-35' : ''}`}>
                  <span className="truncate text-sm font-semibold text-foreground">{nomeCurtoPrestador(p.nome)}</span>
                  <span className="col-span-2 flex h-3 overflow-hidden rounded-full bg-muted sm:col-span-1 sm:order-none order-last"
                    role="img" aria-label={`${p.evidencias} evidências, ${p.ignorados} fora do PEP, ${p.arquivos - p.evidencias - p.ignorados} outros`}>
                    <span className="h-full bg-sky-500 dark:bg-sky-400" style={{ width: `${(p.evidencias / maxArquivos) * 100}%` }} />
                    <span className="h-full border-l-2 border-card bg-slate-400 dark:bg-slate-500" style={{ width: `${(p.ignorados / maxArquivos) * 100}%` }} />
                    <span className="h-full border-l-2 border-card bg-slate-300 dark:bg-slate-600" style={{ width: `${(Math.max(p.arquivos - p.evidencias - p.ignorados, 0) / maxArquivos) * 100}%` }} />
                  </span>
                  <span className="text-right text-sm font-black tabular-nums text-foreground">{numero(p.arquivos)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-4 px-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500 dark:bg-sky-400" aria-hidden />evidências</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-400 dark:bg-slate-500" aria-hidden />fora do PEP</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />planilhas e outros</span>
        </div>
      </Bloco>

      <Bloco icone={Files} titulo={`Os ${numero(resumo.total)} arquivos, um por um`} subtitulo="toque num arquivo para ver tudo o que o robô sabe dele">
        <ListaArquivos
          execucaoId={execucao.id}
          filtro={filtro}
          contagens={{ ...resumo.por_tipo, total: resumo.total + (resumo.por_tipo.removido ?? 0) }}
          onLimparFiltro={() => setFiltro({})}
        />
      </Bloco>
    </div>
  )
}
