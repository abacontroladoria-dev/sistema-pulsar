"use client"

// MultiSearchCombobox — lista suspensa com "digitar pra buscar" + checkbox,
// pra seleção múltipla dentro de listas longas (ex.: terapias que uma sala
// comporta). Fecha ao clicar fora (mesmo padrão de data-*-dropdown +
// document "mousedown" já usado em OcupPacMode.tsx, aqui via ref.contains).
// Diferente de SearchCombobox (seleção única, fecha ao escolher), este
// permanece aberto entre marcações — só fecha por clique fora ou Escape.
//
// O painel é um portal pra document.body, posicionado por getBoundingClientRect
// do gatilho: um `<select>` nativo escapa do layout da página inteira, mas um
// `absolute` comum fica preso ao ancestral posicionado mais próximo — dentro de
// um cartão com `overflow-hidden` (ex.: bloco de profissional em
// ContratosCadastro.tsx), o painel era cortado na borda do cartão e a 2ª+
// opção da lista sumia sem aviso nenhum.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown } from "lucide-react"

// `Id` é genérico (default number, como os ids numéricos de terapia/especialidade
// que motivaram o componente) pra também servir a listas com chave de texto —
// ex.: os grupos de permissão, cujo id é uuid.
export interface OpcaoMulti<Id extends string | number = number> {
  id: Id
  nome: string
}

interface Props<Id extends string | number> {
  opcoes: OpcaoMulti<Id>[]
  selecionados: Set<Id>
  onToggle: (id: Id) => void
  placeholder?: string
  ariaLabel: string
  /** Plural usado no resumo com 3+ selecionados (ex.: "3 {nomePlural} selecionadas"). */
  nomePlural?: string
  /**
   * A palavra depois do número no resumo. Padrão "selecionadas" (terapias,
   * situações); "selecionados" para substantivo masculino (convênios).
   */
  adjetivoResumo?: string
  /**
   * Liga a linha "Marcar todos · Desmarcar todos" logo abaixo da busca. Recebe
   * os ids VISÍVEIS: com texto digitado, marca só os que a busca achou — o que
   * se espera de "marcar todos" numa lista filtrada.
   */
  onMarcarTodos?: (idsVisiveis: Id[]) => void
  onDesmarcarTodos?: () => void
  /** Lista todos os selecionados no resumo, em vez de resumir em "N selecionadas". */
  resumoCompleto?: boolean
  /** Classe extra do gatilho, pra casar com o estilo da tela que o usa. */
  className?: string
  disabled?: boolean
  /**
   * "plano" abre mão de borda/fundo/padding próprios pra que `className` defina
   * o gatilho inteiro — usado no card do Painel Administrativo, onde ele precisa
   * ser uma pill colorida igual à do setor.
   */
  variant?: "padrao" | "plano"
  /** Foco programático no gatilho (ex.: item "Editar" de um menu de ações). */
  triggerRef?: React.RefObject<HTMLButtonElement | null>
  /**
   * `false` abre o painel dentro do próprio componente, sem portal. Obrigatório
   * dentro de um Dialog do Radix (components/ui/dialog): o Dialog modal desliga
   * o pointer-events de tudo fora do conteúdo dele e prende o foco lá dentro —
   * com o painel em document.body, a lista abria mas não aceitava clique nem
   * digitação ("+ Novo usuário", 29/09/2026). Quem usa assim precisa garantir
   * que o container não tenha `overflow-hidden`, senão o painel é cortado.
   */
  portal?: boolean
}

export function MultiSearchCombobox<Id extends string | number = number>({ opcoes, selecionados, onToggle, placeholder = "Nenhuma opção selecionada", ariaLabel, nomePlural = "opções", adjetivoResumo = "selecionadas", onMarcarTodos, onDesmarcarTodos, resumoCompleto = false, className = "", disabled = false, variant = "padrao", triggerRef, portal = true }: Props<Id>) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState("")
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  // Recalcula em `position: fixed` (relativo à viewport, igual getBoundingClientRect)
  // — evita ter que somar scroll de containers intermediários, que é o que
  // `absolute` dentro de um ancestral com overflow exigiria pra funcionar certo.
  const reposicionar = () => {
    const r = wrapperRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 2, left: r.left, width: r.width })
  }

  useLayoutEffect(() => {
    if (!portal) return
    if (aberto) reposicionar()
    else setPos(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, portal])

  useEffect(() => {
    if (!aberto || !portal) return
    // `capture: true` pega scroll de QUALQUER container intermediário (a lista
    // de contratos, o card do profissional), não só o da window.
    window.addEventListener("scroll", reposicionar, true)
    window.addEventListener("resize", reposicionar)
    return () => {
      window.removeEventListener("scroll", reposicionar, true)
      window.removeEventListener("resize", reposicionar)
    }
  }, [aberto, portal])

  useEffect(() => {
    if (!aberto) return
    const fechar = (e: MouseEvent) => {
      const alvo = e.target as Node
      // O painel vive num portal: não é descendente de wrapperRef no DOM, por
      // isso precisa do próprio contains — senão todo clique nele (inclusive
      // marcar um checkbox) seria lido como "clique fora" e fecharia na hora.
      if (wrapperRef.current?.contains(alvo) || dropdownRef.current?.contains(alvo)) return
      setAberto(false)
    }
    document.addEventListener("mousedown", fechar)
    return () => document.removeEventListener("mousedown", fechar)
  }, [aberto])

  useEffect(() => {
    if (aberto) inputRef.current?.focus()
    else setTexto("")
  }, [aberto])

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase()
    if (!q) return opcoes
    return opcoes.filter(o => o.nome.toLowerCase().includes(q))
  }, [texto, opcoes])

  const nomesSelecionados = useMemo(() => opcoes.filter(o => selecionados.has(o.id)).map(o => o.nome), [opcoes, selecionados])
  const resumo = nomesSelecionados.length === 0
    ? placeholder
    : resumoCompleto || nomesSelecionados.length <= 2
      ? nomesSelecionados.join(", ")
      : `${nomesSelecionados.length} ${nomePlural} ${adjetivoResumo}`

  const plano = variant === "plano"
  const classesGatilho = plano
    ? "flex w-full items-center justify-between gap-2 text-left text-[13px] focus:outline-none focus:ring-2 focus:ring-brand/30"
    : `flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-[13px] focus:outline-none focus:ring-2 focus:ring-ring ${nomesSelecionados.length ? "text-foreground" : "text-muted-foreground"}`

  // Com portal: fixo na viewport, em document.body. Sem portal: logo abaixo do
  // gatilho, dentro do próprio componente (ver a prop `portal`).
  const painel = aberto && (!portal || pos) ? (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-multiselectable="true"
      // Marca lida pelo Dialog que hospeda o combobox: o Esc da busca fecha
      // só a lista, não o formulário inteiro (ver CreateUserModal).
      data-multisearch-aberto=""
      style={portal && pos ? { position: "fixed", top: pos.top, left: pos.left, width: pos.width } : undefined}
      className={`z-[100] flex max-h-72 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg ${portal ? "" : "absolute left-0 right-0 top-full mt-0.5"}`}
    >
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        aria-label={`Buscar em ${ariaLabel}`}
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") setAberto(false) }}
        placeholder="Digite para buscar..."
        className="shrink-0 border-b border-border bg-transparent px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      {(onMarcarTodos || onDesmarcarTodos) && (
        // Ações em massa: texto, não botão pesado — é atalho, não o conteúdo.
        <div className="flex shrink-0 items-center justify-end gap-3 border-b border-border px-3 py-1.5 text-[12px]">
          {onMarcarTodos && (
            <button
              type="button"
              onClick={() => onMarcarTodos(filtradas.map(o => o.id))}
              disabled={!filtradas.length || filtradas.every(o => selecionados.has(o.id))}
              className="font-semibold text-primary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline disabled:opacity-60"
            >
              {texto.trim() ? "Marcar os encontrados" : "Marcar todos"}
            </button>
          )}
          {onDesmarcarTodos && (
            <button
              type="button"
              onClick={onDesmarcarTodos}
              disabled={selecionados.size === 0}
              className="font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
            >
              Desmarcar todos
            </button>
          )}
        </div>
      )}
      <div className="overflow-y-auto p-1">
        {!filtradas.length ? (
          <div className="px-3 py-2 text-[12px] text-muted-foreground">Nenhuma opção encontrada.</div>
        ) : filtradas.map(o => {
          const marcada = selecionados.has(o.id)
          return (
            <label
              key={o.id}
              role="option"
              aria-selected={marcada}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-foreground hover:bg-muted/60"
            >
              <input type="checkbox" checked={marcada} onChange={() => onToggle(o.id)} className="shrink-0" />
              <span className="truncate">{o.nome}</span>
            </label>
          )
        })}
      </div>
    </div>
  ) : null

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setAberto(v => !v)}
        onKeyDown={e => { if (e.key === "Escape") setAberto(false) }}
        className={`${classesGatilho} ${className}`}
      >
        <span className="truncate">{resumo}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${plano ? "opacity-60" : "text-muted-foreground"} ${aberto ? "rotate-180" : ""}`} />
      </button>

      {painel && (portal ? createPortal(painel, document.body) : painel)}
    </div>
  )
}
