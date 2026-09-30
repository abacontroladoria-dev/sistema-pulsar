'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, FileSpreadsheet, FileText, FileX, Search } from 'lucide-react'
import { StatusChip, TONE_CHIP } from '@/components/ui/tones'
import { dataHora, numero, partesDoCaminho, rotuloMotivo, TIPOS_ARQUIVO } from '@/lib/roboSharepoint/rotulos'
import { listarArquivosLidos, type OrdemArquivos } from '@/services/roboSharepoint.service'
import type { ArquivoLidoCompleto, SpItemStatus, TipoArquivoLido } from '@/types/roboSharepoint'
import { Mostrando, TOM } from './Blocos'
import { ModalArquivo } from './ModalArquivo'

// Os arquivos de UMA execução, uma linha-cartão por arquivo (padrão
// CardRemunRP): ladrilho do tipo à esquerda, nome e trilha de pastas, e à
// direita, separadas por divisórias, competência, envio e a situação no
// Pulsar. Clicar na linha abre o modal com tudo o que se sabe do arquivo;
// clicar no nome abre o arquivo no SharePoint.

export type FiltroArquivos = {
  tipo?: TipoArquivoLido | null
  sigla?: string | null
  motivo?: string | null
  prestadorPastaId?: string | null
  pacientePastaId?: string | null
  situacao?: SpItemStatus | null
  motivoPulsar?: string | null
  soNovos?: boolean
  rotulo?: string | null
}

const TAMANHO = 20

const FICHAS: { tipo: TipoArquivoLido | null; rotulo: string }[] = [
  { tipo: null, rotulo: 'Todos' },
  { tipo: 'evidencia', rotulo: 'Evidências' },
  { tipo: 'planilha', rotulo: 'Planilhas' },
  { tipo: 'ignorado', rotulo: 'Fora do PEP' },
  { tipo: 'fora_padrao', rotulo: 'Fora do padrão' },
  { tipo: 'removido', rotulo: 'Apagados' },
]

const ORDENS: { valor: OrdemArquivos; rotulo: string }[] = [
  { valor: 'caminho', rotulo: 'Por pasta' },
  { valor: 'recentes', rotulo: 'Mais recentes' },
  { valor: 'nome', rotulo: 'Por nome' },
]

const SITUACAO: Record<SpItemStatus, { rotulo: string; tom: 'green' | 'amber' | 'blue' | 'gray' }> = {
  sugerido: { rotulo: 'sugestão', tom: 'blue' },
  confirmado: { rotulo: 'confirmada', tom: 'green' },
  nao_reconhecido: { rotulo: 'não reconhecido', tom: 'amber' },
  ignorado: { rotulo: 'ignorada', tom: 'gray' },
  removido: { rotulo: 'apagado', tom: 'gray' },
}

const mesBR = (c: string | null | undefined) => (c ? c.split('-').reverse().join('/') : '—')

function Ladrinho({ a }: { a: ArquivoLidoCompleto }) {
  const Icone = a.tipo === 'removido' ? FileX : a.tipo === 'planilha' ? FileSpreadsheet : FileText
  const t = TONE_CHIP[TOM[a.tipo]]
  return (
    <span className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-xl ${t.bg} ${t.text}`}>
      <Icone className="h-4 w-4" aria-hidden />
      <span className="mt-0.5 text-[9px] font-black uppercase tracking-wide">{a.sigla ?? (a.tipo === 'planilha' ? 'xlsx' : a.tipo === 'evidencia' ? 'pep' : '—')}</span>
    </span>
  )
}

export function ListaArquivos({ execucaoId, filtro, contagens, onLimparFiltro }: {
  execucaoId: string
  filtro: FiltroArquivos
  contagens?: Partial<Record<TipoArquivoLido, number>> & { total?: number }
  onLimparFiltro?: () => void
}) {
  const [tipo, setTipo] = useState<TipoArquivoLido | null>(filtro.tipo ?? null)
  const [ordem, setOrdem] = useState<OrdemArquivos>('caminho')
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [pagina, setPagina] = useState(0)
  const [dados, setDados] = useState<{ arquivos: ArquivoLidoCompleto[]; total: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState<ArquivoLidoCompleto | null>(null)

  const [filtroAnterior, setFiltroAnterior] = useState(filtro)
  if (filtroAnterior !== filtro) {
    setFiltroAnterior(filtro)
    setTipo(filtro.tipo ?? null)
    setPagina(0)
  }

  useEffect(() => {
    const t = setTimeout(() => { setBuscaAplicada(busca); setPagina(0) }, 300)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    let vivo = true
    const id = setTimeout(async () => {
      setCarregando(true)
      setErro(null)
      try {
        const r = await listarArquivosLidos({
          execucaoId, tipo, sigla: filtro.sigla, motivo: filtro.motivo,
          prestadorPastaId: filtro.prestadorPastaId, pacientePastaId: filtro.pacientePastaId,
          situacao: filtro.situacao, motivoPulsar: filtro.motivoPulsar, soNovos: filtro.soNovos,
          busca: buscaAplicada, ordem, pagina, tamanho: TAMANHO,
        })
        if (vivo) setDados(r)
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar os arquivos')
      } finally {
        if (vivo) setCarregando(false)
      }
    }, 0)
    return () => { vivo = false; clearTimeout(id) }
  }, [execucaoId, tipo, filtro.sigla, filtro.motivo, filtro.prestadorPastaId, filtro.pacientePastaId, filtro.situacao, filtro.motivoPulsar, filtro.soNovos, buscaAplicada, ordem, pagina])

  const total = dados?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / TAMANHO))
  const temFiltroExterno = !!(filtro.sigla || filtro.motivo || filtro.prestadorPastaId || filtro.pacientePastaId || filtro.situacao || filtro.motivoPulsar || filtro.soNovos)

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative w-full xl:max-w-xs">
          <label htmlFor={`busca-arquivos-${execucaoId}`} className="sr-only">Buscar arquivo, paciente ou pasta</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input id={`busca-arquivos-${execucaoId}`} value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar arquivo, paciente ou pasta"
            className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Tipo de arquivo">
          {FICHAS.map(f => {
            const n = f.tipo ? contagens?.[f.tipo] : contagens?.total
            if (f.tipo && !n) return null
            const ativo = tipo === f.tipo
            return (
              <button key={f.rotulo} type="button" aria-pressed={ativo} onClick={() => { setTipo(f.tipo); setPagina(0) }}
                className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  ativo ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-foreground hover:bg-muted/50'}`}>
                {f.rotulo}
                {n != null && <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${ativo ? 'bg-white/20' : 'bg-muted text-muted-foreground'}`}>{numero(n)}</span>}
              </button>
            )
          })}
        </div>
        <div className="flex shrink-0 gap-1 rounded-xl border border-border bg-muted/40 p-1 xl:ml-auto" role="group" aria-label="Ordenar">
          {ORDENS.map(o => (
            <button key={o.valor} type="button" aria-pressed={ordem === o.valor} onClick={() => { setOrdem(o.valor); setPagina(0) }}
              className={`h-9 rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                ordem === o.valor ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>

      {temFiltroExterno && onLimparFiltro && <Mostrando rotulo={filtro.rotulo ?? 'seleção'} total={total} onLimpar={onLimparFiltro} />}

      {erro && <p className="rounded-xl border border-border px-4 py-6 text-sm text-rose-700 dark:text-rose-400">{erro}</p>}
      {!erro && !dados && carregando && <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">Carregando arquivos…</p>}
      {!erro && dados && dados.arquivos.length === 0 && !carregando && (
        <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">Nenhum arquivo com esse filtro.</p>
      )}

      <ul className={`space-y-2 transition-opacity ${carregando && dados ? 'opacity-50' : ''}`} aria-busy={carregando}>
        {dados?.arquivos.map(a => {
          const p = partesDoCaminho(a.caminho)
          const sit = a.situacao ? SITUACAO[a.situacao] : null
          const nota = a.tipo === 'planilha' && a.detalhe
            ? (a.detalhe.usada ? 'planilha lida pelo robô' : rotuloMotivo(a.detalhe.motivo))
            : a.tipo === 'ignorado' || a.tipo === 'fora_padrao' ? rotuloMotivo(a.motivo)
              : a.situacao === 'nao_reconhecido' ? rotuloMotivo(a.motivo_pulsar) : null
          return (
            <li key={a.sp_id}>
              <div role="button" tabIndex={0} onClick={() => setAberto(a)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberto(a) } }}
                className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex-row lg:items-center lg:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Ladrinho a={a} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {a.web_url && a.tipo !== 'removido' ? (
                        <a href={a.web_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex min-w-0 items-center gap-1 rounded text-sm font-bold text-foreground hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-sky-400">
                          <span className="truncate">{a.nome}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="sr-only">(abre no SharePoint)</span>
                        </a>
                      ) : (
                        <span className={`truncate text-sm font-bold ${a.tipo === 'removido' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{a.nome}</span>
                      )}
                      {a.novo && <StatusChip tone="blue" dense>novo</StatusChip>}
                    </div>
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                      {[p.prestador, p.paciente, p.pasta].filter(Boolean).map((seg, i, arr) => (
                        <span key={i} className="inline-flex min-w-0 items-center gap-1">
                          <span className="truncate">{seg}</span>
                          {i < arr.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />}
                        </span>
                      ))}
                    </p>
                    {nota && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/90">{nota}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-3 divide-x divide-border text-left lg:w-[27rem] lg:shrink-0">
                  <div className="px-3 first:pl-0 lg:first:pl-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Competência</p>
                    <p className="text-base font-black leading-tight tabular-nums text-foreground">{mesBR(a.competencia_pulsar ?? a.competencia)}</p>
                  </div>
                  <div className="px-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Enviado</p>
                    <p className="text-sm font-bold leading-tight tabular-nums text-foreground">{a.criado_em_sp ? dataHora(a.criado_em_sp) : '—'}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{a.criado_por ?? ''}</p>
                  </div>
                  <div className="px-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Situação</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {sit ? <StatusChip tone={sit.tom} dense>{sit.rotulo}</StatusChip> : <StatusChip tone={TOM[a.tipo]} dense>{TIPOS_ARQUIVO[a.tipo]?.rotulo}</StatusChip>}
                    </div>
                  </div>
                </div>
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 lg:block" aria-hidden />
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite">{numero(total)} arquivo(s){paginas > 1 ? ` · página ${pagina + 1} de ${paginas}` : ''}</span>
        {paginas > 1 && (
          <div className="flex gap-1.5">
            <button type="button" disabled={pagina === 0 || carregando} onClick={() => setPagina(p => p - 1)}
              className="inline-flex h-11 items-center gap-1 rounded-lg border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" aria-hidden /> Anterior
            </button>
            <button type="button" disabled={pagina + 1 >= paginas || carregando} onClick={() => setPagina(p => p + 1)}
              className="inline-flex h-11 items-center gap-1 rounded-lg border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-muted disabled:opacity-40">
              Próxima <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {aberto && <ModalArquivo arquivo={aberto} onClose={() => setAberto(null)} />}
    </div>
  )
}
