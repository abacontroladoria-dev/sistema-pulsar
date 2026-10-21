"use client"

// TabelaComparar — uma linha por unidade, com a MESMA estrutura dos blocos da
// tela: "Com profissional na sala" (total + as quatro situações) e "Sem
// profissional na sala". Todo percentual tem a mesma base — as vagas da
// semana daquela unidade — e as partes somam o total (maior resto).
//
// Visual: colunas de largura fixa (a tabela não "espalha" em tela larga),
// cabeçalho com a cor de cada situação no lugar de caixa alta + lâmpadas,
// números centralizados (% em cima, vagas embaixo) e a barra da semana sob o
// nome da unidade para comparar de relance. A linha inteira abre o painel.

import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react"
import { compararValores, type SortDir } from "@/components/cronograma/ui/SortableTh"
import {
  SITUACOES_CADEIRA,
  comProfissional,
  pessoasParaAjustarNoMapa,
  type OcupacaoClinicaUnidade,
  type SituacaoCadeira,
} from "@/lib/cronograma/ocupacaoClinica"
import { BarraCapacidade, MarcaComProfissional } from "./BarraCapacidade"
import { COR_ALERTA, SITUACAO, fmtNum, plural, porcentagensQueSomam } from "./visual"

interface Props {
  unidades: OcupacaoClinicaUnidade[]
  onAbrir: (unidade: string) => void
}

const COM_PROFISSIONAL = SITUACOES_CADEIRA.filter(s => s !== "vazia")
type Coluna = "com" | SituacaoCadeira

type Linha = {
  u: OcupacaoClinicaUnidade
  unidade: string
  ajustar: number
  vagas: Record<Coluna, number>
  pct: Record<Coluna, number>
}

const DIVISOR = "border-l border-border"

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
        ajustar: pessoasParaAjustarNoMapa(u).total,
        vagas: { com: totalCom, paciente: c.paciente, aberta: c.aberta, administrativo: c.administrativo, regularizar: c.regularizar, vazia: c.vazia },
        pct: { com: pctCom, ...Object.fromEntries(COM_PROFISSIONAL.map((s, i) => [s, subs[i]])), vazia: pctSem } as Record<Coluna, number>,
      }
    })
    const valor = (l: Linha, chave: string) => (chave.startsWith("pct.") ? l.pct[chave.slice(4) as Coluna] : l[chave as "unidade" | "ajustar"])
    const ord = [...base].sort((a, b) => compararValores(valor(a, sort.key), valor(b, sort.key)) * (sort.dir === "asc" ? 1 : -1))
    // Terceirizada sempre no fim, qualquer que seja a ordenação.
    return [...ord.filter(l => !l.u.terceirizada), ...ord.filter(l => l.u.terceirizada)]
  }, [unidades, sort])

  function ordenar(key: string) {
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : key === "unidade" ? "asc" : "desc" }))
  }

  const cab = (key: string, rotulo: ReactNode, opts: { explicacao?: string; alinhar?: "left" | "center"; classe?: string } = {}) => (
    <CabecalhoOrdenavel key={key} chave={key} ativo={sort.key === key} dir={sort.dir} onClick={ordenar} explicacao={opts.explicacao} alinhar={opts.alinhar} classe={opts.classe}>
      {rotulo}
    </CabecalhoOrdenavel>
  )
  const sit = (s: SituacaoCadeira) => (
    <span className="inline-flex items-center gap-1.5 text-left leading-tight">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${SITUACAO[s].cor}`} aria-hidden />{SITUACAO[s].rotulo}
    </span>
  )

  return (
    <section aria-labelledby="ocup-comparar" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="ocup-comparar" className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Unidades lado a lado</h2>
        <p className="text-sm text-muted-foreground">% das vagas da semana de cada unidade · clique numa linha para ver o detalhe</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th colSpan={5} className="px-3 pb-1 pt-4 text-left">
                <span className="flex items-center gap-2 border-b-2 border-[#1F4E79] pb-2 text-sm font-bold text-foreground dark:border-[#9CC7E6]">
                  <MarcaComProfissional grande />Com profissional na sala
                </span>
              </th>
              <th className={`px-3 pb-1 pt-4 text-left ${DIVISOR}`}>
                <span className="flex items-center gap-2 border-b-2 border-slate-300 pb-2 text-sm font-bold text-foreground dark:border-slate-600">
                  <span className={`h-4 w-4 shrink-0 rounded-[4px] border border-border ${SITUACAO.vazia.cor}`} aria-hidden />Sem profissional
                </span>
              </th>
              <th className={DIVISOR} />
            </tr>
            <tr className="border-b border-border text-xs text-muted-foreground">
              {cab("unidade", "Unidade", { alinhar: "left", classe: "pl-5" })}
              {cab("pct.com", <b className="text-foreground">Total</b>, { explicacao: "Todas as vagas em que há profissional reservado na sala." })}
              {COM_PROFISSIONAL.map(s => cab(`pct.${s}`, sit(s), { explicacao: `${SITUACAO[s].descricao} ${SITUACAO[s].acao}`.trim() }))}
              {cab("pct.vazia", <b className="text-foreground">Total</b>, { explicacao: `${SITUACAO.vazia.descricao} ${SITUACAO.vazia.acao}`, classe: DIVISOR })}
              {cab("ajustar", "Ajustes no mapa de salas", { explicacao: "Pessoas reservadas numa sala sem agenda no turno, ou atendendo sem sala definida. Corrige-se em Ocupação de Salas › Regularizações.", classe: DIVISOR })}
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => (
              <tr
                key={l.unidade}
                onClick={() => onAbrir(l.unidade)}
                className={`cursor-pointer border-b border-border/70 transition-colors last:border-b-0 hover:bg-muted/40 ${l.u.terceirizada ? "text-muted-foreground" : ""}`}
              >
                <td className="py-3.5 pl-5 pr-3 align-middle">
                  <button type="button" onClick={e => { e.stopPropagation(); onAbrir(l.unidade) }}
                    className="text-left font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {l.unidade}
                  </button>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {plural(l.u.salasOperacionais, "sala em uso", "salas em uso")}{l.u.terceirizada ? " · fora do total" : ""}
                  </div>
                  <div className="mt-2 max-w-[13rem]"><BarraCapacidade contagem={l.u.contagem} tamanho="sm" chave={false} /></div>
                </td>
                <Celula pct={l.pct.com} vagas={l.vagas.com} forte />
                {COM_PROFISSIONAL.map(s => <Celula key={s} pct={l.pct[s]} vagas={l.vagas[s]} />)}
                <Celula pct={l.pct.vazia} vagas={l.vagas.vazia} forte classe={DIVISOR} />
                <td className={`px-3 text-center ${DIVISOR}`}>
                  {l.ajustar > 0
                    ? <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${COR_ALERTA}`}>{plural(l.ajustar, "pessoa", "pessoas")}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** % em cima (o que se compara entre unidades), vagas embaixo. */
function Celula({ pct, vagas, forte = false, classe = "" }: { pct: number; vagas: number; forte?: boolean; classe?: string }) {
  return (
    <td className={`px-3 text-center tabular-nums ${classe}`}>
      <div className={forte ? "text-lg font-black text-foreground" : "text-base font-bold text-foreground"}>{pct}%</div>
      <div className="text-xs text-muted-foreground">{fmtNum(vagas)} {vagas === 1 ? "vaga" : "vagas"}</div>
    </td>
  )
}

function CabecalhoOrdenavel({ chave, ativo, dir, onClick, explicacao, alinhar = "center", classe = "", children }: {
  chave: string
  ativo: boolean
  dir: SortDir
  onClick: (chave: string) => void
  explicacao?: string
  alinhar?: "left" | "center"
  classe?: string
  children: ReactNode
}) {
  const Icone = !ativo ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown
  return (
    <th className={`px-3 py-2.5 font-semibold ${alinhar === "left" ? "text-left" : "text-center"} ${classe}`} aria-sort={ativo ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onClick(chave)}
        title={explicacao}
        className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ativo ? "text-foreground" : ""}`}
      >
        {children}
        <Icone size={13} className={`shrink-0 ${ativo ? "opacity-100" : "opacity-40"}`} aria-hidden />
      </button>
    </th>
  )
}
