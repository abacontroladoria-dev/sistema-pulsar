"use client"

// TabelaComparar — uma linha por unidade, com a MESMA estrutura dos blocos da
// tela: "Com profissional na sala" (total + as quatro situações) e "Sem
// profissional na sala". Todo percentual tem a mesma base — as vagas da
// semana daquela unidade — e as partes somam o total (maior resto). A razão
// "profissional com paciente" (outra base) não entra aqui: misturada às
// outras colunas, ninguém sabia a que cada % se referia.

import { useMemo, useState } from "react"
import { SortableTh, compararValores, type SortDir } from "@/components/cronograma/ui/SortableTh"
import {
  SITUACOES_CADEIRA,
  comProfissional,
  pessoasParaAjustarNoMapa,
  type OcupacaoClinicaUnidade,
  type SituacaoCadeira,
} from "@/lib/cronograma/ocupacaoClinica"
import { MarcaComProfissional } from "./BarraCapacidade"
import { SITUACAO, fmtNum, porcentagensQueSomam } from "./visual"

interface Props {
  unidades: OcupacaoClinicaUnidade[]
  onAbrir: (unidade: string) => void
}

const COM_PROFISSIONAL = SITUACOES_CADEIRA.filter(s => s !== "vazia")
type Coluna = "com" | SituacaoCadeira

type Linha = {
  u: OcupacaoClinicaUnidade
  unidade: string
  salas: number
  ajustar: number
  vagas: Record<Coluna, number>
  pct: Record<Coluna, number>
}

const TOM_COM = "bg-[#1F4E79]/10 dark:bg-[#9CC7E6]/15"
const TOM_SEM = "bg-slate-100 dark:bg-slate-800/70"

export function TabelaComparar({ unidades, onAbrir }: Props) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "pct.paciente", dir: "desc" })

  const linhas = useMemo(() => {
    const base: Linha[] = unidades.map(u => {
      const c = u.contagem
      const totalCom = comProfissional(c)
      const [pctCom, pctSem] = porcentagensQueSomam([totalCom, c.vazia], c.total)
      const subs = porcentagensQueSomam(COM_PROFISSIONAL.map(s => c[s]), c.total, pctCom)
      return {
        u,
        unidade: u.unidade,
        salas: u.salasOperacionais,
        ajustar: pessoasParaAjustarNoMapa(u).total,
        vagas: { com: totalCom, paciente: c.paciente, aberta: c.aberta, administrativo: c.administrativo, regularizar: c.regularizar, vazia: c.vazia },
        pct: { com: pctCom, ...Object.fromEntries(COM_PROFISSIONAL.map((s, i) => [s, subs[i]])), vazia: pctSem } as Record<Coluna, number>,
      }
    })
    const valor = (l: Linha, chave: string) => {
      if (chave.startsWith("pct.")) return l.pct[chave.slice(4) as Coluna]
      return l[chave as "unidade" | "salas" | "ajustar"]
    }
    const ord = [...base].sort((a, b) => compararValores(valor(a, sort.key), valor(b, sort.key)) * (sort.dir === "asc" ? 1 : -1))
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
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Cada percentual é sobre as vagas da semana daquela unidade. Embaixo do percentual, a quantidade de vagas.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[1040px] text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:px-3 [&_th]:py-2">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th colSpan={2} />
              <th colSpan={5} className={`${TOM_COM} border-x border-border text-center normal-case tracking-normal`}>
                <span className="inline-flex items-center gap-2 text-sm font-black text-foreground"><MarcaComProfissional grande />Com profissional na sala</span>
              </th>
              <th className={`${TOM_SEM} min-w-[10rem] border-r border-border text-center normal-case tracking-normal`}>
                <span className="inline-flex items-center gap-2 text-sm font-black text-foreground">
                  <span className={`h-4 w-4 rounded-[4px] border border-border ${SITUACAO.vazia.cor}`} aria-hidden />Sem profissional na sala
                </span>
              </th>
              <th />
            </tr>
            <tr className="border-b border-border">
              {th("Unidade", "unidade", "left")}
              {th("Salas em uso", "salas")}
              {th("Total", "pct.com", "right", "Todas as vagas em que há profissional reservado na sala.")}
              {th(SITUACAO.paciente.rotulo, "pct.paciente", "right", SITUACAO.paciente.descricao)}
              {th(SITUACAO.aberta.rotulo, "pct.aberta", "right", `${SITUACAO.aberta.descricao} ${SITUACAO.aberta.acao}`)}
              {th(SITUACAO.administrativo.rotulo, "pct.administrativo", "right", `${SITUACAO.administrativo.descricao} ${SITUACAO.administrativo.acao}`)}
              {th(SITUACAO.regularizar.rotulo, "pct.regularizar", "right", `${SITUACAO.regularizar.descricao} ${SITUACAO.regularizar.acao}`)}
              {th("Total", "pct.vazia", "right", `${SITUACAO.vazia.descricao} ${SITUACAO.vazia.acao}`)}
              {th("Ajustes no mapa de salas", "ajustar", "right", "Pessoas reservadas numa sala sem agenda no turno, ou atendendo sem sala definida. Corrige-se em Ocupação de Salas › Regularizações.")}
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => (
              <tr key={l.unidade} className={`border-t border-border/60 ${l.u.terceirizada ? "text-muted-foreground" : ""}`}>
                <td className="min-w-48">
                  <button type="button" onClick={() => onAbrir(l.unidade)} className="text-left font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {l.unidade}
                  </button>
                  {l.u.terceirizada && <div className="text-xs">fora do total da rede</div>}
                </td>
                <td className="text-right tabular-nums">{fmtNum(l.salas)}</td>
                <Celula pct={l.pct.com} vagas={l.vagas.com} forte fundo={TOM_COM} />
                {COM_PROFISSIONAL.map(s => <Celula key={s} pct={l.pct[s]} vagas={l.vagas[s]} />)}
                <Celula pct={l.pct.vazia} vagas={l.vagas.vazia} forte fundo={TOM_SEM} />
                <td className={`text-right tabular-nums ${l.ajustar > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>
                  {l.ajustar > 0 ? `${fmtNum(l.ajustar)} ${l.ajustar === 1 ? "pessoa" : "pessoas"}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Percentual em cima (o que se compara entre unidades), quantidade de vagas embaixo. */
function Celula({ pct, vagas, forte = false, fundo = "" }: { pct: number; vagas: number; forte?: boolean; fundo?: string }) {
  return (
    <td className={`text-right tabular-nums ${fundo}`}>
      <div className={forte ? "text-base font-black text-foreground" : "font-semibold text-foreground"}>{pct}%</div>
      <div className="text-xs text-muted-foreground">{fmtNum(vagas)} {vagas === 1 ? "vaga" : "vagas"}</div>
    </td>
  )
}
