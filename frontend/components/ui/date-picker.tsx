"use client"

import { useState } from "react"
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react"
import * as Popover from "@radix-ui/react-popover"

function parseDateLocal(iso: string): Date {
  if (!iso) return new Date()
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return new Date()
  return new Date(y, m - 1, d)
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

function getFirstDayOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
}

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  align?: "left" | "right" | "center"
  /**
   * SUBSTITUI as classes do botão-gatilho (não soma a elas).
   *
   * Existe porque o gatilho padrão nasceu para um campo de formulário: traz
   * `mt-1` e a moldura de `<input>`, que dentro de uma barra de filtros viram um
   * degrau de 4px e uma segunda borda. Com esta prop o calendário — a parte que
   * importa reusar — é o mesmo, e só a casca acompanha o lugar.
   *
   * Omitida, o comportamento é exatamente o de antes: nenhum chamador existente
   * muda de aparência.
   */
  classeGatilho?: string
  /**
   * SUBSTITUI o miolo do gatilho (a data "dd/mm/aaaa" + o ícone). Para quando
   * a tela já mostra o período por extenso e o botão é esse próprio texto
   * (ex.: Grade, "04 – 10 de outubro de 2026" + ícone). Use com `rotuloGatilho`.
   */
  conteudoGatilho?: React.ReactNode
  /** aria-label do gatilho quando o miolo não diz que é uma escolha de data. */
  rotuloGatilho?: string
  /** "AAAA-MM-DD": dias anteriores ficam desabilitados (equivale ao `min` do input nativo). */
  min?: string
  /** "AAAA-MM-DD": dias posteriores ficam desabilitados. */
  max?: string
  /** id do botão-gatilho, para `<label htmlFor>`. */
  id?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  /**
   * Escolha de MÊS (substitui o `<input type="month">`): abre na grade de meses
   * e devolve "AAAA-MM-01". `min`/`max` comparam pelo mês.
   */
  apenasMes?: boolean
}

type Visao = "dias" | "meses" | "anos"

// `align` sem valor padrão: o antigo era `"start" as any` — uma string que não
// pertence ao próprio tipo do prop, sustentada por um cast. Omitido, o
// `radixAlign` abaixo já nasce "start", que era o efeito pretendido. Nenhum
// chamador muda: os que passam "right"/"center" continuam mapeados igual.
export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "dd/mm/aaaa",
  align,
  classeGatilho,
  conteudoGatilho,
  rotuloGatilho,
  min,
  max,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  apenasMes,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  // Clicar em "Mês Ano" sobe para meses e depois anos: data de nascimento não
  // pode custar cem cliques de "mês anterior".
  const [visao, setVisao] = useState<Visao>("dias")
  const [currentMonth, setCurrentMonth] = useState(() => parseDateLocal(value))
  // Valor mudou de fora: o mês visível acompanha (ajuste no render, sem efeito).
  const [valorAnterior, setValorAnterior] = useState(value)
  if (value !== valorAnterior) {
    setValorAnterior(value)
    if (value) setCurrentMonth(parseDateLocal(value))
  }

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const daysInMonth = getDaysInMonth(currentMonth)
  const firstDay = getFirstDayOfMonth(currentMonth)

  const days: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) days.push(null)
  for (let i = 1; i <= daysInMonth; i++) days.push(i)

  const handleDateSelect = (day: number) => {
    onChange(formatDate(year, month, day))
    setIsOpen(false)
  }

  // Passo das setas conforme a visão: 1 mês, 1 ano ou 12 anos.
  const anoInicioGrade = year - (year % 12)
  const passo = (dir: 1 | -1) =>
    visao === "dias"
      ? new Date(year, month + dir, 1)
      : new Date(year + dir * (visao === "meses" ? 1 : 12), month, 1)
  const prev = (e: React.MouseEvent) => { e.preventDefault(); setCurrentMonth(passo(-1)) }
  const next = (e: React.MouseEvent) => { e.preventDefault(); setCurrentMonth(passo(1)) }
  const foraDoLimite = (iso: string) => (!!min && iso < min) || (!!max && iso > max)
  const mesForaDoLimite = (a: number, m: number) => {
    const ym = formatDate(a, m, 1).slice(0, 7)
    return (!!min && ym < min.slice(0, 7)) || (!!max && ym > max.slice(0, 7))
  }
  const hojeIso = formatDate(new Date().getFullYear(), new Date().getMonth(), apenasMes ? 1 : new Date().getDate())

  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
  const dayNames = ["D", "S", "T", "Q", "Q", "S", "S"]

  const dateObj = value ? parseDateLocal(value) : null
  const displayDate = dateObj ? dateObj.toLocaleDateString("pt-BR") : placeholder

  // Convert legacy align prop to radix align
  let radixAlign: "start" | "center" | "end" = "start"
  if (align === "right") radixAlign = "end"
  else if (align === "center") radixAlign = "center"

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(aberto) => {
        setIsOpen(aberto)
        if (aberto) setVisao(apenasMes ? "meses" : "dias")
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={rotuloGatilho}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={
            classeGatilho ??
            "flex w-full mt-1 items-center justify-between rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:bg-muted/40 disabled:text-muted-foreground"
          }
        >
          {conteudoGatilho ?? (
            <>
              <span className={value ? "" : "text-muted-foreground/60"}>{displayDate}</span>
              <CalendarIcon className="h-4 w-4 text-muted-foreground/50" />
            </>
          )}
        </button>
      </Popover.Trigger>
      
      {!disabled && (
        <Popover.Portal>
          <Popover.Content 
            align={radixAlign}
            sideOffset={4}
            className="z-[100] w-[280px] rounded-lg border border-border bg-card p-4 shadow-xl animate-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
          >
            {/* Header */}
            <div className="mb-3 flex items-center justify-between">
              <button type="button" onClick={prev} className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-border hover:bg-muted/50">
                <ChevronLeft size={16} className="text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => setVisao(visao === "dias" ? "meses" : "anos")}
                disabled={visao === "anos"}
                aria-label={visao === "dias" ? "Escolher mês e ano" : visao === "meses" ? "Escolher ano" : undefined}
                className="rounded-md px-2 py-0.5 text-sm font-semibold text-foreground hover:bg-muted/50 disabled:hover:bg-transparent"
              >
                {visao === "dias" ? `${monthNames[month]} ${year}` : visao === "meses" ? year : `${anoInicioGrade} – ${anoInicioGrade + 11}`}
              </button>
              <button type="button" onClick={next} className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-border hover:bg-muted/50">
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>
            </div>

            {visao !== "dias" && (
              <div className="grid grid-cols-3 gap-1">
                {(visao === "meses"
                  ? monthNames.map((nome, m) => ({ chave: m, rotulo: nome.slice(0, 3), atual: dateObj?.getFullYear() === year && dateObj?.getMonth() === m }))
                  : Array.from({ length: 12 }, (_, i) => anoInicioGrade + i).map((a) => ({ chave: a, rotulo: String(a), atual: dateObj?.getFullYear() === a }))
                ).map((it) => (
                  <button
                    key={it.chave}
                    type="button"
                    disabled={visao === "meses" && apenasMes && mesForaDoLimite(year, it.chave)}
                    onClick={() => {
                      if (visao === "meses" && apenasMes) {
                        onChange(formatDate(year, it.chave, 1))
                        setIsOpen(false)
                      } else if (visao === "meses") {
                        setCurrentMonth(new Date(year, it.chave, 1))
                        setVisao("dias")
                      } else {
                        setCurrentMonth(new Date(it.chave, month, 1))
                        setVisao("meses")
                      }
                    }}
                    className={`flex h-10 items-center justify-center rounded-md text-sm transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground/30 disabled:hover:bg-transparent ${
                      it.atual ? "bg-primary font-bold text-primary-foreground hover:bg-primary/90" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {it.rotulo}
                  </button>
                ))}
              </div>
            )}

            {visao === "dias" && (<>
            {/* Days header */}
            <div className="mb-2 grid grid-cols-7 gap-1 text-center">
              {dayNames.map((day, i) => (
                <div key={`${day}-${i}`} className="text-[11px] font-bold text-foreground">
                  {day}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1">
              {days.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="h-8" />
                }
                const currentDate = formatDate(year, month, day)
                const isSelected = currentDate === value
                const isToday = currentDate === hojeIso
                const isWeekend = idx % 7 === 0 || idx % 7 === 6
                const bloqueado = foraDoLimite(currentDate)

                return (
                  <button
                    key={day}
                    type="button"
                    disabled={bloqueado}
                    onClick={() => handleDateSelect(day)}
                    className={`flex h-8 w-full items-center justify-center rounded-md text-sm transition-colors ${
                      bloqueado
                        ? "cursor-not-allowed text-muted-foreground/30"
                        : isSelected
                        ? "bg-primary font-bold text-primary-foreground hover:bg-primary/90"
                        : isToday
                        ? "bg-accent font-semibold text-accent-foreground hover:bg-accent/80"
                        : isWeekend
                        ? "text-red-500 hover:bg-muted"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
            </>)}
            <div className="mt-4 flex justify-between">
               <button
                  type="button"
                  onClick={() => {
                     onChange("")
                     setIsOpen(false)
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
               >
                  Limpar
               </button>
               <button
                  type="button"
                  disabled={apenasMes ? mesForaDoLimite(new Date().getFullYear(), new Date().getMonth()) : foraDoLimite(hojeIso)}
                  onClick={() => {
                     onChange(hojeIso)
                     setIsOpen(false)
                  }}
                  className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
               >
                  Hoje
               </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  )
}
