"use client"

// Modal do estado que impede o cálculo da remuneração.
//
// Existe porque a primeira versão despejava a explicação inteira no cabeçalho, e
// o cabeçalho é uma faixa de chips de status: três linhas de texto corrido
// sobrepunham os controles e ainda contradiziam o empty state do corpo, que
// mandava fazer upload por um motivo genérico. Duas respostas para a mesma
// pergunta, em dois lugares.
//
// A divisão agora é por papel. Cabeçalho: um chip de uma linha, que também é a
// alça para reabrir isto. Modal: o que houve, por que trava, e os dois botões
// que resolvem — a instrução deixa de ser prosa e vira affordance.
//
// O número é o único elemento com peso visual. "Grade incompleta" é abstrato;
// "21 sessões" é o que faz alguém entender que há dinheiro em jogo. O resto fica
// quieto de propósito.

import { AlertTriangle, Loader2, RefreshCw, Upload } from "lucide-react"

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

export interface GradeIncompletaModalProps {
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  /** Título curto — o mesmo texto do chip no cabeçalho. */
  resumo: string
  /** Uma ou duas frases: o que houve e por que trava. */
  erro: string
  /** Quantidade que dá concretude ao problema. Ausente quando não há número. */
  quantidade?: number
  /** O próximo passo DESTA falha. Vem do veredicto, não é fixo aqui. */
  dica: string
  /** Período carregado, para a pessoa não precisar conferir no cabeçalho. */
  periodo: { de: string; ate: string }
  onRecarregar: () => void
  onUsarCsv: () => void
  carregando: boolean
}

const diaMes = (iso: string) => {
  const [, m, d] = iso.split("-")
  return d && m ? `${d}/${m}` : iso
}

export function GradeIncompletaModal({
  aberto, onOpenChange, resumo, erro, quantidade, dica, periodo,
  onRecarregar, onUsarCsv, carregando,
}: GradeIncompletaModalProps) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={15} aria-hidden />
            {resumo}
          </DialogTitle>
        </DialogHeader>

        {/* O número carrega o peso; a frase explica. Alinhados pela primeira
            linha para o algarismo não flutuar solto acima do texto. */}
        <div className="flex items-start gap-4">
          {quantidade !== undefined && (
            <span className="font-heading text-4xl leading-none font-semibold tabular-nums text-destructive">
              {quantidade.toLocaleString("pt-BR")}
            </span>
          )}
          <DialogDescription className="pt-0.5">{erro}</DialogDescription>
        </div>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {diaMes(periodo.de)} a {diaMes(periodo.ate)}.
          </span>{" "}
          {dica}
        </p>

        <DialogFooter>
          <button
            type="button"
            onClick={onUsarCsv}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <Upload size={12} aria-hidden />
            Usar CSV do TiTa
          </button>
          <button
            type="button"
            onClick={onRecarregar}
            disabled={carregando}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[#2A92C0] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2A92C0]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {carregando ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />}
            {carregando ? "Lendo..." : "Carregar de novo"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
