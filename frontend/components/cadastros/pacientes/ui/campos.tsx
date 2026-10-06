"use client"

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import { Check, ChevronDown } from "lucide-react"

// Classes de formulário do projeto. Mesmas constantes de
// components/cadastros/NovoProfissionalModal.tsx — tokens semânticos, sem cor
// literal, para o tema claro/escuro continuar valendo.
//
// Aqui elas ganham a variante `disabled`, que o modal não precisa: esta tela
// nasce SOMENTE-LEITURA e só libera os campos depois do botão EDITAR.

export const campo =
  "w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground " +
  "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring " +
  "disabled:cursor-default disabled:bg-muted/40 disabled:text-muted-foreground"
export const rotulo =
  "block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
export const foco = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** Bloco de uma sub-seção: título, subtítulo e grade de dois campos por linha. */
export function Secao({
  titulo,
  descricao,
  acao,
  children,
}: {
  titulo: string
  descricao?: string
  acao?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="min-w-0">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
          {descricao && (
            <p className="mt-0.5 text-sm text-muted-foreground">{descricao}</p>
          )}
        </div>
        {acao}
      </header>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

type CampoBaseProps = {
  label: string
  /** Ocupa a linha inteira em vez de meia. */
  largo?: boolean
  dica?: string
}

export function Campo({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
  largo,
  dica,
  maxLength,
  inputMode,
}: CampoBaseProps & {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  type?: string
  placeholder?: string
  maxLength?: number
  inputMode?: "text" | "numeric" | "tel" | "email"
}) {
  return (
    <div className={largo ? "sm:col-span-2" : undefined}>
      <label className={rotulo}>{label}</label>
      <input
        type={type}
        className={`mt-1 ${campo}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
      />
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}

/** Campo de leitura pura — valor gerado pelo sistema, que nem EDITAR libera. */
export function CampoSomenteLeitura({
  label,
  value,
  largo,
  dica,
  acima,
}: CampoBaseProps & {
  value: string
  /**
   * Contexto curto ao lado do rótulo — mesma linha, para não empurrar a caixa
   * para baixo e desalinhar a grade com o campo vizinho.
   */
  acima?: string
}) {
  return (
    <div className={largo ? "sm:col-span-2" : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <label className={rotulo}>{label}</label>
        {acima && <span className="text-xs text-muted-foreground">{acima}</span>}
      </div>
      <p className="mt-1 rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5 text-sm text-muted-foreground">
        {value || "—"}
      </p>
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}


export function CampoTextarea({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  linhas = 3,
  dica,
}: CampoBaseProps & {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  placeholder?: string
  linhas?: number
}) {
  return (
    <div className="sm:col-span-2">
      <label className={rotulo}>{label}</label>
      <textarea
        className={`mt-1 ${campo} resize-y`}
        rows={linhas}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}

export function CampoCheckbox({
  label,
  checked,
  onChange,
  disabled,
  dica,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled: boolean
  dica?: string
}) {
  return (
    <div className="sm:col-span-2">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className={`h-4 w-4 rounded border-border accent-primary disabled:cursor-default ${foco}`}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        {label}
      </label>
      {dica && <p className="mt-1 pl-6 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}

export function CampoSelect<T extends string>({
  label,
  value,
  onChange,
  disabled,
  opcoes,
  vazio = "Não informado",
  largo,
  dica,
}: CampoBaseProps & {
  value: T | null
  onChange: (v: T | null) => void
  disabled: boolean
  opcoes: { valor: T; rotulo: string }[]
  vazio?: string
}) {
  const id = useId()
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")
  const buscaRef = useRef<HTMLInputElement>(null)

  const rotuloSelecionado = value ? opcoes.find(o => o.valor === value)?.rotulo : null

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return opcoes
    return opcoes.filter(o => o.rotulo.toLowerCase().includes(q))
  }, [busca, opcoes])

  useEffect(() => {
    if (aberto) setBusca("")
  }, [aberto])

  const selecionar = (v: T | null) => {
    onChange(v)
    setAberto(false)
  }

  return (
    <div className={largo ? "sm:col-span-2" : undefined}>
      <label className={rotulo} htmlFor={id}>{label}</label>
      <Popover.Root open={aberto} onOpenChange={disabled ? undefined : setAberto}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            className={`mt-1 flex w-full items-center justify-between rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:bg-muted/40 disabled:text-muted-foreground ${!value ? "text-muted-foreground/60" : ""}`}
          >
            <span className="line-clamp-1 text-left">{rotuloSelecionado ?? vazio}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </Popover.Trigger>
        {!disabled && (
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              onOpenAutoFocus={(e) => { e.preventDefault(); buscaRef.current?.focus() }}
              className="z-[100] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
            >
              <div className="border-b border-border p-1">
                <input
                  ref={buscaRef}
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Digite para buscar..."
                  className="w-full rounded-sm bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && filtradas.length === 1) selecionar(filtradas[0].valor)
                    else if (e.key === "Escape") setAberto(false)
                  }}
                />
              </div>
              <div className="max-h-96 overflow-y-auto p-1">
                <button
                  type="button"
                  onClick={() => selecionar(null)}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {!value && <Check className="h-4 w-4" />}
                  </span>
                  {vazio}
                </button>
                {filtradas.map((o) => (
                  <button
                    key={o.valor}
                    type="button"
                    onClick={() => selecionar(o.valor)}
                    className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                      {value === o.valor && <Check className="h-4 w-4" />}
                    </span>
                    {o.rotulo}
                  </button>
                ))}
                {filtradas.length === 0 && (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma opção encontrada.</p>
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </Popover.Root>
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}

/** Botão segmentado Sim/Não — para campos booleanos que merecem mais destaque que um checkbox. */
export function CampoToggleSimNao({
  label,
  value,
  onChange,
  disabled,
  dica,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled: boolean
  dica?: string
}) {
  return (
    <div>
      <label className={rotulo}>{label}</label>
      <div className="mt-1 inline-flex rounded-md border border-border p-0.5">
        <button
          type="button"
          onClick={() => onChange(false)}
          disabled={disabled}
          aria-pressed={!value}
          className={`rounded px-3 py-1 text-sm font-medium disabled:cursor-default disabled:opacity-60 ${foco} ${
            !value ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          Não
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          disabled={disabled}
          aria-pressed={value}
          className={`rounded px-3 py-1 text-sm font-medium disabled:cursor-default disabled:opacity-60 ${foco} ${
            value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          Sim
        </button>
      </div>
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}

/**
 * Cor em hexadecimal: amostra clicável que abre uma paleta (as cores já usadas
 * no catálogo, para manter a família visual) + campo "#RRGGBB" + seletor livre
 * do sistema operacional para qualquer outra cor. Grava sempre "#RRGGBB".
 */
export function CampoCor({
  label,
  value,
  onChange,
  disabled,
  sugestoes = [],
  dica,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
  /** Cores oferecidas na paleta (sem repetição, na ordem recebida). */
  sugestoes?: string[]
  dica?: string
}) {
  const id = useId()
  const [aberto, setAberto] = useState(false)
  // Rascunho só enquanto a pessoa digita; fora disso o campo mostra o valor.
  const [rascunho, setRascunho] = useState<string | null>(null)
  const texto = rascunho ?? value

  const valido = /^#[0-9A-Fa-f]{6}$/.test(texto.trim())
  const paleta = useMemo(
    () => [...new Set(sugestoes.map(s => s.toUpperCase()))].slice(0, 40),
    [sugestoes]
  )

  const confirmarTexto = (v: string) => {
    setRascunho(v)
    let n = v.trim().toUpperCase()
    if (!n.startsWith("#")) n = `#${n}`
    if (/^#[0-9A-F]{6}$/.test(n)) onChange(n)
  }

  return (
    <div>
      <label className={rotulo} htmlFor={id}>{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <Popover.Root open={aberto} onOpenChange={disabled ? undefined : setAberto}>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Escolher cor (atual ${value})`}
              className={`h-9 w-9 shrink-0 rounded-md border border-border shadow-sm disabled:cursor-default ${foco}`}
              style={{ backgroundColor: value }}
            />
          </Popover.Trigger>
          {!disabled && (
            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={6}
                className="z-[100] w-64 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
              >
                <p className="mb-2 text-xs font-semibold text-muted-foreground">Cores já usadas</p>
                <div className="grid grid-cols-8 gap-1.5">
                  {paleta.map(cor => (
                    <button
                      key={cor}
                      type="button"
                      title={cor}
                      aria-label={cor}
                      onClick={() => { onChange(cor); setAberto(false) }}
                      className={`relative h-6 w-6 rounded border border-black/10 ${foco}`}
                      style={{ backgroundColor: cor }}
                    >
                      {cor === value.toUpperCase() && (
                        <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white mix-blend-difference" />
                      )}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-sm hover:bg-muted/50">
                  Outra cor…
                  <input
                    type="color"
                    value={value}
                    onChange={e => onChange(e.target.value.toUpperCase())}
                    className="h-6 w-10 cursor-pointer border-0 bg-transparent p-0"
                  />
                </label>
              </Popover.Content>
            </Popover.Portal>
          )}
        </Popover.Root>
        <input
          id={id}
          type="text"
          value={texto}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          onChange={e => confirmarTexto(e.target.value)}
          onBlur={() => setRascunho(null)}
          aria-invalid={!valido}
          className={`${campo} font-mono uppercase ${!valido ? "border-rose-400" : ""}`}
        />
      </div>
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}
