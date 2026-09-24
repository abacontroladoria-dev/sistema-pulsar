"use client"

// SearchCombobox — combobox de seleção única com "digitar pra buscar",
// mesmo padrão ARIA já duplicado em ProfissionalCombobox
// (DisponibilidadeInternaView.tsx) e EspecialidadeCombobox
// (SimulacaoNovoPrestadorTab.tsx), generalizado aqui pra não duplicar de
// novo em cada tela nova que precisar de um <select> pesquisável. Só permite
// escolher 1 opção da lista — texto livre nunca vira valor selecionado.

import { useId, useMemo, useRef, useState, type ReactNode } from "react"
import { B } from "@/lib/cronograma/constants"

interface Props {
  value: string
  onChange: (v: string) => void
  opcoes: string[]
  placeholder?: string
  ariaLabel: string
  /**
   * "ocupacao" replica a anatomia do campo de busca de paciente do Modo 1
   * ("Aumentar Cronograma", OcupPacMode.tsx): anel de foco navy, lista com raio
   * 10px e opções destacadas em navy. Existe como variante, e não como novo
   * padrão, porque as outras seis telas que já usam este combobox seguem o
   * estilo Tailwind original e não devem mudar de aparência.
   */
  variante?: "padrao" | "ocupacao"
  /** Só na variante "ocupacao": campo de linha de tabela (fonte/padding menores). */
  compacto?: boolean
  disabled?: boolean
  /**
   * Marcador exibido à direita do nome, dentro da lista (ex.: selo "Inativo").
   * Render prop em vez de sufixo no texto porque o valor da opção é a própria
   * string selecionada — concatenar o selo mudaria o valor.
   */
  sufixoOpcao?: (opcao: string) => ReactNode
}

export function SearchCombobox({
  value, onChange, opcoes, placeholder = "Digite para buscar...", ariaLabel,
  variante = "padrao", compacto = false, disabled = false, sufixoOpcao,
}: Props) {
  const id = useId()
  const [texto, setTexto] = useState(value)
  const [aberto, setAberto] = useState(false)
  const [ativoIdx, setAtivoIdx] = useState(-1)
  const [focado, setFocado] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const [ultimoValor, setUltimoValor] = useState(value)
  if (value !== ultimoValor) {
    setUltimoValor(value)
    setTexto(value)
  }

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase()
    if (!q) return opcoes
    return opcoes.filter(o => o.toLowerCase().includes(q))
  }, [texto, opcoes])

  const selecionar = (opcao: string) => { onChange(opcao); setTexto(opcao); setUltimoValor(opcao); setAberto(false); setAtivoIdx(-1) }
  const valida = opcoes.includes(value)
  const ocup = variante === "ocupacao"
  // Na variante "ocupacao" o campo vazio é estado neutro (nada escolhido ainda),
  // não erro — igual ao campo de paciente do Modo 1, que abre em branco.
  const mostrarInvalido = !valida && !!texto

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        autoComplete="off"
        // Edge/Chrome ignoram autocomplete="off" pra campos que a heurística de
        // preenchimento de contato/endereço reconhece pelo texto ao redor
        // (rótulo "Paciente", placeholder "nome") — sem isso aparecia um dropdown
        // nativo de sugestão de nome/endereço por cima da lista de opções própria
        // deste componente. `name` aleatório quebra essa heurística sem precisar
        // de nenhum atributo não-padrão.
        name={`busca-${id}`}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={aberto}
        aria-controls={aberto ? `${id}-listbox` : undefined}
        value={texto}
        onChange={e => { setTexto(e.target.value); setUltimoValor(""); onChange(""); setAberto(true); setAtivoIdx(-1) }}
        disabled={disabled}
        onFocus={() => { setAberto(true); setFocado(true) }}
        onBlur={() => { setTimeout(() => setAberto(false), 150); setFocado(false); if (value) setTexto(value) }}
        onKeyDown={e => {
          if (!aberto || !filtradas.length) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            const next = Math.min(ativoIdx + 1, filtradas.length - 1)
            setAtivoIdx(next); listRef.current?.children[next]?.scrollIntoView({ block: "nearest" })
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            const prev = Math.max(ativoIdx - 1, 0)
            setAtivoIdx(prev); listRef.current?.children[prev]?.scrollIntoView({ block: "nearest" })
          } else if (e.key === "Enter") {
            e.preventDefault()
            const idx = ativoIdx >= 0 ? ativoIdx : (filtradas.length === 1 ? 0 : -1)
            if (idx >= 0) selecionar(filtradas[idx])
          } else if (e.key === "Escape") {
            setAberto(false); setAtivoIdx(-1)
            if (value) setTexto(value)
          }
        }}
        placeholder={placeholder}
        className={ocup
          ? "w-full placeholder:text-muted-foreground disabled:opacity-60"
          : `w-full rounded-lg border px-2.5 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${!mostrarInvalido ? "border-border bg-card" : "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20"}`}
        style={ocup ? {
          boxSizing: "border-box",
          border: `1px solid ${mostrarInvalido ? "#fca5a5" : "var(--border)"}`,
          borderRadius: compacto ? "8px" : "9px",
          padding: compacto ? "4px 8px" : "7px 12px",
          fontSize: compacto ? "11px" : "16px",
          fontFamily: "inherit",
          outline: "none",
          background: "var(--card)",
          color: "inherit",
          boxShadow: focado ? `0 0 0 2px ${B.navy}` : "none",
        } : undefined}
      />
      {aberto && filtradas.length > 0 && (
        <div
          ref={listRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-label={ariaLabel}
          className={ocup ? undefined : "absolute left-0 right-0 top-[calc(100%+2px)] z-[100] max-h-52 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"}
          style={ocup ? {
            position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 100,
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px",
            boxShadow: "0 4px 16px rgba(0,0,0,.08)", maxHeight: "200px", overflowY: "auto",
          } : undefined}
        >
          {filtradas.map((opcao, i) => {
            const selecionada = opcao === value
            const ativa = i === ativoIdx
            return (
              <button
                key={opcao}
                type="button"
                role="option"
                aria-selected={selecionada}
                onMouseDown={e => { e.preventDefault(); selecionar(opcao) }}
                className={ocup ? undefined : `block w-full px-3 py-1.5 text-left text-[13px] transition-colors ${ativa ? "bg-sky-600 text-white" : selecionada ? "bg-muted font-semibold text-foreground" : "text-foreground hover:bg-muted/60"}`}
                style={ocup ? {
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "8px", width: "100%", textAlign: "left",
                  padding: "8px 12px", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: "12px",
                  background: ativa ? B.navy : selecionada ? "var(--muted)" : "transparent",
                  color: ativa ? "#fff" : selecionada ? B.navy : "var(--card-foreground)",
                  fontWeight: selecionada || ativa ? 700 : 400,
                } : undefined}
              >
                {sufixoOpcao ? (
                  <>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{opcao}</span>
                    {sufixoOpcao(opcao)}
                  </>
                ) : opcao}
              </button>
            )
          })}
        </div>
      )}
      {mostrarInvalido && !aberto && (
        ocup
          ? <div style={{ marginTop: "4px", fontSize: "10px", fontWeight: 700, color: "#dc2626" }}>Selecione uma opção válida da lista.</div>
          : <div className="mt-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">Selecione uma opção válida da lista.</div>
      )}
    </div>
  )
}
