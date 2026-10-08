"use client"

import { useMemo, useState } from "react"
import { Loader2, Lock, LockOpen } from "lucide-react"
import toast from "react-hot-toast"
import { CampoSelect, campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { DatePicker } from "@/components/ui/date-picker"
import { avisoFeito, tom } from "@/components/ui/pastel/pecas"
import { dataBR, hojeBrasilia, horaCurta, opcoesHorario } from "@/lib/disponibilidadeProfissional"
import { DIAS_CURTOS } from "@/lib/grade/motor"
import { criarBloqueio, excluirBloqueio } from "@/services/grade.service"
import type { BloqueioGrade, ProfissionalGrade, TipoBloqueio } from "@/types/grade"

// Bloqueios da Grade: horário em que o profissional não atende (férias,
// administrativo…). Feriado não se cadastra aqui — vem de Cadastros → Feriados.
// Sessões que já estavam agendadas dentro do bloqueio continuam na agenda (a
// grade mostra o conflito); excluir é uma decisão à parte.

const TIPOS: { valor: TipoBloqueio; rotulo: string }[] = [
  { valor: "ferias", rotulo: "Férias" },
  { valor: "administrativo", rotulo: "Administrativo" },
  { valor: "bloqueio", rotulo: "Bloqueio" },
  { valor: "outro", rotulo: "Outro" },
]
const HORAS = opcoesHorario().map(h => ({ valor: h, rotulo: h }))

export function PainelNovoBloqueio({
  profissionais, inicial, onFechar, onCriado,
}: {
  profissionais: ProfissionalGrade[]
  inicial: { profissionalId?: number | null; data?: string; inicio?: string; fim?: string }
  onFechar: () => void
  onCriado: () => void
}) {
  const hoje = hojeBrasilia()
  const [profId, setProfId] = useState<number | null>(inicial.profissionalId ?? null)
  const [inicio, setInicio] = useState(inicial.data && inicial.data >= hoje ? inicial.data : hoje)
  const [semFim, setSemFim] = useState(false)
  const [fim, setFim] = useState(inicial.data && inicial.data >= hoje ? inicial.data : hoje)
  const [diaInteiro, setDiaInteiro] = useState(!inicial.inicio)
  const [hIni, setHIni] = useState(inicial.inicio ?? "08:00")
  const [hFim, setHFim] = useState(inicial.fim ?? "12:00")
  const [dias, setDias] = useState<Set<number>>(new Set())
  const [tipo, setTipo] = useState<TipoBloqueio>("ferias")
  const [motivo, setMotivo] = useState("")
  const [salvando, setSalvando] = useState(false)

  const opcoesProf = useMemo(() => profissionais.filter(p => p.ativo).map(p => ({ valor: String(p.id), rotulo: p.nome })), [profissionais])
  const valido = !!profId && motivo.trim().length >= 2 && (semFim || fim >= inicio) && (diaInteiro || hFim > hIni)

  const salvar = async () => {
    if (!valido || !profId) return
    setSalvando(true)
    try {
      const r = await criarBloqueio({
        profissional_id: profId,
        data_inicio: inicio,
        data_fim: semFim ? null : fim,
        hora_inicio: diaInteiro ? null : hIni,
        hora_fim: diaInteiro ? null : hFim,
        dias_semana: dias.size ? [...dias].sort() : null,
        tipo,
        motivo: motivo.trim(),
      })
      avisoFeito("Bloqueio criado")
      if (r.sessoes_no_periodo > 0) {
        toast(`${r.sessoes_no_periodo} sessão(ões) já agendada(s) dentro do bloqueio continuam na agenda — confira na grade.`, { icon: "⚠️", duration: 9000 })
      }
      onCriado()
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Drawer title="Bloquear horário" subtitle="O profissional não atende neste período. Vale só no Pulsar." width={480} onClose={onFechar}
      footer={
        <>
          <button type="button" onClick={onFechar} className={`${tom("cinza")} pp-btn pp-btn-suave min-h-11`}>Cancelar</button>
          <button type="button" onClick={salvar} disabled={!valido || salvando} className={`${tom("aco")} pp-btn min-h-11`}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />} Bloquear
          </button>
        </>
      }>
      <div className="pp space-y-4">
        <CampoSelect label="Profissional" value={profId ? String(profId) : null} onChange={v => setProfId(v ? Number(v) : null)} disabled={false} opcoes={opcoesProf} vazio="Escolha o profissional" />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className={rotulo}>De</span>
            <div className="mt-1"><DatePicker value={inicio} onChange={v => v && setInicio(v < hoje ? hoje : v)} /></div>
          </div>
          <div>
            <span className={rotulo}>Até</span>
            <div className="mt-1">{semFim
              ? <p className="flex h-11 items-center text-sm font-semibold text-[var(--pp-ink-muted)]">Sem término</p>
              : <DatePicker value={fim} onChange={v => v && setFim(v < inicio ? inicio : v)} />}</div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={semFim} onChange={e => setSemFim(e.target.checked)} className="h-5 w-5 accent-[var(--pp-foco)]" /> Sem data de término
        </label>

        <fieldset className="space-y-2">
          <legend className={rotulo}>Horário</legend>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={diaInteiro} onClick={() => setDiaInteiro(true)} className={`${tom("aco")} pp-pilula min-h-11 pl-3`}>Dia inteiro</button>
            <button type="button" aria-pressed={!diaInteiro} onClick={() => setDiaInteiro(false)} className={`${tom("aco")} pp-pilula min-h-11 pl-3`}>Só um horário</button>
          </div>
          {!diaInteiro && (
            <div className="grid grid-cols-2 gap-3">
              <CampoSelect label="Das" value={hIni} onChange={v => v && setHIni(v)} disabled={false} opcoes={HORAS} vazio="—" />
              <CampoSelect label="Às" value={hFim} onChange={v => v && setHFim(v)} disabled={false} opcoes={HORAS} vazio="—" />
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={rotulo}>Dias da semana <span className="font-semibold normal-case text-[var(--pp-ink-muted)]">(nenhum marcado = todos)</span></legend>
          <div className="flex flex-wrap gap-1.5">
            {DIAS_CURTOS.map((d, i) => (
              <button key={d} type="button" aria-pressed={dias.has(i)}
                onClick={() => setDias(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                className={`${tom("aco")} pp-pilula min-h-11 min-w-11 justify-center px-3`}>{d}</button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={rotulo}>Tipo</legend>
          <div className="flex flex-wrap gap-1.5">
            {TIPOS.map(t => (
              <button key={t.valor} type="button" aria-pressed={tipo === t.valor} onClick={() => setTipo(t.valor)} className={`${tom("cinza")} pp-pilula min-h-11 pl-3`}>{t.rotulo}</button>
            ))}
          </div>
        </fieldset>

        <div>
          <label className={rotulo} htmlFor="motivo-bloqueio">Motivo</label>
          <input id="motivo-bloqueio" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300}
            placeholder="Ex.: férias; reunião de equipe às quartas" className={`${campo} mt-1 h-11 w-full`} />
        </div>
      </div>
    </Drawer>
  )
}

export function PainelVerBloqueio({
  b, nomeProfissional, onFechar, onMudou,
}: {
  b: BloqueioGrade
  nomeProfissional: string
  onFechar: () => void
  onMudou: () => void
}) {
  const hoje = hojeBrasilia()
  const [motivo, setMotivo] = useState("")
  const [salvando, setSalvando] = useState(false)
  const jaComecou = b.data_inicio < hoje
  const jaTerminou = b.data_fim !== null && b.data_fim < hoje

  const remover = async () => {
    setSalvando(true)
    try {
      const r = await excluirBloqueio(b.id, motivo.trim())
      avisoFeito(r.modo === "excluido" ? "Bloqueio removido" : "Bloqueio encerrado ontem")
      onMudou()
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  const tipo = TIPOS.find(t => t.valor === b.tipo)?.rotulo ?? b.tipo
  return (
    <Drawer title={b.motivo} subtitle={`${tipo} · ${nomeProfissional}`} width={440} onClose={onFechar}
      footer={!jaTerminou && (
        <button type="button" onClick={remover} disabled={salvando || motivo.trim().length < 3} className={`${tom("vermelho")} pp-btn pp-btn-suave min-h-11`}>
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LockOpen className="h-4 w-4" aria-hidden />}
          {jaComecou ? "Encerrar ontem" : "Remover bloqueio"}
        </button>
      )}>
      <div className="pp space-y-4">
        <dl className="space-y-1.5 rounded-[18px] bg-[var(--pp-muted)] p-4 text-sm font-semibold">
          <div><dt className="inline text-[var(--pp-ink-muted)]">Período: </dt><dd className="inline">{dataBR(b.data_inicio)} {b.data_fim ? `a ${dataBR(b.data_fim)}` : "sem término"}</dd></div>
          <div><dt className="inline text-[var(--pp-ink-muted)]">Horário: </dt><dd className="inline">{b.hora_inicio ? `${horaCurta(b.hora_inicio)}–${horaCurta(b.hora_fim)}` : "dia inteiro"}</dd></div>
          {b.dias_semana && <div><dt className="inline text-[var(--pp-ink-muted)]">Dias: </dt><dd className="inline">{b.dias_semana.map(d => DIAS_CURTOS[d]).join(", ")}</dd></div>}
          <div><dt className="inline text-[var(--pp-ink-muted)]">Origem: </dt><dd className="inline">{b.origem === "tita_importacao" ? "Importado do TiTa" : `Criado na Grade${b.criado_por_nome ? ` por ${b.criado_por_nome}` : ""}`}</dd></div>
        </dl>
        {!jaTerminou && (
          <div>
            <label className={rotulo} htmlFor="motivo-remover">Motivo para remover (obrigatório)</label>
            <input id="motivo-remover" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} className={`${campo} mt-1 h-11 w-full`} />
            {jaComecou && <p className="mt-1 text-xs font-semibold text-[var(--pp-ink-muted)]">Já começou: os dias que passaram ficam como estão; o bloqueio termina ontem.</p>}
          </div>
        )}
      </div>
    </Drawer>
  )
}
