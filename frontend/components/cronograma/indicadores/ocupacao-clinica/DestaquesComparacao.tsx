"use client"

// DestaquesComparacao — no modo Comparar, o topo deixa de repetir o total da
// rede e responde "quem se destaca em quê": a unidade com mais paciente, a com
// mais vagas livres para agendar, a com mais espaço sem profissional e a com
// mais ajustes no mapa de salas. Clique abre o painel da unidade.

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import {
  comProfissional,
  pctComPaciente,
  pessoasParaAjustarNoMapa,
  type OcupacaoClinicaUnidade,
} from "@/lib/cronograma/ocupacaoClinica"
import { SITUACAO, fmtNum, fmtPct, plural } from "./visual"

interface Props {
  /** Só as unidades próprias — a terceirizada não entra nos destaques. */
  unidades: OcupacaoClinicaUnidade[]
  onAbrir: (unidade: string) => void
}

function maior<T>(lista: T[], valor: (x: T) => number): T | null {
  return lista.reduce<T | null>((m, x) => (m === null || valor(x) > valor(m) ? x : m), null)
}

export function DestaquesComparacao({ unidades, onAbrir }: Props) {
  if (unidades.length < 2) return null

  const pctVazia = (u: OcupacaoClinicaUnidade) => (u.contagem.total > 0 ? u.contagem.vazia / u.contagem.total : 0)
  const maisPaciente = maior(unidades, u => pctComPaciente(u.contagem) ?? 0)!
  const maisLivre = maior(unidades, u => u.contagem.aberta)!
  const maisVazia = maior(unidades, pctVazia)!
  const maisAjuste = maior(unidades, u => pessoasParaAjustarNoMapa(u).total)!
  const ajustes = pessoasParaAjustarNoMapa(maisAjuste).total

  return (
    <section aria-labelledby="ocup-destaques" className="flex flex-col gap-3">
      <h2 id="ocup-destaques" className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Destaques da semana</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Destaque
          cor={SITUACAO.paciente.cor}
          titulo="Mais ocupada com paciente"
          unidade={maisPaciente.unidade}
          valor={<><b>{fmtPct(pctComPaciente(maisPaciente.contagem))}</b> das vagas com paciente</>}
          onAbrir={onAbrir}
        />
        <Destaque
          cor={SITUACAO.aberta.cor}
          titulo="Mais vagas livres para agendar"
          unidade={maisLivre.unidade}
          valor={<><b>{fmtNum(maisLivre.contagem.aberta)}</b> vagas com profissional e sem paciente</>}
          onAbrir={onAbrir}
        />
        <Destaque
          cor={`border border-border ${SITUACAO.vazia.cor}`}
          titulo="Mais espaço sem profissional"
          unidade={maisVazia.unidade}
          valor={<><b>{fmtPct(pctVazia(maisVazia))}</b> das vagas ({fmtNum(maisVazia.contagem.vazia)}) sem ninguém na sala</>}
          onAbrir={onAbrir}
        />
        {ajustes > 0 ? (
          <Destaque
            cor={SITUACAO.regularizar.cor}
            titulo="Mais ajustes no mapa de salas"
            unidade={maisAjuste.unidade}
            valor={<><b>{plural(ajustes, "pessoa", "pessoas")}</b> para ajustar</>}
            onAbrir={onAbrir}
          />
        ) : (
          <Destaque
            cor={SITUACAO.regularizar.cor}
            titulo="Mapa de salas"
            unidade="Tudo em dia"
            valor={<>{plural(unidades.reduce((s, u) => s + comProfissional(u.contagem), 0), "vaga", "vagas")} com profissional, nenhuma pessoa para ajustar</>}
          />
        )}
      </div>
    </section>
  )
}

function Destaque({ cor, titulo, unidade, valor, onAbrir }: {
  cor: string
  titulo: string
  unidade: string
  valor: ReactNode
  onAbrir?: (unidade: string) => void
}) {
  const conteudo = (
    <>
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <span className={`h-3 w-3 shrink-0 rounded-[3px] ${cor}`} aria-hidden />{titulo}
      </span>
      <span className="flex items-center justify-between gap-2 text-xl font-black text-foreground">
        {unidade}
        {onAbrir && <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />}
      </span>
      <span className="text-sm text-muted-foreground [&_b]:font-bold [&_b]:text-foreground">{valor}</span>
    </>
  )
  const classe = "flex flex-col gap-1 rounded-2xl border border-border bg-card p-4 text-left shadow-sm"
  if (!onAbrir) return <div className={classe}>{conteudo}</div>
  return (
    <button type="button" onClick={() => onAbrir(unidade)}
      className={`${classe} transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
      {conteudo}
    </button>
  )
}
