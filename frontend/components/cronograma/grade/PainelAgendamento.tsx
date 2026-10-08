"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle, CalendarClock, CloudDownload, History, Loader2, MapPin, Repeat, Stethoscope, Trash2, UserRound, UserRoundX,
} from "lucide-react"
import toast from "react-hot-toast"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { avisoFeito, tom } from "@/components/ui/pastel/pecas"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { campo } from "@/components/cadastros/pacientes/ui/campos"
import { estiloTons } from "@/lib/cadastros/tonsTerapia"
import { dataBR, horaCurta, hojeBrasilia } from "@/lib/disponibilidadeProfissional"
import { descreverSerie, rotuloDia } from "@/lib/grade/motor"
import { buscarSerie, contarDestaEmDiante, excluir, listarEventosDaSessao } from "@/services/grade.service"
import type { AgendamentoGrade, EventoGrade, SerieGrade } from "@/types/grade"
import { ListaEventos } from "./PainelRegistro"

// Detalhe de uma sessão (painel lateral): dados, série, histórico e as duas
// exclusões — só esta, ou desta em diante. Motivo obrigatório; nada do passado
// é excluído (o banco também recusa). Nada vai ao TiTa.

type Escopo = "somente_esta" | "desta_em_diante"

export function PainelAgendamento({
  a, cor, reposicao, foraDaGrade, foraDaJanela, onFechar, onMudou,
}: {
  a: AgendamentoGrade
  cor: string | null
  /** Profissional já saiu: sessão mantida para reposição. */
  reposicao: boolean
  foraDaGrade: boolean
  foraDaJanela: boolean
  onFechar: () => void
  onMudou: () => void
}) {
  const [serie, setSerie] = useState<SerieGrade | null>(null)
  const [eventos, setEventos] = useState<EventoGrade[] | null>(null)
  const [escopo, setEscopo] = useState<Escopo | null>(null)
  const [motivo, setMotivo] = useState("")
  const [previa, setPrevia] = useState<{ quantidade: number; ultima: string | null } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const { confirmar, dialogo } = useConfirmacao()

  const hoje = hojeBrasilia()
  const passado = a.data < hoje
  const temSerie = !!a.serie_id && serie?.frequencia === "semanal"

  useEffect(() => {
    let vivo = true
    if (a.serie_id) buscarSerie(a.serie_id).then(s => vivo && setSerie(s)).catch(() => {})
    listarEventosDaSessao(a.id, a.serie_id).then(e => vivo && setEventos(e)).catch(() => vivo && setEventos([]))
    return () => { vivo = false }
  }, [a.id, a.serie_id])

  useEffect(() => {
    setPrevia(null)
    if (escopo !== "desta_em_diante" || !a.serie_id) return
    let vivo = true
    contarDestaEmDiante(a.serie_id, a.data).then(p => vivo && setPrevia(p)).catch(() => {})
    return () => { vivo = false }
  }, [escopo, a.serie_id, a.data])

  const confirmarExclusao = async () => {
    if (!escopo || motivo.trim().length < 3) return
    const qtd = escopo === "somente_esta" ? 1 : previa?.quantidade ?? 0
    const ok = await confirmar({
      titulo: escopo === "somente_esta" ? "Excluir esta sessão?" : `Excluir ${qtd} sessão${qtd === 1 ? "" : "ões"}?`,
      texto: escopo === "somente_esta"
        ? `${a.paciente_nome} · ${rotuloDia(a.data)}, ${horaCurta(a.hora_inicio)}.\nA exclusão fica registrada com seu nome e o motivo.`
        : `De ${dataBR(a.data)} até ${dataBR(previa?.ultima ?? a.data)}. A série é encerrada e não gera mais sessões.\nA exclusão fica registrada com seu nome e o motivo.`,
      confirmar: "Excluir",
      t: "vermelho",
      Icone: Trash2,
    })
    if (!ok) return
    setSalvando(true)
    try {
      const r = await excluir(a.id, escopo, motivo.trim())
      avisoFeito(r.excluidas === 1 ? "Sessão excluída" : `${r.excluidas} sessões excluídas`)
      onMudou()
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  const terapia = a.terapia_exibicao_nome ?? a.terapia_nome
  const exibicaoDiferente = a.terapia_exibicao_nome && a.terapia_exibicao_nome !== a.terapia_nome

  return (
    <Drawer
      title={a.paciente_nome}
      subtitle={`${rotuloDia(a.data)} · ${horaCurta(a.hora_inicio)}–${horaCurta(a.hora_fim)}`}
      width={460}
      onClose={onFechar}
      footer={!passado && (
        escopo ? (
          <>
            <button type="button" onClick={() => { setEscopo(null); setMotivo("") }} className={`${tom("cinza")} pp-btn pp-btn-suave min-h-11`}>Voltar</button>
            <button type="button" onClick={confirmarExclusao} disabled={salvando || motivo.trim().length < 3 || (escopo === "desta_em_diante" && !previa)}
              className={`${tom("vermelho")} pp-btn min-h-11`}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              Excluir{escopo === "desta_em_diante" && previa ? ` ${previa.quantidade}` : ""}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEscopo("somente_esta")} className={`${tom("vermelho")} pp-btn pp-btn-suave min-h-11`}>
              <Trash2 className="h-4 w-4" aria-hidden /> Só esta
            </button>
            {temSerie && (
              <button type="button" onClick={() => setEscopo("desta_em_diante")} className={`${tom("vermelho")} pp-btn pp-btn-suave min-h-11`}>
                <Trash2 className="h-4 w-4" aria-hidden /> Desta em diante
              </button>
            )}
          </>
        )
      )}
    >
      <div className="pp space-y-4">
        {/* Cartão na cor da terapia */}
        <div style={estiloTons(cor)} className="ua-tons rounded-[18px] bg-[var(--t-50)] p-4 shadow-[inset_0_0_0_1px_var(--t-300)]">
          <p className="flex items-center gap-2 text-base font-extrabold text-[var(--t-700)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--t-500)]" aria-hidden />{terapia}
          </p>
          {exibicaoDiferente && <p className="mt-0.5 text-xs font-semibold text-[var(--t-700)]">Terapia clínica: {a.terapia_nome}</p>}
          <dl className="mt-3 space-y-1.5 text-sm">
            <Linha Icone={UserRound} rotulo="Profissional" valor={a.profissional_nome} />
            <Linha Icone={MapPin} rotulo="Sala" valor={[a.sala_nome, a.unidade_nome].filter(Boolean).join(" · ") || "—"} />
            <Linha Icone={CalendarClock} rotulo="Quando" valor={`${rotuloDia(a.data)}, ${horaCurta(a.hora_inicio)}–${horaCurta(a.hora_fim)}`} />
            {serie && <Linha Icone={Repeat} rotulo="Repetição" valor={descreverSerie(serie)} />}
            <Linha Icone={a.origem === "tita_importacao" ? CloudDownload : Stethoscope} rotulo="Origem"
              valor={a.origem === "tita_importacao" ? `Importada do TiTa${a.tita_agendamento_id ? ` (sessão ${a.tita_agendamento_id})` : ""}` : "Criada na Grade"} />
          </dl>
        </div>

        {(reposicao || foraDaGrade || foraDaJanela) && (
          <ul className="space-y-2">
            {reposicao && <Aviso t="vermelho" Icone={UserRoundX} texto="Profissional inativo — esta sessão precisa de reposição (outro profissional ou substituição)." />}
            {foraDaGrade && <Aviso t="amber" Icone={AlertTriangle} texto="Fora da disponibilidade cadastrada do profissional neste horário." />}
            {foraDaJanela && <Aviso t="amber" Icone={AlertTriangle} texto="Fora da disponibilidade que a família informou." />}
          </ul>
        )}

        {passado && (
          <p className="rounded-xl bg-[var(--pp-muted)] px-3 py-2 text-sm font-semibold text-[var(--pp-ink-muted)]">
            Sessão de data passada: não pode ser excluída.
          </p>
        )}

        {escopo && (
          <div className={`${tom("vermelho")} space-y-2 rounded-[18px] bg-[var(--c-suave)] p-4 shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
            <p className="text-sm font-extrabold text-[var(--c-tinta)]">
              {escopo === "somente_esta"
                ? `Excluir só a sessão de ${dataBR(a.data)}`
                : previa
                  ? `Excluir ${previa.quantidade} sessão${previa.quantidade === 1 ? "" : "ões"}: de ${dataBR(a.data)} até ${dataBR(previa.ultima)}`
                  : "Contando as sessões…"}
            </p>
            <label className="block text-xs font-bold text-[var(--pp-ink-muted)]" htmlFor="motivo-exclusao">Motivo (obrigatório)</label>
            <textarea id="motivo-exclusao" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} rows={3}
              placeholder="Ex.: família pediu para encerrar; remarcada para quinta"
              className={`${campo} w-full resize-y py-2`} autoFocus />
          </div>
        )}

        <section aria-labelledby="hist-sessao">
          <h3 id="hist-sessao" className="mb-2 flex items-center gap-2 text-sm font-extrabold"><History className="h-4 w-4" aria-hidden /> Histórico</h3>
          {eventos === null
            ? <p className="text-sm text-[var(--pp-ink-muted)]">Carregando…</p>
            : <ListaEventos eventos={eventos} vazio="Sem registro de alteração." />}
          <p className="mt-2 text-xs font-semibold text-[var(--pp-ink-muted)]">
            {a.criado_por_nome ? `Lançada por ${a.criado_por_nome}` : "Lançada"} em {dataBR(a.criado_em.slice(0, 10))}.
          </p>
        </section>
      </div>
      {dialogo}
    </Drawer>
  )
}

function Linha({ Icone, rotulo, valor }: { Icone: typeof UserRound; rotulo: string; valor: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icone className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-700)] opacity-70" aria-hidden />
      <dt className="sr-only">{rotulo}</dt>
      <dd className="min-w-0 font-semibold">{valor}</dd>
    </div>
  )
}

function Aviso({ t, Icone, texto }: { t: Parameters<typeof tom>[0]; Icone: typeof AlertTriangle; texto: string }) {
  return (
    <li className={`${tom(t)} flex items-start gap-2 rounded-xl bg-[var(--c-suave)] px-3 py-2 text-sm font-semibold text-[var(--c-tinta)]`}>
      <Icone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{texto}
    </li>
  )
}
