'use client'

import { useMemo, useState } from 'react'
import { Check, ExternalLink, Minus, Search, X } from 'lucide-react'
import { StatusChip, TONE_CHIP } from '@/components/ui/tones'
import { nomeCurtoPrestador, numero, rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import type { PacienteDetalhe } from '@/types/roboSharepoint'

// Cada paciente, de onde quer que ele apareça: na aba "Pacientes" de uma
// planilha, numa pasta de "3. Pacientes", ou nos dois. O cartão diz o que o
// robô conseguiu ligar (os 4 sinais), com quem no Pulsar, e o que já existe
// dele no SharePoint (arquivos por item) e no planejamento.

type Filtro = 'todos' | 'reconhecidos' | 'nao' | 'sem_pasta' | 'fora_planilha'

const SINAIS = [
  { chave: 'na_planilha', rotulo: 'Planilha' },
  { chave: 'cpf_valido', rotulo: 'CPF' },
  { chave: 'no_cadastro', rotulo: 'Cadastro' },
  { chave: 'nome_compativel', rotulo: 'Nome' },
] as const

const ORDEM_SIGLAS = ['TAP', 'TOP', 'PIC', 'RT', 'OE']
const mesAbrev = (c: string | null) => {
  if (!c) return 'sem data'
  const [a, m] = c.split('-')
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${a.slice(2)}`
}

function Sinal({ valor, rotulo }: { valor: boolean | undefined | null; rotulo: string }) {
  const Icone = valor == null ? Minus : valor ? Check : X
  const tom = valor == null ? 'gray' : valor ? 'green' : 'amber'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CHIP[tom].bg} ${TONE_CHIP[tom].text}`}>
      <Icone className="h-3 w-3" aria-hidden />{rotulo}
      <span className="sr-only">{valor == null ? ': não avaliado' : valor ? ': sim' : ': não'}</span>
    </span>
  )
}

function iniciais(nome: string) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('')
}

export function ListaPacientes({ pacientes }: { pacientes: PacienteDetalhe[] }) {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')

  const contagem = useMemo(() => ({
    todos: pacientes.length,
    reconhecidos: pacientes.filter(p => p.status === 'reconhecido').length,
    nao: pacientes.filter(p => p.status !== 'reconhecido').length,
    sem_pasta: pacientes.filter(p => !p.pasta_id).length,
    fora_planilha: pacientes.filter(p => !p.na_planilha).length,
  }), [pacientes])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase('pt-BR')
    return pacientes.filter(p => {
      if (filtro === 'reconhecidos' && p.status !== 'reconhecido') return false
      if (filtro === 'nao' && p.status === 'reconhecido') return false
      if (filtro === 'sem_pasta' && p.pasta_id) return false
      if (filtro === 'fora_planilha' && p.na_planilha) return false
      if (t && !`${p.nome} ${p.paciente_nome ?? ''} ${p.prestador_nome_pasta ?? ''}`.toLocaleLowerCase('pt-BR').includes(t)) return false
      return true
    })
  }, [pacientes, filtro, busca])

  const grupos = useMemo(() => {
    const m = new Map<string, PacienteDetalhe[]>()
    for (const p of visiveis) {
      const k = p.prestador_nome_pasta ?? '—'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    return [...m.entries()]
  }, [visiveis])

  const FICHAS: { k: Filtro; r: string }[] = [
    { k: 'todos', r: 'Todos' },
    { k: 'reconhecidos', r: 'Reconhecidos' },
    { k: 'nao', r: 'Não reconhecidos' },
    { k: 'sem_pasta', r: 'Na planilha, sem pasta' },
    { k: 'fora_planilha', r: 'Pasta fora da planilha' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-xs">
          <label htmlFor="busca-pacientes" className="sr-only">Buscar paciente</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input id="busca-pacientes" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar paciente ou prestador"
            className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtrar pacientes">
          {FICHAS.map(f => (
            <button key={f.k} type="button" aria-pressed={filtro === f.k} onClick={() => setFiltro(f.k)}
              className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                filtro === f.k ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-foreground hover:bg-muted/50'}`}>
              {f.r}
              <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${filtro === f.k ? 'bg-white/20' : 'bg-muted text-muted-foreground'}`}>{numero(contagem[f.k])}</span>
            </button>
          ))}
        </div>
      </div>

      {grupos.length === 0 && <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">Nenhum paciente com esse filtro.</p>}

      {grupos.map(([prestador, lista]) => (
        <section key={prestador}>
          <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
            <h4 className="text-sm font-bold text-foreground">{nomeCurtoPrestador(prestador)}</h4>
            <span className="text-xs tabular-nums text-muted-foreground">
              {lista.filter(p => p.status === 'reconhecido').length} de {lista.length} reconhecidos
            </span>
          </div>
          <ul className="grid gap-2 xl:grid-cols-2">
            {lista.map((p, i) => {
              const ok = p.status === 'reconhecido'
              const tom = ok ? 'green' : 'amber'
              const s = p.sinais ?? {}
              const arquivos = ORDEM_SIGLAS.filter(sg => p.arquivos_por_sigla?.[sg])
              return (
                <li key={`${p.pasta_id ?? p.nome}-${i}`} className="flex gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/25">
                  <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-black ${TONE_CHIP[tom].bg} ${TONE_CHIP[tom].text}`} aria-hidden>
                    {iniciais(p.nome)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{p.nome}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {ok ? <>No Pulsar: <span className="font-medium text-foreground">{p.paciente_nome}</span>{p.origem === 'agenda' ? ' · pela agenda do TiTa' : p.origem === 'manual' ? ' · vinculado à mão' : ''}</>
                            : rotuloMotivo(p.motivo)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <StatusChip tone={tom} dense>{ok ? 'reconhecido' : 'não reconhecido'}</StatusChip>
                        {p.web_url && (
                          <a href={p.web_url} target="_blank" rel="noreferrer" aria-label={`Abrir a pasta de ${p.nome} no SharePoint`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      <Sinal valor={p.na_planilha} rotulo={SINAIS[0].rotulo} />
                      <Sinal valor={p.na_planilha ? p.cpf_valido : null} rotulo={SINAIS[1].rotulo} />
                      <Sinal valor={s.no_cadastro ?? null} rotulo={SINAIS[2].rotulo} />
                      <Sinal valor={s.nome_compativel ?? null} rotulo={SINAIS[3].rotulo} />
                      {!p.pasta_id && <StatusChip tone="amber" dense>sem pasta no SharePoint</StatusChip>}
                    </div>

                    <div className="mt-2 grid grid-cols-2 divide-x divide-border text-[11px]">
                      <div className="pr-3">
                        <p className="font-medium text-muted-foreground">Arquivos no SharePoint</p>
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {arquivos.length ? arquivos.map(sg => (
                            <span key={sg} className={`rounded-md px-1.5 py-0.5 font-bold tabular-nums ${TONE_CHIP.blue.bg} ${TONE_CHIP.blue.text}`}>{sg} {p.arquivos_por_sigla[sg]}</span>
                          )) : <span className="text-muted-foreground/70">nenhum ainda</span>}
                        </p>
                      </div>
                      <div className="pl-3">
                        <p className="font-medium text-muted-foreground">Planejamento</p>
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {p.planejamento.length ? p.planejamento.map((l, j) => (
                            <span key={j} className="rounded-md bg-muted px-1.5 py-0.5 font-semibold text-foreground">{l.sigla ?? '?'} {mesAbrev(l.competencia)}</span>
                          )) : <span className="text-muted-foreground/70">sem linhas</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
