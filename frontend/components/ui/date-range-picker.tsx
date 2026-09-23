"use client"

import { useRef, useState } from "react"
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react"
import * as Popover from "@radix-ui/react-popover"

/*
 * Seletor de INTERVALO, irmão de date-picker.tsx (que é de data única).
 *
 * Mesma casca — Radix Popover, mesma grade de 7 colunas, mesma navegação de mês
 * — porque são o mesmo objeto na cabeça de quem usa; o que muda é selecionar um
 * dia ou dois. Não virou uma prop de `DatePicker` porque o estado de um
 * intervalo (primeiro clique pendente, hover projetando o trecho) não existe no
 * de data única, e enfiá-lo lá deixaria os dois piores.
 *
 * O `react-day-picker` está no package.json e resolveria isto, mas trazê-lo aqui
 * colocaria dois calendários de aparência diferente na mesma tela. Enquanto o
 * DatePicker for feito à mão, o de intervalo acompanha.
 */

function parseDateLocal(iso: string): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
]
const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"]

const porExtenso = (iso: string) => {
  const d = parseDateLocal(iso)
  return d ? d.toLocaleDateString("pt-BR") : ""
}

export interface AtalhoPeriodo {
  rotulo: string
  /** Devolve o par na hora do clique — "hoje" muda se a tela ficar aberta. */
  intervalo: () => { inicio: string; fim: string }
}

interface DateRangePickerProps {
  inicio: string
  fim: string
  onChange: (intervalo: { inicio: string; fim: string }) => void
  atalhos?: AtalhoPeriodo[]
  /**
   * O intervalo padrão da tela. Passando isto, o calendário ganha um "Limpar".
   *
   * É função e devolve um par preenchido, nunca vazio: um período em branco
   * viraria uma consulta sem recorte, e a tela ficaria esperando por dados que
   * ninguém pediu. Limpar aqui significa voltar ao padrão, não ficar sem nada.
   */
  padrao?: () => { inicio: string; fim: string }
  align?: "start" | "center" | "end"
  className?: string
}

export function DateRangePicker({
  inicio, fim, onChange, atalhos = [], padrao, align = "start", className
}: DateRangePickerProps) {
  const [aberto, setAberto] = useState(false)
  const [mesVisivel, setMesVisivel] = useState(() => parseDateLocal(inicio) ?? new Date())

  /*
   * `pendente` guarda o primeiro clique de um novo intervalo. Enquanto ele
   * existe, o calendário está no meio de uma escolha e o valor de fora ainda
   * não mudou — só ao segundo clique o intervalo é entregue.
   */
  const [pendente, setPendente] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  /*
   * O mesmo `pendente`, em ref.
   *
   * O Radix guarda a referência de `onOpenChange` de quando o popover montou,
   * e ali `pendente` ainda era `null` — pelo closure a guarda lia sempre null
   * e nunca protegia. A ref é lida no momento do evento, que é o único valor
   * que serve para decidir se o fechamento vem no meio de uma escolha.
   */
  const pendenteRef = useRef<string | null>(null)
  const marcarPendente = (valor: string | null) => {
    pendenteRef.current = valor
    setPendente(valor)
  }

  /*
   * O reset mora aqui e não num efeito: abrir é o evento, e reagir a ele com
   * `useEffect` renderizaria uma vez com o mês velho antes de corrigir.
   */
  const alternar = (proximo: boolean) => {
    if (proximo) {
      setMesVisivel(parseDateLocal(inicio) ?? new Date())
      marcarPendente(null)
      setHover(null)
      setAberto(true)
      return
    }
    /*
     * Com uma escolha pendente, o pedido de fechar é recusado.
     *
     * Era o que impedia marcar um período: o primeiro clique num dia chega ao
     * Radix como interação de fechamento, a janela sumia, e o segundo clique
     * nunca acontecia. Quem fecha de propósito usa Esc ou clica fora — ambos
     * passam por `escapar`, que desfaz a escolha antes de sair.
     */
    if (pendenteRef.current) return
    setAberto(false)
  }

  /** Saída explícita: desfaz a escolha começada e fecha. */
  const escapar = () => {
    marcarPendente(null)
    setHover(null)
    setAberto(false)
  }

  const ano = mesVisivel.getFullYear()
  const mes = mesVisivel.getMonth()
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  const primeiroDia = new Date(ano, mes, 1).getDay()

  const celulas: (number | null)[] = []
  for (let i = 0; i < primeiroDia; i++) celulas.push(null)
  for (let i = 1; i <= diasNoMes; i++) celulas.push(i)

  /*
   * Os extremos do trecho destacado. Com um clique dado, o outro extremo é o
   * dia sob o cursor — é isso que faz o intervalo "crescer" junto do mouse.
   * Clicar numa data anterior à primeira inverte o par em vez de recusar:
   * quem clica em 20 e depois em 5 quis o intervalo de 5 a 20.
   */
  const [de, ate] = pendente
    ? [pendente, hover ?? pendente].sort()
    : [inicio, fim]

  const escolher = (iso: string) => {
    if (!pendente) {
      marcarPendente(iso)
      setHover(iso)
      return
    }
    const [i, f] = [pendente, iso].sort()
    onChange({ inicio: i, fim: f })
    // `escapar` e não `setAberto(false)`: a guarda de `alternar` olha para
    // `pendente`, que neste ponto ainda vale — limpar antes de fechar é o que
    // deixa a janela sair.
    escapar()
  }

  const rotulo =
    inicio && fim
      ? inicio === fim
        ? porExtenso(inicio)
        : `${porExtenso(inicio)} – ${porExtenso(fim)}`
      : "Selecionar período"

  return (
    <Popover.Root open={aberto} onOpenChange={alternar}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Clique em duas datas para marcar um período"
          // Clicar no gatilho com escolha em andamento cancela e fecha; sem
          // isto a guarda de `alternar` recusaria, e o botão ficaria inerte.
          onClick={e => { if (pendenteRef.current) { e.preventDefault(); escapar() } }}
          className={
            className ??
            "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition hover:border-brand hover:bg-brand-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          }
        >
          <CalendarIcon className="h-4 w-4 text-brand-fg" />
          <span className="text-[13px] font-bold tabular-nums">{rotulo}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          /*
           * Clicar fora e Esc são saídas deliberadas, então desfazem a escolha
           * começada e fecham. O que `alternar` recusa é o fechamento que o
           * próprio clique num dia provocava.
           */
          onPointerDownOutside={escapar}
          onEscapeKeyDown={escapar}
          onFocusOutside={e => e.preventDefault()}
          className="z-100 w-75 rounded-xl border border-border bg-card p-4 shadow-xl animate-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => setMesVisivel(new Date(ano, mes - 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-border hover:bg-muted/50"
            >
              <ChevronLeft size={16} className="text-muted-foreground" />
            </button>
            <div className="text-sm font-semibold text-foreground">
              {MESES[mes]} {ano}
            </div>
            <button
              type="button"
              aria-label="Próximo mês"
              onClick={() => setMesVisivel(new Date(ano, mes + 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-border hover:bg-muted/50"
            >
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 gap-y-1 text-center">
            {DIAS.map((d, i) => (
              <div key={`${d}-${i}`} className="text-[11px] font-bold text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {/*
            `gap-y` sem `gap-x`: o trecho selecionado precisa ser uma faixa
            contínua, e uma folga horizontal a cortaria em quadradinhos soltos.
          */}
          <div className="grid grid-cols-7 gap-y-1" onMouseLeave={() => pendente && setHover(pendente)}>
            {celulas.map((dia, idx) => {
              if (dia === null) return <div key={`vazio-${idx}`} className="h-8" />

              const iso = formatDate(ano, mes, dia)
              const ehInicio = iso === de
              const ehFim = iso === ate
              const dentro = Boolean(de && ate && iso > de && iso < ate)
              const extremo = ehInicio || ehFim
              const hoje = iso === formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())

              return (
                <button
                  key={dia}
                  type="button"
                  onClick={() => escolher(iso)}
                  onMouseEnter={() => pendente && setHover(iso)}
                  className={`
                    relative flex h-8 items-center justify-center text-sm transition-colors
                    ${dentro ? "bg-brand-surface text-foreground" : ""}
                    ${extremo ? "bg-brand-fg font-bold text-white" : ""}
                    ${!dentro && !extremo ? "rounded-md text-foreground hover:bg-muted" : ""}
                    ${ehInicio ? "rounded-l-md" : ""}
                    ${ehFim ? "rounded-r-md" : ""}
                    ${hoje && !extremo && !dentro ? "font-bold text-brand-fg" : ""}
                  `}
                >
                  {dia}
                </button>
              )
            })}
          </div>

          {/*
            A instrução mora aqui e muda conforme o passo, em vez de uma legenda
            fixa solta na tela: antes do primeiro clique ela diz o que fazer,
            depois dele diz o que falta. Uma linha só, sempre no mesmo lugar —
            então o popover não muda de altura entre os dois estados.
          */}
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            {pendente ? 'Agora escolha a data final' : 'Clique em duas datas para marcar um período'}
          </p>

          {/*
            O rodapé some durante a escolha: com um clique dado, a única coisa
            que importa é o segundo, e atalhos ali seriam saídas laterais no
            meio de uma ação começada.
          */}
          {(atalhos.length > 0 || padrao) && !pendente && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap gap-1">
                {atalhos.map(a => (
                  <button
                    key={a.rotulo}
                    type="button"
                    onClick={() => {
                      onChange(a.intervalo())
                      escapar()
                    }}
                    className="rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    {a.rotulo}
                  </button>
                ))}
              </div>

              {padrao && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(padrao())
                    escapar()
                  }}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground underline underline-offset-2 transition hover:text-foreground"
                >
                  Limpar
                </button>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
