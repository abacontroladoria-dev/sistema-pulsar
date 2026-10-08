"use client"

import { ChevronRight, History } from "lucide-react"
import {
  ROTULO_TIPO,
  TIPOS_CONTRATO,
  contratoAtualPorTipo,
  dataBR,
  dataBRDeTimestamp,
  statusEfetivo,
  textoPrazo,
  vigencia,
} from "@/lib/contratos/status"
import type { ContratoPaciente } from "@/types/contratosPaciente"
import { foco } from "../../ui/campos"
import { SelosContrato } from "./Selos"

// Lista da aba Contratos, agrupada por tipo. Em cada grupo, o contrato ATUAL
// (o mais recente não cancelado — decisão 1 do plano) vem primeiro e em
// destaque; os anteriores (renovações, cancelados) ficam abaixo, apagados, como
// histórico. Clique abre o painel de detalhe.

export function ListaContratos({
  contratos,
  hoje,
  onAbrir,
}: {
  contratos: ContratoPaciente[]
  hoje: string
  onAbrir: (c: ContratoPaciente) => void
}) {
  const atual = contratoAtualPorTipo(contratos)

  return (
    <div className="space-y-4">
      {TIPOS_CONTRATO.map((tipo) => {
        const doTipo = contratos.filter((c) => c.tipo === tipo)
        if (doTipo.length === 0) return null
        const vigenteDoTipo = atual.get(tipo)
        // Atual primeiro; o resto já vem do banco por início desc.
        const ordenados = vigenteDoTipo
          ? [vigenteDoTipo, ...doTipo.filter((c) => c.id !== vigenteDoTipo.id)]
          : doTipo

        return (
          <section key={tipo} className="rounded-lg border border-border bg-card">
            <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">
              {ROTULO_TIPO[tipo]}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {doTipo.length} {doTipo.length === 1 ? "contrato" : "contratos"}
              </span>
            </h3>
            <ul className="divide-y divide-border">
              {ordenados.map((c) => (
                <Linha
                  key={c.id}
                  contrato={c}
                  hoje={hoje}
                  atual={c.id === vigenteDoTipo?.id}
                  onAbrir={() => onAbrir(c)}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Linha({
  contrato: c,
  hoje,
  atual,
  onAbrir,
}: {
  contrato: ContratoPaciente
  hoje: string
  atual: boolean
  onAbrir: () => void
}) {
  const status = statusEfetivo(c)
  const v = vigencia(c.data_inicio, c.data_vencimento, hoje)

  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        className={`flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 ${foco} ${
          atual ? "" : "opacity-70"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium tabular-nums text-foreground">
              {dataBR(c.data_inicio)} → {dataBR(c.data_vencimento)}
            </span>
            <SelosContrato status={status} vigencia={v} />
            {!atual && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <History className="h-3 w-3" aria-hidden="true" />
                Anterior
              </span>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {status !== "cancelado" && <span>{textoPrazo(c.data_inicio, c.data_vencimento, hoje)}</span>}
            {c.assinado_em && status === "assinado" && (
              <span>
                · assinado em {dataBRDeTimestamp(c.assinado_em)}
                {c.origem_assinatura === "manual" ? " (manual)" : " (D4Sign)"}
              </span>
            )}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  )
}
