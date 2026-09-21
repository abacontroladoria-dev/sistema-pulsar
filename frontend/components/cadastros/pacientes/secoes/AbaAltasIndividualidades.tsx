"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, AlertTriangle, ExternalLink, FileText, Loader2, Plus, Trash2, CalendarDays, RotateCcw, CalendarClock } from "lucide-react"
import toast from "react-hot-toast"
import {
  getAltasDoPaciente,
  criarAlta,
  excluirAlta,
  reativarAlta,
  uploadArquivoAlta,
  getUrlAssinadaAlta,
} from "@/services/pacienteAltaIndividualidade.service"
import {
  getSuspensoesDoPaciente,
  criarSuspensao,
  excluirSuspensao,
  reativarSuspensao,
  estenderPrazoSuspensao,
  uploadArquivoSuspensao,
  getUrlAssinadaSuspensao,
} from "@/services/pacienteSuspensaoTemporaria.service"
import {
  getAltasClinicasDoPaciente,
  altaClinicaVigente,
  criarAltaClinica,
  excluirAltaClinica,
  reativarAltaClinica,
  uploadArquivoAltaClinica,
  getUrlAssinadaAltaClinica,
} from "@/services/pacienteAltaClinica.service"
import { getCriadores } from "@/services/cadastrosAuditoria.service"
import { campo, rotulo, CampoSelect, CampoTextarea, CampoCheckbox } from "@/components/cadastros/pacientes/ui/campos"
import { ESP_CLINICO } from "@/lib/cronograma/constants"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import { DatePicker } from "@/components/ui/date-picker"
import { ORIGENS_JUDICIAIS } from "@/types/laudos"
import type {
  AltaIndividualidadeForm,
  NivelSuporte,
  OrigemJudicial,
  PacienteAlta,
  PacienteAltaClinica,
  PacienteAltaForm,
  PacienteSuspensaoTemporaria,
  PacienteSuspensaoTemporariaForm,
} from "@/types/laudos"

type Props = {
  pacienteId: number
  pacienteNome: string
  /**
   * "Informações adicionais" agora vive no formulário unificado de
   * PacienteDetalhe (usePacienteDetalhe), para entrar no mesmo
   * dirtyCount/"Salvar tudo" do resto do cadastro — dois botões de salvar na
   * mesma tela confundia sobre qual usar. Altas e Suspensões continuam
   * gravando direto (cada card tem seu próprio efeito imediato — criar,
   * excluir, reativar —, não faz sentido "descartar" isso no Cancelar).
   */
  individualidade: AltaIndividualidadeForm
  setIndividualidade: (patch: Partial<AltaIndividualidadeForm>) => void
  disabled: boolean
  /** Deep link (ex.: vindo de Ocupação de Paciente) — abre o detalhe desta suspensão ao carregar. */
  suspensaoIdInicial?: number
}

function dataBR(isoStr: string) {
  if (!isoStr) return ""
  const [y, m, d] = isoStr.split("-")
  if (!y || !m || !d) return isoStr
  return `${d}/${m}/${y}`
}

/** Linha única do card: sem o "monte de informação", o detalhe fica no modal. */
function resumoAlta(alta: PacienteAlta, criador: string | null | undefined): string {
  return `${dataBR(alta.data_alta)} · @${criador ?? "—"}`
}

function resumoSuspensao(sus: PacienteSuspensaoTemporaria): string {
  const prazo = sus.prazo_indefinido ? "Prazo indefinido" : `Prazo até ${dataBR(sus.prazo_fim ?? "")}`
  return `${dataBR(sus.data_suspensao)} - ${prazo} · @${sus.criado_por_usuario_nome ?? "—"}`
}

/**
 * Não excluído acima de excluído; dentro de cada grupo, data mais recente
 * primeiro. String ISO "YYYY-MM-DD" ordena igual a data real.
 */
function ordenarPorAtivoEData<T extends { ativo: boolean }>(itens: T[], data: (item: T) => string): T[] {
  return [...itens].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1
    return data(b).localeCompare(data(a))
  })
}

/**
 * Vigente = ativa (não excluída) E dentro do prazo (indefinido ou
 * prazo_fim ainda não passou). Comparação por string ISO "YYYY-MM-DD": tanto
 * `prazo_fim` quanto "hoje" nesse formato ordenam igual a datas reais.
 */
function vigente(sus: PacienteSuspensaoTemporaria): boolean {
  if (!sus.ativo) return false
  if (sus.prazo_indefinido) return true
  const hoje = new Date().toISOString().slice(0, 10)
  return (sus.prazo_fim ?? "") >= hoje
}

/** Prazo passou, mas a linha continua ativa — precisa de uma decisão do usuário. */
function prazoAlcancado(sus: PacienteSuspensaoTemporaria): boolean {
  return sus.ativo && !vigente(sus)
}


export function AbaAltasIndividualidades({
  pacienteId,
  pacienteNome,
  individualidade,
  setIndividualidade,
  disabled,
  suspensaoIdInicial,
}: Props) {
  const [altas, setAltas] = useState<PacienteAlta[]>([])
  const [suspensoes, setSuspensoes] = useState<PacienteSuspensaoTemporaria[]>([])
  const [altasClinicas, setAltasClinicas] = useState<PacienteAltaClinica[]>([])

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState<number | null>(null)
  const [excluindoSuspensao, setExcluindoSuspensao] = useState<number | null>(null)
  const [reativando, setReativando] = useState<number | null>(null)
  const [reativandoSuspensao, setReativandoSuspensao] = useState<number | null>(null)
  const [estendendoPrazo, setEstendendoPrazo] = useState<number | null>(null)
  const [excluindoAltaClinica, setExcluindoAltaClinica] = useState<number | null>(null)
  const [reativandoAltaClinica, setReativandoAltaClinica] = useState<number | null>(null)
  const [abrindoLinkAltaClinica, setAbrindoLinkAltaClinica] = useState(false)

  const [modalAberto, setModalAberto] = useState(false)
  const [modalSuspensaoAberto, setModalSuspensaoAberto] = useState(false)
  const [modalAltaClinicaAberto, setModalAltaClinicaAberto] = useState(false)
  const [detalheAlta, setDetalheAlta] = useState<PacienteAlta | null>(null)
  const [detalheSuspensao, setDetalheSuspensao] = useState<PacienteSuspensaoTemporaria | null>(null)
  const [abrindoLink, setAbrindoLink] = useState<number | null>(null)
  const [abrindoLinkSuspensao, setAbrindoLinkSuspensao] = useState<number | null>(null)
  const [verTodasAltas, setVerTodasAltas] = useState(false)

  /**
   * `id_alta` -> quem criou e quando, via trilha de auditoria (alta não tem
   * coluna própria de responsável). Suspensão já traz isso na própria linha
   * — ver `criado_por_usuario_nome` (20260902110000).
   */
  const [criadorAltas, setCriadorAltas] = useState<Record<string, { usuarioNome: string | null; criadoEm: string | null }>>({})

  const LIMITE_ALTAS_VISIVEIS = 3
  const altasVisiveis = verTodasAltas ? altas : altas.slice(0, LIMITE_ALTAS_VISIVEIS)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [resAltas, resSuspensoes, resAltasClinicas] = await Promise.all([
      getAltasDoPaciente(pacienteId),
      getSuspensoesDoPaciente(pacienteId),
      getAltasClinicasDoPaciente(pacienteId),
    ])

    setAltas(ordenarPorAtivoEData(resAltas.data, (a) => a.data_alta))
    setSuspensoes(ordenarPorAtivoEData(resSuspensoes.data, (s) => s.data_suspensao))
    setAltasClinicas(resAltasClinicas.data)
    setErro(resAltas.error || resSuspensoes.error || resAltasClinicas.error)
    setCarregando(false)

    // Quem criou cada card — separado do carregamento principal para não
    // atrasar a primeira renderização por causa de uma info secundária.
    if (resAltas.data.length > 0) {
      void getCriadores("alta", resAltas.data.map(a => a.id_alta)).then(setCriadorAltas)
    }
  }, [pacienteId])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Abre o detalhe da suspensão que veio por deep link (ex.: "ver na ficha do
  // paciente" em Ocupação de Paciente) assim que a lista carregar — só uma
  // vez, senão reabriria a cada `carregar()` disparado por uma ação do
  // próprio usuário (ex.: depois de estender o prazo).
  const abriuDeepLinkRef = useRef(false)
  useEffect(() => {
    if (abriuDeepLinkRef.current || !suspensaoIdInicial || suspensoes.length === 0) return
    const alvo = suspensoes.find(s => s.id_suspensao === suspensaoIdInicial)
    if (alvo) {
      setDetalheSuspensao(alvo)
      abriuDeepLinkRef.current = true
    }
  }, [suspensaoIdInicial, suspensoes])

  /** Devolve se a exclusão realmente aconteceu — o modal de detalhe só fecha nesse caso. */
  async function confirmarExclusao(alta: PacienteAlta): Promise<boolean> {
    if (!window.confirm("Excluir esta alta? Ela sai da lista, mas o registro é preservado e a ação fica no histórico.")) {
      return false
    }
    setExcluindo(alta.id_alta)
    const { error } = await excluirAlta(pacienteId, pacienteNome, alta)
    setExcluindo(null)
    if (error) {
      toast.error(`Erro ao excluir: ${error}`)
      return false
    }
    toast.success("Alta excluída. O registro ficou no histórico.")
    void carregar()
    return true
  }

  async function reativar(alta: PacienteAlta): Promise<boolean> {
    setReativando(alta.id_alta)
    const { error } = await reativarAlta(pacienteId, pacienteNome, alta)
    setReativando(null)
    if (error) {
      toast.error(`Erro ao reativar: ${error}`)
      return false
    }
    toast.success("Alta reativada.")
    void carregar()
    return true
  }

  async function abrirArquivo(alta: PacienteAlta) {
    if (!alta.arquivo_alta_path) return
    setAbrindoLink(alta.id_alta)
    const url = await getUrlAssinadaAlta(alta.arquivo_alta_path)
    setAbrindoLink(null)
    if (url) {
      window.open(url, "_blank")
    } else {
      toast.error("Não foi possível acessar o arquivo.")
    }
  }

  async function confirmarExclusaoSuspensao(suspensao: PacienteSuspensaoTemporaria): Promise<boolean> {
    if (!window.confirm("Excluir esta suspensão temporária? Ela sai da lista, mas o registro é preservado e a ação fica no histórico.")) {
      return false
    }
    setExcluindoSuspensao(suspensao.id_suspensao)
    const { error } = await excluirSuspensao(pacienteId, pacienteNome, suspensao)
    setExcluindoSuspensao(null)
    if (error) {
      toast.error(`Erro ao excluir: ${error}`)
      return false
    }
    toast.success("Suspensão excluída. O registro ficou no histórico.")
    void carregar()
    return true
  }

  async function reativarSus(suspensao: PacienteSuspensaoTemporaria): Promise<boolean> {
    setReativandoSuspensao(suspensao.id_suspensao)
    const { error } = await reativarSuspensao(pacienteId, pacienteNome, suspensao)
    setReativandoSuspensao(null)
    if (error) {
      toast.error(`Erro ao reativar: ${error}`)
      return false
    }
    toast.success("Suspensão reativada.")
    void carregar()
    return true
  }

  async function estenderPrazo(
    suspensao: PacienteSuspensaoTemporaria,
    indefinido: boolean,
    novoPrazoFim: string | null
  ): Promise<boolean> {
    setEstendendoPrazo(suspensao.id_suspensao)
    const { error } = await estenderPrazoSuspensao(pacienteId, pacienteNome, suspensao, indefinido, novoPrazoFim)
    setEstendendoPrazo(null)
    if (error) {
      toast.error(`Erro ao estender prazo: ${error}`)
      return false
    }
    toast.success("Prazo estendido.")
    void carregar()
    return true
  }

  async function confirmarAltaClinica(dataAltaClinica: string, arquivoPath: string | null): Promise<boolean> {
    const { error } = await criarAltaClinica(pacienteId, pacienteNome, {
      data_alta_clinica: dataAltaClinica,
      arquivo_alta_clinica_path: arquivoPath,
    })
    if (error) {
      toast.error(`Não foi possível registrar: ${error}`)
      return false
    }
    toast.success("Alta clínica registrada. Todas as terapias foram encerradas.")
    void carregar()
    return true
  }

  async function confirmarReversaoAltaClinica(altaClinica: PacienteAltaClinica): Promise<boolean> {
    if (!window.confirm("Reverter a alta clínica? O paciente volta a constar como ativo.")) {
      return false
    }
    setExcluindoAltaClinica(altaClinica.id_alta_clinica)
    const { error } = await excluirAltaClinica(pacienteId, pacienteNome, altaClinica)
    setExcluindoAltaClinica(null)
    if (error) {
      toast.error(`Erro ao reverter: ${error}`)
      return false
    }
    toast.success("Alta clínica revertida.")
    void carregar()
    return true
  }

  async function reativarAltaClinicaExcluida(altaClinica: PacienteAltaClinica): Promise<boolean> {
    setReativandoAltaClinica(altaClinica.id_alta_clinica)
    const { error } = await reativarAltaClinica(pacienteId, pacienteNome, altaClinica)
    setReativandoAltaClinica(null)
    if (error) {
      toast.error(`Erro ao reativar: ${error}`)
      return false
    }
    toast.success("Alta clínica reativada.")
    void carregar()
    return true
  }

  async function abrirArquivoAltaClinica(altaClinica: PacienteAltaClinica) {
    if (!altaClinica.arquivo_alta_clinica_path) return
    setAbrindoLinkAltaClinica(true)
    const url = await getUrlAssinadaAltaClinica(altaClinica.arquivo_alta_clinica_path)
    setAbrindoLinkAltaClinica(false)
    if (url) {
      window.open(url, "_blank")
    } else {
      toast.error("Não foi possível acessar o arquivo.")
    }
  }

  async function abrirArquivoSuspensao(suspensao: PacienteSuspensaoTemporaria) {
    if (!suspensao.arquivo_suspensao_path) return
    setAbrindoLinkSuspensao(suspensao.id_suspensao)
    const url = await getUrlAssinadaSuspensao(suspensao.arquivo_suspensao_path)
    setAbrindoLinkSuspensao(null)
    if (url) {
      window.open(url, "_blank")
    } else {
      toast.error("Não foi possível acessar o arquivo.")
    }
  }

  if (carregando) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    )
  }

  if (erro) {
    return (
      <div className="min-w-0 flex-1">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Não foi possível carregar os dados. {erro}</span>
        </div>
      </div>
    )
  }

  const vigenteAltaClinica = altaClinicaVigente(altasClinicas)
  // Lista já vem ordenada por criado_em desc — a primeira inativa é a mais recente.
  const ultimaAltaClinicaRevertida = altasClinicas.find((a) => !a.ativo) ?? null

  return (
    <div className="min-w-0 flex-1 space-y-6">
      {/* ── Informações adicionais ── */}
      {/* Sem botão de salvar próprio: entra no "Salvar tudo" do topo da
          página (usePacienteDetalhe), junto com Cadastro e Ficha médica. */}
      <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-foreground">
          Informações adicionais
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoSimNao
            label="Comportamento agressivo?"
            value={individualidade.comp_agressivo}
            onChange={(v) => setIndividualidade({ comp_agressivo: v })}
            disabled={disabled}
          />
          <CampoSimNao
            label="Paciente verbal?"
            value={individualidade.paciente_verbal}
            onChange={(v) => setIndividualidade({ paciente_verbal: v })}
            disabled={disabled}
          />
          <CampoSimNao
            label="Autorização de ambiente natural?"
            value={individualidade.ambiente_natural}
            onChange={(v) => setIndividualidade({ ambiente_natural: v })}
            disabled={disabled}
          />
          <CampoSelect<NivelSuporte>
            label="Nível de suporte clínico"
            value={individualidade.nivel_suporte}
            onChange={(v) => setIndividualidade({ nivel_suporte: v })}
            disabled={disabled}
            opcoes={[
              { valor: "1", rotulo: "1" },
              { valor: "2", rotulo: "2" },
              { valor: "3", rotulo: "3" },
              { valor: "NA", rotulo: "NA" },
            ]}
          />
          {/* Sem opção "Não informado" na lista: ela É o vazio (null). Ter as
              duas coisas daria dois jeitos de gravar a mesma ausência. */}
          <CampoSelect<OrigemJudicial>
            label="Origem judicial"
            value={individualidade.origem_judicial}
            onChange={(v) => setIndividualidade({ origem_judicial: v })}
            disabled={disabled}
            vazio="Não informado"
            opcoes={ORIGENS_JUDICIAIS.map((o) => ({ valor: o, rotulo: o }))}
          />
        </div>
      </section>

      {/* ── Altas e Suspensões, lado a lado ── */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">

      {/* ── Lista de Altas ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Altas Registradas</h2>
          <button
            type="button"
            onClick={() => setModalAberto(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>

        {altas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma alta registrada.</p>
          </div>
        ) : (
          <>
          <ul className="grid grid-cols-1 gap-4">
            {altasVisiveis.map((alta) => (
              <li
                key={alta.id_alta}
                className={`flex h-full min-h-[92px] flex-col rounded-lg border border-border bg-card px-4 py-3 shadow-sm ${
                  alta.ativo ? "" : "opacity-60"
                }`}
              >
                <div
                  className="flex flex-1 flex-wrap items-start justify-between gap-2 cursor-pointer"
                  onClick={() => setDetalheAlta(alta)}
                >
                  <div className="flex items-center gap-3">
                    <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold uppercase tracking-wide text-foreground">
                          {alta.especialidade_alta}
                        </p>
                        {!alta.ativo && (
                          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
                            Excluída
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Alta
                      </p>
                      <p className="mt-1 text-sm text-foreground">
                        {resumoAlta(alta, criadorAltas[alta.id_alta]?.usuarioNome)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {alta.arquivo_alta_path && (
                    <button
                      type="button"
                      onClick={() => void abrirArquivo(alta)}
                      disabled={abrindoLink === alta.id_alta}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      title="Ver arquivo da alta"
                    >
                      {abrindoLink === alta.id_alta ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  {/* Excluída: só reativar. Ativa: só excluir. Uma alta nunca
                      mostra as duas ações ao mesmo tempo. */}
                  {alta.ativo ? (
                    <button
                      type="button"
                      onClick={() => void confirmarExclusao(alta)}
                      disabled={excluindo === alta.id_alta}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Excluir alta"
                    >
                      {excluindo === alta.id_alta ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void reativar(alta)}
                      disabled={reativando === alta.id_alta}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Reativar alta"
                    >
                      {reativando === alta.id_alta ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              </li>
            ))}
          </ul>
          {altas.length > LIMITE_ALTAS_VISIVEIS && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setVerTodasAltas((v) => !v)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {verTodasAltas ? "Ver menos" : `Ver mais (${altas.length - LIMITE_ALTAS_VISIVEIS})`}
              </button>
            </div>
          )}
          </>
        )}
      </section>

      {/* ── Lista de Suspensões Temporárias ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Suspensões Temporárias de Especialidades</h2>
          <button
            type="button"
            onClick={() => setModalSuspensaoAberto(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>

        {suspensoes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma suspensão temporária registrada.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4">
            {suspensoes.map((sus) => (
              <li
                key={sus.id_suspensao}
                className={`flex h-full min-h-[92px] flex-col rounded-lg border border-border bg-card px-4 py-3 shadow-sm ${
                  !sus.ativo || prazoAlcancado(sus) ? "opacity-60" : ""
                }`}
              >
                <div
                  className="flex flex-1 flex-wrap items-start justify-between gap-2 cursor-pointer"
                  onClick={() => setDetalheSuspensao(sus)}
                >
                  <div className="flex items-center gap-3">
                    <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold uppercase tracking-wide text-foreground">
                          {sus.especialidade_suspensao}
                        </p>
                        {!sus.ativo ? (
                          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
                            Excluída
                          </span>
                        ) : prazoAlcancado(sus) ? (
                          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                            Prazo alcançado
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Suspensão Temporária
                      </p>
                      <p className="mt-1 text-sm text-foreground">
                        {resumoSuspensao(sus)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {sus.arquivo_suspensao_path && (
                    <button
                      type="button"
                      onClick={() => void abrirArquivoSuspensao(sus)}
                      disabled={abrindoLinkSuspensao === sus.id_suspensao}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      title="Ver arquivo da suspensão"
                    >
                      {abrindoLinkSuspensao === sus.id_suspensao ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  {/* Excluída: só reativar. Ativa: só excluir. */}
                  {sus.ativo ? (
                    <button
                      type="button"
                      onClick={() => void confirmarExclusaoSuspensao(sus)}
                      disabled={excluindoSuspensao === sus.id_suspensao}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Excluir suspensão"
                    >
                      {excluindoSuspensao === sus.id_suspensao ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void reativarSus(sus)}
                      disabled={reativandoSuspensao === sus.id_suspensao}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Reativar suspensão"
                    >
                      {reativandoSuspensao === sus.id_suspensao ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      </div>

      {/* ── Alta Clínica: fora do grid, tratamento visual distinto — não é
          "mais um registro por especialidade", é o encerramento geral do
          paciente. ── */}
      <section
        className={`rounded-lg border px-4 py-4 shadow-sm ${
          vigenteAltaClinica
            ? "border-destructive/40 bg-destructive/5"
            : "border-border bg-card"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`h-5 w-5 shrink-0 mt-0.5 ${
                vigenteAltaClinica ? "text-destructive" : "text-muted-foreground"
              }`}
            />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Alta Clínica / Alta de todas as Terapias
              </h2>
              {vigenteAltaClinica ? (
                <p className="mt-1 text-sm text-foreground">
                  Encerrada em {dataBR(vigenteAltaClinica.data_alta_clinica)} · @
                  {vigenteAltaClinica.criado_por_usuario_nome ?? "—"}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Paciente ativo. Nenhuma alta clínica registrada.
                </p>
              )}
            </div>
          </div>

          {vigenteAltaClinica ? (
            <div className="flex items-center gap-2">
              {vigenteAltaClinica.arquivo_alta_clinica_path && (
                <button
                  type="button"
                  onClick={() => void abrirArquivoAltaClinica(vigenteAltaClinica)}
                  disabled={abrindoLinkAltaClinica}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Ver anexo da alta clínica"
                >
                  {abrindoLinkAltaClinica ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => void confirmarReversaoAltaClinica(vigenteAltaClinica)}
                disabled={excluindoAltaClinica === vigenteAltaClinica.id_alta_clinica}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {excluindoAltaClinica === vigenteAltaClinica.id_alta_clinica ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Reverter alta clínica
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setModalAltaClinicaAberto(true)}
              // text-destructive-foreground depende de --destructive-foreground
              // (globals.css) resolver certo em toda combinação de navegador/
              // build — texto direto elimina essa dependência: branco no claro,
              // quase-preto no escuro (onde o vermelho de fundo é mais claro).
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-white hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-neutral-900"
            >
              <AlertTriangle className="h-4 w-4" />
              Registrar alta clínica
            </button>
          )}
        </div>

        {/* Sem vigente, mas existe alguma revertida: oferece desfazer a
            última reversão em vez de abrir o modal e registrar de novo. */}
        {!vigenteAltaClinica && ultimaAltaClinicaRevertida && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              Última alta clínica revertida em {dataBR(ultimaAltaClinicaRevertida.data_alta_clinica)}.
            </p>
            <button
              type="button"
              onClick={() => void reativarAltaClinicaExcluida(ultimaAltaClinicaRevertida)}
              disabled={reativandoAltaClinica === ultimaAltaClinicaRevertida.id_alta_clinica}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {reativandoAltaClinica === ultimaAltaClinicaRevertida.id_alta_clinica ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Reativar
            </button>
          </div>
        )}
      </section>

      {modalAltaClinicaAberto && (
        <AltaClinicaConfirmModal
          pacienteId={pacienteId}
          onClose={() => setModalAltaClinicaAberto(false)}
          onConfirmar={async (data, arquivoPath) => {
            const ok = await confirmarAltaClinica(data, arquivoPath)
            if (ok) setModalAltaClinicaAberto(false)
          }}
        />
      )}

      {modalAberto && (
        <AltaFormModal
          pacienteId={pacienteId}
          pacienteNome={pacienteNome}
          // Só a especialidade de alta ATIVA bloqueia repetição — uma alta
          // excluída não deve impedir registrar outra na mesma especialidade.
          altasUsadas={altas.filter(a => a.ativo).map(a => a.especialidade_alta)}
          onClose={() => setModalAberto(false)}
          onSalvo={() => {
            setModalAberto(false)
            void carregar()
          }}
        />
      )}

      {modalSuspensaoAberto && (
        <SuspensaoFormModal
          pacienteId={pacienteId}
          pacienteNome={pacienteNome}
          // Só a especialidade com suspensão ATIVA E VIGENTE bloqueia
          // repetição — uma suspensão excluída, ou já vencida por prazo, não
          // deve impedir registrar outra na mesma especialidade.
          especialidadesSuspensas={suspensoes.filter(vigente).map(s => s.especialidade_suspensao)}
          onClose={() => setModalSuspensaoAberto(false)}
          onSalvo={() => {
            setModalSuspensaoAberto(false)
            void carregar()
          }}
        />
      )}

      {detalheAlta && (
        <DetalheCardModal
          titulo={detalheAlta.especialidade_alta}
          tipo="Alta"
          ativo={detalheAlta.ativo}
          linhas={[
            { label: "Data da alta", valor: dataBR(detalheAlta.data_alta) },
            {
              label: "Criado por",
              valor: criadorAltas[detalheAlta.id_alta]?.usuarioNome
                ? `${criadorAltas[detalheAlta.id_alta].usuarioNome}${criadorAltas[detalheAlta.id_alta].criadoEm ? ` em ${criadorAltas[detalheAlta.id_alta].criadoEm}` : ""}`
                : "—",
            },
          ]}
          temArquivo={!!detalheAlta.arquivo_alta_path}
          abrindoArquivo={abrindoLink === detalheAlta.id_alta}
          onAbrirArquivo={() => void abrirArquivo(detalheAlta)}
          excluindo={excluindo === detalheAlta.id_alta}
          onExcluir={() => void confirmarExclusao(detalheAlta).then((ok) => ok && setDetalheAlta(null))}
          reativando={reativando === detalheAlta.id_alta}
          onReativar={() => void reativar(detalheAlta).then((ok) => ok && setDetalheAlta(null))}
          onClose={() => setDetalheAlta(null)}
        />
      )}

      {detalheSuspensao && (
        <DetalheCardModal
          titulo={detalheSuspensao.especialidade_suspensao}
          tipo="Suspensão Temporária"
          ativo={detalheSuspensao.ativo}
          prazoAlcancado={prazoAlcancado(detalheSuspensao)}
          linhas={[
            { label: "Data da suspensão", valor: dataBR(detalheSuspensao.data_suspensao) },
            {
              label: "Prazo para fim da suspensão",
              valor: detalheSuspensao.prazo_indefinido
                ? "Indefinido"
                : dataBR(detalheSuspensao.prazo_fim ?? ""),
            },
            ...(detalheSuspensao.observacoes
              ? [{ label: "Observações", valor: detalheSuspensao.observacoes }]
              : []),
            {
              label: "Criado por",
              valor: detalheSuspensao.criado_por_usuario_nome
                ? `${detalheSuspensao.criado_por_usuario_nome} em ${new Date(detalheSuspensao.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                : "—",
            },
          ]}
          temArquivo={!!detalheSuspensao.arquivo_suspensao_path}
          abrindoArquivo={abrindoLinkSuspensao === detalheSuspensao.id_suspensao}
          onAbrirArquivo={() => void abrirArquivoSuspensao(detalheSuspensao)}
          excluindo={excluindoSuspensao === detalheSuspensao.id_suspensao}
          onExcluir={() => void confirmarExclusaoSuspensao(detalheSuspensao).then((ok) => ok && setDetalheSuspensao(null))}
          reativando={reativandoSuspensao === detalheSuspensao.id_suspensao}
          onReativar={() => void reativarSus(detalheSuspensao).then((ok) => ok && setDetalheSuspensao(null))}
          estendendoPrazo={estendendoPrazo === detalheSuspensao.id_suspensao}
          onEstenderPrazo={(indefinido, novoPrazoFim) => estenderPrazo(detalheSuspensao, indefinido, novoPrazoFim)}
          onClose={() => setDetalheSuspensao(null)}
        />
      )}
    </div>
  )
}

// ─── MODAL NOVA ALTA ─────────────────────────────────────────────────────────

function AltaFormModal({
  pacienteId,
  pacienteNome,
  altasUsadas,
  onClose,
  onSalvo
}: {
  pacienteId: number
  pacienteNome: string
  altasUsadas: string[]
  onClose: () => void
  onSalvo: () => void
}) {
  const [form, setForm] = useState<PacienteAltaForm>({
    data_alta: new Date().toISOString().slice(0, 10),
    especialidade_alta: "",
    arquivo_alta_path: null
  })
  const [salvando, setSalvando] = useState(false)
  const [uploadando, setUploadando] = useState(false)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof PacienteAltaForm>(k: K, v: PacienteAltaForm[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setErroArquivo(null)
    setUploadando(true)
    const { path, error } = await uploadArquivoAlta(pacienteId, file)
    setUploadando(false)
    if (error || !path) {
      setErroArquivo(error ?? "Erro ao fazer upload.")
      return
    }
    set("arquivo_alta_path", path)
  }

  async function salvar() {
    if (!form.data_alta || !form.especialidade_alta) {
      toast.error("Preencha a data e a especialidade.")
      return
    }
    setSalvando(true)
    const { error } = await criarAlta(pacienteId, pacienteNome, form)
    setSalvando(false)

    if (error) {
      toast.error(`Não foi possível salvar: ${error}`)
      return
    }
    toast.success("Alta cadastrada com sucesso!")
    onSalvo()
  }

  return (
    <ScheduleModal onClose={onClose} title="Nova Alta">
      <div className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={rotulo}>Data da alta *</label>
            <DatePicker
              value={form.data_alta}
              onChange={(v) => set("data_alta", v)}
            />
          </div>
          <div>
            <label className={rotulo}>Especialidade da alta *</label>
            <div className="mt-1">
              <SearchCombobox
                value={form.especialidade_alta}
                onChange={(v) => set("especialidade_alta", v)}
                opcoes={Object.keys(ESP_CLINICO).filter(x => !altasUsadas.includes(x))}
                placeholder="Selecione..."
                ariaLabel="Especialidade da alta"
              />
            </div>
          </div>
        </div>

        <div>
          <label className={rotulo}>Anexo da alta (PDF ou imagem)</label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadando}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {uploadando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {form.arquivo_alta_path ? "Substituir arquivo selecionado" : "Selecionar arquivo"}
            </button>
            {form.arquivo_alta_path && (
              <span className="text-xs font-medium text-emerald-600">Arquivo anexado</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {erroArquivo && <p className="mt-1 text-xs text-destructive">{erroArquivo}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || uploadando}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar alta
          </button>
        </div>
      </div>
    </ScheduleModal>
  )
}

// ─── MODAL NOVA SUSPENSÃO TEMPORÁRIA ────────────────────────────────────────

function SuspensaoFormModal({
  pacienteId,
  pacienteNome,
  especialidadesSuspensas,
  onClose,
  onSalvo
}: {
  pacienteId: number
  pacienteNome: string
  especialidadesSuspensas: string[]
  onClose: () => void
  onSalvo: () => void
}) {
  const [form, setForm] = useState<PacienteSuspensaoTemporariaForm>({
    data_suspensao: new Date().toISOString().slice(0, 10),
    especialidade_suspensao: "",
    prazo_indefinido: false,
    prazo_fim: "",
    arquivo_suspensao_path: null,
    observacoes: "",
  })
  const [salvando, setSalvando] = useState(false)
  const [uploadando, setUploadando] = useState(false)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof PacienteSuspensaoTemporariaForm>(
    k: K,
    v: PacienteSuspensaoTemporariaForm[K]
  ) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setErroArquivo(null)
    setUploadando(true)
    const { path, error } = await uploadArquivoSuspensao(pacienteId, file)
    setUploadando(false)
    if (error || !path) {
      setErroArquivo(error ?? "Erro ao fazer upload.")
      return
    }
    set("arquivo_suspensao_path", path)
  }

  async function salvar() {
    if (!form.data_suspensao || !form.especialidade_suspensao) {
      toast.error("Preencha a data e a especialidade.")
      return
    }
    if (!form.prazo_indefinido && !form.prazo_fim) {
      toast.error("Informe o prazo para fim da suspensão, ou marque prazo indefinido.")
      return
    }
    setSalvando(true)
    const { error } = await criarSuspensao(pacienteId, pacienteNome, {
      ...form,
      prazo_fim: form.prazo_indefinido ? null : form.prazo_fim,
      observacoes: form.observacoes || null,
    })
    setSalvando(false)

    if (error) {
      toast.error(`Não foi possível salvar: ${error}`)
      return
    }
    toast.success("Suspensão temporária cadastrada com sucesso!")
    onSalvo()
  }

  return (
    <ScheduleModal onClose={onClose} title="Nova Suspensão Temporária">
      <div className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={rotulo}>Data da suspensão *</label>
            <DatePicker
              value={form.data_suspensao}
              onChange={(v) => set("data_suspensao", v)}
            />
          </div>
          <div>
            <label className={rotulo}>Especialidade da suspensão *</label>
            <div className="mt-1">
              <SearchCombobox
                value={form.especialidade_suspensao}
                onChange={(v) => set("especialidade_suspensao", v)}
                opcoes={Object.keys(ESP_CLINICO).filter(x => !especialidadesSuspensas.includes(x))}
                placeholder="Selecione..."
                ariaLabel="Especialidade da suspensão"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={rotulo}>Prazo para fim da suspensão *</label>
            <div className="mt-1">
              <DatePicker
                value={form.prazo_fim ?? ""}
                onChange={(v) => set("prazo_fim", v)}
                disabled={form.prazo_indefinido}
              />
            </div>
          </div>
          <div className="flex items-end pb-1.5">
            <CampoCheckbox
              label="Suspensão com prazo indefinido"
              checked={form.prazo_indefinido}
              onChange={(v) => set("prazo_indefinido", v)}
              disabled={salvando}
            />
          </div>
        </div>

        <CampoTextarea
          label="Observações"
          value={form.observacoes ?? ""}
          onChange={(v) => set("observacoes", v)}
          disabled={salvando}
          placeholder="Opcional"
        />

        <div>
          <label className={rotulo}>Anexo da suspensão (PDF ou imagem)</label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadando}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {uploadando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {form.arquivo_suspensao_path ? "Substituir arquivo selecionado" : "Selecionar arquivo"}
            </button>
            {form.arquivo_suspensao_path && (
              <span className="text-xs font-medium text-emerald-600">Arquivo anexado</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {erroArquivo && <p className="mt-1 text-xs text-destructive">{erroArquivo}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || uploadando}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar suspensão
          </button>
        </div>
      </div>
    </ScheduleModal>
  )
}

// ─── MODAL CONFIRMAÇÃO ALTA CLÍNICA ─────────────────────────────────────────

/**
 * Checkbox + confirmação, não um formulário: alta clínica não tem
 * especialidade nem anexo, só a data e a certeza de que é o encerramento
 * geral, não de uma terapia específica.
 */
function AltaClinicaConfirmModal({
  pacienteId,
  onClose,
  onConfirmar,
}: {
  pacienteId: number
  onClose: () => void
  onConfirmar: (dataAltaClinica: string, arquivoPath: string | null) => Promise<void>
}) {
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [confirmado, setConfirmado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [arquivoPath, setArquivoPath] = useState<string | null>(null)
  const [uploadando, setUploadando] = useState(false)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setErroArquivo(null)
    setUploadando(true)
    const { path, error } = await uploadArquivoAltaClinica(pacienteId, file)
    setUploadando(false)
    if (error || !path) {
      setErroArquivo(error ?? "Erro ao fazer upload.")
      return
    }
    setArquivoPath(path)
  }

  async function confirmar() {
    setSalvando(true)
    await onConfirmar(data, arquivoPath)
    setSalvando(false)
  }

  return (
    <ScheduleModal onClose={onClose} title="Registrar Alta Clínica">
      <div className="space-y-5 p-6">
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Isto encerra TODAS as terapias do paciente, não apenas uma especialidade. Use
            &quot;Adicionar&quot; em Altas Registradas para alta de uma única especialidade.
          </span>
        </div>

        <div>
          <label className={rotulo}>Data da alta clínica *</label>
          <DatePicker value={data} onChange={setData} />
        </div>

        <div>
          <label className={rotulo}>Anexo (opcional — PDF ou imagem)</label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadando}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {uploadando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {arquivoPath ? "Substituir arquivo selecionado" : "Selecionar arquivo"}
            </button>
            {arquivoPath && (
              <span className="text-xs font-medium text-emerald-600">Arquivo anexado</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {erroArquivo && <p className="mt-1 text-xs text-destructive">{erroArquivo}</p>}
        </div>

        <CampoCheckbox
          label="Confirmo que este é o encerramento de todas as terapias do paciente"
          checked={confirmado}
          onChange={setConfirmado}
          disabled={salvando}
        />

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={salvando || uploadando || !confirmado || !data}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-white hover:bg-destructive/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-neutral-900"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar alta clínica
          </button>
        </div>
      </div>
    </ScheduleModal>
  )
}

// ─── MODAL DE DETALHE (ALTA OU SUSPENSÃO) ───────────────────────────────────

function DetalheCardModal({
  titulo,
  tipo,
  ativo,
  prazoAlcancado,
  linhas,
  temArquivo,
  abrindoArquivo,
  onAbrirArquivo,
  excluindo,
  onExcluir,
  reativando,
  onReativar,
  estendendoPrazo,
  onEstenderPrazo,
  onClose,
}: {
  titulo: string
  tipo: string
  ativo: boolean
  /** Só a Suspensão usa isto — Alta não tem prazo. */
  prazoAlcancado?: boolean
  linhas: { label: string; valor: string }[]
  temArquivo: boolean
  abrindoArquivo: boolean
  onAbrirArquivo: () => void
  excluindo: boolean
  onExcluir: () => void
  reativando: boolean
  onReativar: () => void
  estendendoPrazo?: boolean
  onEstenderPrazo?: (indefinido: boolean, novoPrazoFim: string | null) => Promise<boolean>
  onClose: () => void
}) {
  const [formEstenderAberto, setFormEstenderAberto] = useState(false)
  const [novoIndefinido, setNovoIndefinido] = useState(false)
  const [novoPrazoFim, setNovoPrazoFim] = useState("")

  async function confirmarExtensao() {
    if (!onEstenderPrazo) return
    const hoje = new Date().toISOString().slice(0, 10)
    if (!novoIndefinido && (!novoPrazoFim || novoPrazoFim <= hoje)) {
      toast.error("Informe uma data futura para o novo prazo, ou marque prazo indefinido.")
      return
    }
    const ok = await onEstenderPrazo(novoIndefinido, novoIndefinido ? null : novoPrazoFim)
    if (ok) onClose()
  }

  return (
    <ScheduleModal onClose={onClose} title={titulo}>
      <div className="space-y-5 p-6">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tipo}
          </span>
          {!ativo ? (
            <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
              Excluída
            </span>
          ) : prazoAlcancado ? (
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
              Prazo alcançado
            </span>
          ) : null}
        </div>

        <dl className="space-y-3">
          {linhas.map((l) => (
            <div key={l.label}>
              <dt className={rotulo}>{l.label}</dt>
              <dd className="mt-0.5 text-sm text-foreground">{l.valor}</dd>
            </div>
          ))}
        </dl>

        {formEstenderAberto ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={rotulo}>Novo prazo *</label>
                <div className="mt-1">
                  <DatePicker value={novoPrazoFim} onChange={setNovoPrazoFim} disabled={novoIndefinido} />
                </div>
              </div>
              <div className="flex items-end pb-1.5">
                <CampoCheckbox
                  label="Prazo indefinido"
                  checked={novoIndefinido}
                  onChange={setNovoIndefinido}
                  disabled={!!estendendoPrazo}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormEstenderAberto(false)}
                disabled={estendendoPrazo}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarExtensao()}
                disabled={estendendoPrazo}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {estendendoPrazo && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            {temArquivo && (
              <button
                type="button"
                onClick={onAbrirArquivo}
                disabled={abrindoArquivo}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {abrindoArquivo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Ver anexo
              </button>
            )}
            {prazoAlcancado && onEstenderPrazo && (
              <button
                type="button"
                onClick={() => setFormEstenderAberto(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarClock className="h-4 w-4" />
                Estender prazo
              </button>
            )}
            {ativo ? (
              <button
                type="button"
                onClick={onExcluir}
                disabled={excluindo}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Excluir
              </button>
            ) : (
              <button
                type="button"
                onClick={onReativar}
                disabled={reativando}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {reativando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Reativar
              </button>
            )}
          </div>
        )}
      </div>
    </ScheduleModal>
  )
}

// ─── CAMPO SIM/NÃO ────────────────────────────────────────────────────────────

function CampoSimNao({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
  disabled?: boolean
}) {
  return (
    <CampoSelect<"sim" | "nao">
      label={label}
      value={value === null ? null : value ? "sim" : "nao"}
      onChange={(v) => onChange(v === "sim" ? true : v === "nao" ? false : null)}
      opcoes={[
        { valor: "sim", rotulo: "Sim" },
        { valor: "nao", rotulo: "Não" },
      ]}
      disabled={!!disabled}
    />
  )
}
