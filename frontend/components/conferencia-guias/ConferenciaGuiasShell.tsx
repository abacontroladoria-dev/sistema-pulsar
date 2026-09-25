'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, RefreshCw, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useHeader } from '@/contexts/HeaderContext'
import { useConferenciaGuias } from '@/hooks/useConferenciaGuias'
import { useTemPermissao } from '@/hooks/useTemPermissao'
import { comoData, formatarDia, hojeLocal, segundaDe, somarDias } from '@/components/auditoria-assim/reconciliacao/datas'
import { gravarAlvoReconciliacao } from '@/components/auditoria-assim/ponteReconciliacao'
import {
  marcarAssinatura,
  marcarRecepcaoAvisada,
  salvarObservacaoConferencia,
} from '@/services/conferencia-guias.service'
import {
  agruparFolhas,
  chaveDaSessao,
  contarAbas,
  filipetaDaSessao,
  pedeConferencia,
  folhaNaAba,
  grupoDaFolha,
  grupoNaAba,
  idDaSessao,
  montarFolhas,
  normalizarBusca,
  progresso,
  type Aba,
  type Folha,
  type GrupoFolhas,
  type LinhaFolha,
  type SessaoConferencia,
  type StatusConferencia,
} from './folhas'
import { FilaPacientes } from './FilaPacientes'
import { FolhaPapel, juntarLinhas } from './FolhaPapel'
import PainelSessao from './PainelSessao'

/**
 * As perguntas que ela faz à pilha. "Todas" saiu porque a busca já atravessa
 * as abas (quem procura um nome quer achá-lo, esteja onde estiver). "Com a
 * recepção" separa o que ela já avisou do que ainda pede ela.
 */
// As duas que pedem trabalho são o resumo da semana (cartões); as outras duas
// são consulta, e ficam discretas embaixo.
// Receita do KpiCards (DESIGN.md): inativo branco com o número na cor do
// estado; ativo = tinta -50 + fio -300 (o -400 não tem par no tema escuro). Nunca preenchimento saturado.
const ABAS_RESUMO: { id: 'pendentes' | 'divergencias'; rotulo: string; ativo: string; inativo: string }[] = [
  {
    id: 'pendentes',
    rotulo: 'Pacientes a conferir',
    ativo: 'border-amber-300 bg-amber-50 text-amber-700',
    inativo: 'border-slate-200 bg-white text-amber-700 hover:bg-amber-50',
  },
  {
    id: 'divergencias',
    rotulo: 'Com problema',
    ativo: 'border-rose-300 bg-rose-50 text-rose-700',
    inativo: 'border-slate-200 bg-white text-rose-700 hover:bg-rose-50',
  },
]
const ABAS_CONSULTA: { id: 'recepcao' | 'conferidas'; rotulo: string }[] = [
  { id: 'recepcao', rotulo: 'Com a recepção' },
  { id: 'conferidas', rotulo: 'Prontas' },
]

const VAZIO: Record<Aba, string> = {
  pendentes: 'Nada a conferir neste período até agora.',
  divergencias: 'Nenhum problema pedindo você neste período.',
  recepcao: 'Nada esperando a recepção.',
  conferidas: 'Nenhuma folha pronta ainda.',
  todas: 'Nenhuma sessão ASSIM neste período.',
}

// Fila recolhida no desktop, para a folha ganhar a largura toda. Preferência de
// quem usa, e só dela — por isso localStorage; sem storage vale até recarregar.
// useSyncExternalStore, e não useState: no servidor não há storage, e um valor
// diferente no primeiro render do cliente seria erro de hidratação.
const CHAVE_FILA = 'conferencia-guias:fila-recolhida'
let filaDaVisita: boolean | null = null
const ouvintesFila = new Set<() => void>()
function lerFilaRecolhida(): boolean {
  if (filaDaVisita !== null) return filaDaVisita
  try {
    return localStorage.getItem(CHAVE_FILA) === '1'
  } catch {
    return false
  }
}
function assinarFila(aviso: () => void) {
  ouvintesFila.add(aviso)
  return () => ouvintesFila.delete(aviso)
}
function gravarFilaRecolhida(v: boolean) {
  filaDaVisita = v
  try {
    localStorage.setItem(CHAVE_FILA, v ? '1' : '0')
  } catch {
    // sem storage, vale só até recarregar
  }
  ouvintesFila.forEach((aviso) => aviso())
}

// O `lg` do Tailwind: abaixo dele a fila e a folha são telas separadas.
const ehCelular = () => !window.matchMedia('(min-width: 1024px)').matches

/** Para o toast dizer o que voltou atrás. */
function rotuloLinhas(lista: SessaoConferencia[]) {
  if (lista.length !== 1) return `as ${lista.length} linhas`
  const s = lista[0]
  return `a sessão das ${s.hora_inicial.slice(0, 5)} (${s.terapias ?? 'sessão'})`
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "Esta semana", "Semana passada", "Há 3 semanas" — onde ela está no tempo. */
function semanaRelativa(segunda: string) {
  const n = Math.round((comoData(segundaDe(hojeLocal())).getTime() - comoData(segunda).getTime()) / (7 * 86_400_000))
  if (n <= 0) return 'Esta semana'
  if (n === 1) return 'Semana passada'
  return `Há ${n} semanas`
}

/** "22 a 26 de setembro"; atravessando o mês, "29/09 a 03/10". */
function rotuloPeriodo(inicio: string, fim: string) {
  if (inicio.slice(5, 7) === fim.slice(5, 7)) {
    return `${Number(inicio.slice(8, 10))} a ${Number(fim.slice(8, 10))} de ${MESES[Number(fim.slice(5, 7)) - 1]}`
  }
  return `${formatarDia(inicio)} a ${formatarDia(fim)}`
}

export default function ConferenciaGuiasShell() {
  const { setHeader } = useHeader()
  const router = useRouter()
  useEffect(() => {
    setHeader('Conferência de Guias', 'Folha de assinaturas × evolução × autorização — ASSIM')
  }, [setHeader])

  // O período é uma semana (seg–sex), a da folha de papel.
  const [segunda, setSegunda] = useState(() => segundaDe(hojeLocal()))
  // Só vale no desktop: no celular a fila e a folha já são telas separadas.
  const filaRecolhida = useSyncExternalStore(assinarFila, lerFilaRecolhida, () => false)
  const alternarFila = useCallback((recolher: boolean) => {
    gravarFilaRecolhida(recolher)
    // O botão clicado some; o foco vai para o que faz o caminho de volta.
    requestAnimationFrame(() => document.getElementById(recolher ? 'mostrar-fila' : 'recolher-fila')?.focus())
  }, [])

  const sexta = somarDias(segunda, 4)
  const semanaAtual = segunda === segundaDe(hojeLocal())
  const semanas = useMemo(() => [segunda], [segunda])
  const { sessoes, carregando, erro, recarregar, aplicarLocal, restaurar, escrever } = useConferenciaGuias(semanas)

  // O relógio decide o que é "futura". Um minuto basta.
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const [aba, setAba] = useState<Aba>('pendentes')
  const [busca, setBusca] = useState('')
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null)
  const [ocupados, setOcupados] = useState<Set<string>>(new Set())
  const [detalheId, setDetalheId] = useState<string | null>(null)
  const refFolha = useRef<HTMLElement>(null)

  const folhas = useMemo(() => montarFolhas(sessoes, agora), [sessoes, agora])
  const contagem = useMemo(() => contarAbas(folhas), [folhas])
  const { conferidas, realizadas } = useMemo(() => progresso(folhas), [folhas])

  // A fila é de PACIENTES (por semana): as folhas 1 e 2 são um item só.
  const grupos = useMemo(() => agruparFolhas(folhas), [folhas])
  const visiveis = useMemo(() => {
    const termo = normalizarBusca(busca)
    if (termo) return grupos.filter((g) => normalizarBusca(g.paciente_nome).includes(termo))
    return grupos.filter((g) => grupoNaAba(g, aba))
  }, [grupos, aba, busca])

  // Ao abrir o paciente, a folha que responde à aba (a 2 se só ela tem o que
  // conferir); sem nenhuma, a primeira.
  const folhaDeEntrada = useCallback(
    (g: GrupoFolhas) => g.folhas.find((f) => folhaNaAba(f, busca ? 'pendentes' : aba)) ?? g.folhas[0],
    [aba, busca]
  )

  // A folha aberta sai de `folhas`, não de `visiveis`: marcar a última linha
  // tira a folha de "A conferir", e ela tem de continuar na mesa até a Silvana
  // escolher outra. Sem escolha, no desktop abre a primeira da fila.
  const escolhida = useMemo(() => folhas.find((f) => f.id === selecionadaId) ?? null, [folhas, selecionadaId])
  const naMesa = escolhida ?? (visiveis[0] ? folhaDeEntrada(visiveis[0]) : null)
  const grupoNaMesa = naMesa ? grupoDaFolha(naMesa) : null

  // O cartão do paciente fala da semana dele inteira, não só desta folha.
  const doPaciente = useMemo(() => {
    let pendentes = 0
    let divergentes = 0
    let filipetas = 0
    let faltas = 0
    for (const f of folhas) {
      if (grupoDaFolha(f) !== grupoNaMesa) continue
      pendentes += f.pendentes
      divergentes += f.divergentes
      filipetas += f.linhas.filter((l) => filipetaDaSessao(l.sessao)).length
      faltas += f.faltas
    }
    return { pendentes, divergentes, filipetas, faltas }
  }, [folhas, grupoNaMesa])

  // As outras folhas do mesmo paciente na semana, para as setas do papel.
  const vizinhas = useMemo(() => {
    if (!naMesa) return { anterior: null, seguinte: null }
    const irmas = folhas.filter((f) => grupoDaFolha(f) === grupoNaMesa)
    const i = irmas.findIndex((f) => f.id === naMesa.id)
    return { anterior: irmas[i - 1]?.id ?? null, seguinte: irmas[i + 1]?.id ?? null }
  }, [folhas, naMesa, grupoNaMesa])

  // A linha atual: a que ela escolheu no teclado, se ainda estiver na mesa;
  // senão a primeira por marcar. É o "você parou aqui" depois de uma interrupção.
  const [cursorId, setCursorId] = useState<string | null>(null)
  // A falta tem número mas não tem ação: o cursor e o teclado passam por cima.
  const linhasRealizadas = useMemo(() => (naMesa?.linhas ?? []).filter(pedeConferencia), [naMesa])
  const atualId = useMemo(() => {
    if (cursorId && linhasRealizadas.some((l) => idDaSessao(l.sessao) === cursorId)) return cursorId
    const p = linhasRealizadas.find((l) => l.sessao.status_conferencia === null)
    return p ? idDaSessao(p.sessao) : null
  }, [cursorId, linhasRealizadas])

  // A próxima folha com linha por marcar, na ordem da pilha (alfabética).
  const proxima = useMemo(() => {
    if (!naMesa) return null
    const i = folhas.findIndex((f) => f.id === naMesa.id)
    const candidata =
      folhas.slice(i + 1).find((f) => f.pendentes > 0) ?? folhas.slice(0, Math.max(i, 0)).find((f) => f.pendentes > 0)
    if (!candidata) return null
    return {
      id: candidata.id,
      // Ainda o mesmo paciente: o botão fala da folha, não repete o nome.
      rotulo:
        grupoDaFolha(candidata) === grupoNaMesa
          ? `Ir para a folha ${candidata.numero} de ${candidata.totalFolhas}`
          : `Próxima folha: ${candidata.paciente_nome}`,
    }
  }, [folhas, naMesa, grupoNaMesa])

  // No celular a fila some ao abrir a folha, e o foco cairia no body: leva-o
  // ao título da folha, e na volta ao paciente de onde saiu.
  const selecionar = useCallback(
    (g: GrupoFolhas) => {
      // Clicar de novo no paciente aberto não tira da folha em que ela está.
      if (naMesa && grupoDaFolha(naMesa) === g.id) setSelecionadaId(naMesa.id)
      else {
        setSelecionadaId(folhaDeEntrada(g).id)
        setCursorId(null)
      }
      requestAnimationFrame(() => {
        const el = refFolha.current
        if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
        if (ehCelular()) document.getElementById('titulo-folha')?.focus()
      })
    },
    [naMesa, folhaDeEntrada]
  )
  // As setas "folha 1 de 2": troca a folha e deixa o foco na seta clicada.
  const trocarFolha = useCallback((id: string) => {
    setSelecionadaId(id)
    setCursorId(null)
  }, [])
  // "Próxima folha": o botão some com a folha, então o foco vai para o título
  // da nova — senão cairia no body.
  const irParaProxima = useCallback((id: string) => {
    setSelecionadaId(id)
    setCursorId(null)
    requestAnimationFrame(() => {
      const el = refFolha.current
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
      document.getElementById('titulo-folha')?.focus()
    })
  }, [])

  const voltarParaFila = useCallback(() => {
    const de = grupoNaMesa
    setSelecionadaId(null)
    requestAnimationFrame(() => {
      if (de) document.querySelector<HTMLElement>(`[data-grupo-id="${CSS.escape(de)}"]`)?.focus()
    })
  }, [grupoNaMesa])

  const linhaDetalhe = useMemo<LinhaFolha | null>(() => {
    if (!detalheId) return null
    for (const f of folhas) for (const l of f.linhas) if (idDaSessao(l.sessao) === detalheId) return l
    return null
  }, [folhas, detalheId])

  const comOcupado = useCallback(async (ids: string[], fn: () => Promise<void>) => {
    setOcupados((a) => new Set([...a, ...ids]))
    try {
      await fn()
    } finally {
      setOcupados((a) => {
        const n = new Set(a)
        ids.forEach((i) => n.delete(i))
        return n
      })
    }
  }, [])

  const gravarAssinatura = useCallback(
    async (lista: SessaoConferencia[], status: StatusConferencia | null): Promise<boolean> => {
      if (lista.length === 0) return false
      let ok = false
      const ids = lista.map(idDaSessao)
      const conjunto = new Set(ids)
      // O estado de AGORA, não o de `lista`: no "Desfazer" do lote, `lista` é
      // de antes do lote, e restaurá-la desmarcaria na tela o que o banco tem.
      const anteriores = aplicarLocal(conjunto, {
        status_conferencia: status,
        conferido_em: status ? new Date().toISOString() : null,
      })
      await comOcupado(ids, async () => {
        try {
          const carimbo = await escrever(() => marcarAssinatura(lista.map(chaveDaSessao), status))
          aplicarLocal(conjunto, {
            status_conferencia: status,
            conferido_por_nome: status ? carimbo.nome : null,
            conferido_em: status ? carimbo.em : null,
          })
          ok = true
        } catch {
          restaurar(anteriores)
          toast.error(`Não foi possível salvar ${rotuloLinhas(lista)}. A marca voltou atrás; tente de novo.`)
        }
      })
      return ok
    },
    [aplicarLocal, comOcupado, restaurar, escrever]
  )

  const onAssinatura = useCallback(
    (linha: LinhaFolha, status: StatusConferencia | null) => {
      void gravarAssinatura([linha.sessao], status)
      // Marcou com o mouse: a linha atual anda para a próxima por marcar, como
      // no teclado. Desfazer deixa a atual onde está (o clique já a pôs ali).
      if (status) {
        const id = idDaSessao(linha.sessao)
        const i = linhasRealizadas.findIndex((l) => idDaSessao(l.sessao) === id)
        const seguinte = linhasRealizadas.find((l, j) => j > i && l.sessao.status_conferencia === null)
        setCursorId(seguinte ? idDaSessao(seguinte.sessao) : null)
      }
    },
    [gravarAssinatura, linhasRealizadas]
  )

  // Clicar (ou chegar pelo Tab) em qualquer ponto da linha a torna a atual.
  const onCursor = useCallback((linha: LinhaFolha) => {
    if (pedeConferencia(linha)) setCursorId(idDaSessao(linha.sessao))
  }, [])

  // O lote afirma N linhas de uma vez: o toast diz quais e deixa desfazer.
  const onMarcarFolha = useCallback(
    async (folha: Folha) => {
      const linhas = folha.linhas.filter((l) => pedeConferencia(l) && l.sessao.status_conferencia === null)
      const lista = linhas.map((l) => l.sessao)
      const nums = linhas.map((l) => l.linha)
      if (!(await gravarAssinatura(lista, 'assinada'))) return
      toast(
        (t) => (
          <span className="flex items-center gap-3 text-sm">
            {nums.length === 1 ? `Linha ${nums[0]} marcada como assinada` : `Linhas ${juntarLinhas(nums)} marcadas como assinadas`}
            <button
              type="button"
              onClick={() => {
                toast.dismiss(t.id)
                void gravarAssinatura(lista, null)
              }}
              className="rounded px-1 font-semibold text-sky-700 underline underline-offset-2"
            >
              Desfazer
            </button>
          </span>
        ),
        { duration: 8000 }
      )
    },
    [gravarAssinatura]
  )

  // Teclado na folha: A assinada, N não assinou, ↑/↓ (ou K/J) muda de linha.
  // Marcar anda para a próxima por marcar — o ritmo de quem confere o papel.
  const refTeclado = useRef({ atualId, linhasRealizadas, gravarAssinatura, painelAberto: false })
  useEffect(() => {
    refTeclado.current = { atualId, linhasRealizadas, gravarAssinatura, painelAberto: detalheId !== null }
  })
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const { atualId: atual, linhasRealizadas: linhas, gravarAssinatura: gravar, painelAberto } = refTeclado.current
      if (painelAberto || e.ctrlKey || e.metaKey || e.altKey || !atual) return
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))) return
      // Menu ⋮ aberto: as letras são a busca do próprio menu, não marcação.
      if (alvo?.closest('[role="menu"]')) return
      const i = linhas.findIndex((l) => idDaSessao(l.sessao) === atual)
      if (i < 0) return
      const mover = (j: number) => {
        const l = linhas[j]
        if (!l) return
        const id = idDaSessao(l.sessao)
        setCursorId(id)
        document.querySelector(`[data-linha-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
      }
      const tecla = e.key.toLowerCase()
      if (tecla === 'arrowdown' || tecla === 'j') {
        e.preventDefault()
        mover(i + 1)
      } else if (tecla === 'arrowup' || tecla === 'k') {
        e.preventDefault()
        mover(i - 1)
      } else if (tecla === 'a' || tecla === 'n') {
        e.preventDefault()
        void gravar([linhas[i].sessao], tecla === 'a' ? 'assinada' : 'sem_assinatura')
        const seguinte = linhas.findIndex((l, j) => j > i && l.sessao.status_conferencia === null)
        if (seguinte >= 0) mover(seguinte)
        else setCursorId(null)
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [])

  const onAviso = useCallback(
    (linha: LinhaFolha) => {
      const s = linha.sessao
      const id = idDaSessao(s)
      const avisar = !s.recepcao_avisada_em
      const anteriores = aplicarLocal(new Set([id]), { recepcao_avisada_em: avisar ? new Date().toISOString() : null })
      void comOcupado([id], async () => {
        try {
          const carimbo = await escrever(() => marcarRecepcaoAvisada(chaveDaSessao(s), avisar))
          aplicarLocal(new Set([id]), {
            recepcao_avisada_em: avisar ? carimbo.em : null,
            recepcao_avisada_por_nome: avisar ? carimbo.nome : null,
          })
        } catch {
          restaurar(anteriores)
          toast.error('Não foi possível registrar o aviso. Tente de novo.')
        }
      })
    },
    [aplicarLocal, comOcupado, restaurar, escrever]
  )

  const onDetalhe = useCallback((linha: LinhaFolha) => setDetalheId(idDaSessao(linha.sessao)), [])
  const fecharDetalhe = useCallback(() => setDetalheId(null), [])

  const salvarObservacao = useCallback(
    async (s: SessaoConferencia, texto: string) => {
      try {
        await escrever(() => salvarObservacaoConferencia(chaveDaSessao(s), texto))
        aplicarLocal(new Set([idDaSessao(s)]), { observacao_conferencia: texto.trim() || null })
        toast.success('Observação salva')
      } catch {
        toast.error('Não foi possível salvar a observação.')
      }
    },
    [aplicarLocal, escrever]
  )

  // Atalhos só para quem pode abrir a tela de destino — um link que leva ao
  // /sem-permissao é pior que link nenhum.
  const { tem: podeAssim } = useTemPermissao('auditoria_assim')
  const { tem: podeEvolucoes } = useTemPermissao('terapeutico_auditoria_evolucoes')

  const hrefConferenciaAssim = useMemo(
    () => (podeAssim ? (s: SessaoConferencia) => `/auditoria-assim?tab=auditoria&data=${s.data_atendimento}` : null),
    [podeAssim]
  )
  const hrefEvolucoes = useMemo(
    () =>
      podeEvolucoes
        ? (s: SessaoConferencia) =>
            // A semana DA SESSÃO.
            `/terapeutico/auditoria-evolucoes?de=${segundaDe(s.data_atendimento)}&ate=${somarDias(segundaDe(s.data_atendimento), 4)}&q=${encodeURIComponent(s.paciente_nome ?? '')}`
        : null,
    [podeEvolucoes]
  )
  const onAbrirReconciliacao = useMemo(
    () =>
      podeAssim
        ? (s: SessaoConferencia) => {
            gravarAlvoReconciliacao({
              pacienteNome: s.paciente_nome,
              carteirinha: s.carteirinha,
              data: s.data_atendimento,
            })
            router.push('/auditoria-assim?tab=reconciliacao')
          }
        : null,
    [podeAssim, router]
  )

  // No celular é uma tela de cada vez: a fila, ou a folha escolhida.
  const folhaAbertaNoCelular = escolhida !== null

  return (
    <div className="flex items-start gap-6 selection:bg-blue-100 selection:text-slate-900">
      {/* ── A fila ─────────────────────────────────────────────────────── */}
      <aside
        aria-label="Pacientes do período"
        className={`w-full shrink-0 flex-col lg:sticky lg:top-4 ${filaRecolhida ? 'lg:hidden' : 'lg:flex'} lg:max-h-[calc(100vh-2rem)] lg:w-[320px] rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_8px_24px_-12px_rgba(15,27,45,0.12)] ${
          folhaAbertaNoCelular ? 'hidden' : 'flex'
        }`}
      >
        <div className="flex items-center gap-2">
          {/* O mesmo desenho do "Folha 1 de 2": setas nas pontas, o período no meio. */}
          <nav aria-label="Semana" className="flex min-w-0 flex-1 items-center rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setSegunda((s) => somarDias(s, -7))}
              aria-label="Semana anterior"
              title="Semana anterior"
              className="inline-flex h-12 w-10 shrink-0 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span aria-live="polite" className="flex min-w-0 flex-1 flex-col items-center leading-tight">
              <span className="text-[11px] font-medium text-slate-500">{semanaRelativa(segunda)}</span>
              <span className="truncate text-sm font-semibold text-slate-800 tabular-nums">{rotuloPeriodo(segunda, sexta)}</span>
            </span>
            <button
              type="button"
              onClick={() =>
                setSegunda((s) => {
                  // Nunca passa da semana corrente: não há o que conferir no futuro.
                  const alvo = somarDias(s, 7)
                  const atual = segundaDe(hojeLocal())
                  return alvo > atual ? atual : alvo
                })
              }
              disabled={semanaAtual}
              aria-label="Próxima semana"
              title="Próxima semana"
              className="inline-flex h-12 w-10 shrink-0 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </nav>
          <button
            id="recolher-fila"
            type="button"
            onClick={() => alternarFila(true)}
            aria-label="Esconder a lista de pacientes"
            title="Esconder a lista de pacientes"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none lg:inline-flex"
          >
            <PanelLeftClose size={18} aria-hidden="true" />
          </button>
        </div>

        {/* O progresso da semana, numa frase, e o atualizar. */}
        <span className="mt-1 flex items-center justify-between gap-2 pl-1 text-xs text-slate-500 tabular-nums">
          <span aria-label={`${conferidas} de ${realizadas} sessões já conferidas`}>
            {conferidas} de {realizadas} sessões conferidas
          </span>
          <button
            type="button"
            onClick={() => void recarregar()}
            disabled={carregando}
            aria-label="Atualizar"
            title="Atualizar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-60"
          >
            <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          </button>
        </span>
        {!semanaAtual && (
          <button
            type="button"
            onClick={() => setSegunda(segundaDe(hojeLocal()))}
            className="mt-1 inline-flex min-h-11 items-center self-start rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          >
            Voltar para esta semana
          </button>
        )}

        {/* O resumo da semana: dois cartões que também filtram a fila. */}
        <div role="group" aria-label="Filtrar pacientes" className="mt-4 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {ABAS_RESUMO.map((a) => {
              const ativa = aba === a.id && !busca
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={ativa}
                  onClick={() => {
                    setAba(a.id)
                    setBusca('')
                  }}
                  className={`flex flex-col items-start rounded-xl border px-3.5 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                    ativa ? a.ativo : a.inativo
                  }`}
                >
                  <span className="text-2xl leading-tight font-bold tabular-nums">
                    {carregando && sessoes.length === 0 ? '–' : contagem[a.id]}
                  </span>
                  <span className="text-xs font-medium">{a.rotulo}</span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {ABAS_CONSULTA.map((a) => {
              const ativa = aba === a.id && !busca
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={ativa}
                  onClick={() => {
                    setAba(a.id)
                    setBusca('')
                  }}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                    ativa ? 'bg-slate-100 font-semibold text-slate-800' : 'font-medium text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {a.rotulo}
                  <span className="tabular-nums">{carregando && sessoes.length === 0 ? '' : contagem[a.id]}</span>
                </button>
              )
            })}
          </div>
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Buscar paciente</span>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-500"
          />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar paciente…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-3.5 pl-10 text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          />
        </label>

        <div className="mt-3 min-h-0 flex-1 lg:-mr-2 lg:overflow-y-auto lg:pr-2">
          {erro ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {erro}
            </p>
          ) : carregando && sessoes.length === 0 ? (
            <ul className="flex flex-col gap-1.5" aria-busy="true">
              {Array.from({ length: 7 }).map((_, i) => (
                <li key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </ul>
          ) : visiveis.length === 0 ? (
            <p className="px-2 py-6 text-sm text-slate-500">
              {busca ? 'Nenhum paciente com esse nome neste período.' : VAZIO[aba]}
            </p>
          ) : (
            <FilaPacientes
              grupos={visiveis}
              selecionadoId={grupoNaMesa}
              mostrarSemana={false}
              foco={busca ? 'pendentes' : aba}
              onSelecionar={selecionar}
            />
          )}
        </div>
      </aside>

      {/* ── A folha ────────────────────────────────────────────────────── */}
      <section
        ref={refFolha}
        aria-label="Folha de assinaturas"
        className={`min-w-0 flex-1 flex-col gap-2 lg:flex ${folhaAbertaNoCelular ? 'flex' : 'hidden'}`}
      >
        <button
          type="button"
          onClick={voltarParaFila}
          className="inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-sm font-semibold text-sky-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none lg:hidden"
        >
          <ChevronLeft size={18} />
          Pacientes
        </button>
        {filaRecolhida && (
          <button
            id="mostrar-fila"
            type="button"
            onClick={() => alternarFila(false)}
            className="hidden min-h-10 items-center gap-2 self-start rounded-lg px-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none lg:inline-flex"
          >
            <PanelLeftOpen size={18} aria-hidden="true" />
            Mostrar pacientes
          </button>
        )}

        {naMesa ? (
          <FolhaPapel
            folha={naMesa}
            onMarcarFolha={onMarcarFolha}
            atualId={atualId}
            proxima={proxima}
            onProxima={irParaProxima}
            vizinhas={vizinhas}
            onTrocarFolha={trocarFolha}
            doPaciente={doPaciente}
            ocupados={ocupados}
            onAssinatura={onAssinatura}
            onCursor={onCursor}
            onAviso={onAviso}
            onDetalhe={onDetalhe}
            hrefEvolucoes={hrefEvolucoes}
            onAbrirReconciliacao={onAbrirReconciliacao}
          />
        ) : (
          !carregando && (
            <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-slate-300 px-6 text-center text-sm text-slate-500">
              {erro ? 'A folha aparece aqui quando a semana carregar.' : 'Escolha um paciente na fila para abrir a folha.'}
            </div>
          )
        )}
      </section>

      <PainelSessao
        linha={linhaDetalhe}
        agora={agora}
        onFechar={fecharDetalhe}
        onSalvarObservacao={salvarObservacao}
        hrefConferenciaAssim={hrefConferenciaAssim}
        hrefEvolucoes={hrefEvolucoes}
        onAbrirReconciliacao={onAbrirReconciliacao}
      />
    </div>
  )
}
