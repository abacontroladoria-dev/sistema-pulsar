"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FileOutput } from "lucide-react"
import toast from "react-hot-toast"
import { useHeader } from "@/contexts/HeaderContext"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import type { OpcaoMulti } from "@/components/cronograma/ui/MultiSearchCombobox"
import { gerarCsv } from "@/lib/exportarEvolucoes/csv"
import { nomeDoArquivo } from "@/lib/exportarEvolucoes/formato"
import { baixarArquivo, gerarPdfEvolucoes } from "@/lib/exportarEvolucoes/pdf"
import { ErroExportacao, lerAssinaturas, lerConteudo, listarEvolucoes } from "@/services/exportar-evolucoes.service"
import type { EvolucaoItem } from "@/types/exportarEvolucoes"
import { BarraExportacao, type Progresso } from "./BarraExportacao"
import { CardEvolucao } from "./CardEvolucao"
import { FiltrosExportacao, periodoPadrao } from "./FiltrosExportacao"
import { PainelEvolucao } from "./PainelEvolucao"

// Exportar Evoluções: período + pacientes + terapias → cards por paciente →
// seleção → PDF (relatório para o convênio) ou CSV. Plano:
// docs/PLANO_EXPORTAR_EVOLUCOES.md.
//
// O período consulta o banco (e vai na URL, para dar para compartilhar);
// pacientes e terapias filtram o que ele trouxe, aqui mesmo. O texto clínico só
// é pedido ao abrir um card ou ao exportar — e cada pedido fica registrado.

const DATA = /^\d{4}-\d{2}-\d{2}$/
const CONFIRMAR_ACIMA_DE = 1000
const GRUPOS_POR_VEZ = 20
const CARDS_POR_VEZ = 30

const chavePaciente = (i: EvolucaoItem) => (i.paciente_id != null ? `id:${i.paciente_id}` : `nome:${i.paciente_nome}`)

type Grupo = { chave: string; nome: string; convenio: string | null; itens: EvolucaoItem[] }

function agrupar(itens: EvolucaoItem[]): Grupo[] {
  const mapa = new Map<string, Grupo>()
  for (const i of itens) {
    const k = chavePaciente(i)
    let g = mapa.get(k)
    if (!g) {
      g = { chave: k, nome: i.paciente_nome, convenio: i.convenio, itens: [] }
      mapa.set(k, g)
    }
    g.itens.push(i)
  }
  return [...mapa.values()]
}

function opcoesContadas(valores: { id: string; nome: string }[]): OpcaoMulti<string>[] {
  const mapa = new Map<string, { nome: string; n: number }>()
  for (const v of valores) {
    const atual = mapa.get(v.id)
    if (atual) atual.n++
    else mapa.set(v.id, { nome: v.nome, n: 1 })
  }
  return [...mapa.entries()]
    .map(([id, { nome, n }]) => ({ id, nome: `${nome} (${n})` }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
}

/** Caixa do cabeçalho do paciente: marcada, desmarcada ou parcial. */
function CaixaGrupo({ marcadas, total, onChange, rotulo }: { marcadas: number; total: number; onChange: () => void; rotulo: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = marcadas > 0 && marcadas < total
  }, [marcadas, total])
  return (
    <label className="flex min-h-11 w-12 shrink-0 cursor-pointer items-center justify-center">
      <input ref={ref} type="checkbox" checked={marcadas === total && total > 0} onChange={onChange} aria-label={rotulo} className="h-4 w-4 cursor-pointer accent-sky-700" />
    </label>
  )
}

export default function ExportarEvolucoesShell() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("Exportar Evoluções", "Atendimentos realizados em PDF ou CSV para o convênio")
  }, [setHeader])

  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const de = params.get("de")
  const ate = params.get("ate")
  const periodo = useMemo(
    () => (de && ate && DATA.test(de) && DATA.test(ate) && de <= ate ? { inicio: de, fim: ate } : periodoPadrao()),
    [de, ate],
  )
  const mudarPeriodo = useCallback(
    (p: { inicio: string; fim: string }) => router.replace(`${pathname}?de=${p.inicio}&ate=${p.fim}`, { scroll: false }),
    [router, pathname],
  )

  // ── Dados do período ──────────────────────────────────────────────────────
  const [recarga, setRecarga] = useState(0)
  const consulta = `${periodo.inicio}|${periodo.fim}|${recarga}`
  const [dados, setDados] = useState<{ consulta: string; itens?: EvolucaoItem[]; erro?: string } | null>(null)

  useEffect(() => {
    let vivo = true
    listarEvolucoes(periodo.inicio, periodo.fim)
      .then(r => vivo && setDados({ consulta, itens: r }))
      .catch(e => vivo && setDados({ consulta, erro: e instanceof ErroExportacao ? e.message : "Não foi possível ler as evoluções." }))
    return () => {
      vivo = false
    }
  }, [periodo.inicio, periodo.fim, consulta])

  // Resultado de outro período (ou de antes do "Tentar de novo") não vale: carregando.
  const atual = dados?.consulta === consulta ? dados : null
  const itens = atual?.itens ?? null
  const erro = atual?.erro ?? null

  // ── Filtros da tela ───────────────────────────────────────────────────────
  const [pacientes, setPacientes] = useState<Set<string>>(new Set())
  const [terapias, setTerapias] = useState<Set<string>>(new Set())

  const opcoesPacientes = useMemo(
    () => opcoesContadas((itens ?? []).map(i => ({ id: chavePaciente(i), nome: i.paciente_nome }))),
    [itens],
  )
  const opcoesTerapias = useMemo(() => opcoesContadas((itens ?? []).map(i => ({ id: i.terapia, nome: i.terapia }))), [itens])

  // Paciente/terapia que não existe no período novo sai do filtro.
  useEffect(() => {
    if (!itens) return
    const pacs = new Set(itens.map(chavePaciente))
    const ters = new Set(itens.map(i => i.terapia))
    setPacientes(s => (([...s].every(p => pacs.has(p)) ? s : new Set([...s].filter(p => pacs.has(p))))))
    setTerapias(s => (([...s].every(t => ters.has(t)) ? s : new Set([...s].filter(t => ters.has(t))))))
  }, [itens])

  const visiveis = useMemo(
    () =>
      (itens ?? []).filter(
        i => (pacientes.size === 0 || pacientes.has(chavePaciente(i))) && (terapias.size === 0 || terapias.has(i.terapia)),
      ),
    [itens, pacientes, terapias],
  )
  const grupos = useMemo(() => agrupar(visiveis), [visiveis])

  // ── Seleção ───────────────────────────────────────────────────────────────
  const [sel, setSel] = useState<Set<string>>(new Set())

  // Ao trocar o filtro, a seleção fica só com o que continua visível.
  useEffect(() => {
    const vis = new Set(visiveis.map(i => i.chave))
    setSel(prev => {
      const novo = new Set([...prev].filter(c => vis.has(c)))
      return novo.size === prev.size ? prev : novo
    })
  }, [visiveis])

  const marcar = useCallback((chave: string) => {
    setSel(prev => {
      const novo = new Set(prev)
      if (novo.has(chave)) novo.delete(chave)
      else novo.add(chave)
      return novo
    })
  }, [])
  const marcarGrupo = (g: Grupo) => {
    setSel(prev => {
      const novo = new Set(prev)
      const todas = g.itens.every(i => novo.has(i.chave))
      for (const i of g.itens) {
        if (todas) novo.delete(i.chave)
        else novo.add(i.chave)
      }
      return novo
    })
  }
  const todasMarcadas = visiveis.length > 0 && visiveis.every(i => sel.has(i.chave))

  const selecionadas = useMemo(() => visiveis.filter(i => sel.has(i.chave)), [visiveis, sel])
  const semAssinatura = useMemo(
    () => new Set(selecionadas.filter(i => !i.tem_assinatura).map(i => i.profissional_id ?? i.profissional_nome)).size,
    [selecionadas],
  )

  // ── Quanto mostrar (a lista pode ter milhares) ────────────────────────────
  const [gruposMostrados, setGruposMostrados] = useState(GRUPOS_POR_VEZ)
  const [cardsMostrados, setCardsMostrados] = useState<Record<string, number>>({})
  useEffect(() => {
    setGruposMostrados(GRUPOS_POR_VEZ)
    setCardsMostrados({})
  }, [itens, pacientes, terapias])

  const [aberto, setAberto] = useState<EvolucaoItem | null>(null)

  // ── Exportar ──────────────────────────────────────────────────────────────
  const { confirmar, dialogo } = useConfirmacao()
  const [progresso, setProgresso] = useState<Progresso | null>(null)

  const exportar = async (formato: "pdf" | "csv") => {
    const escolhidas = selecionadas
    if (escolhidas.length === 0 || progresso) return
    const n = escolhidas.length
    if (
      n > CONFIRMAR_ACIMA_DE &&
      !(await confirmar({
        titulo: `Exportar ${n.toLocaleString("pt-BR")} evoluções?`,
        texto: `São muitas evoluções: ${formato === "pdf" ? "o PDF" : "o CSV"} pode levar alguns minutos para ficar pronto (cerca de ${Math.max(1, Math.ceil(n / 1500))} min). A tela continua usável enquanto isso.`,
        confirmar: `Exportar ${formato.toUpperCase()}`,
        t: "aco",
        Icone: FileOutput,
      }))
    )
      return

    try {
      setProgresso({ texto: `Lendo evoluções… 0 de ${n}`, feito: 0, total: n })
      const conteudo = await lerConteudo(
        escolhidas.map(i => i.chave),
        formato,
        (lidas, total) => setProgresso({ texto: `Lendo evoluções… ${lidas} de ${total}`, feito: lidas, total }),
      )
      if (conteudo.length === 0) {
        toast.error("Nenhuma das evoluções selecionadas está mais disponível.")
        return
      }
      const nome = nomeDoArquivo(
        conteudo.map(c => ({ id: chavePaciente(c), nome: c.paciente_nome })),
        periodo.inicio,
        periodo.fim,
        formato,
      )

      if (formato === "csv") {
        baixarArquivo(gerarCsv(conteudo), "text/csv;charset=utf-8", nome)
      } else {
        setProgresso({ texto: "Buscando assinaturas…", feito: 0, total: 1 })
        const ids = [...new Set(conteudo.filter(c => c.tem_assinatura && c.profissional_id != null).map(c => c.profissional_id as number))]
        const assinaturas = await lerAssinaturas(ids)
        const bytes = await gerarPdfEvolucoes({
          itens: conteudo,
          de: periodo.inicio,
          ate: periodo.fim,
          assinaturas,
          aoProgredir: (pagina, total) => setProgresso({ texto: `Gerando página ${pagina} de ${total}…`, feito: pagina, total }),
        })
        baixarArquivo(bytes as BlobPart, "application/pdf", nome)
      }
      if (conteudo.length < n) toast(`${n - conteudo.length} evolução(ões) não estavam mais disponíveis e ficaram fora.`)
    } catch (e) {
      toast.error(e instanceof ErroExportacao ? e.message : "Não foi possível gerar o arquivo. Tente de novo.")
    } finally {
      setProgresso(null)
    }
  }

  // ── Tela ──────────────────────────────────────────────────────────────────
  const carregando = itens === null && !erro

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-3">
      <FiltrosExportacao
        periodo={periodo}
        onPeriodo={mudarPeriodo}
        opcoesPacientes={opcoesPacientes}
        pacientes={pacientes}
        onPacientes={setPacientes}
        opcoesTerapias={opcoesTerapias}
        terapias={terapias}
        onTerapias={setTerapias}
        carregando={carregando}
      />

      <div aria-live="polite" className="flex-1 space-y-3">
        {erro ? (
          <div className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[14px] text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
            <p>{erro}</p>
            <button
              type="button"
              onClick={() => setRecarga(r => r + 1)}
              className="min-h-11 rounded-lg border border-rose-300 bg-white px-3 text-[13px] font-semibold text-rose-800 hover:bg-rose-50 dark:border-rose-700 dark:bg-transparent dark:text-rose-200"
            >
              Tentar de novo
            </button>
          </div>
        ) : carregando ? (
          <div className="space-y-2" aria-label="Carregando evoluções">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-xl border border-border bg-muted/40" />
            ))}
          </div>
        ) : itens!.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[14px] text-muted-foreground">
            Nenhuma evolução neste período.
          </p>
        ) : visiveis.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[14px] text-muted-foreground">
            Nenhuma evolução com estes filtros.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex-1 text-[14px] text-muted-foreground">
                <span className="font-semibold text-foreground">{visiveis.length.toLocaleString("pt-BR")}</span>{" "}
                {visiveis.length === 1 ? "evolução" : "evoluções"} · {grupos.length} {grupos.length === 1 ? "paciente" : "pacientes"}
              </div>
              <button
                type="button"
                onClick={() => setSel(todasMarcadas ? new Set() : new Set(visiveis.map(i => i.chave)))}
                className="min-h-11 rounded-lg px-2 text-[14px] font-semibold text-sky-800 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/30"
              >
                {todasMarcadas ? "Desmarcar tudo" : "Selecionar tudo"}
              </button>
              <button
                type="button"
                onClick={() => setSel(new Set())}
                disabled={sel.size === 0}
                className="min-h-11 rounded-lg px-2 text-[14px] font-semibold text-muted-foreground hover:bg-muted/50 disabled:opacity-40"
              >
                Limpar
              </button>
            </div>

            {grupos.slice(0, gruposMostrados).map(g => {
              const marcadas = g.itens.reduce((n, i) => n + (sel.has(i.chave) ? 1 : 0), 0)
              const limite = cardsMostrados[g.chave] ?? CARDS_POR_VEZ
              return (
                <section key={g.chave} className="space-y-1.5">
                  <div className="flex items-center gap-1 border-b border-border">
                    <CaixaGrupo
                      marcadas={marcadas}
                      total={g.itens.length}
                      onChange={() => marcarGrupo(g)}
                      rotulo={`Selecionar todas as evoluções de ${g.nome}`}
                    />
                    <h2 className="min-w-0 flex-1 break-words py-2 text-[16px] font-bold text-foreground">
                      {g.nome} <span className="font-medium text-muted-foreground">({g.itens.length})</span>
                    </h2>
                    {g.convenio && <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">{g.convenio}</span>}
                  </div>
                  <ul className="space-y-1.5">
                    {g.itens.slice(0, limite).map(i => (
                      <CardEvolucao key={i.chave} item={i} marcada={sel.has(i.chave)} onMarcar={marcar} onAbrir={setAberto} />
                    ))}
                  </ul>
                  {g.itens.length > limite && (
                    <button
                      type="button"
                      onClick={() => setCardsMostrados(m => ({ ...m, [g.chave]: limite + CARDS_POR_VEZ * 3 }))}
                      className="min-h-11 w-full rounded-xl border border-dashed border-border text-[14px] font-semibold text-sky-800 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/30"
                    >
                      Mostrar mais {Math.min(g.itens.length - limite, CARDS_POR_VEZ * 3)} de {g.itens.length - limite} restantes
                    </button>
                  )}
                </section>
              )
            })}
            {grupos.length > gruposMostrados && (
              <button
                type="button"
                onClick={() => setGruposMostrados(n => n + GRUPOS_POR_VEZ)}
                className="min-h-11 w-full rounded-xl border border-border bg-card text-[14px] font-semibold text-sky-800 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/30"
              >
                Mostrar mais pacientes ({grupos.length - gruposMostrados} restantes)
              </button>
            )}
          </>
        )}
      </div>

      <BarraExportacao
        selecionadas={selecionadas.length}
        semAssinatura={semAssinatura}
        progresso={progresso}
        onCsv={() => exportar("csv")}
        onPdf={() => exportar("pdf")}
      />

      {aberto && <PainelEvolucao key={aberto.chave} item={aberto} onClose={() => setAberto(null)} />}
      {dialogo}
    </div>
  )
}
