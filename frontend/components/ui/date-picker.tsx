"use client"

import { useState, useEffect } from "react"
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
}

// `align` sem valor padrão: o antigo era `"start" as any` — uma string que não
// pertence ao próprio tipo do prop, sustentada por um cast. Omitido, o
// `radixAlign` abaixo já nasce "start", que era o efeito pretendido. Nenhum
// chamador muda: os que passam "right"/"center" continuam mapeados igual.
export function DatePicker({ value, onChange, disabled, placeholder = "dd/mm/aaaa", align, classeGatilho, conteudoGatilho, rotuloGatilho }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(() => parseDateLocal(value))
  
  useEffect(() => {
    if (value) {
      setCurrentMonth(parseDateLocal(value))
    }
  }, [value])

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

  const prev = (e: React.MouseEvent) => { e.preventDefault(); setCurrentMonth(new Date(year, month - 1, 1)) }
  const next = (e: React.MouseEvent) => { e.preventDefault(); setCurrentMonth(new Date(year, month + 1, 1)) }

  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
  const dayNames = ["D", "S", "T", "Q", "Q", "S", "S"]

  const dateObj = value ? parseDateLocal(value) : null
  const displayDate = dateObj ? dateObj.toLocaleDateString("pt-BR") : placeholder

  // Convert legacy align prop to radix align
  let radixAlign: "start" | "center" | "end" = "start"
  if (align === "right") radixAlign = "end"
  else if (align === "center") radixAlign = "center"

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={rotuloGatilho}
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
              <div className="text-sm font-semibold text-foreground">
                {monthNames[month]} {year}
              </div>
              <button type="button" onClick={next} className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-border hover:bg-muted/50">
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>
            </div>

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
                const isToday = currentDate === formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
                const isWeekend = idx % 7 === 0 || idx % 7 === 6

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => handleDateSelect(day)}
                    className={`flex h-8 w-full items-center justify-center rounded-md text-sm transition-colors ${
                      isSelected
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
                  onClick={() => {
                     onChange(formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))
                     setIsOpen(false)
                  }}
                  className="text-xs text-primary hover:underline"
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
