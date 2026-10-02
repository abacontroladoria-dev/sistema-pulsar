'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink, FileDown, FileSpreadsheet, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { StatusChip, TONE_CHIP } from '@/components/ui/tones'
import { dataHora, nomeCurtoPrestador, numero, rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import { obterArvorePastas } from '@/services/roboSharepoint.service'
import { carregarRelatorioPrestador, competenciaAtual } from '@/services/relatorioPrestadorPep.service'
import { rotuloMes } from '@/lib/roboSharepoint/relatorioPrestador'
import type { ArvorePastas, NoPasta, ResumoPrestadorLido } from '@/types/roboSharepoint'
import { Barra, corBarra, Sigla, TOM } from './Blocos'

// As 1.769 pastas, navegáveis como no SharePoint: prestador → seções →
// pacientes → as 7 subpastas → os arquivos. Cada nível é pedido ao banco só
// quando abre (sp_pep_arvore_pastas), então o site inteiro cabe sem estourar
// nada. "Abrir tudo" num prestador desce a árvore dele inteira.

import { tom } from '@/components/ui/pastel/pecas'

function razaoSocial(nomePasta: string) {
  return /\(([^()]+)\)\s*$/.exec(nomePasta)?.[1] ?? null
}

function No({ execucaoId, no, nivel, forcar, pastel }: { execucaoId: string; no: NoPasta; nivel: number; forcar: boolean; pastel?: boolean }) {
  const temConteudo = no.subpastas > 0 || no.arquivos > 0
  const [aberto, setAberto] = useState(forcar && temConteudo)
  const [filhos, setFilhos] = useState<ArvorePastas | null>(null)
  const [carregando, setCarregando] = useState(false)

  const [forcarAnterior, setForcarAnterior] = useState(forcar)
  if (forcarAnterior !== forcar) { setForcarAnterior(forcar); if (temConteudo) setAberto(forcar) }

  useEffect(() => {
    if (!aberto || filhos || !temConteudo) return
    let vivo = true
    const id = setTimeout(async () => {
      setCarregando(true)
      try { const r = await obterArvorePastas(execucaoId, no.id); if (vivo) setFilhos(r) } finally { if (vivo) setCarregando(false) }
    }, 0)
    return () => { vivo = false; clearTimeout(id) }
  }, [aberto, filhos, temConteudo, execucaoId, no.id])

  const vazia = !temConteudo
  return (
    <li>
      <div className={`group flex min-h-11 items-center gap-2 rounded-lg pr-2 transition-colors ${vazia ? 'opacity-55' : pastel ? 'hover:bg-[var(--c-suave)]' : 'hover:bg-muted/50'}`}
        style={{ paddingLeft: `${nivel * 20 + 4}px` }}>
        <button type="button" disabled={vazia} onClick={() => setAberto(v => !v)} aria-expanded={aberto}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          {vazia ? <span className="w-4" /> : aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          {aberto ? <FolderOpen className={`h-4 w-4 shrink-0 ${pastel ? 'text-amber-500' : 'text-amber-600 dark:text-amber-400'}`} aria-hidden /> : <Folder className={`h-4 w-4 shrink-0 ${vazia ? 'text-muted-foreground' : pastel ? 'text-amber-500' : 'text-amber-600 dark:text-amber-400'}`} aria-hidden />}
          <span className={`truncate text-sm font-medium ${pastel ? 'text-[var(--pp-ink)]' : 'text-foreground'}`}>{no.nome}</span>
          {no.papel === 'paciente' && (pastel ? <span className={`${tom('cinza')} pp-selo-motivo`}>paciente</span> : <StatusChip tone="gray" dense>paciente</StatusChip>)}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          {vazia ? <span className="italic">vazia</span> : (
            <>
              {no.arquivos > 0 && (pastel ? <span className={`${tom('cinza')} pp-pilula !h-5 !text-[10px]`}><span className="pp-pilula-bola">{numero(no.arquivos)}</span> arq.</span> : <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-foreground">{numero(no.arquivos)} arq.</span>)}
              {no.evidencias > 0 && (pastel ? <span className={`${tom('azul')} pp-pilula !h-5 !text-[10px]`}><span className="pp-pilula-bola">{numero(no.evidencias)}</span> evid.</span> : <span className={`rounded-full px-2 py-0.5 font-semibold ${TONE_CHIP.blue.bg} ${TONE_CHIP.blue.text}`}>{numero(no.evidencias)} evid.</span>)}
              {no.subpastas > 0 && <span>{numero(no.subpastas)} pasta(s)</span>}
            </>
          )}
          {no.web_url && (
            <a href={no.web_url} target="_blank" rel="noreferrer" aria-label={`Abrir a pasta ${no.nome} no SharePoint`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </span>
      </div>

      {aberto && (
        <div className="relative">
          <span className="pointer-events-none absolute bottom-2 top-0 border-l border-dashed border-border" style={{ left: `${nivel * 20 + 11}px` }} aria-hidden />
          {carregando && !filhos && (
            <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground" style={{ paddingLeft: `${(nivel + 1) * 20 + 4}px` }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> abrindo…
            </p>
          )}
          {filhos && (
            <ul>
              {filhos.pastas.map(f => <No key={f.id} execucaoId={execucaoId} no={f} nivel={nivel + 1} forcar={forcar} pastel={pastel} />)}
              {filhos.arquivos.map(a => {
                const corIcone = a.tipo === 'evidencia' ? (pastel ? 'text-[var(--pp-verde-tinta)]' : 'text-sky-600 dark:text-sky-400') : 'text-muted-foreground'
                const tomPastel = a.tipo === 'evidencia' ? 'verde' : a.tipo === 'planilha' ? 'azul' : a.tipo === 'fora_padrao' ? 'amber' : 'cinza'
                const rotuloA = a.tipo === 'evidencia' ? 'evidência' : a.tipo === 'planilha' ? 'planilha' : a.tipo === 'fora_padrao' ? 'fora do padrão' : 'fora do PEP'
                return (
                  <li key={a.sp_id} className={`flex min-h-10 items-center gap-2 rounded-lg pr-2 ${pastel ? 'hover:bg-[var(--c-suave)]' : 'hover:bg-muted/50'}`} style={{ paddingLeft: `${(nivel + 1) * 20 + 24}px` }}>
                    {a.tipo === 'planilha' ? <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <FileText className={`h-4 w-4 shrink-0 ${corIcone}`} aria-hidden />}
                    {!pastel && <Sigla sigla={a.sigla} />}
                    {a.web_url ? (
                      <a href={a.web_url} target="_blank" rel="noreferrer" className={`min-w-0 truncate text-sm ${pastel ? 'text-[var(--pp-ink)] hover:text-[var(--c-forte)]' : 'text-foreground hover:text-sky-700 dark:hover:text-sky-400'} hover:underline`}>{a.nome}</a>
                    ) : <span className={`min-w-0 truncate text-sm ${pastel ? 'text-[var(--pp-ink)]' : 'text-foreground'}`}>{a.nome}</span>}
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      {(a.tipo === 'ignorado' || a.tipo === 'fora_padrao') && <span className="hidden truncate md:inline">{rotuloMotivo(a.motivo)}</span>}
                      {pastel ? <span className={`${tom(tomPastel)} pp-selo-motivo`}>{rotuloA}</span> : <StatusChip tone={TOM[a.tipo]} dense>{rotuloA}</StatusChip>}
                      <span className="tabular-nums">{dataHora(a.criado_em_sp)}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function BotaoPdfPrestador({ no, competencia, pastel }: { no: NoPasta; competencia: string; pastel?: boolean }) {
  const [gerando, setGerando] = useState(false)
  const nome = nomeCurtoPrestador(no.nome)

  async function gerar() {
    setGerando(true)
    try {
      const [{ gerarPdfRelatorio, baixarPdf }, relatorio] = await Promise.all([
        import('@/lib/roboSharepoint/relatorioPrestadorPdf'),
        carregarRelatorioPrestador(no.id, no.nome, competencia),
      ])
      const bytes = await gerarPdfRelatorio(relatorio)
      const slug = relatorio.razaoSocial.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      baixarPdf(bytes, `Pendencias-PEP-${slug}-${competencia}.pdf`)
      toast.success(`Pendências de ${nome} (${rotuloMes(competencia)}) baixadas em PDF.`)
    } catch (e) {
      toast.error(e instanceof Error ? `Não foi possível gerar o PDF: ${e.message}` : 'Não foi possível gerar o PDF')
    } finally {
      setGerando(false)
    }
  }

  return (
    <button type="button" onClick={gerar} disabled={gerando}
      title={`Baixar pendências em PDF: o que está nas pastas e o que falta entregar em ${rotuloMes(competencia)}`}
      aria-label={`Baixar pendências de ${nome} em PDF (${rotuloMes(competencia)})`}
      className={pastel
        ? `${tom('vermelho')} flex w-full shrink-0 items-center justify-center gap-2 border-t border-[var(--c-linha)] bg-[var(--c-suave)] px-4 py-3 text-sm font-semibold text-[var(--c-tinta)] transition-colors hover:bg-[var(--pp-surface)] focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 xl:w-28 xl:flex-col xl:gap-1 xl:border-l xl:border-t-0 xl:px-2`
        : "flex w-full shrink-0 items-center justify-center gap-2 border-t border-border px-4 py-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 dark:text-rose-300 dark:hover:bg-rose-950/40 xl:w-28 xl:flex-col xl:gap-1 xl:border-l xl:border-t-0 xl:px-2"
      }>
      {gerando
        ? <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden />
        : <FileDown className="h-6 w-6" aria-hidden />}
      <span className="text-center text-xs font-bold leading-tight">{gerando ? 'Gerando…' : 'Baixar pendências em PDF'}</span>
    </button>
  )
}

function CartaoPrestador({ execucaoId, no, resumo, apagado, competencia, pastel }: { execucaoId: string; no: NoPasta; resumo?: ResumoPrestadorLido; apagado: boolean; competencia: string; pastel?: boolean }) {
  const [aberto, setAberto] = useState(false)
  const [tudo, setTudo] = useState(false)
  const [filhos, setFilhos] = useState<ArvorePastas | null>(null)

  useEffect(() => {
    if (!aberto || filhos) return
    let vivo = true
    obterArvorePastas(execucaoId, no.id).then(r => { if (vivo) setFilhos(r) })
    return () => { vivo = false }
  }, [aberto, filhos, execucaoId, no.id])

  const t = no.arquivos > 0 ? 'azul' : 'cinza'
  const temPlanilha = resumo?.tem_planilha
  return (
    <li className={pastel
      ? `pp pp-cartao is-compacto transition-opacity ${apagado ? 'opacity-35' : ''}`
      : `overflow-hidden rounded-2xl border bg-card transition-opacity ${aberto ? 'border-foreground/20 shadow-sm' : 'border-border'} ${apagado ? 'opacity-35' : ''}`
    }>
      <div className="flex flex-col xl:flex-row xl:items-stretch">
      <button type="button" aria-expanded={aberto} onClick={() => setAberto(v => !v)}
        className={`flex min-w-0 flex-1 flex-col gap-4 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:flex-row xl:items-center ${pastel ? 'hover:bg-[var(--c-suave)]' : 'hover:bg-muted/30'}`}>
        <span className="flex min-w-0 flex-1 items-center gap-4">
          {pastel ? (
            <span className={`${tom(t)} flex size-16 shrink-0 flex-col items-center justify-center rounded-xl bg-[var(--c-suave)] text-[var(--c-tinta)] border border-[var(--c-linha)]`}>
              <span className="text-2xl font-black leading-none tabular-nums">{numero(no.arquivos)}</span>
              <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide">arquivos</span>
            </span>
          ) : (
            <span className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-xl ${TONE_CHIP[t === 'azul' ? 'blue' : 'gray'].bg} ${TONE_CHIP[t === 'azul' ? 'blue' : 'gray'].text}`}>
              <span className="text-2xl font-black leading-none tabular-nums">{numero(no.arquivos)}</span>
              <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide">arquivos</span>
            </span>
          )}
          <span className="min-w-0">
            <span className={`block truncate text-base font-bold ${pastel ? 'text-[var(--pp-ink)]' : 'text-foreground'}`}>{nomeCurtoPrestador(no.nome)}</span>
            <span className={`block truncate text-xs ${pastel ? 'text-[var(--pp-ink-muted)]' : 'text-muted-foreground'}`}>{razaoSocial(no.nome) ?? no.nome}</span>
            {resumo && resumo.pastas_paciente > 0 && (
              <span className="mt-2 flex max-w-xs items-center gap-2">
                {pastel ? (
                  <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-[var(--pp-border)]">
                    <span className="h-full bg-[var(--pp-verde)]" style={{ width: `${(resumo.evidencias / Math.max(no.arquivos, 1)) * 100}%` }} />
                  </div>
                ) : <Barra pct={(resumo.evidencias / Math.max(no.arquivos, 1)) * 100} cor={corBarra('blue')} />}
                <span className={`shrink-0 text-[11px] tabular-nums ${pastel ? 'text-[var(--pp-ink-muted)]' : 'text-muted-foreground'}`}>{numero(resumo.evidencias)} de {numero(no.arquivos)} são evidência</span>
              </span>
            )}
          </span>
        </span>
        <span className={`grid grid-cols-4 divide-x ${pastel ? 'divide-[var(--pp-border)]' : 'divide-border'} xl:w-[30rem] xl:shrink-0 xl:border-l xl:pl-6 ${pastel ? 'xl:border-[var(--pp-border)]' : 'xl:border-border'}`}>
          {[
            { r: 'Pastas', v: numero(no.subpastas) },
            { r: 'Pacientes', v: numero(resumo?.pastas_paciente ?? 0) },
            { r: 'Evidências', v: numero(no.evidencias) },
          ].map(m => (
            <span key={m.r} className="px-3 first:pl-0">
              <span className={`block text-[11px] font-medium ${pastel ? 'text-[var(--pp-ink-muted)]' : 'text-muted-foreground'}`}>{m.r}</span>
              <span className={`block text-lg font-black leading-tight tabular-nums ${pastel ? 'text-[var(--pp-ink)]' : 'text-foreground'}`}>{m.v}</span>
            </span>
          ))}
          <span className="px-3">
            <span className={`block text-[11px] font-medium ${pastel ? 'text-[var(--pp-ink-muted)]' : 'text-muted-foreground'}`}>Planilha</span>
            <span className="mt-1 block">{temPlanilha ? (pastel ? <span className={`${tom('verde')} pp-selo-motivo`}>tem</span> : <StatusChip tone="green" dense>tem</StatusChip>) : (pastel ? <span className={`${tom('amber')} pp-selo-motivo`}>falta</span> : <StatusChip tone="amber" dense>falta</StatusChip>)}</span>
          </span>
        </span>
        <ChevronDown className={`hidden h-5 w-5 shrink-0 text-muted-foreground transition-transform xl:block ${aberto ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <BotaoPdfPrestador no={no} competencia={competencia} pastel={pastel} />
      </div>

      {aberto && (
        <div className={`border-t px-2 pb-3 pt-2 sm:px-4 ${pastel ? 'border-[var(--pp-border)] bg-[var(--pp-surface)]' : 'border-border/70 bg-muted/20'}`}>
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${pastel ? 'text-[var(--pp-ink-muted)]' : 'text-muted-foreground'}`}>Pastas de {nomeCurtoPrestador(no.nome)}</p>
            <div className="flex gap-1">
              {no.web_url && (
                <a href={no.web_url} target="_blank" rel="noreferrer"
                  className={`inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold hover:bg-muted ${pastel ? 'text-[var(--pp-ink-muted)] hover:text-[var(--pp-ink)]' : 'text-muted-foreground hover:text-foreground'}`}>
                  Abrir no SharePoint <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
              <button type="button" onClick={() => setTudo(v => !v)}
                className={`inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pastel ? 'border-[var(--pp-border)] text-[var(--pp-ink)] bg-transparent hover:bg-[var(--c-suave)]' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
                {tudo ? <><ChevronsDownUp className="h-3.5 w-3.5" aria-hidden /> Recolher tudo</> : <><ChevronsUpDown className="h-3.5 w-3.5" aria-hidden /> Abrir tudo</>}
              </button>
            </div>
          </div>
          {!filhos ? (
            <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> abrindo…</p>
          ) : (
            <ul className="pp-arvore">{filhos.pastas.map(f => <No key={f.id} execucaoId={execucaoId} no={f} nivel={0} forcar={tudo} pastel={pastel} />)}</ul>
          )}
        </div>
      )}
    </li>
  )
}

export function ExploradorPastas({ execucaoId, resumoPrestadores, filtroPrestador, competencia, pastel }: {
  execucaoId: string
  competencia?: string
  resumoPrestadores: ResumoPrestadorLido[]
  filtroPrestador?: 'com' | 'sem' | null
  pastel?: boolean
}) {
  const [raiz, setRaiz] = useState<ArvorePastas | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    obterArvorePastas(execucaoId, null)
      .then(r => { if (vivo) setRaiz(r) })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível abrir as pastas') })
    return () => { vivo = false }
  }, [execucaoId])

  if (erro) return <p className="text-sm text-amber-800 dark:text-amber-300">{erro} (a migration 20261001140000 já foi aplicada?)</p>
  if (!raiz) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Carregando as pastas…</p>

  const porId = new Map(resumoPrestadores.map(p => [p.pasta_id, p]))
  const ordenados = [...raiz.pastas].sort((a, b) => b.arquivos - a.arquivos || a.nome.localeCompare(b.nome))
  return (
    <ul className="space-y-2">
      {ordenados.map(no => (
        <CartaoPrestador key={no.id} execucaoId={execucaoId} no={no} resumo={porId.get(no.id)} competencia={competencia ?? competenciaAtual()}
          apagado={filtroPrestador === 'com' ? no.arquivos === 0 : filtroPrestador === 'sem' ? no.arquivos > 0 : false} pastel={pastel} />
      ))}
    </ul>
  )
}
