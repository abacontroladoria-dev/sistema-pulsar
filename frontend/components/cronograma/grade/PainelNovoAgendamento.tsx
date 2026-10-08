"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CalendarPlus, CheckCircle2, Info, Loader2, Repeat } from "lucide-react"
import toast from "react-hot-toast"
import { CampoSelect, campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import { DatePicker } from "@/components/ui/date-picker"
import { dataBR, hojeBrasilia } from "@/lib/disponibilidadeProfissional"
import { exibicaoSugerida } from "@/lib/grade/exibicao"
import { DIAS_NOMES, ROTULO_CONFLITO, diaDaSemana, foraDaJanelaDoPaciente, janelaDoPaciente, montarDia, rotuloVagas } from "@/lib/grade/motor"
import {
  criar, disponibilidadePaciente, listarAgendamentos, listarBloqueios, listarFaixas, listarFeriados, simular, type PacienteGrade,
} from "@/services/grade.service"
import type { DisponibilidadePacienteGrade, HorarioGrade, PayloadAgendamento, ProfissionalGrade, SimulacaoData } from "@/types/grade"
import type { CadastroTerapia } from "@/types/terapia"
import { aviso, btnPrimario, btnSecundario, opcaoForm } from "./estilo"

// "Novo agendamento" (painel lateral). Grava SÓ no Pulsar. Os horários
// oferecidos são os livres da disponibilidade do profissional naquele dia; a
// prévia vem do banco (grade_simular_agendamento), com o motivo de cada data
// pulada — feriado, bloqueio, horário lotado…

type Repeticao = "unica" | "semanal" | "quinzenal" | "personalizado"
type Termino = "continuo" | "data" | "sessoes"

export type InicialNovo = {
  profissionalId?: number | null
  pacienteId?: number | null
  data?: string
  inicio?: string
  fim?: string
}

export function PainelNovoAgendamento({
  inicial, profissionais, pacientes, catalogo, onFechar, onCriado,
}: {
  inicial: InicialNovo
  profissionais: ProfissionalGrade[]
  pacientes: PacienteGrade[] | null
  catalogo: CadastroTerapia[]
  onFechar: () => void
  onCriado: () => void
}) {
  const hoje = hojeBrasilia()
  const [profId, setProfId] = useState<number | null>(inicial.profissionalId ?? null)
  const [pacId, setPacId] = useState<number | null>(inicial.pacienteId ?? null)
  const [data, setData] = useState(inicial.data && inicial.data >= hoje ? inicial.data : hoje)
  const [horario, setHorario] = useState<string | null>(inicial.inicio ? `${inicial.inicio}|${inicial.fim}` : null)
  const [terapiaId, setTerapiaId] = useState<number | null>(null)
  const [exibicaoId, setExibicaoId] = useState<number | null>(null)
  const [repeticao, setRepeticao] = useState<Repeticao>("semanal")
  const [intervalo, setIntervalo] = useState(3)
  const [termino, setTermino] = useState<Termino>("continuo")
  const [dataFim, setDataFim] = useState("")
  const [totalSessoes, setTotalSessoes] = useState(10)
  const [observacao, setObservacao] = useState("")
  const [permitirSimultaneo, setPermitirSimultaneo] = useState(false)

  const [horarios, setHorarios] = useState<HorarioGrade[] | null>(null)
  const [dispPac, setDispPac] = useState<DisponibilidadePacienteGrade | null>(null)
  const [simulacao, setSimulacao] = useState<SimulacaoData[] | null>(null)
  const [simulando, setSimulando] = useState(false)
  const [erroSim, setErroSim] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const catalogoPorId = useMemo(() => new Map(catalogo.map(t => [t.id, t])), [catalogo])
  const prof = profissionais.find(p => p.id === profId) ?? null

  // Horários livres do profissional no dia (pelo motor, com a mesma regra da tela).
  useEffect(() => {
    setHorarios(null)
    if (!profId || !data) return
    let vivo = true
    Promise.all([
      listarFaixas(data, data, [profId]),
      listarAgendamentos({ de: data, ate: data, profissionais: [profId] }),
      listarBloqueios(data, data, [profId]),
      listarFeriados(data, data),
    ]).then(([faixas, agendamentos, bloqueios, feriados]) => {
      if (!vivo || !prof) return
      const d = montarDia({ profissional: prof, data, faixas, agendamentos, bloqueios, feriado: feriados[0] ?? null })
      setHorarios(d.horarios.filter(h => h.estado === "disponivel" || h.estado === "parcial"))
    }).catch(e => vivo && toast.error(e instanceof Error ? e.message : String(e)))
    return () => { vivo = false }
  }, [profId, data, prof])

  // Horário que veio do clique e não está mais livre (ou outro dia): limpa.
  useEffect(() => {
    if (horarios && horario && !horarios.some(h => `${h.inicio}|${h.fim}` === horario)) setHorario(null)
  }, [horarios, horario])

  const slot = horarios?.find(h => `${h.inicio}|${h.fim}` === horario) ?? null
  const terapiasDoSlot = useMemo(() => slot?.terapias ?? [], [slot])

  useEffect(() => {
    if (terapiasDoSlot.length === 1) setTerapiaId(terapiasDoSlot[0].id)
    else if (terapiaId && !terapiasDoSlot.some(t => t.id === terapiaId)) setTerapiaId(null)
  }, [terapiasDoSlot, terapiaId])

  useEffect(() => {
    const t = terapiaId ? catalogoPorId.get(terapiaId) : null
    setExibicaoId(t ? exibicaoSugerida(t, catalogo) : null)
  }, [terapiaId, catalogoPorId, catalogo])

  useEffect(() => {
    setDispPac(null)
    if (!pacId) return
    let vivo = true
    disponibilidadePaciente(pacId).then(d => vivo && setDispPac(d)).catch(() => {})
    return () => { vivo = false }
  }, [pacId])

  const payload: PayloadAgendamento | null = useMemo(() => {
    if (!profId || !pacId || !terapiaId || !slot) return null
    const semanal = repeticao !== "unica"
    if (semanal && termino === "data" && !dataFim) return null
    return {
      paciente_id: pacId,
      profissional_id: profId,
      terapia_id: terapiaId,
      terapia_exibicao_id: exibicaoId,
      data_inicio: data,
      hora_inicio: slot.inicio,
      hora_fim: slot.fim,
      frequencia: semanal ? "semanal" : "unica",
      intervalo_semanas: repeticao === "quinzenal" ? 2 : repeticao === "personalizado" ? intervalo : 1,
      data_fim: semanal && termino === "data" ? dataFim : null,
      total_sessoes: semanal && termino === "sessoes" ? totalSessoes : null,
      permitir_paciente_simultaneo: permitirSimultaneo,
      observacao: observacao.trim() || null,
    }
  }, [profId, pacId, terapiaId, exibicaoId, slot, data, repeticao, intervalo, termino, dataFim, totalSessoes, permitirSimultaneo, observacao])

  // Prévia do banco, com uma pausa para não chamar a cada tecla.
  const chavePayload = payload ? JSON.stringify({ ...payload, observacao: null }) : ""
  useEffect(() => {
    setSimulacao(null)
    setErroSim(null)
    if (!chavePayload) return
    let vivo = true
    setSimulando(true)
    const t = setTimeout(() => {
      simular(JSON.parse(chavePayload) as PayloadAgendamento)
        .then(r => vivo && setSimulacao(r))
        .catch(e => vivo && setErroSim(e instanceof Error ? e.message : String(e)))
        .finally(() => vivo && setSimulando(false))
    }, 350)
    return () => { vivo = false; clearTimeout(t) }
  }, [chavePayload])

  const oks = simulacao?.filter(s => s.ok) ?? []
  const puladas = simulacao?.filter(s => !s.ok) ?? []
  const temOcupado = puladas.some(s => s.conflito === "paciente_ocupado") || (permitirSimultaneo && simulacao?.some(s => s.conflito === "paciente_ocupado"))
  const janela = pacId ? janelaDoPaciente(dispPac, data) : null
  const foraJanela = !!slot && !!dispPac && foraDaJanelaDoPaciente(dispPac, { data, hora_inicio: slot.inicio, hora_fim: slot.fim })

  const salvar = async () => {
    if (!payload || !oks.length) return
    setSalvando(true)
    try {
      const r = await criar(payload)
      toast.success(r.criadas === 1 ? "Sessão agendada" : `${r.criadas} sessões agendadas`)
      if (r.puladas.length) toast(`${r.puladas.length} data(s) pulada(s) — ver o Registro de alterações.`, { icon: "ℹ️", duration: 6000 })
      onCriado()
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  const opcoesProf = useMemo(() => profissionais.filter(p => p.ativo).map(p => ({ valor: String(p.id), rotulo: p.nome })), [profissionais])
  const opcoesPac = useMemo(() => (pacientes ?? []).filter(p => p.ativo).map(p => ({ valor: String(p.id_paciente), rotulo: p.convenio_nome ? `${p.nome} · ${p.convenio_nome}` : p.nome })), [pacientes])
  const opcoesExib = useMemo(() => catalogo.filter(t => t.ativo || t.id === exibicaoId).map(t => ({ valor: String(t.id), rotulo: t.nome })), [catalogo, exibicaoId])
  const dia = DIAS_NOMES[diaDaSemana(data)].toLowerCase()
  const nesteDia = `${[0, 6].includes(diaDaSemana(data)) ? "neste" : "nesta"} ${dia}`
  const tomPrevia = TONE_SOFT[erroSim ? "red" : oks.length ? "green" : "amber"]

  return (
    <Drawer
      title="Novo agendamento"
      subtitle="Vale só no Pulsar — nada é enviado ao TiTa."
      width={520}
      onClose={onFechar}
      footer={
        <>
          <button type="button" onClick={onFechar} className={btnSecundario}>Cancelar</button>
          <button type="button" onClick={salvar} disabled={!payload || !oks.length || salvando || simulando} className={btnPrimario}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}
            {oks.length > 1 ? `Agendar ${oks.length} sessões` : "Agendar"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <CampoSelect label="Profissional" value={profId ? String(profId) : null} onChange={v => setProfId(v ? Number(v) : null)} disabled={false} opcoes={opcoesProf} vazio="Escolha o profissional" />
        <CampoSelect label="Paciente" value={pacId ? String(pacId) : null} onChange={v => setPacId(v ? Number(v) : null)} disabled={!pacientes} opcoes={opcoesPac} vazio={pacientes ? "Escolha o paciente" : "Carregando pacientes…"} />

        <div>
          <span className={rotulo}>Data de início</span>
          <div className="mt-1"><DatePicker value={data} onChange={v => v && setData(v < hoje ? hoje : v)} /></div>
        </div>

        <div>
          <span className={rotulo}>Horário livre</span>
          {!profId ? (
            <p className="mt-1 text-sm text-muted-foreground">Escolha o profissional para ver os horários.</p>
          ) : horarios === null ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Lendo a disponibilidade…</p>
          ) : !horarios.length ? (
            <p className={`${aviso("amber")} mt-1`}>
              Nenhum horário livre {nesteDia}. A grade vem da Disponibilidade do cadastro do profissional.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Horário">
              {horarios.map(h => {
                const k = `${h.inicio}|${h.fim}`
                return (
                  <button key={k} type="button" role="radio" aria-checked={horario === k} onClick={() => setHorario(k)}
                    className={`${opcaoForm(horario === k)} min-h-11 tabular-nums`}
                    title={rotuloVagas(h)}>
                    {h.inicio}–{h.fim}{h.capacidade > 1 && <span className="text-xs text-muted-foreground">· {rotuloVagas(h)}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {slot && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoSelect label="Terapia" value={terapiaId ? String(terapiaId) : null} onChange={v => setTerapiaId(v ? Number(v) : null)} disabled={false}
              opcoes={terapiasDoSlot.map(t => ({ valor: String(t.id), rotulo: t.nome }))} vazio="Escolha a terapia" />
            <CampoSelect label="Terapia de exibição" value={exibicaoId ? String(exibicaoId) : null} onChange={v => setExibicaoId(v ? Number(v) : null)} disabled={!terapiaId}
              opcoes={opcoesExib} vazio="Igual à terapia" />
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Sala: {slot.local ? [slot.local.nome, slot.local.unidade].filter(Boolean).join(" · ") : "—"} (vem da disponibilidade)
            </p>
          </div>
        )}

        {foraJanela && (
          <p className={aviso("amber")}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {janela ? `Fora da disponibilidade da família ${nesteDia} (${janela.inicio}–${janela.fim}).` : `A família não informou disponibilidade ${nesteDia}.`}
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className={rotulo}>Repetição</legend>
          <div className="flex flex-wrap gap-1.5">
            {([
              ["unica", "Não se repete"],
              ["semanal", `${[0, 6].includes(diaDaSemana(data)) ? "Todo" : "Toda"} ${dia.replace("-feira", "")}`],
              ["quinzenal", "A cada 2 semanas"],
              ["personalizado", "Personalizado"],
            ] as [Repeticao, string][]).map(([v, r]) => (
              <button key={v} type="button" aria-pressed={repeticao === v} onClick={() => setRepeticao(v)} className={`${opcaoForm(repeticao === v)} min-h-11`}>
                {v === "semanal" && <Repeat className="h-3.5 w-3.5" aria-hidden />}{r}
              </button>
            ))}
          </div>
          {repeticao === "personalizado" && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              A cada
              <input type="number" min={1} max={8} value={intervalo} onChange={e => setIntervalo(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
                className={`${campo} h-9 w-20 text-center`} aria-label="Intervalo em semanas" />
              semanas
            </label>
          )}
        </fieldset>

        {repeticao !== "unica" && (
          <fieldset className="space-y-2">
            <legend className={rotulo}>Término</legend>
            <div className="flex flex-wrap gap-1.5">
              {([["continuo", "Sem término (contínuo)"], ["data", "Em uma data"], ["sessoes", "Após N sessões"]] as [Termino, string][]).map(([v, r]) => (
                <button key={v} type="button" aria-pressed={termino === v} onClick={() => setTermino(v)} className={`${opcaoForm(termino === v)} min-h-11`}>{r}</button>
              ))}
            </div>
            {termino === "data" && <DatePicker value={dataFim} onChange={v => setDataFim(v && v < data ? data : v)} />}
            {termino === "sessoes" && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="number" min={1} max={520} value={totalSessoes} onChange={e => setTotalSessoes(Math.min(520, Math.max(1, Number(e.target.value) || 1)))}
                  className={`${campo} h-9 w-24 text-center`} aria-label="Número de sessões" />
                sessões (datas puladas não contam)
              </label>
            )}
            {termino === "continuo" && (
              <p className="text-xs text-muted-foreground">As sessões ficam lançadas até 6 meses à frente e a repetição automática estende toda noite.</p>
            )}
          </fieldset>
        )}

        <div>
          <label className={rotulo} htmlFor="obs-agendamento">Observação (opcional)</label>
          <textarea id="obs-agendamento" value={observacao} onChange={e => setObservacao(e.target.value)} maxLength={1000} rows={2}
            className={`${campo} mt-1 w-full resize-y py-2`} />
        </div>

        {/* Prévia */}
        {payload && (
          <section aria-live="polite" className={`space-y-2 rounded-lg p-3 ${tomPrevia.bg} ${tomPrevia.text}`}>
            {simulando ? (
              <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Conferindo as datas…</p>
            ) : erroSim ? (
              <p className="text-sm">{erroSim}</p>
            ) : simulacao && (
              <>
                <p className="flex items-start gap-2 text-sm font-semibold">
                  {oks.length ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  {oks.length
                    ? oks.length === 1 ? `Será criada 1 sessão em ${dataBR(oks[0].data)}.` : `Serão criadas ${oks.length} sessões, de ${dataBR(oks[0].data)} a ${dataBR(oks[oks.length - 1].data)}.`
                    : "Nenhuma data pode ser agendada."}
                </p>
                {puladas.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Datas puladas">
                    {puladas.slice(0, 12).map(s => (
                      <li key={s.data} className="rounded-full border border-amber-300 bg-card px-2 text-xs font-medium leading-6 text-amber-700 dark:border-amber-800 dark:text-amber-400">
                        {dataBR(s.data).slice(0, 5)} · {s.conflito ? ROTULO_CONFLITO[s.conflito] : ""}
                      </li>
                    ))}
                    {puladas.length > 12 && <li className="text-xs font-semibold">+{puladas.length - 12}</li>}
                  </ul>
                )}
                {temOcupado && (
                  <label className="flex items-start gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={permitirSimultaneo} onChange={e => setPermitirSimultaneo(e.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
                    Permitir sessão ao mesmo tempo de outra do paciente (ex.: supervisão junto)
                  </label>
                )}
              </>
            )}
          </section>
        )}

        {!payload && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Preencha profissional, paciente, horário e terapia para ver as datas.
          </p>
        )}
      </div>
    </Drawer>
  )
}
