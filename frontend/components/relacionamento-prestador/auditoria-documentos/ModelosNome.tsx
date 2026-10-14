"use client"

import { FileText, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { BOTAO_SECUNDARIO, ROTULO } from "@/components/terapeutico/auditoria/vocabulario"

// Etapa 1 — os modelos de nome dos arquivos (recebidos em 14/10/2026). A
// regra que confere é a do banco (sp_pep_ler_nome_padrao); este quadro é a
// mesma regra em palavras, para quem audita e para mandar ao prestador.

const GRUPOS: { titulo: string; modelo: string; itens: { sigla: string; nome: string; exemplos: string[] }[]; nota?: string }[] = [
  {
    titulo: "Na pasta Geral",
    modelo: "SIGLA-NN-MMAAAA",
    itens: [
      { sigla: "STC", nome: "Supervisão Técnica ABA do Caso", exemplos: ["STC-01-092026", "STC-02-092026", "STC-03-092026", "STC-04-092026"] },
      { sigla: "ETC", nome: "Estudo Técnico de Caso", exemplos: ["ETC-01-092026", "ETC-02-092026", "ETC-03-092026", "ETC-04-092026"] },
    ],
  },
  {
    titulo: "Na pasta dos Pacientes",
    modelo: "SIGLA-PACIENTE-MMAAAA",
    nota: "O TAP, por ser quinzenal, leva o número: TAP-NN-PACIENTE-MMAAAA.",
    itens: [
      { sigla: "TAP", nome: "Treinamento de Aplicadores ABA", exemplos: ["TAP-01-JOAO SILVA-092026", "TAP-02-JOAO SILVA-092026"] },
      { sigla: "TOP", nome: "Treinamento e Orientação Parental", exemplos: ["TOP-JOAO SILVA-092026"] },
      { sigla: "PIC", nome: "Plano Individualizado Comportamental", exemplos: ["PIC-JOAO SILVA-092026"] },
      { sigla: "RT", nome: "Relatório de Fechamento Técnico", exemplos: ["RT-JOAO SILVA-092026"] },
      { sigla: "OE", nome: "Orientação Escolar", exemplos: ["OE-JOAO SILVA-092026"] },
    ],
  },
  {
    titulo: "Documento de reprogramação",
    modelo: "REP-SIGLA-PACIENTE-MMAAAA",
    itens: [
      { sigla: "REP", nome: "Reprogramação de PIC, RT ou OE", exemplos: ["REP-PIC-JOAO SILVA-092026", "REP-RT-JOAO SILVA-092026", "REP-OE-JOAO SILVA-092026"] },
    ],
  },
]

export function ModelosNome({ onFechar }: { onFechar: () => void }) {
  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) onFechar() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[90vh] w-[94vw] max-w-2xl gap-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl bg-card p-0 sm:max-w-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-fg">
              <FileText className="h-3.5 w-3.5" aria-hidden /> Etapa 1 · Nome do arquivo
            </span>
            <DialogTitle className="text-base font-bold text-foreground">Modelos de nome</DialogTitle>
            <p className="text-xs text-muted-foreground">MMAAAA = mês e ano colados (setembro de 2026 = 092026). NN = número com dois dígitos (01, 02…).</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className={BOTAO_SECUNDARIO}>
            <X className="h-3.5 w-3.5" aria-hidden /> Fechar
          </button>
        </header>
        <div className="space-y-5 overflow-auto px-5 py-4">
          {GRUPOS.map(g => (
            <section key={g.titulo} aria-labelledby={`modelo-${g.modelo}`}>
              <h3 id={`modelo-${g.modelo}`} className={ROTULO}>{g.titulo}</h3>
              <p className="mt-1 font-mono text-sm font-bold">{g.modelo}</p>
              {g.nota && <p className="mt-0.5 text-xs text-muted-foreground">{g.nota}</p>}
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {g.itens.map(i => (
                  <li key={i.sigla} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="w-56 shrink-0 text-sm"><strong>{i.sigla}</strong> <span className="text-muted-foreground">({i.nome})</span></span>
                    <span className="flex flex-wrap gap-1.5">
                      {i.exemplos.map(e => <code key={e} className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">{e}</code>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-muted-foreground">
            Fora do modelo o arquivo não é entregue pelo robô. Uma pessoa pode marcar a entrega mesmo assim, e ela fica com o aviso &ldquo;Ajustar nomenclatura&rdquo; até o arquivo ser renomeado no SharePoint.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
