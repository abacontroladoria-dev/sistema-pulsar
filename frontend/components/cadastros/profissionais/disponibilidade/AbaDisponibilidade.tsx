"use client"

import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { CalendarDays, CalendarRange, CircleSlash, Copy, Database, Loader2, Plus, RotateCcw, X } from "lucide-react"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { CabecalhoPastel, SecaoPastel, tom } from "@/components/ui/pastel/pecas"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { useProfissionais } from "@/hooks/useProfissionais"
import { rascunhoDeVersao, periodoBR, totaisDaSemana } from "@/lib/disponibilidadeProfissional"
import { listarLocais, listarOcupacoesDeOutros } from "@/services/profissionalDisponibilidade.service"
import type {
  LocalDisponivel, OcupacaoLocal, OrigemVersao, RascunhoDisponibilidade, VersaoDisponibilidade,
} from "@/types/disponibilidadeProfissional"
import type { CadastroTerapia } from "@/types/terapia"
import type { Profissional } from "@/types/profissional"
import { EditorDisponibilidade } from "./EditorDisponibilidade"
import { FaixaSituacao, SeloSituacao, SemanaLeitura, TOM_SITUACAO } from "./pecasDisponibilidade"
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
  const ordenadas = useMemo(() => [...versoes].sort((a, b) => b.vigente_de.localeCompare(a.vigente_de)), [versoes])
  const vigente = ordenadas.find(v => v.situacao === "vigente") ?? null
  const [selecionadaId, setSelecionadaId] = useState<string | null>(versaoInicialId ?? null)
  const selecionada = ordenadas.find(v => v.id === selecionadaId) ?? vigente ?? ordenadas[0] ?? null

  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [preparando, setPreparando] = useState(false)
  const [locais, setLocais] = useState<LocalDisponivel[]>([])
  const [ocupacoes, setOcupacoes] = useState<OcupacaoLocal[]>([])
  const [vigencia, setVigencia] = useState<{ versao: VersaoDisponibilidade; modo: "encerrar" | "ajustar" } | null>(null)

  const catalogoPorId = useMemo(() => new Map(catalogo.map(t => [t.id, t])), [catalogo])
  const corDaTerapia = (id: number) => catalogoPorId.get(id)?.cor_hex ?? "#CBD5E1"
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
    return <div className="flex items-center gap-2 p-6 text-sm font-semibold text-[var(--pp-ink-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando disponibilidade…</div>
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
            titulo: "Descartar esta nova versão?",
            texto: "O que você montou no editor será perdido. As versões já salvas continuam como estão.",
            confirmar: "Descartar",
            cancelar: "Continuar editando",
            t: "vermelho",
            Icone: X,
          })) setEdicao(null)
        }}
        onSalvo={async () => { setEdicao(null); setSelecionadaId(null); await onMudou() }}
      />
      {dialogo}
      </>
    )
  }

  const novaVersao = () =>
    abrirEditor({ base: rascunhoDeVersao(vigente ?? ordenadas[0] ?? null), origem: "manual", restauradaDe: null })

  if (!ordenadas.length) {
    return (
      <SecaoPastel titulo="disp-vazia">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className={`${tom("teal")} flex size-16 items-center justify-center rounded-[20px] bg-[var(--c)] text-[var(--c-sobre)]`}>
            <CalendarDays className="h-7 w-7" aria-hidden />
          </span>
          <h3 id="disp-vazia" className="text-[20px] font-extrabold">Nenhuma disponibilidade cadastrada</h3>
          <p className="max-w-md text-sm font-semibold text-[var(--pp-ink-muted)]">
            Monte os dias, horários, terapias e locais em que {prof.nome.split(" ")[0]} atende.
            {prof.tita_profissional_id ? " Dá para começar pelo que a grade TiTa já mostra." : ""}
          </p>
          <button type="button" onClick={novaVersao} disabled={preparando} className={`${tom("teal")} pp-btn mt-1`}>
            {preparando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Criar a primeira versão
          </button>
        </div>
      </SecaoPastel>
    )
  }

  const rascunhoSel = selecionada ? rascunhoDeVersao(selecionada) : null
  const totais = rascunhoSel ? totaisDaSemana(rascunhoSel) : null

  return (
    <div className="space-y-5">
      <SecaoPastel titulo="disp-titulo">
        <CabecalhoPastel
          id="disp-titulo"
          titulo="Disponibilidade"
          t="teal"
          Icone={CalendarDays}
          apoio={vigente ? `Versão nº ${vigente.numero} valendo · ${periodoBR(vigente.vigente_de, vigente.vigente_ate)}` : "Nenhuma versão valendo hoje"}
          ajuda={[
            { t: "teal", Icone: CalendarRange, texto: "Cada mudança vira uma versão nova, com data para começar e (se quiser) para terminar." },
            { t: "vermelho", Icone: CircleSlash, texto: "Passou a data de fim e não há outra versão: a grade fica inativa." },
            { t: "aco", Icone: RotateCcw, texto: "Versões antigas nunca são apagadas — dá para restaurar qualquer uma." },
          ]}
          direita={
            <button type="button" onClick={novaVersao} disabled={preparando} className={`${tom("teal")} pp-btn`}>
              {preparando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Nova versão
            </button>
          }
        />

        {/* Seletor de versões: da mais nova para a mais antiga */}
        <div role="tablist" aria-label="Versões" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {ordenadas.map(v => {
            const ativa = selecionada?.id === v.id
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={ativa}
                onClick={() => setSelecionadaId(v.id)}
                className={`${tom(TOM_SITUACAO[v.situacao])} flex shrink-0 flex-col items-start gap-0.5 rounded-[16px] px-3.5 py-2.5 text-left transition-shadow ${
                  ativa ? "bg-[var(--c-suave)] shadow-[inset_0_0_0_2px_var(--c-medio)]" : "bg-[var(--pp-muted)] hover:bg-[var(--c-suave)]"
                }`}
              >
                <span className="flex items-center gap-2 text-[13px] font-extrabold">
                  nº {v.numero} <SeloSituacao situacao={v.situacao} compacto />
                </span>
                <span className="text-xs font-semibold tabular-nums text-[var(--pp-ink-muted)]">{periodoBR(v.vigente_de, v.vigente_ate)}</span>
              </button>
            )
          })}
        </div>
      </SecaoPastel>

      {selecionada && rascunhoSel && totais && (
        <SecaoPastel titulo="disp-versao">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="disp-versao" className="text-[18px] font-extrabold">Versão nº {selecionada.numero}</h3>
              <p className="text-[13px] font-semibold text-[var(--pp-ink-muted)]">
                {totais.sessoes} sessões/semana · criada por {selecionada.criado_por_nome ?? "—"} em {new Date(selecionada.criado_em).toLocaleDateString("pt-BR")}
                {selecionada.origem === "preenchido_tita" && " · montada a partir da grade TiTa"}
                {selecionada.origem === "restaurada" && " · restaurada de versão anterior"}
                {selecionada.motivo && ` · “${selecionada.motivo}”`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selecionada.situacao === "encerrada" ? (
                <button type="button" disabled={preparando}
                  onClick={() => abrirEditor({ base: rascunhoDeVersao(selecionada), origem: "restaurada", restauradaDe: selecionada })}
                  className={`${tom("aco")} pp-btn pp-btn-suave`}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Restaurar como nova versão
                </button>
              ) : (
                <>
                  <button type="button" disabled={preparando}
                    onClick={() => abrirEditor({ base: rascunhoDeVersao(selecionada), origem: "manual", restauradaDe: null })}
                    className={`${tom("teal")} pp-btn pp-btn-suave`}>
                    <Copy className="h-4 w-4" aria-hidden /> Partir desta
                  </button>
                  <button type="button" onClick={() => setVigencia({ versao: selecionada, modo: "ajustar" })} className={`${tom("aco")} pp-btn pp-btn-suave`}>
                    <CalendarRange className="h-4 w-4" aria-hidden /> Vigência
                  </button>
                  <button type="button" onClick={() => setVigencia({ versao: selecionada, modo: "encerrar" })} className={`${tom("vermelho")} pp-btn pp-btn-suave`}>
                    <CircleSlash className="h-4 w-4" aria-hidden /> Encerrar
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="mb-4">
            <FaixaSituacao situacao={selecionada.situacao} de={selecionada.vigente_de} ate={selecionada.vigente_ate} />
          </div>
          <SemanaLeitura rascunho={rascunhoSel} corDaTerapia={corDaTerapia} nomeTerapia={nomeTerapia} />
        </SecaoPastel>
      )}

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
