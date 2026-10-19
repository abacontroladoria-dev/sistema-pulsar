"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FilePenLine,
  Loader2,
  RotateCcw,
  Stamp,
  Stethoscope,
  UserCheck,
  UserRound,
  XCircle,
} from "lucide-react"
import toast from "react-hot-toast"
import { campo, foco } from "@/components/cadastros/pacientes/ui/campos"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { useUrlAssinada } from "@/hooks/useUrlAssinada"
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual"
import { dataBR, horaCurta } from "@/lib/disponibilidadeProfissional"
import {
  buscarDetalheEvolucao,
  limparEvolucao,
  meuAcessoEvolucao,
  registrarEvolucao,
  registrarFalta,
} from "@/services/grade.service"
import type { AcessoEvolucaoGrade, AgendamentoGrade, DetalheEvolucaoGrade, ProfissionalGrade } from "@/types/grade"
import { btnPrimario, btnSecundario, rotuloCampo } from "./estilo"

type ModoAcao = "escolha" | "evoluir" | "falta"

export function SecaoEvolucaoSessao({
  a,
  acesso,
  profissionais = [],
  onSalvo,
}: {
  a: AgendamentoGrade
  acesso: AcessoEvolucaoGrade
  profissionais?: ProfissionalGrade[]
  onSalvo: () => void
}) {
  const { realRole, effectiveRole, canImpersonate } = useImpersonation()
  const usuarioAtual = useUsuarioAtual()
  const { confirmar, dialogo } = useConfirmacao()
  const [acessoAtual, setAcessoAtual] = useState<AcessoEvolucaoGrade>(acesso)
  const [detalhe, setDetalhe] = useState<DetalheEvolucaoGrade | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [modo, setModo] = useState<ModoAcao>("escolha")
  const [descricao, setDescricao] = useState("")
  const [tipoFalta, setTipoFalta] = useState<"paciente" | "terapeuta">("paciente")
  const [salvando, setSalvando] = useState(false)
  // Em edição de uma evolução feita em substituição, mantém quem substituiu (senão o banco regrava como o agendado).
  const [substitutoId, setSubstitutoId] = useState<number | null>(null)

  useEffect(() => {
    setAcessoAtual(acesso)
  }, [acesso])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setEditando(false)
    setModo("escolha")
    setSubstitutoId(null)
    Promise.all([
      buscarDetalheEvolucao(a.id).catch(() => null),
      meuAcessoEvolucao().catch(() => acesso),
    ])
      .then(([d, ac]) => {
        if (!vivo) return
        setDetalhe(d)
        setAcessoAtual(ac)
        setDescricao(d?.descricao_evolucao ?? "")
        setTipoFalta(d?.tipo_falta === "terapeuta" ? "terapeuta" : "paciente")
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [a.id, acesso])

  const ehAdminEfetivo = Boolean(
    acessoAtual.eh_admin ||
    acesso.eh_admin ||
    realRole === "admin" ||
    effectiveRole === "admin" ||
    canImpersonate ||
    usuarioAtual.role === "admin" ||
    usuarioAtual.gruposLabel?.split(",").some(g => g.trim().toLowerCase() === "administrador"),
  )

  const podeEvoluirEfetivo = Boolean(
    acessoAtual.pode_evoluir ||
    acesso.pode_evoluir ||
    ehAdminEfetivo,
  )

  const nomeRealizadoPor =
    (acessoAtual.usuario_nome && acessoAtual.usuario_nome !== "Usuário do Pulsar"
      ? acessoAtual.usuario_nome
      : null) ||
    usuarioAtual.nomeCompleto ||
    (acesso.usuario_nome && acesso.usuario_nome !== "Usuário do Pulsar" ? acesso.usuario_nome : null) ||
    "Administrador"

  const urlCarimbo = useUrlAssinada(
    detalhe?.possui_tratativa && !editando ? detalhe.carimbo?.assinatura_path : null,
  )

  const terapiaExibida = a.terapia_nome

  const temRegistroAtivo = Boolean(
    detalhe && (detalhe.registrado || detalhe.possui_tratativa),
  )

  const salvarEvolucao = async () => {
    if (descricao.trim().length < 3) {
      toast.error("Preencha a descrição da evolução.")
      return
    }
    setSalvando(true)
    try {
      const novo = await registrarEvolucao(a.id, descricao.trim(), substitutoId)
      setDetalhe(novo)
      setEditando(false)
      setModo("escolha")
      toast.success("Evolução terapêutica registrada!")
      onSalvo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 7000 })
    } finally {
      setSalvando(false)
    }
  }

  const salvarFalta = async () => {
    setSalvando(true)
    try {
      const novo = await registrarFalta(a.id, tipoFalta)
      setDetalhe(novo)
      setEditando(false)
      setModo("escolha")
      toast.success(
        tipoFalta === "terapeuta" ? "Marcado como falta do profissional." : "Marcado como falta do paciente.",
      )
      onSalvo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 7000 })
    } finally {
      setSalvando(false)
    }
  }

  const reverterRegistro = async () => {
    const rotuloTipo = detalhe?.possui_tratativa ? "a evolução terapêutica" : "o registro de falta"
    const ok = await confirmar({
      titulo: "Remover lançamento da sessão?",
      texto: `Tem certeza de que deseja remover ${rotuloTipo} desta sessão?\nEla voltará ao status pendente.`,
      confirmar: "Sim, remover",
      cancelar: "Cancelar",
      t: "vermelho",
      Icone: AlertTriangle,
    })
    if (!ok) return

    setSalvando(true)
    try {
      const novo = await limparEvolucao(a.id)
      setDetalhe(novo)
      setDescricao("")
      setSubstitutoId(null)
      setEditando(false)
      setModo("escolha")
      toast.success("Registro removido da sessão.")
      onSalvo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 7000 })
    } finally {
      setSalvando(false)
    }
  }

  const abrirEdicaoAdmin = () => {
    setEditando(true)
    if (detalhe?.possui_tratativa) {
      setDescricao(detalhe.descricao_evolucao ?? "")
      const subId =
        detalhe.tratativa_profissional_id ??
        (detalhe.substituicao && detalhe.tratativa_profissional_nome
          ? profissionais.find(
              p => p.nome.trim().toLowerCase() === detalhe.tratativa_profissional_nome?.trim().toLowerCase(),
            )?.id ?? null
          : null)
      setSubstitutoId(subId)
      setModo("evoluir")
    } else if (detalhe?.status_execucao === "Cancelado") {
      setTipoFalta(detalhe.tipo_falta === "terapeuta" ? "terapeuta" : "paciente")
      setModo("falta")
    } else {
      setModo("escolha")
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>Carregando status da evolução…</span>
      </div>
    )
  }

  // ── 1. Visão já evoluída (e não está em modo de edição) ─────────────────────
  if (detalhe?.possui_tratativa && !editando) {
    const carimbo = detalhe.carimbo
    const conselho = [carimbo?.tipo_registro, carimbo?.uf_registro, carimbo?.codigo_registro]
      .filter(Boolean)
      .join(" ")

    return (
      <section className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
        {/* Alerta de Inconsistência exclusivo para o Admin */}
        {ehAdminEfetivo && detalhe.inconsistencia && (
          <div className="flex items-start gap-2.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2.5 text-xs text-violet-900 dark:text-violet-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
            <div>
              <p className="font-semibold">Inconsistência detectada</p>
              <p className="mt-0.5 opacity-90">
                A recepção marcou falta neste atendimento, porém a sessão foi marcada como evoluída.
              </p>
            </div>
          </div>
        )}

        {/* Alerta suave para profissional/não-admin sem o jargão de inconsistência */}
        {!ehAdminEfetivo && detalhe.falta_recepcao && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>A recepção registrou FALTA neste atendimento</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Evoluído
            </span>
            {detalhe.substituicao && (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                Substituição
              </span>
            )}
            {detalhe.origem === "tita_importacao" && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Sincronizado do TiTa
              </span>
            )}
          </div>

          {podeEvoluirEfetivo && (
            <button
              type="button"
              onClick={abrirEdicaoAdmin}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${foco}`}
            >
              <FilePenLine className="h-3.5 w-3.5" aria-hidden />
              Editar evolução / Alterar status
            </button>
          )}
        </div>

        {/* Dados de autoria e carimbo de tempo da tratativa */}
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/80 bg-card p-3 text-xs sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">
              {detalhe.substituicao ? "Profissional substituto" : "Realizado por"}
            </span>
            <p className="mt-0.5 font-semibold text-foreground">
              {detalhe.substituicao
                ? (carimbo?.profissional_nome ?? detalhe.tratativa_profissional_nome ?? "—")
                : (detalhe.tratativa_profissional_nome ?? detalhe.registrado_por_nome ?? "—")}
            </p>
            {detalhe.registrado_por_nome && detalhe.substituicao && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Lançado por {detalhe.registrado_por_nome}
              </p>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Data e hora da evolução</span>
            <p className="mt-0.5 font-semibold tabular-nums text-foreground">
              {detalhe.tratativa_criada_em_brasilia ?? "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Profissional agendado</span>
            <p className="mt-0.5 font-medium text-foreground">{a.profissional_nome}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Vínculo · Origem</span>
            <p className="mt-0.5 font-medium text-foreground">
              {detalhe.evolucao_vinculo ?? "Agendamento ativo"} · {detalhe.tratativa_origem ?? "Prontuário"}
            </p>
          </div>
        </div>

        {/* Texto da Descrição */}
        <div className="space-y-1">
          <span className="text-xs font-semibold text-foreground">Descrição da evolução</span>
          <div className="rounded-lg border border-border bg-card p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {detalhe.descricao_evolucao || (
              <span className="italic text-muted-foreground">
                {podeEvoluirEfetivo
                  ? "Evolução registrada sem texto descritivo detalhado."
                  : "O texto da evolução só pode ser lido por administradores."}
              </span>
            )}
          </div>
        </div>

        {/* Carimbo anexado em /cadastros/profissionais */}
        {carimbo && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/90 p-3 text-center">
            {urlCarimbo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urlCarimbo}
                alt={`Carimbo e assinatura de ${carimbo.profissional_nome ?? (detalhe.substituicao ? detalhe.tratativa_profissional_nome : a.profissional_nome)}`}
                className="max-h-24 w-auto object-contain"
              />
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Stamp className="h-4 w-4 shrink-0" aria-hidden />
                <span>Carimbo digital do profissional</span>
              </div>
            )}
            <p className="mt-1.5 text-xs font-semibold text-foreground">
              {carimbo.profissional_nome ?? (detalhe.substituicao ? detalhe.tratativa_profissional_nome : a.profissional_nome)}
            </p>
            {conselho && <p className="text-[11px] text-muted-foreground">{conselho}</p>}
          </div>
        )}
      </section>
    )
  }

  // ── 2. Visão já marcada como Falta no Pulsar (e não está em edição) ────────
  if (temRegistroAtivo && !detalhe?.possui_tratativa && !editando) {
    const rotuloFalta =
      detalhe?.tipo_falta === "terapeuta"
        ? "Falta do profissional"
        : "Falta do paciente"

    return (
      <section className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-500/5 p-4">
        {detalhe?.falta_recepcao && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>A recepção registrou FALTA neste atendimento</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            <XCircle className="h-3.5 w-3.5" aria-hidden />
            {rotuloFalta}
          </span>

          {podeEvoluirEfetivo && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditando(true)
                  setModo("evoluir")
                }}
                className={`inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 ${foco}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                Evoluir atendimento normalmente
              </button>
              <button
                type="button"
                onClick={abrirEdicaoAdmin}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${foco}`}
              >
                <FilePenLine className="h-3.5 w-3.5" aria-hidden />
                Editar status
              </button>
            </div>
          )}
        </div>

        {detalhe?.registrado && (
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/80 bg-card p-3 text-xs sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Registrado por</span>
              <p className="mt-0.5 font-semibold text-foreground">{detalhe.registrado_por_nome ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Data e hora do registro</span>
              <p className="mt-0.5 font-semibold tabular-nums text-foreground">
                {detalhe.atualizado_em_brasilia ?? "—"}
              </p>
            </div>
          </div>
        )}
      </section>
    )
  }

  // ── 3. Usuário sem permissão de evoluir (ex.: diretoria ou cronograma) ──────
  if (!podeEvoluirEfetivo) {
    return (
      <section className="rounded-xl border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <p>Apenas administradores podem registrar evolução terapêutica ou falta neste momento.</p>
      </section>
    )
  }

  // ── 4. Painel de Ação (Admin evoluindo, marcando falta ou editando) ─────────
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">Qual ação deseja fazer?</h3>
        {editando && (
          <button
            type="button"
            onClick={() => {
              setEditando(false)
              setModo("escolha")
            }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancelar edição
          </button>
        )}
      </div>

      {detalhe?.falta_recepcao && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div>
              <p className="font-semibold">A recepção registrou FALTA neste atendimento</p>
              <p className="mt-0.5 text-muted-foreground">
                Você pode registrar a evolução normalmente para confirmar que o atendimento foi realizado.
              </p>
            </div>
          </div>
          {modo !== "evoluir" && (
            <button
              type="button"
              onClick={() => setModo("evoluir")}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Evoluir agora
            </button>
          )}
        </div>
      )}

      {/* Botões principais: Vermelho (Marcar como falta) e Verde (Evoluir) */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => setModo("falta")}
          aria-pressed={modo === "falta"}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-all ${foco} ${
            modo === "falta"
              ? "border-rose-600 bg-rose-600 text-white shadow-xs"
              : "border-rose-300 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:border-rose-800 dark:text-rose-300"
          }`}
        >
          <XCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span>Marcar como falta</span>
        </button>

        <button
          type="button"
          onClick={() => setModo("evoluir")}
          aria-pressed={modo === "evoluir"}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-all ${foco} ${
            modo === "evoluir"
              ? "border-emerald-600 bg-emerald-600 text-white shadow-xs"
              : "border-emerald-300 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:border-emerald-800 dark:text-emerald-300"
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>Evoluir</span>
        </button>
      </div>

      {/* Formulário: Marcar como falta */}
      {modo === "falta" && (
        <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
          <p className="text-xs font-semibold text-foreground">Selecione o tipo de falta:</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setTipoFalta("paciente")}
              aria-pressed={tipoFalta === "paciente"}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors ${foco} ${
                tipoFalta === "paciente"
                  ? "border-rose-600 bg-rose-600/10 text-rose-800 dark:text-rose-200"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <UserRound className="h-4 w-4 shrink-0" aria-hidden />
              <span>Falta do paciente</span>
            </button>

            <button
              type="button"
              onClick={() => setTipoFalta("terapeuta")}
              aria-pressed={tipoFalta === "terapeuta"}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors ${foco} ${
                tipoFalta === "terapeuta"
                  ? "border-rose-600 bg-rose-600/10 text-rose-800 dark:text-rose-200"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <Stethoscope className="h-4 w-4 shrink-0" aria-hidden />
              <span>Falta do profissional</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setModo("escolha")}
              disabled={salvando}
              className={btnSecundario}
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={salvarFalta}
              disabled={salvando}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md bg-rose-600 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50 ${foco}`}
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
              Confirmar falta
            </button>
          </div>
        </div>
      )}

      {/* Formulário: Evoluir (dados organizados + Descrição obrigatória + Salvar, sem exibir carimbo agora) */}
      {modo === "evoluir" && (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-card p-2.5 text-xs sm:grid-cols-2">
            <div className="flex items-center gap-1.5">
              <Stethoscope className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">Terapia:</span>
              <span className="truncate font-semibold text-foreground">{terapiaExibida}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">Data:</span>
              <span className="font-semibold tabular-nums text-foreground">{dataBR(a.data)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">Hora:</span>
              <span className="font-semibold tabular-nums text-foreground">
                {horaCurta(a.hora_inicio)} às {horaCurta(a.hora_fim)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              <span className="text-muted-foreground">Realizado por:</span>
              <span className="truncate font-semibold text-foreground">{nomeRealizadoPor}</span>
            </div>
          </div>

          <div>
            <label htmlFor="descricao-evolucao-grade" className={rotuloCampo}>
              Descrição *
            </label>
            <textarea
              id="descricao-evolucao-grade"
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              rows={5}
              maxLength={20000}
              placeholder="Descreva a evolução terapêutica do atendimento…"
              className={`${campo} w-full resize-y py-2`}
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setModo("escolha")}
              disabled={salvando}
              className={btnSecundario}
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={salvarEvolucao}
              disabled={salvando || descricao.trim().length < 3}
              className={`${btnPrimario} bg-emerald-600 hover:bg-emerald-700`}
            >
              {salvando ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              )}
              Salvar
            </button>
          </div>
        </div>
      )}

      {/* Em modo de edição de um registro já existente, permite também limpar/reverter */}
      {editando && detalhe?.registrado && (
        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <span className="text-xs text-muted-foreground">Deseja remover o lançamento e voltar para pendente?</span>
          <button
            type="button"
            onClick={reverterRegistro}
            disabled={salvando}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Limpar registro
          </button>
        </div>
      )}

      {dialogo}
    </section>
  )
}
