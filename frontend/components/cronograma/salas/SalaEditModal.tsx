"use client"

// SalaEditModal — CRUD de sala (criar/editar) sobre o shell ScheduleModal.

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Clock, Loader2, Save, Trash2 } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { ConfirmDialog } from "@/components/cronograma/ui/ConfirmDialog"
import { criarSala, atualizarSala, arquivarSala, listarNucleos, listarExclusividadesTerapia } from "@/services/salas.service"
import { normNumeroSala, sugerirNumerosSalaDisponiveis } from "@/lib/cronograma/salas"
import { pm, fm } from "@/lib/cronograma/helpers"
import { useStatusLabels } from "@/hooks/useStatusLabels"
import { DIAS_DISPONIVEIS_PADRAO, chaveHorarioCustomizado } from "@/lib/cronograma/salasTypes"
import type { Sala, SalaInput, SalaCapacidade, SalaStatus, SalaTerapiaExclusiva, ModoExclusividadeTerapia } from "@/lib/cronograma/salasTypes"

const MODO_LABEL: Record<ModoExclusividadeTerapia, string> = { obrigatoria: "Obrigatória", preferencial: "Preferencial" }

interface SalaEditModalProps {
  sala: Sala | null
  /** Salas já cadastradas (todas as unidades) — usadas para sugerir números livres e avisar de duplicidade antes de tentar salvar. */
  todasSalas: Sala[]
  onClose: () => void
  onSaved: () => void
}

const CAPACIDADE_LABEL: Record<SalaCapacidade, string> = {
  unico: "Único (1 profissional/paciente por vez)",
  duplo: "Duplo (2 simultâneos)",
  multiplo: "Múltiplo (3+ simultâneos)",
}

/** Unidades reais da operação (mesmo conjunto canônico usado em normalizarUnidadeOcupacao). */
const UNIDADES = ["Realengo", "Fazendinha", "Padre Miguel", "Ambiente Natural", "Unidade Terceirizada - Campo Grande"]

/** Dias da semana disponíveis pra atendimento (1=Seg ... 6=Sáb) — mesma ordem usada na grade. */
const DIAS_SEMANA: { dow: number; label: string }[] = [
  { dow: 1, label: "Seg" },
  { dow: 2, label: "Ter" },
  { dow: 3, label: "Qua" },
  { dow: 4, label: "Qui" },
  { dow: 5, label: "Sex" },
  { dow: 6, label: "Sáb" },
]

// O anel de foco vive aqui para cobrir de uma vez os cinco inputs/textarea
// que usam esta classe — antes nenhum deles tinha qualquer estado de foco.
const INPUT_CLS = "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** Uma linha do editor de "Horários personalizados" — vira uma entrada em `horarios_customizados` no submit. `id` é só chave de React (a chave real gravada é dow+turno). */
interface OverrideRow {
  id: string
  dow: number
  turno: "Manhã" | "Tarde"
  inicio: string
  fim: string
  duracaoMin: number
}

/** Gera a lista de horários de um override (ex.: 08:00→12:00, 30min = 8 horários) — mesmo formato "HH:MM" de HORAS_GRID, pra `calcularSlotsDaSala` tratar igual ao grid padrão. */
function gerarHorarios(inicio: string, fim: string, duracaoMin: number): string[] {
  const ini = pm(inicio)
  const end = pm(fim)
  if (ini === null || end === null || !Number.isFinite(duracaoMin) || duracaoMin <= 0) return []
  const horarios: string[] = []
  for (let m = ini; m + duracaoMin <= end; m += duracaoMin) horarios.push(fm(m))
  return horarios
}

/** Reconstrói início/fim/duração a partir de uma lista de horários já salva (edição de uma sala existente) — inversa de gerarHorarios, assumindo passo constante. */
function inferirOverride(horarios: string[]): { inicio: string; fim: string; duracaoMin: number } {
  const minutos = horarios.map(h => pm(h)).filter((n): n is number => n !== null).sort((a, b) => a - b)
  if (!minutos.length) return { inicio: "08:00", fim: "12:00", duracaoMin: 30 }
  const duracaoMin = minutos.length >= 2 ? minutos[1] - minutos[0] : 40
  return { inicio: fm(minutos[0]), fim: fm(minutos[minutos.length - 1] + duracaoMin), duracaoMin }
}

export function SalaEditModal({ sala, todasSalas, onClose, onSaved }: SalaEditModalProps) {
  const [nucleos, setNucleos] = useState<string[]>([])
  const { labels: statusLabels } = useStatusLabels()
  const [exclusividades, setExclusividades] = useState<SalaTerapiaExclusiva[]>([])

  useEffect(() => {
    listarNucleos().then(rows => setNucleos(rows.map(n => n.nome))).catch(() => {})
  }, [])

  useEffect(() => {
    if (!sala) return
    listarExclusividadesTerapia().then(rows => setExclusividades(rows.filter(r => r.sala_id === sala.id))).catch(() => {})
  }, [sala])

  const [form, setForm] = useState<SalaInput>({
    unidade_nome: sala?.unidade_nome ?? "",
    nucleo: sala?.nucleo ?? "",
    andar: sala?.andar ?? "",
    numero_sala: sala?.numero_sala ?? "",
    nome_exibicao: sala?.nome_exibicao ?? "",
    capacidade: sala?.capacidade ?? "unico",
    status: sala?.status ?? "operacional",
    sala_nome_referencia: sala?.sala_nome_referencia ?? "",
    observacoes: sala?.observacoes ?? "",
    dias_disponiveis: sala?.dias_disponiveis?.length ? sala.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO,
  })
  const [overrides, setOverrides] = useState<OverrideRow[]>(() =>
    Object.entries(sala?.horarios_customizados ?? {}).map(([chave, horarios]) => {
      const [dowStr, turno] = chave.split("-")
      return { id: chave, dow: Number(dowStr), turno: turno as "Manhã" | "Tarde", ...inferirOverride(horarios) }
    }),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  function set<K extends keyof SalaInput>(key: K, v: SalaInput[K]) {
    setForm(prev => ({ ...prev, [key]: v }))
  }

  const diasAtuais = form.dias_disponiveis?.length ? form.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO

  const diasPadrao = diasAtuais.length === DIAS_DISPONIVEIS_PADRAO.length
    && diasAtuais.every(d => {
      const padrao = DIAS_DISPONIVEIS_PADRAO.find(p => p.dow === d.dow)
      return !!padrao && d.turnos.length === 2 && d.turnos.includes("Manhã") && d.turnos.includes("Tarde")
    })

  function turnoAtivo(dow: number, turno: "Manhã" | "Tarde"): boolean {
    return diasAtuais.some(d => d.dow === dow && d.turnos.includes(turno))
  }

  function alternarTurno(dow: number, turno: "Manhã" | "Tarde") {
    setForm(prev => {
      const atuais = prev.dias_disponiveis?.length ? prev.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO
      const existente = atuais.find(d => d.dow === dow)
      const turnosNovos = existente
        ? (existente.turnos.includes(turno) ? existente.turnos.filter(t => t !== turno) : [...existente.turnos, turno])
        : [turno]
      const semEsseDia = atuais.filter(d => d.dow !== dow)
      const novo = turnosNovos.length > 0
        ? [...semEsseDia, { dow, turnos: turnosNovos }].sort((a, b) => a.dow - b.dow)
        : semEsseDia
      return { ...prev, dias_disponiveis: novo }
    })
  }

  /** Overrides visíveis/válidos — só os cujo dia+turno ainda está marcado acima (evita salvar um horário personalizado "órfão" se o usuário desmarcar o turno depois de configurá-lo). */
  const overridesAtivos = overrides.filter(o => turnoAtivo(o.dow, o.turno))

  function combinacaoJaUsada(dow: number, turno: "Manhã" | "Tarde", exceto?: string): boolean {
    return overrides.some(o => o.id !== exceto && o.dow === dow && o.turno === turno)
  }

  /** Primeira combinação dia+turno marcada acima que ainda não tem override — usada pra pré-preencher uma linha nova. */
  function proximaCombinacaoLivre(): { dow: number; turno: "Manhã" | "Tarde" } | null {
    for (const d of diasAtuais) {
      for (const turno of d.turnos) {
        if (!combinacaoJaUsada(d.dow, turno)) return { dow: d.dow, turno }
      }
    }
    return null
  }

  function adicionarOverride() {
    const proxima = proximaCombinacaoLivre()
    if (!proxima) return
    setOverrides(prev => [...prev, {
      id: `novo-${Date.now()}`, dow: proxima.dow, turno: proxima.turno,
      inicio: "08:00", fim: "12:00", duracaoMin: 30,
    }])
  }

  function atualizarOverride(id: string, patch: Partial<OverrideRow>) {
    setOverrides(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o))
  }

  function removerOverride(id: string) {
    setOverrides(prev => prev.filter(o => o.id !== id))
  }

  /** `horarios_customizados` final pra gravar — deriva de `overridesAtivos`, ignorando linhas sem nenhum horário gerado (início/fim/duração inconsistentes). */
  const horariosCustomizados = Object.fromEntries(
    overridesAtivos
      .map(o => [chaveHorarioCustomizado(o.dow, o.turno), gerarHorarios(o.inicio, o.fim, o.duracaoMin)] as const)
      .filter(([, horarios]) => horarios.length > 0),
  )

  const andarPreenchido = (form.andar ?? "").trim() !== ""

  /** Números já em uso na mesma unidade + andar (exceto a própria sala, quando editando) — a numeração é por andar, então "Sala 1" do 1º e do 2º andar podem coexistir. */
  const numerosUsadosNoAndar = useMemo(
    () => todasSalas
      .filter(s => s.unidade_nome === form.unidade_nome && (s.andar ?? "") === (form.andar ?? "") && s.id !== sala?.id)
      .map(s => s.numero_sala),
    [todasSalas, form.unidade_nome, form.andar, sala?.id],
  )

  const numerosSugeridos = useMemo(
    () => (form.unidade_nome && andarPreenchido) ? sugerirNumerosSalaDisponiveis(numerosUsadosNoAndar) : [],
    [form.unidade_nome, andarPreenchido, numerosUsadosNoAndar],
  )

  const numeroJaUsado = andarPreenchido && form.numero_sala.trim() !== ""
    && numerosUsadosNoAndar.some(n => normNumeroSala(n) === normNumeroSala(form.numero_sala))

  /**
   * O que impede o salvamento, em prosa. Antes `valido` era uma conjunção de
   * seis condições e o botão só ficava opaco — num modal largo o campo que
   * falta pode estar na outra metade da tela, e o usuário concluía que "o
   * sistema não salva".
   */
  const pendencias: string[] = []
  if (!form.unidade_nome.trim()) pendencias.push("Unidade")
  if (!andarPreenchido) pendencias.push("Andar")
  if (!form.numero_sala.trim()) pendencias.push("Número da sala")
  if (form.nome_exibicao.trim() === "") pendencias.push("Nome de exibição")
  if (numeroJaUsado) pendencias.push("um número de sala que ainda não exista neste andar")
  if ((form.dias_disponiveis?.length ?? 0) === 0) pendencias.push("ao menos um dia de atendimento")
  // Linha de horário que não gera sessão nenhuma seria DESCARTADA em silêncio
  // pelo filtro do payload — o usuário salvava, reabria e ela não estava lá.
  if (overridesAtivos.some(o => gerarHorarios(o.inicio, o.fim, o.duracaoMin).length === 0)) {
    pendencias.push("corrigir os horários personalizados marcados em vermelho")
  }

  const valido = pendencias.length === 0

  async function handleSalvar() {
    if (!valido) return
    setSaving(true)
    setError(null)
    try {
      // `horarios_customizados` só entra no payload quando há override de fato
      // — ou quando a sala JÁ tinha algum e ele precisa ser zerado. Mandar o
      // campo sempre (inclusive `{}`) acopla toda a edição de sala a esse
      // recurso opcional: em 2026-09-14 a coluna não existia em produção (a
      // migration 20260908095723 tinha sido pulada) e o PostgREST rejeitava o
      // request INTEIRO antes de emitir o UPDATE — capacidade, nome, status e
      // dias pararam de salvar por causa de um campo que ninguém estava
      // usando. Omitir quando não há nada a gravar mantém a falha contida ao
      // recurso que a causou.
      const tinhaOverrides = Object.keys(sala?.horarios_customizados ?? {}).length > 0
      const payload: SalaInput = {
        ...form,
        ...((Object.keys(horariosCustomizados).length > 0 || tinhaOverrides)
          ? { horarios_customizados: horariosCustomizados }
          : {}),
      }
      if (sala) await atualizarSala(sala.id, payload)
      else await criarSala(payload)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar sala.")
    } finally {
      setSaving(false)
    }
  }

  async function confirmarExclusao() {
    if (!sala) return
    setConfirmandoExclusao(false)
    setSaving(true)
    setError(null)
    try {
      await arquivarSala(sala.id)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao excluir sala.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScheduleModal
      title={sala ? `Editar ${sala.nome_exibicao}` : "Nova sala"}
      // O subtítulo dizia "cruzado ... pela referência de nome", e isso era
      // falso: `salas.ts:94` cruza por normNumeroSala(numero_sala), e
      // `sala_nome_referencia` não é lido por nenhuma lógica (só aparece no
      // rótulo da auditoria). O campo de maior consequência da tela é o
      // Número — o cabeçalho precisa dizer isso.
      subtitle="Cadastro estrutural de sala — a agenda é cruzada por Unidade + Número da sala."
      // Largo, na linguagem de docs/padrao-detalhamento-modal.md (max-w-350).
      // 1280 e não 1180: a linha de horário personalizado tem ~490px de piso
      // (seis trilhas + gaps) e agora vive em MEIA coluna — a ~1108px úteis
      // ela ficava na borda do estouro.
      maxWidth={1280}
      onClose={onClose}
      footer={
        <>
          {/* Bloco à esquerda: o destrutivo e o aviso do que falta. O `mr-auto`
              aqui é o que empurra Cancelar/Salvar para a direita e mantém o
              Excluir longe da primária — antes os três ficavam colados. */}
          <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {sala && (
            <button
              type="button"
              onClick={() => setConfirmandoExclusao(true)}
              disabled={saving}
              // Longe do Salvar: ação destrutiva não fica a 8px da primária.
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-300 px-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400"
            >
              <Trash2 size={14} /> Excluir
            </button>
          )}
          {!valido && (
            <span className="text-[11px] text-muted-foreground">
              Falta preencher: <span className="font-semibold text-foreground">{pendencias.join(", ")}</span>
            </span>
          )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={saving || !valido}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#222847] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#2d3459] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
          </button>
        </>
      }
    >
      {/* Duas colunas no desktop, empilhado abaixo de lg.
          À esquerda o que a sala É (endereço e identificação): campos curtos,
          preenchidos uma vez e quase nunca revisitados. À direita QUANDO ela
          atende: a grade de dias/turnos e as linhas de horário personalizado
          precisam de largura — comprimidas em 560px, as linhas de override
          quebravam em três filas. */}
      {/* O erro entra ANTES do formulário: renderizado depois, num modal alto,
          ele nascia fora da área visível e o usuário via só o Salvar "não
          fazer nada". */}
      {error && (
        <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Metade e metade, empilhado abaixo de lg.
          A divisão NÃO é por assunto, é por ALTURA: à esquerda o que tem
          tamanho fixo (endereço e identificação, 7 campos curtos); à direita
          tudo que CRESCE — dias, as N linhas de horário e as observações.
          Foi assim que o scroll sumiu: antes os horários ficavam numa faixa
          embaixo, e cada linha nova empurrava o modal para além da viewport. */}
      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Secao titulo="Localização">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Unidade *">
                <MiniSelect
                  value={form.unidade_nome}
                  aria-label="Unidade"
                  placeholder="Selecione..."
                  options={UNIDADES.map(u => ({ value: u, label: u }))}
                  onChange={v => set("unidade_nome", v)}
                />
              </Campo>
              <Campo label="Núcleo">
                <MiniSelect
                  value={form.nucleo ?? ""}
                  aria-label="Núcleo"
                  placeholder="Nenhum"
                  options={nucleos.map(n => ({ value: n, label: n }))}
                  onChange={v => set("nucleo", v)}
                  permiteVazio
                />
              </Campo>
              <Campo label="Andar *">
                <input
                  className={INPUT_CLS}
                  value={form.andar ?? ""}
                  onChange={e => set("andar", e.target.value)}
                  placeholder="1"
                />
              </Campo>
              <Campo label="Número da sala *">
                <input
                  className={`${INPUT_CLS} ${numeroJaUsado ? "border-rose-400 dark:border-rose-700" : ""}`}
                  value={form.numero_sala}
                  onChange={e => set("numero_sala", e.target.value)}
                  placeholder="3"
                />
              </Campo>
              {!andarPreenchido && (
                <span className="col-span-2 text-[11px] text-muted-foreground">
                  Preencha o Andar para ver os números livres — a numeração é por andar, não pela unidade inteira.
                </span>
              )}
              {numeroJaUsado && (
                <span className="col-span-2 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  Já existe uma sala &quot;{form.numero_sala}&quot; em {form.unidade_nome} · {form.andar}º andar. Escolha outro número.
                </span>
              )}
              {!numeroJaUsado && numerosSugeridos.length > 0 && (
                <div className="col-span-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Livres em {form.unidade_nome} · {form.andar}º andar:</span>
                  {numerosSugeridos.map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => set("numero_sala", String(n))}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                        normNumeroSala(form.numero_sala) === String(n)
                          ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                          : "border-border text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
        </div>
            )}
          </div>
        </Secao>

        <Secao titulo="Identificação">
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Nome de exibição *" className="col-span-2">
              <input className={INPUT_CLS} value={form.nome_exibicao} onChange={e => set("nome_exibicao", e.target.value)} placeholder="Sala 3" />
            </Campo>
            <Campo label="Capacidade *">
              <MiniSelect
                value={form.capacidade}
                aria-label="Capacidade"
                options={Object.entries(CAPACIDADE_LABEL).map(([k, l]) => ({ value: k, label: l }))}
                onChange={v => set("capacidade", v as SalaCapacidade)}
              />
            </Campo>
            <Campo label="Status">
              <MiniSelect
                value={form.status ?? ""}
                aria-label="Status"
                options={(Object.keys(statusLabels) as SalaStatus[]).map(k => ({ value: k, label: statusLabels[k].label }))}
                onChange={v => set("status", v as SalaStatus)}
              />
            </Campo>
          </div>
        </Secao>
        </div>

        {/* `@container`: a linha de horário mede a COLUNA, não a viewport.
            Com `sm:` ela virava grade assim que a janela passava de 640px,
            mesmo quando a coluna tinha metade disso, e estourava. */}
        <div className="@container flex flex-col gap-5">
          <Secao titulo="Disponibilidade">
            <div className="flex flex-col gap-3">
              <Campo label="Dias e turnos de atendimento *">
                <div className="flex flex-wrap items-center gap-2.5">
                  {DIAS_SEMANA.map(d => (
                    <div key={d.dow} className="flex items-center gap-1 rounded-lg border border-border px-1.5 py-1">
                      <span className="px-0.5 text-[11px] font-semibold text-muted-foreground">{d.label}</span>
                      {(["Manhã", "Tarde"] as const).map(turno => {
                        const marcado = turnoAtivo(d.dow, turno)
                        return (
                          <button
                            key={turno}
                            type="button"
                            onClick={() => alternarTurno(d.dow, turno)}
                            aria-pressed={marcado}
                            title={`${d.label} · ${turno}`}
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                              marcado
                                ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                                : "border-border text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            {turno === "Manhã" ? "M" : "T"}
                          </button>
                        )
                      })}
        </div>
                ))}
              </div>
              {!diasPadrao && (
                <span className="text-[11px] text-muted-foreground">
                  Fora do padrão Seg-Sex dia inteiro — esta sala aparece numa seção separada da grade principal
                </span>
              )}
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Horários personalizados">
          <div className="flex flex-col gap-3">
            <Campo label="Ajuste o horário de um dia e turno específicos (opcional)">
              <div className="flex flex-col gap-1.5">
                {/* Cabeçalho uma vez, não por linha: antes os seis controles
                    ficavam soltos e só a posição dizia o que era cada um. Com
                    a largura do modal novo eles cabem em colunas alinhadas. */}
                {overridesAtivos.length > 0 && (
                  <div className="hidden grid-cols-[64px_78px_1fr_74px_auto_26px] items-center gap-1.5 px-2 text-[10px] font-semibold text-muted-foreground @md:grid">
                    <span>Dia</span>
                    <span>Turno</span>
                    <span>Das / até</span>
                    <span>Duração</span>
                    <span className="text-right">Sessões</span>
                    <span />
                  </div>
                )}
                {overridesAtivos.map(o => {
                  const horarios = gerarHorarios(o.inicio, o.fim, o.duracaoMin)
                  const turnosDoDia = diasAtuais.find(d => d.dow === o.dow)?.turnos ?? []
                  return (
                    <div
                      key={o.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5 @md:grid @md:grid-cols-[64px_78px_1fr_74px_auto_26px]"
                    >
                      {/* Só dias que ainda têm ALGUM turno livre (ou o próprio
                          dia desta linha). Sem isso dava para pôr duas linhas
                          em Seg/Manhã: as duas apareciam, mas o
                          `Object.fromEntries` do payload guardava só a última
                          — duas linhas na tela, uma no banco. */}
                      <MiniSelect
                        compact
                        aria-label="Dia da semana"
                        value={String(o.dow)}
                        options={diasAtuais
                          .filter(d => d.dow === o.dow || d.turnos.some(t => !combinacaoJaUsada(d.dow, t, o.id)))
                          .map(d => ({ value: String(d.dow), label: DIAS_SEMANA.find(s => s.dow === d.dow)?.label ?? String(d.dow) }))}
                        onChange={v => {
                          const novoDow = Number(v)
                          const turnosNovoDia = diasAtuais.find(d => d.dow === novoDow)?.turnos ?? []
                          const livres = turnosNovoDia.filter(t => !combinacaoJaUsada(novoDow, t, o.id))
                          const novoTurno = livres.includes(o.turno) ? o.turno : (livres[0] ?? turnosNovoDia[0] ?? o.turno)
                          atualizarOverride(o.id, { dow: novoDow, turno: novoTurno })
                        }}
                      />
                      <MiniSelect
                        compact
                        aria-label="Turno"
                        value={o.turno}
                        options={turnosDoDia
                          .filter(t => t === o.turno || !combinacaoJaUsada(o.dow, t, o.id))
                          .map(t => ({ value: t, label: t }))}
                        onChange={v => atualizarOverride(o.id, { turno: v as "Manhã" | "Tarde" })}
                      />
                      <span className="flex items-center gap-1.5">
                        <TimeField ariaLabel="Horário inicial" value={o.inicio} onChange={v => atualizarOverride(o.id, { inicio: v })} />
                        <span className="text-[11px] text-muted-foreground">até</span>
                        <TimeField ariaLabel="Horário final" value={o.fim} onChange={v => atualizarOverride(o.id, { fim: v })} />
                      </span>
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min={5}
                          step={5}
                          aria-label="Minutos por sessão"
                          className="w-14 rounded-md border border-border bg-card px-1.5 py-1 text-[11px] text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          value={o.duracaoMin}
                          onChange={e => atualizarOverride(o.id, { duracaoMin: Number(e.target.value) })}
                        />
                        <span className="text-[11px] text-muted-foreground">min</span>
                      </span>
                      <span className={`text-right text-[11px] font-semibold tabular-nums ${horarios.length > 0 ? "text-foreground" : "text-rose-600 dark:text-rose-400"}`}>
                        {horarios.length > 0 ? horarios.length : "confira"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removerOverride(o.id)}
                        className="justify-self-end rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-rose-400"
                        aria-label="Remover este horário personalizado"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={adicionarOverride}
                  disabled={!proximaCombinacaoLivre()}
                  className="self-start rounded-lg border border-dashed border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                >
                  + Adicionar horário personalizado
                </button>
              </div>
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Outras informações">
          <div className="flex flex-col gap-3">
            <Campo label="Referência na agenda">
              <input
                className={INPUT_CLS}
                value={form.sala_nome_referencia ?? ""}
                onChange={e => set("sala_nome_referencia", e.target.value)}
                placeholder="Ex.: Unid. Realengo - Sala 3"
              />
              <span className="text-[11px] text-muted-foreground">Informativo — o cruzamento com a agenda usa Unidade + Número da sala, não este campo.</span>
            </Campo>
            <Campo label="Observações">
              <textarea
                className={`${INPUT_CLS} min-h-16 resize-y`}
                value={form.observacoes ?? ""}
                onChange={e => set("observacoes", e.target.value)}
              />
            </Campo>
            {sala && exclusividades.length > 0 && (
              <Campo label="Exclusividade de terapia">
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                  {exclusividades
                    .slice()
                    .sort((a, b) => a.terapia_nome.localeCompare(b.terapia_nome))
                    .map(e => (
                      <span key={e.id} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground">
                        {e.terapia_nome} <span className="font-normal text-muted-foreground">· {MODO_LABEL[e.modo]}</span>
                      </span>
                    ))}
                </div>
                <span className="text-[11px] text-muted-foreground">Definida em &quot;Exclusividade de salas com terapias&quot;.</span>
              </Campo>
            )}
          </div>
        </Secao>
        </div>
      </div>

      {confirmandoExclusao && sala && (
        <ConfirmDialog
          title="Excluir sala?"
          // `arquivarSala`, não DELETE: a sala sai das listas mas o histórico
          // dela continua existindo. Dizer "não pode ser desfeita" era assustar
          // com a coisa errada.
          description={`A sala "${sala.nome_exibicao}" sai das listas e da grade. O histórico dela é mantido.`}
          confirmLabel="Excluir"
          confirmColor="#dc2626"
          onConfirm={confirmarExclusao}
          onCancel={() => setConfirmandoExclusao(false)}
        />
      )}
    </ScheduleModal>
  )
}

function Campo({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className}`}>
      <span className="font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** Agrupador visual do formulário — substitui blocos de campo soltos por seções reconhecíveis. */
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Sem uppercase tracked-out: mesma decisão dos rótulos de filtro da
          página — caixa alta espaçada só aumenta a mancha e custa legibilidade. */}
      <h3 className="border-b border-border pb-1 text-[13px] font-bold text-foreground">{titulo}</h3>
      {children}
    </div>
  )
}

/**
 * Select próprio do Pulsar — substitui o `<select>` nativo, cuja lista suspensa
 * é renderizada pelo sistema operacional e não pode ser estilizada via CSS
 * (fonte/cores destoavam do resto do app). Gatilho no mesmo `INPUT_CLS` dos
 * demais campos; lista de opções reaproveita o padrão de dropdown já usado em
 * AlocarSessaoModal (sugestões de profissional/terapia).
 */
function MiniSelect({
  value, onChange, options, placeholder = "Selecione...", permiteVazio = false, compact = false, className = "",
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  /**
   * Nome acessível. Obrigatório na prática: o `Campo` que envolve este
   * componente renderiza um `<label>`, e `<label>` NÃO nomeia um `<button>` —
   * só nomeia controles nativos. Sem isto o leitor de tela anunciava apenas o
   * valor atual ("Selecione...", "Nenhum"), sem dizer de que campo se trata.
   */
  "aria-label"?: string
  /** Mostra "Nenhum"/placeholder como opção clicável na lista (ex.: Núcleo, que aceita ficar vazio). */
  permiteVazio?: boolean
  /** Densidade reduzida (texto 11px) — usada nas linhas estreitas de "Horários personalizados". */
  compact?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  const selecionado = options.find(o => o.value === value)
  // `w-full` no compacto também: nas linhas de horário personalizado ele agora
  // ocupa uma coluna de grade, e sem isso encolhia até o conteúdo, desalinhando
  // das colunas vizinhas e do cabeçalho.
  const triggerCls = compact
    ? "w-full rounded-md border border-border bg-card px-1.5 py-1 text-[11px]"
    : INPUT_CLS

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`${triggerCls} flex items-center justify-between gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <span className={`truncate ${selecionado ? "text-foreground" : "text-muted-foreground"}`}>
          {selecionado?.label ?? placeholder}
        </span>
        <ChevronDown size={compact ? 12 : 14} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-56 w-max min-w-full overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {permiteVazio && (
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => { onChange(""); setOpen(false) }}
              className={`block w-full whitespace-nowrap px-2.5 py-1.5 text-left text-sm hover:bg-muted ${value === "" ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {placeholder}
            </button>
          )}
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`block w-full whitespace-nowrap px-2.5 py-1.5 text-left text-sm hover:bg-muted ${o.value === value ? "font-semibold text-foreground" : "text-foreground"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Campo de horário próprio do Pulsar — substitui `<input type="time">`, cujo
 * seletor (relógio/scroller) também é desenhado pelo sistema operacional.
 * Texto livre mascarado como "HH:MM": digita só números, ":" é inserido
 * automaticamente — sem popup nenhum, 100% estilizável.
 */
function TimeField({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  function handleChange(raw: string) {
    const digitos = raw.replace(/\D/g, "").slice(0, 4)
    const formatado = digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos
    onChange(formatado)
  }
  return (
    <div className="relative">
      <Clock size={11} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        inputMode="numeric"
        placeholder="08:00"
        // `ariaLabel` é obrigatório no tipo: o placeholder era o ÚNICO nome
        // deste campo, o que o DESIGN.md proíbe explicitamente — e com dois
        // TimeField por linha ("das" e "até") eles eram indistinguíveis.
        aria-label={ariaLabel}
        maxLength={5}
        value={value}
        onChange={e => handleChange(e.target.value)}
        className="w-17.5 rounded-md border border-border bg-card py-1 pl-5 pr-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
