"use client"

import { createContext, useContext } from "react"
import { FilePenLine } from "lucide-react"
import { aviso, selo } from "@/components/cronograma/grade/estilo"
import type { AjusteNome } from "@/lib/roboSharepoint/ajusteNome"
import type { PepCatalogoItem, PepEvidencia } from "@/types/pep"

// Selo "Ajustar nomenclatura" na tela PEP (decisão de 14/10/2026): a entrega
// vale, mas o arquivo precisa ser renomeado no SharePoint. A regra está em
// lib/roboSharepoint/ajusteNome.ts; aqui só o contexto (a tela sabe quais
// arquivos o robô leu) e as duas peças visuais. Âmbar = "falta alguém fazer".

export type ConferirAjuste = (ev: PepEvidencia, indice: number, pacienteNome: string | null, item: PepCatalogoItem) => AjusteNome | null

export const AjusteNomeContexto = createContext<ConferirAjuste>(() => null)

export function useAjusteNome() {
  return useContext(AjusteNomeContexto)
}

/** Quantas unidades de um registro carregam o aviso. */
export function useContarAjustes(evidencias: PepEvidencia[] | null | undefined, pacienteNome: string | null, item: PepCatalogoItem) {
  const conferir = useAjusteNome()
  return (evidencias ?? []).filter((ev, i) => ev.caminho?.trim() && conferir(ev, i, pacienteNome, item)).length
}

/** Marca pequena dentro da célula da grade. */
export function SeloAjustarNome({ quantidade }: { quantidade: number }) {
  if (quantidade <= 0) return null
  const texto = quantidade === 1 ? "1 arquivo com nome a ajustar" : `${quantidade} arquivos com nome a ajustar`
  return (
    <span title={texto} className={selo("amber")}>
      <FilePenLine size={11} aria-hidden />
      <span className="sr-only">{texto}</span>
      {quantidade > 1 && <span aria-hidden className="tabular-nums">{quantidade}</span>}
    </span>
  )
}

/** Aviso completo, embaixo do campo da evidência ou na lista do robô. */
export function AvisoAjustarNome({ ajuste }: { ajuste: AjusteNome }) {
  return (
    <div className={`${aviso("amber")} flex-col gap-1 text-xs`}>
      <p className="flex items-center gap-1.5 font-semibold">
        <FilePenLine size={13} aria-hidden /> Ajustar nomenclatura
      </p>
      <p>{ajuste.texto}. A entrega vale; o aviso sai quando o arquivo for renomeado no SharePoint.</p>
      {ajuste.nomeEsperado && (
        <p>
          Nome esperado: <code className="rounded bg-muted px-1 py-0.5 font-semibold text-foreground">{ajuste.nomeEsperado}</code>
        </p>
      )}
    </div>
  )
}
