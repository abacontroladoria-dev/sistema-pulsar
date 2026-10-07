"use client"

import { useEffect, useMemo, useState } from "react"
import { buscarGrade } from "@/lib/grade/fonte"
import { calcularSugestoes } from "@/lib/cronograma/reposicao"
import type { AgendaPacienteSlot, SlotLivre } from "@/lib/cronograma/reposicao"
import type { SessaoAgendada, SessaoFaltada, SugestaoReposicao, ReposicaoAceiteEntry } from "@/types/reposicao"
import { B } from "@/lib/cronograma/constants"
import { AgendaComparacao } from "./AgendaComparacao"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIAS_PT: Record<string,string> = {
  'Segunda-feira':'Segunda','Terça-feira':'Terca',
  'Quarta-feira':'Quarta','Quinta-feira':'Quinta','Sexta-feira':'Sexta',
}
const normalizarDia = (d: string|null|undefined) => d ? (DIAS_PT[d] ?? d) : ''
const horaStr = (t: string|null|undefined) => String(t ?? '').slice(0,5)

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TerapiaOpcao {
  terapia:         string
  terapiaExibicao: string
}

interface Props {
  falta:            SessaoFaltada
  agendaPaciente:   AgendaPacienteSlot[]
  sessoesAgendadas: SessaoAgendada[]
  semanaInicio:     string
  semanaFim:        string
  aceite:           ReposicaoAceiteEntry | undefined
  onAceitar:        (faltaId: string, sugestao: SugestaoReposicao) => void
  onRecusar:        (faltaId: string) => void
  onDesfazer:       (faltaId: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BuscarReposicaoManual({
  falta,
  agendaPaciente,
  sessoesAgendadas,
  semanaInicio,
  semanaFim,
  aceite,
  onAceitar,
  onRecusar,
  onDesfazer,
}: Props) {
  const [aberto,         setAberto]         = useState(false)
  const [terapiaSel,     setTerapiaSel]     = useState<TerapiaOpcao | null>(null)
  const [buscandoSlots,  setBuscandoSlots]  = useState(false)
  const [sugestoes,      setSugestoes]      = useState<SugestaoReposicao[] | null>(null)
  const [semDisp,        setSemDisp]        = useState(false)
  const [erro,           setErro]           = useState<string | null>(null)

  // ── Terapias derivadas das sessões do paciente (primário, sem query) ──────
  const terapiasDoPaciente = useMemo<TerapiaOpcao[]>(() => {
    const seen = new Set<string>()
    return sessoesAgendadas
      .filter(s => { if (!s.terapia || seen.has(s.terapia)) return false; seen.add(s.terapia); return true })
      .map(s => ({ terapia: s.terapia, terapiaExibicao: s.terapiaExibicao || s.terapia }))
      .sort((a, b) => a.terapiaExibicao.localeCompare(b.terapiaExibicao, 'pt-BR'))
  }, [sessoesAgendadas])

  // ── Terapias via query (fallback quando sessoesAgendadas vazio) ────────────
  const [terapiasFallback, setTerapiasFallback] = useState<TerapiaOpcao[]>([])
  const [carregandoFallback, setCarregandoFallback] = useState(false)

  useEffect(() => {
    // Só carrega o fallback se: painel aberto + paciente sem sessões identificadas
    if (!aberto || terapiasDoPaciente.length > 0 || terapiasFallback.length > 0) return

    setCarregandoFallback(true)

    // Busca terapias com slot disponível na semana (paciente_nome null = vago).
    // Fonte "base": slot 'Livre' não é atendimento e não existe em
    // vw_grade_atendimentos. A view já garante `ativo`, que aqui não é só
    // deduplicação — quando um slot livre é ocupado no TiTa ele deixa de vir no
    // CSV como 'Livre' e o sync o marca com ativo=false, ou seja, ativo=false num
    // slot 'Livre' significa exatamente "não está mais vago". Sem isso a tela
    // ofereceria horário já tomado.
    buscarGrade<{ terapia_nome: string | null; terapia_exibicao_nome: string | null }>({
      campos: 'terapia_nome, terapia_exibicao_nome',
      fonte: 'base',
      status: 'Livre',
      ate: semanaFim,
      refinar: q => q.gt('data', falta.dataOriginal),
    }).then(data => {
      const seen = new Set<string>()
      setTerapiasFallback(
        data
          .filter(r => { if (!r.terapia_nome || seen.has(r.terapia_nome)) return false; seen.add(r.terapia_nome); return true })
          .map((r): TerapiaOpcao => ({ terapia: r.terapia_nome as string, terapiaExibicao: r.terapia_exibicao_nome ?? (r.terapia_nome as string) }))
          .sort((a: TerapiaOpcao, b: TerapiaOpcao) => a.terapiaExibicao.localeCompare(b.terapiaExibicao, 'pt-BR'))
      )
      setCarregandoFallback(false)
    }).catch(() => setCarregandoFallback(false))
  }, [aberto, terapiasDoPaciente.length, terapiasFallback.length, falta.dataOriginal, semanaFim])

  const terapiasVisiveis = terapiasDoPaciente.length > 0 ? terapiasDoPaciente : terapiasFallback
  const usandoFallback   = terapiasDoPaciente.length === 0

  // ── Busca de slots para a terapia selecionada ─────────────────────────────
  async function selecionarTerapia(opcao: TerapiaOpcao) {
    if (terapiaSel?.terapia === opcao.terapia && sugestoes !== null) return
    setTerapiaSel(opcao)
    setSugestoes(null)
    setSemDisp(false)
    setErro(null)
    setBuscandoSlots(true)

    let slotsRaw: Record<string, string | null>[]
    try {
      slotsRaw = await buscarGrade<Record<string, string | null>>({
        campos: 'profissional_nome, terapia_nome, terapia_exibicao_nome, hora_inicial, data, dia_semana, sala_nome',
        fonte: 'base',
        status: 'Livre',   // slot sem paciente = disponível; e ainda vago — ver nota no fallback acima
        ate: semanaFim,
        refinar: q => q.eq('terapia_nome', opcao.terapia).gt('data', falta.dataOriginal),
      })
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e)); setBuscandoSlots(false); return
    }

    const slots: SlotLivre[] = slotsRaw.map((r: any): SlotLivre => ({
      profissional:    r.profissional_nome     ?? '',
      terapia:         r.terapia_nome          ?? '',
      terapiaExibicao: r.terapia_exibicao_nome ?? '',
      data:            r.data                  ?? '',
      dia:             normalizarDia(r.dia_semana),
      hora:            horaStr(r.hora_inicial),
      unidade:         r.sala_nome             ?? '',
    }))

    const faltaComTerapia: SessaoFaltada = {
      ...falta,
      terapia:         opcao.terapia,
      terapiaExibicao: opcao.terapiaExibicao,
      semJoin:         false,
    }

    const resultado = calcularSugestoes([faltaComTerapia], slots, agendaPaciente)
    const r = resultado[0]

    if (r?.status === 'com_sugestao') {
      setSugestoes(r.sugestoes)
    } else {
      setSugestoes([])
      setSemDisp(true)
    }

    setBuscandoSlots(false)
  }

  // ── Fechado: botão de acesso ──────────────────────────────────────────────
  if (!aberto) {
    return (
      <div style={{ borderTop: '1px solid #f1f5f9', padding: '10px 14px' }}>
        <button
          onClick={() => setAberto(true)}
          style={{
            fontSize: 12, fontWeight: 600,
            color: '#2A92C0', background: '#eaf5fb',
            border: '1px solid #b6dff0',
            borderRadius: 8, padding: '6px 14px',
            cursor: 'pointer',
          }}
        >
          Buscar reposição
        </button>
      </div>
    )
  }

  // ── Aberto ────────────────────────────────────────────────────────────────
  return (
    <div style={{ borderTop: '1px solid #f1f5f9' }}>
      <div style={{ padding: '12px 14px 10px' }}>

        {/* Label contextual */}
        <div style={{
          fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.07em',
          color: 'var(--muted-foreground)', marginBottom: 8,
        }}>
          {usandoFallback
            ? 'Terapias com slots livres esta semana'
            : 'Terapias do paciente — selecione a que faltou'}
        </div>

        {/* Pills de terapia */}
        {carregandoFallback ? (
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            Buscando terapias disponíveis…
          </p>
        ) : terapiasVisiveis.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
            Nenhum slot livre nos dias restantes desta semana.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {terapiasVisiveis.map(t => {
              const sel = terapiaSel?.terapia === t.terapia
              return (
                <button
                  key={t.terapia}
                  onClick={() => selecionarTerapia(t)}
                  disabled={buscandoSlots}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '999px',
                    border: sel ? `1.5px solid ${B.blue}` : '1.5px solid var(--border)',
                    background: sel ? B.blueLt : 'var(--card)',
                    color: sel ? B.blue : 'var(--foreground)',
                    fontSize: 12, fontWeight: sel ? 700 : 500,
                    cursor: buscandoSlots ? 'not-allowed' : 'pointer',
                    opacity: buscandoSlots && !sel ? 0.5 : 1,
                    transition: 'all 0.12s',
                  }}
                >
                  {t.terapiaExibicao}
                </button>
              )
            })}
          </div>
        )}

        {/* Estados de busca */}
        {buscandoSlots && (
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
            Buscando slots disponíveis…
          </p>
        )}
        {erro && (
          <p style={{ marginTop: 8, fontSize: 12, color: '#E3734F' }}>{erro}</p>
        )}
        {semDisp && terapiaSel && !buscandoSlots && (
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
            Nenhum slot livre para <strong>{terapiaSel.terapiaExibicao}</strong> nos dias restantes.
          </p>
        )}
      </div>

      {/* Agenda visual quando há sugestões */}
      {sugestoes && sugestoes.length > 0 && terapiaSel && (
        <AgendaComparacao
          falta={{ ...falta, terapia: terapiaSel.terapia, terapiaExibicao: terapiaSel.terapiaExibicao, semJoin: false }}
          sugestoes={sugestoes}
          sessoesAgendadas={sessoesAgendadas}
          aceite={aceite}
          onAceitar={onAceitar}
          onRecusar={onRecusar}
          onDesfazer={onDesfazer}
        />
      )}
    </div>
  )
}
