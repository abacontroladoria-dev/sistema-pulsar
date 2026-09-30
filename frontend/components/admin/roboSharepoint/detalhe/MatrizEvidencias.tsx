'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { StatusChip, TONE_CHIP } from '@/components/ui/tones'
import { ITENS_PEP, nomeCurtoPrestador, numero, rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import { obterMatrizEvidencias } from '@/services/roboSharepoint.service'
import type { MatrizEvidencias as Matriz, SpItemStatus } from '@/types/roboSharepoint'

// As 72 evidências no formato da tela PEP: por prestador, uma tabela com os
// pacientes nas linhas e os itens nas colunas (Geral: STC, ETC; por paciente:
// TAP, TOP, PIC, RT, OE). A célula diz quantos arquivos há e em que situação
// estão; clicar nela filtra a lista de arquivos logo abaixo.

export type CelulaEscolhida = { prestadorPastaId: string; pacientePastaId: string | null; sigla: string; rotulo: string }

const GERAL = ['STC', 'ETC']
const POR_PACIENTE = ['TAP', 'TOP', 'PIC', 'RT', 'OE']

type Soma = Partial<Record<SpItemStatus, number>>
const total = (s?: Soma) => Object.values(s ?? {}).reduce((a, b) => a + (b ?? 0), 0)
/** A cor da célula segue a situação mais adiantada que ela tem. */
function tomDaCelula(s?: Soma) {
  if (!s || !total(s)) return null
  if (s.confirmado) return 'green'
  if (s.sugerido) return 'blue'
  if (s.nao_reconhecido) return 'amber'
  return 'gray'
}
const ROTULO: Record<string, string> = { sugerido: 'sugestão', confirmado: 'confirmada', nao_reconhecido: 'não reconhecido', ignorado: 'ignorada', removido: 'apagado' }

function Celula({ soma, ativa, onClick }: { soma?: Soma; ativa: boolean; onClick: () => void }) {
  const n = total(soma)
  const tom = tomDaCelula(soma)
  if (!n || !tom) return <span className="flex h-10 items-center justify-center text-sm text-muted-foreground/40">·</span>
  const dica = Object.entries(soma ?? {}).filter(([, v]) => v).map(([k, v]) => `${v} ${ROTULO[k] ?? k}`).join(' · ')
  return (
    <button type="button" onClick={onClick} aria-pressed={ativa} title={dica} aria-label={`${n} arquivo(s): ${dica}`}
      className={`flex h-10 w-full items-center justify-center gap-1 rounded-lg text-sm font-black tabular-nums transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${TONE_CHIP[tom].bg} ${TONE_CHIP[tom].text} ${ativa ? 'ring-2 ring-foreground/40' : ''}`}>
      {numero(n)}
    </button>
  )
}

export function MatrizEvidencias({ execucaoId, escolhida, onEscolher }: {
  execucaoId: string
  escolhida: CelulaEscolhida | null
  onEscolher: (c: CelulaEscolhida | null) => void
}) {
  const [m, setM] = useState<Matriz | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [soComEvidencia, setSoComEvidencia] = useState(true)

  useEffect(() => {
    let vivo = true
    obterMatrizEvidencias(execucaoId)
      .then(r => { if (vivo) setM(r) })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível montar a matriz') })
    return () => { vivo = false }
  }, [execucaoId])

  // prestador → (paciente|'geral') → sigla → situação → n
  const somas = useMemo(() => {
    const mapa = new Map<string, Map<string, Map<string, Soma>>>()
    for (const c of m?.celulas ?? []) {
      if (!c.prestador_pasta_id) continue
      const p = mapa.get(c.prestador_pasta_id) ?? new Map(); mapa.set(c.prestador_pasta_id, p)
      const chave = c.paciente_pasta_id ?? 'geral'
      const l = p.get(chave) ?? new Map(); p.set(chave, l)
      const s = l.get(c.sigla) ?? {}; s[c.situacao] = (s[c.situacao] ?? 0) + c.n; l.set(c.sigla, s)
    }
    return mapa
  }, [m])

  if (erro) return <p className="text-sm text-amber-800 dark:text-amber-300">{erro} (a migration 20261001140000 já foi aplicada?)</p>
  if (!m) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Montando a matriz…</p>

  const prestadores = m.prestadores
    .map(p => ({ ...p, n: [...(somas.get(p.pasta_id)?.values() ?? [])].reduce((a, l) => a + [...l.values()].reduce((b, s) => b + total(s), 0), 0) }))
    .filter(p => !soComEvidencia || p.n > 0)
    .sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {[['blue', 'sugestão'], ['green', 'confirmada'], ['amber', 'não reconhecido']].map(([t, r]) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded ${TONE_CHIP[t as 'blue'].bg}`} aria-hidden />{r}
            </span>
          ))}
          <span>· = nenhum arquivo</span>
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={soComEvidencia} onChange={e => setSoComEvidencia(e.target.checked)} className="h-4 w-4 accent-slate-700" />
          Só prestadores com evidência
        </label>
      </div>

      {prestadores.map(p => {
        const linhas = somas.get(p.pasta_id)
        const pacientes = m.pacientes.filter(x => x.prestador_pasta_id === p.pasta_id)
          .sort((a, b) => Number(!!linhas?.get(b.pasta_id)) - Number(!!linhas?.get(a.pasta_id)) || a.nome.localeCompare(b.nome))
        const escolher = (pacientePastaId: string | null, sigla: string, nomePac: string) => {
          const mesma = escolhida && escolhida.prestadorPastaId === p.pasta_id && escolhida.pacientePastaId === pacientePastaId && escolhida.sigla === sigla
          onEscolher(mesma ? null : { prestadorPastaId: p.pasta_id, pacientePastaId, sigla, rotulo: `${sigla} · ${nomePac} · ${nomeCurtoPrestador(p.nome)}` })
        }
        const ativa = (pac: string | null, s: string) => !!escolhida && escolhida.prestadorPastaId === p.pasta_id && escolhida.pacientePastaId === pac && escolhida.sigla === s
        return (
          <section key={p.pasta_id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
              <span className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-xl ${TONE_CHIP[p.n ? 'blue' : 'gray'].bg} ${TONE_CHIP[p.n ? 'blue' : 'gray'].text}`}>
                <span className="text-lg font-black leading-none tabular-nums">{numero(p.n)}</span>
                <span className="text-[8px] font-bold uppercase tracking-wide">evid.</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-foreground">{nomeCurtoPrestador(p.nome)}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.prestador_nome ? `No Pulsar: ${p.prestador_nome}` : 'prestador ainda não reconhecido'}</span>
              </span>
              {p.status === 'reconhecido' ? <StatusChip tone="green">reconhecido</StatusChip> : <StatusChip tone="amber">não reconhecido</StatusChip>}
              {p.web_url && (
                <a href={p.web_url} target="_blank" rel="noreferrer" aria-label="Abrir no SharePoint"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="h-4 w-4" aria-hidden /></a>
              )}
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed text-xs">
                <colgroup>
                  <col style={{ width: '30%' }} />
                  {[...GERAL, ...POR_PACIENTE].map(s => <col key={s} style={{ width: `${70 / 7}%` }} />)}
                </colgroup>
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="px-3 py-2.5 text-left font-semibold">Paciente</th>
                    {[...GERAL, ...POR_PACIENTE].map((s, i) => (
                      <th key={s} className={`px-1.5 py-2.5 text-center font-semibold ${i === GERAL.length ? 'border-l border-border' : ''}`}
                        title={ITENS_PEP.find(x => x.sigla === s)?.nome}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border/70 bg-muted/20">
                    <td className="px-3 py-1.5 font-semibold text-foreground">Geral <span className="font-normal text-muted-foreground">(sem paciente)</span></td>
                    {GERAL.map(s => (
                      <td key={s} className="px-1.5 py-1.5"><Celula soma={linhas?.get('geral')?.get(s)} ativa={ativa(null, s)} onClick={() => escolher(null, s, 'Geral')} /></td>
                    ))}
                    {POR_PACIENTE.map((s, i) => <td key={s} className={i === 0 ? 'border-l border-border' : ''} />)}
                  </tr>
                  {pacientes.map(x => (
                    <tr key={x.pasta_id} className="border-t border-border/70 hover:bg-muted/30">
                      <td className="px-3 py-1.5">
                        <span className="block truncate font-semibold text-foreground" title={x.nome}>{x.nome}</span>
                        <span className={`block truncate text-[11px] ${x.status === 'reconhecido' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}>
                          {x.status === 'reconhecido' ? x.paciente_nome : rotuloMotivo(x.motivo)}
                        </span>
                      </td>
                      {GERAL.map(s => <td key={s} />)}
                      {POR_PACIENTE.map((s, i) => (
                        <td key={s} className={`px-1.5 py-1.5 ${i === 0 ? 'border-l border-border' : ''}`}>
                          <Celula soma={linhas?.get(x.pasta_id)?.get(s)} ativa={ativa(x.pasta_id, s)} onClick={() => escolher(x.pasta_id, s, x.nome)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
