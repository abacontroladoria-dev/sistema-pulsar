"use client"

// TabelaComparar — uma linha por unidade, colunas alinhadas e mini-barras na
// mesma escala (0–100%) para comparar de relance. Ordenável por coluna.

import { useMemo, useState } from "react"
import { SortableTh, compararValores, type SortDir } from "@/components/cronograma/ui/SortableTh"
import { pctAproveitamento, pctComPaciente, pctComProfissional, type OcupacaoClinicaUnidade } from "@/lib/cronograma/ocupacaoClinica"
import { SITUACAO, fmtNum, fmtPct } from "./visual"

interface Props {
  unidades: OcupacaoClinicaUnidade[]
  onAbrir: (unidade: string) => void
}

type Linha = {
  u: OcupacaoClinicaUnidade
  unidade: string
  cadeiras: number
  prof: number
  pac: number
  aproveitamento: number
  aberta: number
  regularizar: number
  fora: number
  vazia: number
}

export function TabelaComparar({ unidades, onAbrir }: Props) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "pac", dir: "desc" })

  const linhas = useMemo(() => {
    const base: Linha[] = unidades.map(u => ({
      u,
      unidade: u.unidade,
      cadeiras: u.cadeiras,
      prof: pctComProfissional(u.contagem) ?? 0,
      pac: pctComPaciente(u.contagem) ?? 0,
      aproveitamento: pctAproveitamento(u.contagem) ?? 0,
      aberta: u.contagem.aberta,
      regularizar: u.contagem.regularizar,
      fora: u.foraDoMapa.sessoes,
      vazia: u.contagem.vazia,
    }))
    const ord = [...base].sort((a, b) => compararValores(a[sort.key as keyof Linha], b[sort.key as keyof Linha]) * (sort.dir === "asc" ? 1 : -1))
    // Terceirizada sempre no fim, qualquer que seja a ordenação.
    return [...ord.filter(l => !l.u.terceirizada), ...ord.filter(l => l.u.terceirizada)]
  }, [unidades, sort])

  function onSortClick(key: string) {
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : key === "unidade" ? "asc" : "desc" }))
  }

  const th = (label: string, key: string, align: "left" | "right" = "right", info?: string) => (
    <SortableTh label={label} sortKey={key} activeKey={sort.key} dir={sort.dir} align={align} info={info} onClick={onSortClick} />
  )

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full min-w-[1120px] text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:px-3 [&_th]:py-2.5">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {th("Unidade", "unidade", "left")}
            {th("Cadeiras", "cadeiras")}
            {th("Com profissional", "prof", "left")}
            {th("Com paciente", "pac", "left")}
            {th("Vira atendimento", "aproveitamento", "right", "Do tempo com profissional, quanto tem paciente.")}
            {th("Agenda aberta", "aberta", "right", SITUACAO.aberta.descricao)}
            {th("A regularizar", "regularizar", "right", SITUACAO.regularizar.descricao)}
            {th("Fora do mapa", "fora", "right", "Sessões de quem atende na unidade sem estar alocado em sala naquele horário.")}
            {th("Sem profissional", "vazia", "right", SITUACAO.vazia.descricao)}
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.unidade} className={`border-t border-border/60 ${l.u.terceirizada ? "text-muted-foreground" : ""}`}>
              <td className="min-w-52">
                <button type="button" onClick={() => onAbrir(l.unidade)} className="text-left font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {l.unidade}
                </button>
                {l.u.terceirizada && <div className="text-xs">fora do total da rede</div>}
              </td>
              <td className="text-right tabular-nums">{fmtNum(l.cadeiras)}</td>
              <td><MiniBarra valor={l.prof} cor={SITUACAO.aberta.cor} /></td>
              <td><MiniBarra valor={l.pac} cor={SITUACAO.paciente.cor} /></td>
              <td className="text-right font-semibold tabular-nums">{fmtPct(l.aproveitamento)}</td>
              <td className="text-right tabular-nums">{fmtNum(l.aberta)}</td>
              <td className={`text-right tabular-nums ${l.regularizar > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>{fmtNum(l.regularizar)}</td>
              <td className={`text-right tabular-nums ${l.fora > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>{fmtNum(l.fora)}</td>
              <td className="text-right tabular-nums">{fmtNum(l.vazia)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MiniBarra({ valor, cor }: { valor: number; cor: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 min-w-20 flex-1 overflow-hidden rounded ${SITUACAO.vazia.cor}`}>
        <span className={`block h-full rounded ${cor}`} style={{ width: `${Math.min(1, valor) * 100}%` }} />
      </span>
      <span className="w-12 text-right font-bold tabular-nums text-foreground">{fmtPct(valor)}</span>
    </div>
  )
}
