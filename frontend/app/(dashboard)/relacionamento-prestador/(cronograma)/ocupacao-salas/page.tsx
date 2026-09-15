"use client"

// Ocupação de Salas — shell da tela. Carrega os dados uma vez e alterna entre
// a LISTA (cards/lista compacta/mapa), o DETALHE de uma sala e o relatório de
// REGULARIZAÇÕES, tudo na mesma rota.
//
// Por que o detalhe não é uma rota `[id]`: `useOcupacaoSalas` dispara 5
// consultas pesadas num único efeito — uma delas já estourou statement timeout
// (ver o comentário no hook) — e não existe cache. Uma rota irmã remontaria o
// hook a cada sala aberta. Aqui lista e detalhe dividem os mesmos dados, e um
// `recarregarAlocacoes()` depois de salvar atualiza os dois de uma vez. A URL
// (`?sala=`, `?view=`) preserva deep-link e o Back do browser.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import toast from "react-hot-toast"
import { DoorOpen, Plus } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { useOcupacaoSalas } from "@/hooks/useOcupacaoSalas"
import { resumoOcupacaoDeItens } from "@/lib/cronograma/salas"
import { aplicarFiltrosSala, salaTemProfissional } from "@/components/cronograma/salas/SalasFiltros"
import { SalasListaView, SalasSeletorDeVista, type ModoLista } from "@/components/cronograma/salas/SalasListaView"
import { SalaDetalheView } from "@/components/cronograma/salas/SalaDetalheView"
import { AlocacaoDrawer } from "@/components/cronograma/salas/AlocacaoDrawer"
import { RegularizacoesView } from "@/components/cronograma/salas/RegularizacoesView"
import { SalaEditModal } from "@/components/cronograma/salas/SalaEditModal"
import { AlocarSessaoModal, type ResultadoAlocacao } from "@/components/cronograma/salas/AlocarSessaoModal"
import { GerenciarCategoriasModal } from "@/components/cronograma/salas/GerenciarCategoriasModal"
import { ExclusividadeTerapiaModal } from "@/components/cronograma/salas/ExclusividadeTerapiaModal"
import { HistoricoAuditoriaModal } from "@/components/cronograma/salas/HistoricoAuditoriaModal"
import { MenuAcoesSalas } from "@/components/cronograma/salas/MenuAcoesSalas"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/ScheduleModal"
import { STATUS_SLOT_EXCLUIDO, type Sala, type SlotOcupacaoSala } from "@/lib/cronograma/salasTypes"
import {
  agruparPorDiasDisponiveis,
  salaTemInconsistencia,
  seguePadraoSemanal,
  SALAS_FILTROS_VAZIO,
  type AlocacaoNaCelula,
  type CelulaGradeSala,
  type SalasFiltrosState,
} from "@/lib/cronograma/salasView"

// `useSearchParams` exige um boundary de Suspense, senão o `next build` falha.
export default function OcupacaoSalasPage() {
  return (
    <Suspense fallback={null}>
      <OcupacaoSalasConteudo />
    </Suspense>
  )
}

// O <Toaster/> do root layout fixa `background: '#3A8FB7'` para todo toast, o
// que faria confirmação e erro saírem idênticos. Sobrescrever por chamada (o
// default global serve 41 arquivos e não é nosso para mudar).
const TOAST_OK = { background: "#0f766e", color: "#fff", fontSize: "13px", maxWidth: "none" }
const TOAST_ERRO = { background: "#be123c", color: "#fff", fontSize: "13px", maxWidth: "none" }

/** Verbo da confirmação — no escopo do módulo porque não depende de nada do render. */
const ACAO_VERBO: Record<ResultadoAlocacao["acao"], string> = {
  criada: "alocada", editada: "atualizada", excluida: "removida", movida: "movida",
}

/** Estado de abertura do AlocarSessaoModal, seja a partir da grade ou do drawer. */
interface ModalAlocacao {
  sala: Sala
  dow: number
  turno: "Manhã" | "Tarde"
  diaLabel: string
  alocacaoId?: string
  profissionalInicial?: string
  terapiaInicial?: string | null
}

function OcupacaoSalasConteudo() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("Ocupação de Salas", "Cadastro estrutural de salas cruzado com a agenda real")
    return () => setHeader("", "")
  }, [setHeader])

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const salaDetalheId = searchParams.get("sala")
  const view = searchParams.get("view")
  const emRegularizacoes = view === "regularizacoes"
  const modo: ModoLista =
    view === "lista" || view === "mapa" || view === "regularizacoes" ? view : "cards"

  const {
    salas, alocacoes, linhas, turnosBloqueioAdmin, exclusividades, profissionaisTodos, terapiasTodas,
    salasComOcupacao, loading, error, recarregarSalas, recarregarAlocacoes, encontrarAlocacaoDoProfissional,
  } = useOcupacaoSalas()

  const [filtros, setFiltros] = useState<SalasFiltrosState>(SALAS_FILTROS_VAZIO)
  const [editando, setEditando] = useState<Sala | null | "novo">(null)
  const [isolada, setIsolada] = useState<{ id: string; nome: string } | null>(null)
  const [somenteInconsistentes, setSomenteInconsistentes] = useState(false)
  const [gerenciandoCategorias, setGerenciandoCategorias] = useState(false)
  const [gerenciandoExclusividade, setGerenciandoExclusividade] = useState(false)
  const [verHistorico, setVerHistorico] = useState(false)
  const [drawer, setDrawer] = useState<{ celula: CelulaGradeSala; alocacao: AlocacaoNaCelula } | null>(null)
  const [modalAlocacao, setModalAlocacao] = useState<ModalAlocacao | null>(null)

  const unidades = useMemo(() => [...new Set(salasComOcupacao.map(s => s.sala.unidade_nome))].sort(), [salasComOcupacao])
  const nucleos = useMemo(() => [...new Set(salasComOcupacao.map(s => s.sala.nucleo).filter((n): n is string => !!n))].sort(), [salasComOcupacao])
  const andares = useMemo(() => [...new Set(salasComOcupacao.map(s => s.sala.andar).filter((n): n is string => !!n))].sort(), [salasComOcupacao])
  const salasComExclusividade = useMemo(() => new Set(exclusividades.map(e => e.sala_id)), [exclusividades])

  function irPara(params: { sala?: string | null; view?: string | null }) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [chave, valor] of Object.entries(params)) {
      if (valor === null) next.delete(chave)
      else if (valor !== undefined) next.set(chave, valor)
    }
    const qs = next.toString()
    // `push`, não `replace`: o Back do browser precisa fechar o detalhe.
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function alternarIsolarSala(salaId: string, nome: string) {
    setIsolada(prev => (prev?.id === salaId ? null : { id: salaId, nome }))
  }

  function abrirEdicaoSala(salaId: string) {
    setEditando(salasComOcupacao.find(s => s.sala.id === salaId)?.sala ?? null)
  }

  const filtradas = useMemo(() => {
    return salasComOcupacao
      .filter(item => (isolada ? item.sala.id === isolada.id : true))
      .filter(item => aplicarFiltrosSala(filtros, item.sala) && salaTemProfissional(item, filtros.profissional))
      .filter(item => !somenteInconsistentes || salaTemInconsistencia(item))
      .filter(item => !filtros.comExclusividade || salasComExclusividade.has(item.sala.id))
      .map(item => {
        let slots = item.slots
        if (filtros.turno.length) slots = slots.filter((s: SlotOcupacaoSala) => filtros.turno.includes(s.turno))
        if (filtros.semSessao) slots = slots.filter((s: SlotOcupacaoSala) => s.alocacoes.some(a => a.semCruzamentoCsv))
        return { ...item, slots }
      })
      .filter(item => !filtros.semSessao || item.slots.length > 0)
  }, [salasComOcupacao, filtros, isolada, somenteInconsistentes, salasComExclusividade])

  // Salas com dias diferentes do padrão Seg-Sex (ex.: só quarta e sábado) não
  // entram na grade/mapa principal — iriam aparecer "furadas" nos dias que não
  // atendem, ou forçar uma coluna de sábado pra todas as outras salas. Ganham
  // uma seção própria abaixo, agrupada pelo conjunto exato de dias que usam.
  // Nos CARDS isso não é problema: cada card mostra os próprios dias.
  const filtradasPadrao = useMemo(() => filtradas.filter(item => seguePadraoSemanal(item.sala)), [filtradas])
  const gruposEspeciais = useMemo(() => agruparPorDiasDisponiveis(filtradas.filter(item => !seguePadraoSemanal(item.sala))), [filtradas])

  // Os indicadores respondem aos filtros atuais — calculados sobre `filtradas`,
  // a mesma lista que alimenta os cards/grade/mapa.
  // "Bloqueadas" saiu da tira de indicadores: era uma contagem que o filtro de
  // Status já responde, competindo por espaço com o que é acionável.
  const resumoFiltrado = useMemo(() => resumoOcupacaoDeItens(filtradas), [filtradas])

  // Ocupação REAL (granular, por sessão/bloco de 40min) do recorte filtrado —
  // mesmo critério de exclusão (STATUS_SLOT_EXCLUIDO) e mesma soma de
  // slot.blocos usados em calcularResumoUnidades (salas.ts). Não usa
  // resumoFiltrado.pct (esse é o binário "sala tem alguém alocado").
  const pctGranularFiltrado = useMemo(() => {
    let blocosTotal = 0, blocosPreenchidos = 0
    filtradas.forEach(item => {
      item.slots.forEach(slot => {
        if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return
        blocosTotal += slot.blocos.length
        blocosPreenchidos += slot.blocos.filter(b => b.status === "preenchido").length
      })
    })
    return blocosTotal > 0 ? blocosPreenchidos / blocosTotal : null
  }, [filtradas])

  // A sala do detalhe sai da lista COMPLETA, não da filtrada: um link salvo
  // deve abrir mesmo que os filtros atuais escondam aquela sala.
  const itemDetalhe = useMemo(
    () => (salaDetalheId ? salasComOcupacao.find(s => s.sala.id === salaDetalheId) ?? null : null),
    [salaDetalheId, salasComOcupacao],
  )

  // Se a alocação aberta no drawer deixou de existir (excluída no modal), o
  // drawer fecha. Derivado em render, nunca num efeito.
  const drawerValido = useMemo(() => {
    if (!drawer || !itemDetalhe) return null
    const existe = itemDetalhe.slots.some(s => s.alocacoes.some(a => a.alocacaoId === drawer.alocacao.alocacaoId))
    return existe ? drawer : null
  }, [drawer, itemDetalhe])

  // ─── Confirmação do que foi gravado ────────────────────────────────────────
  //
  // Antes, salvar fechava o modal e a grade redesenhava em silêncio: o momento
  // de MAIOR risco da tela (alocar errado põe criança e terapeuta em salas
  // diferentes) era o de menor feedback, e o usuário reabria a célula só para
  // conferir. Agora a confirmação nomeia o que mudou e oferece desfazer.
  //
  // O <Toaster/> já existe no root layout (react-hot-toast), então não há mount
  // novo. O default global pinta TODO toast de azul (#3A8FB7), o que faria
  // sucesso e erro parecerem iguais — daí o `style` por chamada.
  const [avisoAcessivel, setAvisoAcessivel] = useState("")

  const confirmarAlocacao = useCallback(async (resultado?: ResultadoAlocacao) => {
    await recarregarAlocacoes()
    if (!resultado) return

    const frase = `${resultado.profissional} ${ACAO_VERBO[resultado.acao]} · ${resultado.diaLabel} ${resultado.turno} · ${resultado.salaNome}`
    // A confirmação não pode ser só visual.
    setAvisoAcessivel(frase)

    const desfazer = resultado.desfazer
    toast.success(
      t => (
        <span className="flex items-center gap-3">
          <span>{frase}</span>
          {desfazer && (
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(t.id)
                try {
                  await desfazer()
                  await recarregarAlocacoes()
                  setAvisoAcessivel("Alteração desfeita.")
                  toast.success("Alteração desfeita.", { style: TOAST_OK })
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Não foi possível desfazer."
                  setAvisoAcessivel(msg)
                  toast.error(msg, { style: TOAST_ERRO })
                }
              }}
              className="shrink-0 rounded-md bg-white/20 px-2 py-1 text-xs font-bold underline-offset-2 hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Desfazer
            </button>
          )}
        </span>
      ),
      // Mais que o padrão (~4s): decidir desfazer leva mais tempo que ler.
      { duration: 8000, style: TOAST_OK },
    )
  }, [recarregarAlocacoes])

  function abrirModalDeAlocacao(celula: CelulaGradeSala, alocacao?: AlocacaoNaCelula) {
    if (!itemDetalhe) return
    setModalAlocacao({
      sala: itemDetalhe.sala,
      dow: celula.dow,
      turno: celula.turno,
      diaLabel: celula.diaLabel,
      alocacaoId: alocacao?.alocacaoId,
      profissionalInicial: alocacao?.profissionalNome,
      terapiaInicial: alocacao?.terapiaNome,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* O toast é visual; isto diz a mesma coisa a quem usa leitor de tela. */}
      <span aria-live="polite" className="sr-only">{avisoAcessivel}</span>

      {/* Uma faixa só: o que esta tela É à esquerda, o que se FAZ com ela à
          direita, num eixo de alinhamento apenas.
          Antes eram cinco botões de peso igual numa linha e o contexto ("89
          salas · 33%") numa faixa órfã logo abaixo — três eixos brigando e
          nada dizendo o que era mais importante. Das cinco, três são de
          manutenção rara e foram para o menu "⋯"; Regularizações é uma VIEW e
          foi para junto de Cards/Lista/Mapa, onde sempre pertenceu. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border pb-3">
        {!emRegularizacoes && !salaDetalheId ? (
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
              <DoorOpen size={15} className="text-muted-foreground" aria-hidden />
              {filtradas.length} {filtradas.length === 1 ? "sala" : "salas"}
            </span>
            {pctGranularFiltrado !== null && (
              <span>{Math.round(pctGranularFiltrado * 100)}% de ocupação por bloco de 40 min</span>
            )}
          </h2>
        ) : (
          <span />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* O seletor de vistas mora aqui, e não junto dos filtros: somado a
              eles ele estourava a largura e quebrava os controles em duas
              linhas. Aqui em cima sobrava espaço. */}
          {!salaDetalheId && <SalasSeletorDeVista modo={modo} onModo={m => irPara({ view: m === "cards" ? null : m })} />}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
          <MenuAcoesSalas
            onHistorico={() => setVerHistorico(true)}
            onCategorias={() => setGerenciandoCategorias(true)}
            onExclusividade={() => setGerenciandoExclusividade(true)}
          />
          <button
            type="button"
            onClick={() => setEditando("novo")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#222847] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#2d3459] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-slate-900"
          >
            <Plus size={14} aria-hidden /> Nova sala
          </button>
        </div>
      </div>

      {salaDetalheId ? (
        itemDetalhe ? (
          // `key` faz o estado interno (aba, drawer) nascer limpo ao trocar de
          // sala — sem useEffect de reset.
          <SalaDetalheView
            key={itemDetalhe.sala.id}
            item={itemDetalhe}
            exclusividades={exclusividades}
            onVoltar={() => irPara({ sala: null })}
            onEditarSala={() => setEditando(itemDetalhe.sala)}
            onEditarAlocacao={(celula, alocacao) => abrirModalDeAlocacao(celula, alocacao)}
            onNovaAlocacao={celula => abrirModalDeAlocacao(celula)}
            onVerAlocacao={(celula, alocacao) => setDrawer({ celula, alocacao })}
          />
        ) : loading ? null : (
          // Mesmo vazio pontilhado dos outros — o âmbar avulso daqui era um
          // tratamento que não existia em nenhum outro lugar da tela, e âmbar
          // já significa "precisa de atenção" no vocabulário da página.
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
            <p className="text-sm font-semibold text-foreground">Sala não encontrada</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Ela pode ter sido excluída ou o link está desatualizado.
            </p>
            <button
              type="button"
              onClick={() => irPara({ sala: null })}
              className="mt-1 inline-flex min-h-11 items-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              Voltar para a lista
            </button>
          </div>
        )
      ) : (
        <SalasListaView
          modo={modo}
          filtradas={filtradas}
          filtradasPadrao={filtradasPadrao}
          gruposEspeciais={gruposEspeciais}
          filtros={filtros}
          onFiltros={setFiltros}
          unidades={unidades}
          nucleos={nucleos}
          andares={andares}
          somenteInconsistentes={somenteInconsistentes}
          onToggleInconsistentes={() => setSomenteInconsistentes(v => !v)}
          isolada={isolada}
          onLimparIsolada={() => setIsolada(null)}
          onIsolarSala={alternarIsolarSala}
          totalInconsistencias={resumoFiltrado.inconsistencias}
          onRecarregarTudo={() => { void recarregarSalas(); void recarregarAlocacoes() }}
          loading={loading}
          error={error}
          onVerDetalhes={id => irPara({ sala: id })}
          onEditarSala={abrirEdicaoSala}
          salasComExclusividade={salasComExclusividade}
          salasTodas={salas}
          exclusividades={exclusividades}
          profissionaisTodos={profissionaisTodos}
          terapiasTodas={terapiasTodas}
          encontrarAlocacaoDoProfissional={encontrarAlocacaoDoProfissional}
          onRecarregarAlocacoes={recarregarAlocacoes}
        >
          {/* Regularizações é a 4ª vista, mas usa `alocacoes`+`linhas` direto e
              ignora os filtros de sala. Vem como filho para ficar ABAIXO do
              seletor (o caminho de volta continua visível) sem passar pelos
              filtros que não se aplicam a ela. */}
          {emRegularizacoes && (
            <RegularizacoesView
              alocacoes={alocacoes}
              linhas={linhas}
              turnosBloqueioAdmin={turnosBloqueioAdmin}
              onVerNaGrade={nome => {
                setFiltros(f => ({ ...f, profissional: nome }))
                irPara({ view: "lista", sala: null })
              }}
            />
          )}
        </SalasListaView>
      )}

      {drawerValido && itemDetalhe && (
        <AlocacaoDrawer
          sala={itemDetalhe.sala}
          celula={drawerValido.celula}
          alocacao={drawerValido.alocacao}
          onEditar={() => abrirModalDeAlocacao(drawerValido.celula, drawerValido.alocacao)}
          onClose={() => setDrawer(null)}
        />
      )}

      {/* Empilha sobre o drawer, que continua montado atrás. */}
      {modalAlocacao && (
        <AlocarSessaoModal
          sala={modalAlocacao.sala}
          dow={modalAlocacao.dow}
          turno={modalAlocacao.turno}
          diaLabel={modalAlocacao.diaLabel}
          alocacaoId={modalAlocacao.alocacaoId}
          profissionalInicial={modalAlocacao.profissionalInicial}
          terapiaInicial={modalAlocacao.terapiaInicial}
          encontrarAlocacaoDoProfissional={encontrarAlocacaoDoProfissional}
          // Estado atual da alocação, da lista já em memória — é o que permite
          // desfazer uma edição/exclusão sem consulta nem service novo.
          alocacaoAtual={modalAlocacao.alocacaoId ? alocacoes.find(a => a.id === modalAlocacao.alocacaoId) ?? null : null}
          onClose={() => setModalAlocacao(null)}
          onSaved={confirmarAlocacao}
          salasTodas={salas}
          exclusividades={exclusividades}
          profissionaisTodos={profissionaisTodos}
          terapiasTodas={terapiasTodas}
          // Fica acima do drawer, que continua montado atrás.
          zIndex={drawerValido ? Z_MODAL_EMPILHADO : undefined}
        />
      )}

      {editando && (
        <SalaEditModal
          sala={editando === "novo" ? null : editando}
          todasSalas={salas}
          onClose={() => setEditando(null)}
          onSaved={recarregarSalas}
        />
      )}

      {gerenciandoCategorias && (
        <GerenciarCategoriasModal
          onClose={() => setGerenciandoCategorias(false)}
          onChanged={recarregarSalas}
        />
      )}

      {gerenciandoExclusividade && (
        <ExclusividadeTerapiaModal
          onClose={() => setGerenciandoExclusividade(false)}
          onChanged={recarregarSalas}
        />
      )}

      {verHistorico && <HistoricoAuditoriaModal onClose={() => setVerHistorico(false)} />}
    </div>
  )
}
