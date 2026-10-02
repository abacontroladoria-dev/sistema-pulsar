'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Bot, Check, CheckCircle2, Copy, ExternalLink, FileSpreadsheet, FileWarning, FolderSearch, Hand, Pencil,
  Pointer, Send, UserCheck, Users,
} from 'lucide-react'
import { numero, rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import type { SpFilaPendencias, SpItem, SpPendenciaPasta } from '@/types/roboSharepoint'
import { CartaoPrestador } from './precisaDeVoce/CartaoPrestador'
import { CATEGORIAS, CartaoPasta, ORDEM_CATEGORIAS, categoriaDa, type CategoriaPasta } from './precisaDeVoce/CartaoPasta'
import { AnelProgresso, BotaoAjuda, Comemoracao, Fluxo, TudoEmDia, tom, type PassoFluxo, type Tom } from './precisaDeVoce/pecas'

// "O que precisa de você" — o que o robô não conseguiu resolver sozinho, como
// TAREFAS para quem nem sabe o que é PEP. Redesenho de 02/10/2026: abas-cartão
// coloridas com o contador grande, o "como resolver" em 3 ícones e cartões que
// ficam verdes quando a pessoa age. Pouco texto: a cor e o ícone dizem o que
// fazer, a explicação mora no "?" e nos title.
//
// Cores (tokens .pp-* em app/globals.css, pastéis): âmbar = esperando o
// prestador; aço da marca = ação que se faz aqui e "Comece aqui"; verde =
// feito; violeta = o robô (mesmo sentido do resto da PEP); azul/rosa/coral =
// os três motivos de pasta sem dono.
//
// Só a camada visual mudou: os dados (listarPendenciasDePasta), a mensagem
// copiada (mensagemPedirPlanilha) e a gravação do vínculo (sp_pep_vincular_pasta)
// são os de antes.

const MOTIVOS_DE_PASTA = new Set([
  'planilha_ausente', 'cnpj_ausente', 'cnpj_invalido', 'cnpj_nao_cadastrado', 'cnpj_duplicado',
  'paciente_fora_da_planilha', 'cpf_ausente', 'cpf_invalido', 'cpf_nao_encontrado', 'cpf_duplicado_no_pulsar',
  'nome_divergente', 'prestador_nao_reconhecido', 'paciente_nao_reconhecido',
])

const arquivosDoProprio = (itens: SpItem[]) => itens.filter(i => !MOTIVOS_DE_PASTA.has(i.motivo ?? ''))

const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`

// ── "Avisado" fica no navegador ──────────────────────────────────────────────
// Não há onde gravar no banco que o prestador foi avisado. Guarda por 7 dias
// neste navegador: o bastante para não pedir duas vezes na mesma semana.

const CHAVE_AVISADOS = 'pep:precisa-de-voce:avisados'
const VALIDADE_AVISO_MS = 7 * 86_400_000

function lerAvisados(): Record<string, string> {
  try {
    const bruto = JSON.parse(window.localStorage.getItem(CHAVE_AVISADOS) ?? '{}') as Record<string, string>
    const limite = Date.now() - VALIDADE_AVISO_MS
    return Object.fromEntries(Object.entries(bruto).filter(([, iso]) => Date.parse(iso) > limite))
  } catch {
    return {}
  }
}

function gravarAvisados(v: Record<string, string>) {
  try { window.localStorage.setItem(CHAVE_AVISADOS, JSON.stringify(v)) } catch { /* sem armazenamento: vale só nesta visita */ }
}

// ── Abas ─────────────────────────────────────────────────────────────────────

type AbaId = 'planilha' | 'pasta' | 'arquivo'
type Aba = {
  id: AbaId; t: Tom; Icone: typeof Bot; titulo: string
  pendentes: number; MetaIcone: typeof Bot; meta: string
}

const FLUXOS: Record<AbaId, PassoFluxo[]> = {
  planilha: [
    { t: 'amber', Icone: Copy, rotulo: 'Copie' },
    { t: 'amber', Icone: Send, rotulo: 'Envie' },
    { t: 'violeta', Icone: Bot, rotulo: 'O robô libera' },
  ],
  pasta: [
    { t: 'aco', Icone: Pointer, rotulo: 'Toque' },
    { t: 'aco', Icone: UserCheck, rotulo: 'Escolha' },
    { t: 'verde', Icone: CheckCircle2, rotulo: 'Liberado' },
  ],
  arquivo: [
    { t: 'coral', Icone: ExternalLink, rotulo: 'Abra' },
    { t: 'coral', Icone: Pencil, rotulo: 'Corrija' },
    { t: 'violeta', Icone: Bot, rotulo: 'O robô confere' },
  ],
}

function AbaCartao({ a, ativa, onSelecionar, onTecla }: {
  a: Aba; ativa: boolean; onSelecionar: () => void; onTecla: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}) {
  const zerada = a.pendentes === 0
  const Icone = zerada ? Check : a.Icone
  return (
    <button
      type="button"
      role="tab"
      id={`pp-aba-${a.id}`}
      aria-selected={ativa}
      aria-controls={`pp-painel-${a.id}`}
      tabIndex={ativa ? 0 : -1}
      onClick={onSelecionar}
      onKeyDown={onTecla}
      className={`${tom(a.t)} pp-aba ${zerada ? 'is-zerada' : ''}`}
    >
      <span className="pp-aba-marca" aria-hidden><a.Icone /></span>
      <span className="pp-aba-icone" aria-hidden><Icone className="h-6 w-6" strokeWidth={zerada ? 3 : 2} /></span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-[17px] font-extrabold leading-tight">{a.titulo}</span>
        <span className="pp-aba-meta"><a.MetaIcone className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{a.meta}</span></span>
      </span>
      <span className="pp-aba-num">{numero(a.pendentes)}</span>
    </button>
  )
}

function ListaArquivos({ itens }: { itens: SpItem[] }) {
  return (
    <ul className={`${tom('coral')} flex flex-col gap-2`}>
      {itens.slice(0, 50).map(i => (
        <li key={i.sp_id} className="flex flex-col gap-2 rounded-2xl bg-[var(--pp-surface)] px-4 py-3 shadow-[inset_0_0_0_2px_var(--c-linha)] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-extrabold" title={i.nome}>{i.nome}</span>
              <span className="pp-selo pp-selo-motivo">{rotuloMotivo(i.motivo)}</span>
            </p>
            <p className="truncate text-xs font-semibold text-[var(--pp-ink-muted)]" title={i.caminho ?? undefined}>
              {i.competencia ? `${i.competencia.split('-').reverse().join('/')} · ` : ''}{i.caminho ?? ''}
            </p>
          </div>
          {i.web_url && (
            <a href={i.web_url} target="_blank" rel="noreferrer" className="pp-btn pp-btn-suave shrink-0">
              Abrir <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

// ── Tela ─────────────────────────────────────────────────────────────────────

const GRADE = 'grid grid-cols-1 gap-4 pt-3 @xl:grid-cols-2 @4xl:grid-cols-4'

export function FilaNaoReconhecidos({ fila, itens, onAtualizar }: {
  fila: SpFilaPendencias
  itens: SpItem[]
  onAtualizar: () => void
}) {
  const { semPlanilha, pastas } = fila
  const itensDoArquivo = useMemo(() => arquivosDoProprio(itens), [itens])

  // Planilha: primeiro quem já tem arquivo esperando, depois quem trava mais pacientes.
  const prestadores = useMemo(
    () => [...semPlanilha].sort((a, b) => Number(b.arquivos > 0) - Number(a.arquivos > 0) || b.pastas_paciente - a.pastas_paciente),
    [semPlanilha],
  )
  const [avisados, setAvisados] = useState<Record<string, string>>(() => (typeof window === 'undefined' ? {} : lerAvisados()))
  const marcarAvisado = useCallback((pastaId: string) => {
    setAvisados(prev => {
      const prox = { ...prev, [pastaId]: new Date().toISOString() }
      gravarAvisados(prox)
      return prox
    })
  }, [])
  const prestadoresPendentes = prestadores.filter(p => !avisados[p.pasta_id])
  const maxPacientes = Math.max(0, ...prestadores.map(p => p.pastas_paciente))
  const pacientesParados = prestadores.reduce((s, p) => s + p.pastas_paciente, 0)
  const [verAvisados, setVerAvisados] = useState(false)

  // Pastas: a escolha fica verde nesta visita, mesmo depois que a fila recarrega sem ela.
  const [resolvidas, setResolvidas] = useState<Map<string, { p: SpPendenciaPasta; nome: string }>>(new Map())
  const [aberta, setAberta] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<CategoriaPasta | null>(null)
  const fecharSeletor = useCallback(() => setAberta(null), [])
  const resolver = useCallback((p: SpPendenciaPasta, nome: string) => {
    setResolvidas(prev => new Map(prev).set(p.pasta_id, { p, nome }))
    setAberta(null)
    onAtualizar()
  }, [onAtualizar])

  const pastasPendentes = pastas.filter(p => !resolvidas.has(p.pasta_id))
  const todasAsPastas = useMemo(() => {
    const lista = [...pastas.filter(p => !resolvidas.has(p.pasta_id)), ...[...resolvidas.values()].map(r => r.p)]
    return lista.sort((a, b) =>
      ORDEM_CATEGORIAS.indexOf(categoriaDa(a)) - ORDEM_CATEGORIAS.indexOf(categoriaDa(b))
      || b.arquivos - a.arquivos || a.nome_pasta.localeCompare(b.nome_pasta, 'pt-BR'))
  }, [pastas, resolvidas])
  const pastasVisiveis = filtro ? todasAsPastas.filter(p => categoriaDa(p) === filtro) : todasAsPastas
  const proximaPasta = pastasVisiveis.find(p => !resolvidas.has(p.pasta_id))?.pasta_id ?? null
  const pendentesPorCategoria = (c: CategoriaPasta) => pastasPendentes.filter(p => categoriaDa(p) === c).length
  const categoriasPresentes = ORDEM_CATEGORIAS.filter(c => todasAsPastas.some(p => categoriaDa(p) === c))

  // Progresso: avisados + pastas resolvidas, sobre o total das duas abas.
  const totalPastas = new Set([...pastas.map(p => p.pasta_id), ...resolvidas.keys()]).size
  const total = prestadores.length + totalPastas
  const feitas = prestadores.length - prestadoresPendentes.length + resolvidas.size

  const abas: Aba[] = [
    {
      id: 'planilha', t: 'amber', Icone: FileSpreadsheet, titulo: 'Pedir planilha',
      pendentes: prestadoresPendentes.length, MetaIcone: prestadoresPendentes.length ? Users : Check,
      meta: prestadoresPendentes.length
        ? plural(pacientesParados, 'paciente parado', 'pacientes parados')
        : prestadores.length ? 'Todos avisados' : 'Tudo certo',
    },
    {
      id: 'pasta', t: 'aco', Icone: FolderSearch, titulo: 'De quem é a pasta?',
      pendentes: pastasPendentes.length, MetaIcone: pastasPendentes.length ? Hand : Check,
      meta: pastasPendentes.length ? '1 toque cada' : 'Tudo certo',
    },
  ]
  if (itensDoArquivo.length > 0) {
    abas.push({
      id: 'arquivo', t: 'coral', Icone: FileWarning, titulo: 'Arquivos com problema',
      pendentes: itensDoArquivo.length, MetaIcone: ExternalLink, meta: 'Corrigir no SharePoint',
    })
  }

  const [escolhida, setEscolhida] = useState<AbaId>(() =>
    prestadores.some(p => !avisados[p.pasta_id]) ? 'planilha'
      : pastas.length ? 'pasta'
        : itensDoArquivo.length ? 'arquivo' : 'planilha')
  const ativa = abas.find(a => a.id === escolhida) ?? abas[0]

  function teclaNaAba(e: React.KeyboardEvent<HTMLButtonElement>) {
    const i = abas.findIndex(a => a.id === ativa.id)
    const destino =
      e.key === 'ArrowRight' ? abas[(i + 1) % abas.length]
        : e.key === 'ArrowLeft' ? abas[(i - 1 + abas.length) % abas.length]
          : e.key === 'Home' ? abas[0]
            : e.key === 'End' ? abas[abas.length - 1] : null
    if (!destino) return
    e.preventDefault()
    setEscolhida(destino.id)
    document.getElementById(`pp-aba-${destino.id}`)?.focus()
  }

  const nadaAFazer = prestadores.length === 0 && totalPastas === 0 && itensDoArquivo.length === 0

  return (
    <div className="pp @container">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="titulo-precisa-de-voce" className="text-[22px] font-extrabold leading-7">O que precisa de você</h2>
          <BotaoAjuda />
        </div>
        {!nadaAFazer && <AnelProgresso feitas={feitas} total={total} />}
      </div>

      {nadaAFazer ? <TudoEmDia /> : (
        <>
          <div
            role="tablist"
            aria-label="Tarefas"
            className={`grid grid-cols-1 gap-4 ${abas.length === 3 ? '@xl:grid-cols-2 @4xl:grid-cols-3' : '@xl:grid-cols-2'}`}
          >
            {abas.map(a => (
              <AbaCartao
                key={a.id}
                a={a}
                ativa={a.id === ativa.id}
                onSelecionar={() => setEscolhida(a.id)}
                onTecla={teclaNaAba}
              />
            ))}
          </div>

          <div role="tabpanel" id={`pp-painel-${ativa.id}`} aria-labelledby={`pp-aba-${ativa.id}`} className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Fluxo passos={FLUXOS[ativa.id]} />
              {ativa.id === 'pasta' && categoriasPresentes.length > 1 && pastasPendentes.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por motivo">
                  {categoriasPresentes.map(c => {
                    const cat = CATEGORIAS[c]
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={filtro === c}
                        title={cat.explica}
                        onClick={() => setFiltro(f => (f === c ? null : c))}
                        className={`${tom(cat.t)} pp-pilula`}
                      >
                        <span className="pp-pilula-bola"><cat.Icone className="h-3.5 w-3.5" aria-hidden /></span>
                        {cat.rotulo} <span className="tabular-nums">{pendentesPorCategoria(c)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {ativa.id === 'planilha' && (
              prestadoresPendentes.length === 0 && !verAvisados ? (
                <Comemoracao
                  titulo={prestadores.length ? 'Todos os prestadores foram avisados!' : 'Todos os prestadores têm planilha!'}
                  texto="Agora é com o robô."
                >
                  {prestadores.length > 0 && (
                    <button type="button" onClick={() => setVerAvisados(true)} className="pp-btn pp-btn-suave mt-2">
                      Ver os avisados
                    </button>
                  )}
                </Comemoracao>
              ) : (
                <ul className={GRADE}>
                  {prestadores.map(p => (
                    <CartaoPrestador
                      key={p.pasta_id}
                      p={p}
                      avisadoEm={avisados[p.pasta_id] ?? null}
                      proximo={p.pasta_id === prestadoresPendentes[0]?.pasta_id}
                      maxPacientes={maxPacientes}
                      onAvisado={marcarAvisado}
                    />
                  ))}
                </ul>
              )
            )}

            {ativa.id === 'pasta' && (
              pastasPendentes.length === 0 ? (
                <Comemoracao titulo="Todas as pastas têm dono!" texto="Arquivos liberados." />
              ) : (
                <ul className={GRADE}>
                  {pastasVisiveis.map(p => (
                    <CartaoPasta
                      key={p.pasta_id}
                      p={p}
                      escolhido={resolvidas.get(p.pasta_id)?.nome ?? null}
                      proximo={p.pasta_id === proximaPasta}
                      aberto={aberta === p.pasta_id}
                      onAbrir={() => setAberta(p.pasta_id)}
                      onFechar={fecharSeletor}
                      onResolvido={resolver}
                    />
                  ))}
                </ul>
              )
            )}

            {ativa.id === 'arquivo' && <ListaArquivos itens={itensDoArquivo} />}
          </div>
        </>
      )}
    </div>
  )
}
