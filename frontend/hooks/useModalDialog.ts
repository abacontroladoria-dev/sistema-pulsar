'use client'

import { useEffect, useRef } from 'react'

/**
 * O básico que todo modal do sistema precisa e que nenhum deles tinha.
 *
 * Auditoria de 2026-08-20 no ModalTokenMensal, tudo medido no navegador:
 * `role`/`aria-modal`/`aria-labelledby` nulos; Escape não fechava; o primeiro
 * Tab depois de abrir caía no `NEXTJS-PORTAL`, fora do modal; o foco nunca
 * entrava e nunca voltava para o gatilho ao fechar; e o fundo continuava
 * rolando atrás do overlay.
 *
 * Fica em hook, e não copiado dentro de cada modal, porque os dois modais da
 * /auditoria-assim nasceram com exatamente as mesmas seis lacunas — e o próximo
 * nasceria também.
 *
 * Uso:
 *
 * ```tsx
 * const { refDialogo, propsDialogo } = useModalDialog(open, onClose, 'titulo-x')
 * ...
 * <div ref={refDialogo} {...propsDialogo}> <h2 id="titulo-x">…</h2> </div>
 * ```
 */
export function useModalDialog(aberto: boolean, aoFechar: () => void, idTitulo: string) {
  const refDialogo = useRef<HTMLDivElement>(null)
  // Quem tinha o foco antes de abrir. É para cá que ele volta no fechamento —
  // sem isso o Tab seguinte recomeça do topo do documento.
  const refGatilho = useRef<Element | null>(null)

  useEffect(() => {
    if (!aberto) return

    refGatilho.current = document.activeElement
    const doc = document.documentElement
    // Nó do diálogo capturado no momento do efeito, para a limpeza não depender
    // da ref (que o React já zerou quando ela roda).
    const noCleanup = refDialogo.current

    // Trava de rolagem: compensa a largura da barra para o conteúdo atrás não
    // "pular" horizontalmente quando ela some.
    const larguraBarra = window.innerWidth - doc.clientWidth
    const overflowAnterior = document.body.style.overflow
    const paddingAnterior = document.body.style.paddingRight
    document.body.style.overflow = 'hidden'
    if (larguraBarra > 0) document.body.style.paddingRight = `${larguraBarra}px`

    const focaveis = () => {
      const raiz = refDialogo.current
      if (!raiz) return [] as HTMLElement[]
      return [
        ...raiz.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement)
    }

    // Foco inicial no próprio contêiner (tabIndex -1), não no primeiro botão:
    // cair direto no "Fechar" faz o leitor de tela anunciar o botão antes do
    // título do diálogo.
    const focoInicial = requestAnimationFrame(() => refDialogo.current?.focus())

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Um widget ABERTO dentro do diálogo consome o Escape primeiro. É o que
        // a ARIA manda (Escape descarta o popup, não o diálogo que o contém) e
        // sem isto fechar uma lista de sugestões fecharia o modal junto — o
        // usuário perderia intervalo, busca e foco por apertar Escape uma vez.
        //
        // O teste é genérico de propósito: qualquer elemento focado que declare
        // `aria-expanded="true"` está dizendo que tem algo aberto para fechar.
        // Este listener roda em CAPTURA no document, então é o único lugar onde
        // essa decisão cabe — um handler no próprio campo nunca chegaria antes.
        const foco = document.activeElement
        if (foco instanceof HTMLElement && foco.getAttribute('aria-expanded') === 'true') return
        // Popup em portal (ex.: DatePicker): o foco está DENTRO do popover, fora
        // do diálogo, e o gatilho aberto continua aqui dentro com aria-expanded.
        if (refDialogo.current?.querySelector('[aria-expanded="true"]')) return
        e.stopPropagation()
        aoFechar()
        return
      }
      if (e.key !== 'Tab') return

      const lista = focaveis()
      if (lista.length === 0) {
        e.preventDefault()
        return
      }
      const primeiro = lista[0]
      const ultimo = lista[lista.length - 1]
      const atual = document.activeElement

      // Ciclo fechado: do último volta ao primeiro e vice-versa. O caso do
      // foco estar no contêiner (ou ter escapado do modal) cai no primeiro.
      if (!e.shiftKey && (atual === ultimo || !refDialogo.current?.contains(atual))) {
        e.preventDefault()
        primeiro.focus()
      } else if (e.shiftKey && (atual === primeiro || atual === refDialogo.current)) {
        e.preventDefault()
        ultimo.focus()
      }
    }

    document.addEventListener('keydown', aoTeclar, true)

    return () => {
      cancelAnimationFrame(focoInicial)
      document.removeEventListener('keydown', aoTeclar, true)
      document.body.style.overflow = overflowAnterior
      document.body.style.paddingRight = paddingAnterior
      // Devolve o foco só se ele ainda estiver dentro do modal (ou perdido no
      // body). Se algo já o levou para outro lugar, respeita.
      //
      // `noCleanup` é capturado aqui e não lido de `refDialogo.current`: quando
      // o React desmonta o modal ele zera a ref ANTES de rodar a limpeza, e a
      // verificação "o foco ainda está dentro?" daria sempre falso.
      const alvo = refGatilho.current
      if (alvo instanceof HTMLElement && document.contains(alvo)) {
        const atual = document.activeElement
        if (!atual || atual === document.body || noCleanup?.contains(atual)) alvo.focus()
      }
    }
  }, [aberto, aoFechar])

  return {
    refDialogo,
    propsDialogo: {
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-labelledby': idTitulo,
      tabIndex: -1,
    },
  }
}
