"use client"

import { Check, Loader2 } from "lucide-react"
import { aviso, btnPrimario, btnSecundario, selo } from "@/components/cronograma/grade/estilo"
import { SeletorMesPrevisao } from "@/components/cronograma/indicadores/SeletorMesPrevisao"
import { BarraPartes, Cartao, Indicador } from "@/components/ui/padrao"
import { COMPETENCIA_TESTE_PEP } from "@/lib/remuneracao/calculoPEP"
import type { ConferenciaMes } from "@/lib/remuneracao/situacaoEntregasPep"
import { money } from "./Celulas"
import { NotaFaturamento } from "./VisaoGeralPep"

// Um único bloco pro que antes eram 3-4 cards empilhados (competência, aviso
// de modo teste, potencial/alcançado + liberar). Linha 1 é parâmetro do mês;
// da linha 2 pra baixo é o trabalho do mês.
export function CabecalhoEntregasMensais({
  competencia,
  onMudarMes,
  carregandoLabel,
  progresso,
  mostrarValores,
  potencial,
  alcancado,
  apuracaoLoading,
  liberado,
  onLiberar,
  onReabrir,
  modoTeste,
  erros,
  conferencia,
  conferenciaInvalidada,
  conferindo,
  onConferir,
}: {
  /** Conferência que vale (ninguém mexeu nas entregas depois). */
  conferencia: ConferenciaMes | null
  conferenciaInvalidada: boolean
  conferindo: boolean
  onConferir: (conferir: boolean) => void
  competencia: string
  onMudarMes: (ano: number, mes: number) => void
  carregandoLabel: string | null
  progresso: { completos: number; total: number }
  mostrarValores: boolean
  potencial: number
  alcancado: number
  apuracaoLoading: boolean
  liberado: boolean
  onLiberar: () => void
  onReabrir: () => void
  modoTeste: boolean
  erros: (string | null | undefined)[]
}) {
  const errosVisiveis = erros.filter((e): e is string => Boolean(e))
  const tudoPronto = progresso.total > 0 && progresso.completos === progresso.total
  const pendentes = Math.max(0, progresso.total - progresso.completos)

  return (
    <Cartao className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mês de atendimento
        </span>
        <SeletorMesPrevisao
          ano={Number(competencia.split("-")[0])}
          mes={Number(competencia.split("-")[1])}
          onChange={onMudarMes}
        />
        <NotaFaturamento competencia={competencia} />
        {carregandoLabel && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
            {carregandoLabel}
          </span>
        )}
      </div>

      {(progresso.total > 0 || mostrarValores) && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              {progresso.total > 0 && (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Itens completos</span>
                    <span className="text-lg font-semibold tabular-nums text-foreground">
                      {progresso.completos}/{progresso.total}
                    </span>
                  </div>
                  <BarraPartes
                    partes={[
                      {
                        valor: progresso.completos,
                        tone: tudoPronto ? "green" : "blue",
                        rotulo: `${progresso.completos} completos`,
                      },
                      {
                        valor: pendentes,
                        tone: "slate",
                        rotulo: `${pendentes} pendentes`,
                      },
                    ]}
                  />
                </div>
              )}

              {mostrarValores && (
                <>
                  <div className={apuracaoLoading ? "opacity-40 transition-opacity" : "transition-opacity"}>
                    <Indicador
                      valor={money(potencial)}
                      rotulo="Potencial do mês"
                      tone="slate"
                    />
                  </div>
                  <div className={apuracaoLoading ? "opacity-40 transition-opacity" : "transition-opacity"}>
                    <Indicador
                      valor={money(alcancado)}
                      rotulo="Alcançado (apurado)"
                      tone="green"
                    />
                  </div>
                </>
              )}
            </div>

            {mostrarValores && (
              <div className="flex flex-wrap items-center gap-2">
                {liberado ? (
                  <>
                    <span className={selo("green")}>
                      <Check size={12} /> Faturamento liberado
                    </span>
                    <button
                      type="button"
                      onClick={onReabrir}
                      className={`${btnSecundario} min-h-11 sm:min-h-0`}
                    >
                      Reabrir
                    </button>
                  </>
                ) : (
                  <>
                    {conferencia ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`${selo("green")} whitespace-normal`}>
                          <Check size={12} /> Conferido{conferencia.conferido_por_nome ? ` por ${conferencia.conferido_por_nome}` : ""} em {new Date(conferencia.conferido_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </span>
                        <button
                          type="button"
                          disabled={conferindo}
                          onClick={() => onConferir(false)}
                          className={`${btnSecundario} min-h-11 sm:min-h-0`}
                        >
                          Desfazer
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={conferindo}
                        title={conferenciaInvalidada ? "Uma entrega mudou depois da última conferência" : "Registra que você conferiu as entregas deste analista no mês"}
                        onClick={() => onConferir(true)}
                        className={`${btnSecundario} min-h-11 sm:min-h-0`}
                      >
                        {conferindo ? "Salvando…" : conferenciaInvalidada ? "Conferir de novo" : "Marcar como conferido"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={apuracaoLoading}
                      title={apuracaoLoading ? "Aguarde a apuração terminar de calcular" : undefined}
                      onClick={onLiberar}
                      className={`${btnPrimario} min-h-11 sm:min-h-0`}
                    >
                      Liberar Faturamento
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {modoTeste && (
        <div className={`${aviso("amber")} text-xs`}>
          <div>
            <span className="font-semibold">Modo teste (PRD Seção 13.7):</span> {COMPETENCIA_TESTE_PEP} apura e demonstra os ajustes, mas paga 100% do potencial — por isso &quot;Alcançado&quot; ainda não reflete pendências. Os ajustes passam a valer a partir do mês seguinte.
          </div>
        </div>
      )}

      {errosVisiveis.length > 0 && (
        <div className="space-y-2">
          {errosVisiveis.map((e, i) => (
            <div key={i} className={aviso("red")}>
              <span className="font-medium">{e}</span>
            </div>
          ))}
        </div>
      )}
    </Cartao>
  )
}
