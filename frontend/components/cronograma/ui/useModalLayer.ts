"use client"

// useModalLayer — o comportamento de "camada modal" (pilha, Esc, trap de Tab,
// restauração de foco) compartilhado por ScheduleModal e Drawer.
//
// Extraído de ScheduleModal, onde nasceu, quando o Drawer de Ocupação de Salas
// precisou do mesmo comportamento. O corpo do efeito veio LITERALMENTE de lá —
// cada linha aqui corrigiu um bug concreto (ver comentários), e reescrever em
// vez de mover teria sido reintroduzi-los.
//
// O ponto de compartilhar em vez de duplicar: a pilha `pilhaCamadas` é UMA só,
// então Esc fecha a camada de cima seja ela modal ou drawer. Duas pilhas
// paralelas fariam o Esc fechar o drawer de baixo enquanto um modal estava
// aberto por cima dele.

import { useEffect, useRef, type RefObject } from "react"

/**
 * Camadas de empilhamento. Eram literais espalhados (60 aqui, 70 no detalhe do
 * PDI, `z-[100]` nos popovers de FiltrosPdi) — três números escolhidos em
 * arquivos diferentes, sem nada garantindo que a ordem entre eles fosse
 * intencional. Um popover de Radix passava POR CIMA dos dois modais e ninguém
 * percebia até acontecer.
 */
export const Z_MODAL = 60
/** Um modal aberto POR CIMA de outro que continua montado (ver PainelAnalistaShell). */
export const Z_MODAL_EMPILHADO = 70

/** Tudo que é focável dentro do card — usado pelo trap de Tab. */
const SELETOR_FOCAVEL = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

/**
 * Pilha das camadas modais montadas, na ordem em que montaram — ver o efeito do
 * Esc abaixo. É uma pilha, e não um contador, porque desmontagem fora de ordem
 * (o de dentro saindo depois do de fora) faria um contador dessincronizar e o
 * Esc parar de funcionar para todo mundo; remover por identidade não tem esse
 * modo de falha.
 */
const pilhaCamadas: symbol[] = []

/**
 * Prende Esc/Tab/foco a um card em portal. Chame passando a ref do card e o
 * `onClose` da camada; o hook cuida do resto e faz o foco inicial.
 */
export function useModalLayer(cardRef: RefObject<HTMLElement | null>, onClose: () => void) {
  // `onClose` é quase sempre uma arrow inline no chamador, ou seja uma
  // referência nova a cada render do pai. Guardá-la numa ref mantém o efeito
  // abaixo com dependências VAZIAS: sem isso ele remontaria a cada render do
  // pai, tirando e repondo esta camada no topo da pilha — e um Esc no meio
  // dessa janela fechava a camada de baixo em vez da de cima.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const id = Symbol("camada-modal")
    pilhaCamadas.push(id)
    const noTopo = () => pilhaCamadas[pilhaCamadas.length - 1] === id

    // Devolver o foco para onde ele estava. Sem isto, fechar o modal deixava o
    // foco no `<body>` e o teclado recomeçava do topo da página — quem abriu
    // pelo cartão do coordenador perdia o lugar exatamente como acontecia
    // antes na navegação visual.
    const focoAnterior = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent) => {
      if (!noTopo()) return
      if (e.key === "Escape") {
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab") return

      // Trap de Tab. `aria-modal="true"` promete que o resto da página está
      // inerte; sem prender o Tab a promessa era falsa — dava para tabular
      // para trás do overlay, e com duas camadas empilhadas para dentro da
      // camada de baixo, sem nenhum sinal visual de onde se estava.
      const card = cardRef.current
      if (!card) return

      // Popover/select do Radix (ex.: o DatePicker de PdiDetalheModal) renderiza
      // num portal IRMÃO do card, não dentro dele. Prender o Tab ali dentro
      // arrastaria o foco de volta para o modal no meio da escolha da data e
      // deixaria o calendário inalcançável pelo teclado. Enquanto o foco está
      // numa camada dessas, ela manda.
      const ativoAgora = document.activeElement
      if (ativoAgora?.closest("[data-radix-popper-content-wrapper],[role=listbox],[role=menu]")) return

      const focaveis = [...card.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focaveis.length === 0) {
        e.preventDefault()
        card.focus()
        return
      }
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      const ativo = document.activeElement
      if (!e.shiftKey && (ativo === ultimo || !card.contains(ativo))) {
        e.preventDefault()
        primeiro.focus()
      } else if (e.shiftKey && (ativo === primeiro || !card.contains(ativo))) {
        e.preventDefault()
        ultimo.focus()
      }
    }

    document.addEventListener("keydown", onKey)
    const cardNoMomento = cardRef.current
    return () => {
      document.removeEventListener("keydown", onKey)
      const i = pilhaCamadas.indexOf(id)
      if (i !== -1) pilhaCamadas.splice(i, 1)
      const focoAtual = document.activeElement
      // Só devolve o foco se ele ficou "solto" (no body) ou ainda dentro desta
      // camada que está saindo. Se o usuário já clicou noutro lugar da página,
      // roubá-lo de volta seria pior que não restaurar nada.
      const foraDoModal =
        focoAtual === document.body || focoAtual === null || !!cardNoMomento?.contains(focoAtual)
      if (focoAnterior?.isConnected && foraDoModal) {
        focoAnterior.focus()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Foco inicial no card. Um `tabIndex={-1}` no container evita escolher por
  // conta própria qual campo "merece" o foco — o leitor de tela anuncia o
  // diálogo e o primeiro Tab entra na ordem natural.
  useEffect(() => {
    cardRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
