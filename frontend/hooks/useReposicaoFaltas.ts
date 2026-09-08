'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { buscarGrade } from '@/lib/grade/fonte'
import { calcularSugestoes, TERAPIA_APLICADOR_SUBSTITUTO, TERAPIA_COORDENADOR_DE_CASO } from '@/lib/cronograma/reposicao'
import type { AgendaPacienteSlot, SlotLivre } from '@/lib/cronograma/reposicao'
import type { ResultadoReposicao, SessaoAgendada, SessaoConcluida, SessaoFaltada, SessaoPresente } from '@/types/reposicao'
import { EXIB_NOME } from '@/lib/cronograma/constants'

// ─── Helpers de data ──────────────────────────────────────────────────────────

const DIAS_PT: Record<string, string> = {
  'Segunda-feira': 'Segunda',
  'Terça-feira':   'Terca',
  'Quarta-feira':  'Quarta',
  'Quinta-feira':  'Quinta',
  'Sexta-feira':   'Sexta',
}

function normalizarDia(dia: string | null | undefined): string {
  if (!dia) return ''
  return DIAS_PT[dia] ?? dia
}

function horaStr(t: string | null | undefined): string {
  return String(t ?? '').slice(0, 5)
}

function fimSemana(inicio: string): string {
  const d = new Date(`${inicio}T12:00:00`)
  d.setDate(d.getDate() + 4) // segunda → sexta
  return d.toISOString().slice(0, 10)
}

// Deriva o nome do dia a partir de uma data ISO ("2026-06-30" → "Terca").
// Necessário para FALTA/CONCLUÍDO: csv_grades_profissionais só cobre "hoje em diante"
// (sync-grade-csv-daily), então uma sessão de data já passada nunca tem linha lá.
function diaDaSemana(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`)
  const map: Record<number, string> = { 1: 'Segunda', 2: 'Terca', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta' }
  return map[d.getDay()] ?? ''
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useReposicaoFaltas(
  pacienteId:   string | null,
  pacienteNome: string | null,
  semanaInicio: string,           // ISO date "YYYY-MM-DD" (segunda-feira)
) {
  const [resultados,       setResultados]       = useState<ResultadoReposicao[]>([])
  const [sessoesSemana,    setSessoesSemana]    = useState<SessaoPresente[]>([])
  const [agendaPaciente,   setAgendaPaciente]   = useState<AgendaPacienteSlot[]>([])
  const [sessoesAgendadas, setSessoesAgendadas] = useState<SessaoAgendada[]>([])
  const [sessoesConcluidas, setSessoesConcluidas] = useState<SessaoConcluida[]>([])
  const [loading,          setLoading]          = useState(false)
  const [error,            setError]            = useState<string | null>(null)

  const semanaFim = useMemo(() => fimSemana(semanaInicio), [semanaInicio])

  useEffect(() => {
    if (!pacienteId || !pacienteNome) {
      setResultados([])
      setSessoesSemana([])
      setAgendaPaciente([])
      setSessoesAgendadas([])
      setSessoesConcluidas([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function carregar() {
      const sb = getSupabaseClient()

      // ── Q1, Q2 e Q_REPOSICAO em paralelo: faltas brutas, agenda do paciente e o
      // snapshot da semana em csv_reposicao_faltas ────────────────────────────
      // Nenhuma das tabelas relacionadas tem FK declarada no schema, portanto
      // nenhum join PostgREST é usado — tudo é cruzado por data+hora abaixo.
      const [r1, gradeSemana, r3] = await Promise.all([
        sb
          .from('fila_autorizacoes')
          .select('id, paciente_id, paciente_nome, data_atendimento, horario, status, tipo_falta, tita_agendamento_id, terapia_nome, terapia_exibicao_id, justificativa_falta, falta_revertida_em')
          // 'glosa' conta como comparecimento (convênio negou/questionou o pagamento
          // depois, não afeta se a sessão ocorreu) — sem isso, essas linhas ficavam de
          // fora tanto de FALTA quanto de CONCLUÍDO, e a sessão (já no passado) caía no
          // reforço de "futuro" por não ter nenhum card mais específico cobrindo-a.
          .in('status', ['falta', 'concluido', 'glosa'])
          .eq('paciente_id', pacienteId)
          .gte('data_atendimento', semanaInicio)
          .lte('data_atendimento', semanaFim),

        // Fonte "base" sem recorte de unidade: preserva o alcance que esta
        // consulta sempre teve. O filtro é por nome do paciente, então slot
        // 'Livre' (paciente_nome nulo) nunca casa de qualquer forma.
        buscarGrade<Record<string, string | null>>({
          campos: 'data, dia_semana, hora_inicial, sala_nome, terapia_nome, terapia_exibicao_nome, profissional_nome',
          fonte: 'base',
          de: semanaInicio,
          ate: semanaFim,
          refinar: q => q.ilike('paciente_nome', pacienteNome ?? ''),
        }),

        // csv_reposicao_faltas: snapshot diário da grade INTEIRA da clínica (todo mundo,
        // qualquer status), gerado especificamente para este módulo. Ao contrário da
        // grade sincronizada (só "hoje em diante"), essa tabela cobre a semana
        // corrente inteira — inclusive dias já passados — então é a única fonte que tem
        // a linha original de uma FALTA (profissional/sala de antes de faltar).
        sb
          .from('csv_reposicao_faltas')
          .select('data, hora_inicial, sala_nome, terapia_nome, terapia_exibicao_nome, profissional_nome, status_agendamento')
          .ilike('paciente_nome', pacienteNome ?? '')
          .gte('data', semanaInicio)
          .lte('data', semanaFim),
      ])

      // buscarGrade lança em vez de devolver { error }; quem trata é o
      // carregar().catch(...) no fim deste efeito, que já faz setError + setLoading.
      if (r1.error || r3.error || cancelled) {
        if (!cancelled) setError((r1.error ?? r3.error)?.message ?? 'Erro ao carregar dados')
        if (!cancelled) setLoading(false)
        return
      }

      // Lookup data|hora → linha original da grade (antes da falta), casado por
      // paciente_nome+data+hora — não depende de tita_agendamento_id nem de
      // controle_terapeutico, então cobre inclusive faltas sem CT vinculado.
      const origemPorDataHora: Record<string, { profissional_nome: string; sala_nome: string; terapia_nome: string; terapia_exibicao_nome: string }> = {}
      ;(r3.data ?? []).forEach((r: any) => {
        const k = `${r.data ?? ''}|${horaStr(r.hora_inicial)}`
        if (!origemPorDataHora[k]) {
          origemPorDataHora[k] = {
            profissional_nome: r.profissional_nome ?? '',
            sala_nome: r.sala_nome ?? '',
            terapia_nome: r.terapia_nome ?? '',
            terapia_exibicao_nome: r.terapia_exibicao_nome ?? '',
          }
        }
      })

      // ── Separa faltas x concluídos (Q1 agora traz os dois status) ────────
      // falta_revertida_em é um campo específico de falta e é aplicado aqui
      // (client-side) em vez de no filtro da query, pois não deve afetar
      // linhas 'concluido'.
      // tipo_falta 'unidade' fica de fora: feriado, ponto facultativo e falta de
      // energia são dias em que a clínica não abriu. Não há falta de ninguém a
      // repor, e tratá-los como pendência encheria a reposição de trabalho
      // inexistente. Filtrado aqui junto de falta_revertida_em (e não na query)
      // pelo mesmo motivo: não pode afetar as linhas 'concluido'/'glosa'.
      const r1Faltas     = (r1.data ?? []).filter((r: any) => r.status === 'falta' && !r.falta_revertida_em && r.tipo_falta !== 'unidade')
      // 'glosa' é tratada como concluído (ver comentário na query de r1 acima) —
      // mesmo card, só com rótulo diferente (SessaoConcluida.glosa).
      const r1Concluidos = (r1.data ?? []).filter((r: any) => r.status === 'concluido' || r.status === 'glosa')

      // ── Q_CT: busca controle_terapeutico pelos tita_agendamento_id ────────
      // Inclui faltas e concluídos — CT é usado aqui só como fonte de enriquecimento
      // (profissional/terapia vinculados ao agendamento), não como filtro de
      // elegibilidade. Por isso não restringe por status='indisponivel': mesmo um
      // CT com status='disponivel' ainda diz quem era o profissional daquele slot.
      const titaIds = [...r1Faltas, ...r1Concluidos]
        .map((r: any) => r.tita_agendamento_id)
        .filter(Boolean)

      let ctMap: Record<string, any> = {}

      if (titaIds.length > 0) {
        const { data: ctData, error: ctError } = await sb
          .from('controle_terapeutico')
          .select('tita_agendamento_id, status, profissional_id, profissional_nome, terapia_nome')
          .in('tita_agendamento_id', titaIds)

        if (ctError || cancelled) {
          if (!cancelled) setError(ctError?.message ?? 'Erro ao carregar controle terapêutico')
          if (!cancelled) setLoading(false)
          return
        }

        ctMap = Object.fromEntries(
          (ctData ?? []).map((ct: any) => [String(ct.tita_agendamento_id), ct])
        )
      }

      if (cancelled) return

      // ── Monta SessaoFaltada[] ─────────────────────────────────────────────
      // csv_grades_profissionais é cruzado por data + hora (Q2 já trouxe esses dados).
      const csvRows = gradeSemana

      // csv_grades_profissionais nunca tem a linha de uma FALTA (só cobre "hoje em
      // diante" — ver sync-grade-csv-daily), mas csv_reposicao_faltas (origemPorDataHora)
      // cobre a semana inteira e tem a linha original de antes da falta acontecer.
      // Todas as faltas (status='falta', não canceladas/revertidas) são elegíveis para
      // reposição, independente do motivo (indisponibilidade do profissional ou não
      // comparecimento do paciente).
      const faltas: SessaoFaltada[] = r1Faltas
        .map((r: any) => {
          const ct  = r.tita_agendamento_id ? ctMap[String(r.tita_agendamento_id)] ?? null : null
          const hora = horaStr(r.horario)
          const origem = origemPorDataHora[`${r.data_atendimento ?? ''}|${hora}`] ?? null

          // Profissional: origem (linha real de antes da falta) → CT
          const profissional = origem?.profissional_nome || ct?.profissional_nome || ''

          // Terapia: origem → CT → fila
          const terapia = origem?.terapia_nome || ct?.terapia_nome || r.terapia_nome || ''

          // Exibição: EXIB_NOME (IDs especiais ABA) > origem > CT > fila
          const exibNome        = r.terapia_exibicao_id ? (EXIB_NOME[Number(r.terapia_exibicao_id)] ?? '') : ''
          const terapiaExibicao = exibNome || origem?.terapia_exibicao_nome || origem?.terapia_nome || ct?.terapia_nome || r.terapia_nome || ''

          const dia = diaDaSemana(r.data_atendimento)

          // unidade: origem (única fonte confiável de sala para uma FALTA — CT não tem
          // coluna de sala). Fica em branco só quando csv_reposicao_faltas também não
          // tiver a linha (dado fora da cobertura da semana, caso raro).
          const unidade = origem?.sala_nome || ''

          // semJoin apenas se nenhuma fonte forneceu a terapia
          const semJoin = !terapia

          return {
            faltaId:         r.id,
            pacienteId:      r.paciente_id,
            paciente:        r.paciente_nome ?? '',
            profissional,
            profissionalId:  ct?.profissional_id ?? null,
            terapia,
            terapiaExibicao,
            dia,
            hora,
            unidade,
            dataOriginal:    r.data_atendimento ?? '',
            justificativa:   r.justificativa_falta ?? null,
            origemFalta:     r.tipo_falta ?? '',
            semJoin,
          } satisfies SessaoFaltada
        })

      // ── Monta AgendaPacienteSlot[] (para algoritmo) ──────────────────────
      // Inclui tanto a grade futura (csv) quanto sessões já concluídas (fila),
      // para que o algoritmo de reposição nunca sugira um slot que colide com
      // um atendimento que o paciente já realizou naquela data+hora.
      const agendaFromCsv: AgendaPacienteSlot[] = csvRows.map((r: any) => ({
        data:    r.data ?? '',
        dia:     normalizarDia(r.dia_semana),
        hora:    horaStr(r.hora_inicial),
        unidade: r.sala_nome ?? '',
      }))

      // fila_autorizacoes não tem sala_nome; recupera por lookup em csvRows
      // (data+hora), mesmo padrão usado para profByHora mais abaixo.
      const salaByDataHora: Record<string, string> = {}
      csvRows.forEach((r: any) => {
        const k = `${r.data ?? ''}|${horaStr(r.hora_inicial)}`
        if (!salaByDataHora[k] && r.sala_nome) salaByDataHora[k] = r.sala_nome
      })

      const agendaFromConcluidos: AgendaPacienteSlot[] = r1Concluidos.map((r: any) => {
        const hora = horaStr(r.horario)
        const k = `${r.data_atendimento ?? ''}|${hora}`
        return {
          data:    r.data_atendimento ?? '',
          dia:     diaDaSemana(r.data_atendimento ?? ''),
          hora,
          unidade: salaByDataHora[k] ?? '',
        }
      })

      // Faltas do próprio paciente também ocupam a agenda: em produção, o slot original
      // de uma falta continua "Agendado" (não liberado) até a reposição ser decidida —
      // então uma sugestão para OUTRA falta não pode cair em cima dele. Sem isso, o
      // algoritmo já sugeriu mover uma falta para o data+hora exato de outra falta do
      // mesmo paciente ainda não resolvida (conflito real, paciente não pode estar em
      // dois lugares na mesma hora).
      const agendaFromFaltas: AgendaPacienteSlot[] = r1Faltas.map((r: any) => {
        const hora = horaStr(r.horario)
        const origem = origemPorDataHora[`${r.data_atendimento ?? ''}|${hora}`] ?? null
        return {
          data:    r.data_atendimento ?? '',
          dia:     diaDaSemana(r.data_atendimento ?? ''),
          hora,
          unidade: origem?.sala_nome ?? '',
        }
      })

      const csvKeySet = new Set(agendaFromCsv.map(s => `${s.data}|${s.hora}`))
      const agendaPaciente: AgendaPacienteSlot[] = [
        ...agendaFromCsv,
        ...agendaFromConcluidos.filter(s => !csvKeySet.has(`${s.data}|${s.hora}`)),
      ]
      const agendaKeySet = new Set(agendaPaciente.map(s => `${s.data}|${s.hora}`))
      agendaFromFaltas.forEach(s => {
        const k = `${s.data}|${s.hora}`
        if (!agendaKeySet.has(k)) {
          agendaKeySet.add(k)
          agendaPaciente.push(s)
        }
      })

      // ── filaKeySet: slots que a automação já processou (falta ou concluído) ─
      // Usado para excluir da grade "futuro" qualquer linha do csv que já tenha
      // um card mais específico (falta/concluído) no mesmo data+hora.
      const filaKeySet = new Set(
        [...r1Faltas, ...r1Concluidos].map((r: any) => `${r.data_atendimento ?? ''}|${horaStr(r.horario)}`)
      )

      // ── Reforço de "futuro" via csv_reposicao_faltas ─────────────────────
      // csv_grades_profissionais pode ter buracos de sincronização pontuais (ex.: um
      // dia sincronizado só até certo horário, faltando o resto — confirmado em
      // produção: zero linhas de QUALQUER paciente em alguns horários do próprio dia
      // corrente). csv_reposicao_faltas cobre a semana inteira e tem
      // status_agendamento, então preenche essas lacunas sem duplicar o que
      // csv_grades_profissionais já trouxe nem o que já virou falta/concluído.
      const agendadosReforco = (r3.data ?? []).filter((r: any) => {
        const k = `${r.data ?? ''}|${horaStr(r.hora_inicial)}`
        return r.status_agendamento === 'Agendado' && !csvKeySet.has(k) && !filaKeySet.has(k)
      })
      agendadosReforco.forEach((r: any) => {
        const k = `${r.data ?? ''}|${horaStr(r.hora_inicial)}`
        if (!agendaKeySet.has(k)) {
          agendaKeySet.add(k)
          agendaPaciente.push({
            data:    r.data ?? '',
            dia:     diaDaSemana(r.data ?? ''),
            hora:    horaStr(r.hora_inicial),
            unidade: r.sala_nome ?? '',
          })
        }
      })

      // ── Monta SessaoConcluida[] (para visualização do status CONCLUÍDO) ──
      const sessoesConcluidas: SessaoConcluida[] = r1Concluidos.map((r: any) => {
        const ct = r.tita_agendamento_id ? ctMap[String(r.tita_agendamento_id)] ?? null : null
        const hora = horaStr(r.horario)
        const csv = csvRows.find(
          (c: any) => c.data === r.data_atendimento && horaStr(c.hora_inicial) === hora,
        ) ?? null
        const origem = origemPorDataHora[`${r.data_atendimento ?? ''}|${hora}`] ?? null
        return {
          data:            r.data_atendimento ?? '',
          dia:             normalizarDia(csv?.dia_semana) || diaDaSemana(r.data_atendimento ?? ''),
          hora,
          unidade:         csv?.sala_nome || origem?.sala_nome || '',
          // Terapia de ação: a mesma fonte usada para decidir elegibilidade de reposição
          // (ex.: regra de Coordenador de Caso) — csv/origem/CT/fila, sem preferir exibição.
          terapia:         csv?.terapia_nome || origem?.terapia_nome || ct?.terapia_nome || r.terapia_nome || '',
          terapiaExibicao: csv?.terapia_exibicao_nome || origem?.terapia_exibicao_nome || origem?.terapia_nome || ct?.terapia_nome || r.terapia_nome || '',
          // Profissional: CT (independente de status) → csv → origem
          profissional:    ct?.profissional_nome || csv?.profissional_nome || origem?.profissional_nome || '',
          glosa:           r.status === 'glosa',
        }
      })

      // ── Monta SessaoAgendada[] (para visualização) ────────────────────────
      // Inclui o reforço de csv_reposicao_faltas (agendadosReforco) — sessões futuras
      // reais que csv_grades_profissionais não capturou por buraco de sincronização.
      const sessoesAgendadas: SessaoAgendada[] = [
        ...csvRows.map((r: any) => ({
          data:            r.data                   ?? '',
          dia:             normalizarDia(r.dia_semana),
          hora:            horaStr(r.hora_inicial),
          unidade:         r.sala_nome              ?? '',
          terapia:         r.terapia_nome           ?? '',
          terapiaExibicao: r.terapia_exibicao_nome  ?? r.terapia_nome ?? '',
          profissional:    r.profissional_nome       ?? '',
        })),
        ...agendadosReforco.map((r: any) => ({
          data:            r.data                   ?? '',
          dia:             diaDaSemana(r.data ?? ''),
          hora:            horaStr(r.hora_inicial),
          unidade:         r.sala_nome              ?? '',
          terapia:         r.terapia_nome           ?? '',
          terapiaExibicao: r.terapia_exibicao_nome  ?? r.terapia_nome ?? '',
          profissional:    r.profissional_nome       ?? '',
        })),
      ]

      // ── Query 3: slots livres por terapia (inclui P1 e P2) ───────────────
      // Usa todas as faltas com terapia conhecida (CT ou fallback CSV)
      const faltasComTerapia = faltas.filter(f => !f.semJoin)
      const terapiasSet = new Set(faltasComTerapia.map(f => f.terapia))
      // Coordenador de Caso repõe com Aplicador ABA (PS) como substituto (ver
      // terapiaElegivel em lib/cronograma/reposicao.ts) — busca essas vagas também,
      // mesmo que nenhuma falta da semana seja literalmente dessa terapia.
      if (terapiasSet.has(TERAPIA_COORDENADOR_DE_CASO)) {
        terapiasSet.add(TERAPIA_APLICADOR_SUBSTITUTO)
      }
      const terapias = [...terapiasSet]

      let slotsLivres: SlotLivre[] = []

      if (terapias.length > 0) {
        // Usa vw_reposicao_faltas: view criada especificamente para este módulo,
        // expõe slots Livre da semana corrente (csv_grades_profissionais filtra semana futura).
        // Filtra por terapia_nome — slots Livre têm terapia_exibicao_nome = "Ainda não selecionado".
        const { data: slotsRaw, error: e3 } = await sb
          .from('vw_reposicao_faltas')
          .select('profissional_nome, terapia_nome, terapia_exibicao_nome, hora_inicial, data, dia_semana, sala_nome')
          .in('terapia_nome', terapias)
          .eq('status_agendamento', 'Livre')
          .gte('data', semanaInicio)
          .lte('data', semanaFim)

        if (e3 || cancelled) {
          if (!cancelled) setError(e3?.message ?? 'Erro ao carregar slots livres')
          if (!cancelled) setLoading(false)
          return
        }

        if (cancelled) return

        // slot.terapia usa terapia_nome para casar com falta.terapia
        // (ambos vêm de fila_autorizacoes.terapia_nome e csv.terapia_nome — mesma convenção).
        // terapiaExibicao usa terapia_exibicao_nome quando disponível, senão cai em terapia_nome
        // (slots Livre têm terapia_exibicao_nome = "Ainda não selecionado").
        slotsLivres = (slotsRaw ?? []).map((r: any): SlotLivre => {
          const exibOk = r.terapia_exibicao_nome && r.terapia_exibicao_nome !== 'Ainda não selecionado'
          return {
            profissional:    r.profissional_nome ?? '',
            terapia:         r.terapia_nome      ?? '',
            terapiaExibicao: exibOk ? r.terapia_exibicao_nome : r.terapia_nome ?? '',
            data:            r.data              ?? '',
            dia:             normalizarDia(r.dia_semana),
            hora:            horaStr(r.hora_inicial),
            unidade:         r.sala_nome         ?? '',
          }
        })
      }

      // Profissional/unidade de uma FALTA já vêm de origem (csv_reposicao_faltas) → CT,
      // fontes confiáveis por serem a linha real da própria sessão. Não há mais um
      // enriquecimento por "slot livre" (Q3) aqui de propósito: um slot livre no mesmo
      // data+hora+terapia pode pertencer a outro profissional/sala completamente
      // diferentes (foi exatamente esse tipo de adivinhação — vaga de outra pessoa
      // sendo atribuída à falta — que gerou o card com unidade errada em produção).
      const faltasEnriquecidas = faltas

      // ── Sessões futuras (status FUTURO): csv sem card mais específico ────
      // Exclui linhas já cobertas por um card de falta ou concluído no mesmo
      // data+hora, para não duplicar a sessão na grade. Inclui o mesmo reforço de
      // csv_reposicao_faltas usado em sessoesAgendadas (já vem sem duplicar/sem
      // sobrepor falta ou concluído — ver agendadosReforco).
      const presentes: SessaoPresente[] = [
        ...csvRows
          .filter((r: any) => !filaKeySet.has(`${r.data ?? ''}|${horaStr(r.hora_inicial)}`))
          .map((r: any) => ({
            data:            r.data            ?? '',
            dia:             normalizarDia(r.dia_semana),
            hora:            horaStr(r.hora_inicial),
            unidade:         r.sala_nome       ?? '',
            terapiaExibicao: r.terapia_exibicao_nome ?? '',
          })),
        ...agendadosReforco.map((r: any) => ({
          data:            r.data            ?? '',
          dia:             diaDaSemana(r.data ?? ''),
          hora:            horaStr(r.hora_inicial),
          unidade:         r.sala_nome       ?? '',
          terapiaExibicao: r.terapia_exibicao_nome ?? '',
        })),
      ]


      // ── Executa algoritmo ─────────────────────────────────────────────────
      // Dias em que o paciente teve ao menos uma sessão concluída — habilita
      // reposição no MESMO dia da falta nesses casos (ver calcularSugestoes).
      const diasComPresenca = new Set(sessoesConcluidas.map(s => s.data))
      const resultado = calcularSugestoes(faltasEnriquecidas, slotsLivres, agendaPaciente, diasComPresenca)

      if (!cancelled) {
        setResultados(resultado)
        setSessoesSemana(presentes)
        setAgendaPaciente(agendaPaciente)
        setSessoesAgendadas(sessoesAgendadas)
        setSessoesConcluidas(sessoesConcluidas)
        setLoading(false)
      }
    }

    carregar().catch(err => {
      if (!cancelled) {
        setError(err?.message ?? 'Erro inesperado')
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [pacienteId, pacienteNome, semanaInicio])

  return { resultados, sessoesSemana, agendaPaciente, sessoesAgendadas, sessoesConcluidas, semanaFim, loading, error }
}
