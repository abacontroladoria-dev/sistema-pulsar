"use client"

import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { CalendarDays, CalendarRange, CircleSlash, Database, FastForward, Loader2, Pencil, Plus, Replace, RotateCcw, X } from "lucide-react"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { btnPerigo, btnPrimario, btnSecundario } from "@/components/cronograma/grade/estilo"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { CabecalhoSecao, EstadoVazio } from "@/components/ui/padrao"
import { COR_NEUTRA } from "@/lib/cadastros/terapias"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { useProfissionais } from "@/hooks/useProfissionais"
import { dataBR, hojeBrasilia, rascunhoDeVersao, periodoBR, somarDias, totaisDaSemana } from "@/lib/disponibilidadeProfissional"
import { listarLocais, listarOcupacoesDeOutros, valerHoje } from "@/services/profissionalDisponibilidade.service"
import type {
  LocalDisponivel, OcupacaoLocal, OrigemVersao, RascunhoDisponibilidade, VersaoDisponibilidade,
} from "@/types/disponibilidadeProfissional"
import type { CadastroTerapia } from "@/types/terapia"
import type { Profissional } from "@/types/profissional"
import { EditorDisponibilidade } from "./EditorDisponibilidade"
import { FaixaSituacao, ROTULO_SITUACAO, SemanaLeitura } from "./pecasDisponibilidade"
import { VigenciaModal } from "./VigenciaModal"

type Edicao = { base: RascunhoDisponibilidade; origem: OrigemVersao; restauradaDe: VersaoDisponibilidade | null }

export function AbaDisponibilidade({
  prof,
  versoes,
  habilitadas,
  catalogo,
  carregando,
  erro,
  migrationPendente,
  versaoInicialId,
  onMudou,
}: {
  prof: Profissional
  versoes: VersaoDisponibilidade[]
  habilitadas: number[]
  catalogo: CadastroTerapia[]
  carregando: boolean
  erro: string | null
  migrationPendente: boolean
  /** Versão a abrir (vinda do "Abrir" do Histórico). */
  versaoInicialId?: string | null
  onMudou: () => Promise<void> | void
}) {
  const { profissionais } = useProfissionais()
  const { confirmar, dialogo } = useConfirmacao()
  // Mais nova primeiro; as substituídas (que nunca valeram como planejado) no fim.
  const ordenadas = useMemo(
    () => [...versoes].sort((a, b) =>
      Number(a.situacao === "substituida") - Number(b.situacao === "substituida") || b.vigente_de.localeCompare(a.vigente_de)),
    [versoes]
  )
  const vigente = ordenadas.find(v => v.situacao === "vigente") ?? null
  const [selecionadaId, setSelecionadaId] = useState<string | null>(versaoInicialId ?? null)
  const selecionada = ordenadas.find(v => v.id === selecionadaId) ?? vigente ?? ordenadas[0] ?? null

  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [preparando, setPreparando] = useState(false)
  const [locais, setLocais] = useState<LocalDisponivel[]>([])
  const [ocupacoes, setOcupacoes] = useState<OcupacaoLocal[]>([])
  const [vigencia, setVigencia] = useState<{ versao: VersaoDisponibilidade; modo: "encerrar" | "ajustar" } | null>(null)
  const [antecipando, setAntecipando] = useState(false)

  /** A versão agendada passa a valer hoje, mantendo o número. */
  const fazerValerHoje = async (v: VersaoDisponibilidade) => {
    const hoje = hojeBrasilia()
    const atual = versoes.find(x => x.situacao === "vigente") ?? null
    const efeito = !atual
      ? ""
      : atual.vigente_de >= hoje
        ? ` A versão nº ${atual.numero}, que começou hoje, fica substituída (continua no histórico).`
        : ` A versão nº ${atual.numero} passa a terminar ontem, ${dataBR(somarDias(hoje, -1))}.`
    const ok = await confirmar({
      titulo: `Fazer a versão nº ${v.numero} valer a partir de hoje?`,
      texto: `Ela começa a valer hoje, ${dataBR(hoje)}, em vez de ${dataBR(v.vigente_de)}.${efeito}`,
      confirmar: "Valer a partir de hoje",
      t: "verde",
      Icone: FastForward,
    })
    if (!ok) return
    setAntecipando(true)
    try {
      await valerHoje(v.id)
      toast.success(`Versão nº ${v.numero} valendo a partir de hoje`)
      setSelecionadaId(v.id)
      await onMudou()
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e), { duration: 8000 })
    } finally {
      setAntecipando(false)
    }
  }

  const catalogoPorId = useMemo(() => new Map(catalogo.map(t => [t.id, t])), [catalogo])
  const corDaTerapia = (id: number) => catalogoPorId.get(id)?.cor_hex ?? COR_NEUTRA
  const nomeTerapia = (id: number) => catalogoPorId.get(id)?.nome ?? `#${id}`
  const nomesProf = useMemo(() => new Map(profissionais.map(p => [p.id, p.nome])), [profissionais])

  // Locais e ocupação dos outros só quando vai editar (consulta mais pesada).
  const abrirEditor = async (e: Edicao) => {
    setPreparando(true)
    try {
      const [l, o] = await Promise.all([listarLocais(), listarOcupacoesDeOutros(prof.id)])
      setLocais(l)
      setOcupacoes(o)
      setEdicao(e)
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err))
    } finally {
      setPreparando(false)
    }
  }

  if (migrationPendente) {
    return (
      <InlineNotice tone="amber" icon={<Database className="h-4 w-4" />}>
        A disponibilidade ainda não existe neste banco. Aplique a migration <strong>20261006140000_profissionais_disponibilidade.sql</strong>.
      </InlineNotice>
    )
  }
  if (carregando) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando disponibilidade…</div>
  }
  if (erro) {
    return <InlineNotice tone="red">{erro}</InlineNotice>
  }

  if (edicao) {
    return (
      <>
      <EditorDisponibilidade
        profissional={prof}
        base={edicao.base}
        origemInicial={edicao.origem}
        restauradaDe={edicao.restauradaDe}
        versoes={versoes}
        habilitadas={habilitadas}
        catalogo={catalogo}
        locais={locais}
        ocupacoes={ocupacoes}
        nomeProfissional={id => nomesProf.get(id) ?? `Profissional ${id}`}
        onCancelar={async () => {
          if (await confirmar({
            titulo: "Descartar as alterações?",
            texto: "O que você mudou no editor será perdido. A disponibilidade salva continua como está.",
            confirmar: "Descartar",
            cancelar: "Continuar editando",
            t: "vermelho",
            Icone: X,
          })) setEdicao(null)
        }}
        onSalvo={async () => { setEdicao(null); setSelecionadaId(null); await onMudou() }}
        onSemMudanca={() => setEdicao(null)}
      />
      {dialogo}
      </>
    )
  }

  const novaVersao = () =>
    abrirEditor({ base: rascunhoDeVersao(vigente ?? ordenadas[0] ?? null), origem: "manual", restauradaDe: null })

  if (!ordenadas.length) {
    return (
      <EstadoVazio
        Icone={CalendarDays}
        titulo="Nenhuma disponibilidade cadastrada"
        texto={<>Monte os dias, horários, terapias e locais em que {prof.nome.split(" ")[0]} atende.
          {prof.tita_profissional_id ? " Dá para começar pelo que a grade do TiTa já mostra." : ""}</>}
        acao={
          <button type="button" onClick={novaVersao} disabled={preparando} className={btnPrimario}>
            {preparando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Cadastrar disponibilidade
          </button>
        }
      />
    )
  }

  const rascunhoSel = selecionada ? rascunhoDeVersao(selecionada) : null
  const totais = rascunhoSel ? totaisDaSemana(rascunhoSel) : null

  return (
    <div className="space-y-4">
      <section aria-labelledby="disp-titulo" className="rounded-lg border border-border bg-card px-4 py-4">
        <CabecalhoSecao
          id="disp-titulo"
          titulo="Disponibilidade"
          rotuloAjuda="Como funcionam as versões"
          apoio={vigente ? `Versão nº ${vigente.numero} valendo · ${periodoBR(vigente.vigente_de, vigente.vigente_ate)}` : "Nenhuma versão valendo hoje"}
          ajuda={[
            { Icone: Pencil, texto: "É só editar: ao salvar uma mudança, o sistema guarda a anterior e cria a versão nova, com data para começar e (se quiser) para terminar." },
            { Icone: CircleSlash, tone: "red", texto: "Passou a data de fim e não há outra versão: a grade fica inativa." },
            { Icone: FastForward, tone: "green", texto: "Versão agendada para depois? \"Valer a partir de hoje\" antecipa sem mudar o número." },
            { Icone: Replace, tone: "blue", texto: "Trocada antes de valer (ou no mesmo dia em que começou), a versão fica \"Substituída\" no histórico." },
            { Icone: RotateCcw, texto: "Versões antigas nunca são apagadas — dá para restaurar qualquer uma." },
          ]}
        />

        {/* Seletor de versões: da mais nova para a mais antiga */}
        <SegmentedTabs<string>
          value={selecionada?.id ?? ""}
          onChange={setSelecionadaId}
          ariaLabel="Versões"
          tabs={ordenadas.map(v => ({
            value: v.id,
            label: <>nº {v.numero} · {ROTULO_SITUACAO[v.situacao]} <span className="font-normal tabular-nums opacity-80">· {periodoBR(v.vigente_de, v.vigente_ate)}</span></>,
          }))}
        />
      </section>

      {selecionada && rascunhoSel && totais && (
        <section aria-labelledby="disp-versao" className="rounded-lg border border-border bg-card px-4 py-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 id="disp-versao" className="text-base font-semibold text-foreground">Versão nº {selecionada.numero}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {totais.sessoes} sessões/semana · criada por {selecionada.criado_por_nome ?? "—"} em {new Date(selecionada.criado_em).toLocaleDateString("pt-BR")}
                {selecionada.origem === "preenchido_tita" && " · montada a partir da grade do TiTa"}
                {selecionada.origem === "restaurada" && " · restaurada de versão anterior"}
                {selecionada.motivo && ` · “${selecionada.motivo}”`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selecionada.situacao === "encerrada" || selecionada.situacao === "substituida" ? (
                <button type="button" disabled={preparando}
                  onClick={() => abrirEditor({ base: rascunhoDeVersao(selecionada), origem: "restaurada", restauradaDe: selecionada })}
                  className={btnSecundario}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Restaurar
                </button>
              ) : (
                <>
                  <button type="button" disabled={preparando}
                    onClick={() => abrirEditor({ base: rascunhoDeVersao(selecionada), origem: "manual", restauradaDe: null })}
                    className={btnPrimario}>
                    {preparando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Pencil className="h-4 w-4" aria-hidden />} Editar
                  </button>
                  {selecionada.situacao === "agendada" && (
                    <button type="button" disabled={antecipando} onClick={() => fazerValerHoje(selecionada)} className={btnSecundario}>
                      {antecipando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FastForward className="h-4 w-4" aria-hidden />}
                      Valer a partir de hoje
                    </button>
                  )}
                  <button type="button" onClick={() => setVigencia({ versao: selecionada, modo: "ajustar" })} className={btnSecundario}>
                    <CalendarRange className="h-4 w-4" aria-hidden /> Vigência
                  </button>
                  <button type="button" onClick={() => setVigencia({ versao: selecionada, modo: "encerrar" })} className={btnPerigo}>
                    <CircleSlash className="h-4 w-4" aria-hidden /> Encerrar
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="mb-4">
            <FaixaSituacao
              situacao={selecionada.situacao}
              de={selecionada.vigente_de}
              ate={selecionada.vigente_ate}
              substituidaPor={selecionada.substituida_por ? versoes.find(x => x.id === selecionada.substituida_por)?.numero : null}
            />
          </div>
          <SemanaLeitura rascunho={rascunhoSel} corDaTerapia={corDaTerapia} nomeTerapia={nomeTerapia} />
        </section>
      )}

      {dialogo}

      {vigencia && (
        <VigenciaModal
          versao={vigencia.versao}
          modo={vigencia.modo}
          onFechar={() => setVigencia(null)}
          onSalvo={async () => { setVigencia(null); await onMudou() }}
        />
      )}
    </div>
  )
}
