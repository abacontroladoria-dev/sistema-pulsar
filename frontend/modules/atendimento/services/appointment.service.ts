import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  PaginatedResult,
  VagaDisponivel,
} from '../types/central.types'
import type {
  AppointmentRepository,
  ListAppointmentsInput,
} from '../repositories/appointment.repository'
import { PG_UNIQUE_VIOLATION } from '../repositories/appointment.repository'
import type { AvailabilityRepository } from '../repositories/availability.repository'
import type { AuditRepository } from '../repositories/audit.repository'
import {
  AppointmentNotFoundError,
  SlotAlreadyBookedError,
  SlotInPastError,
  SlotNotInGradeError,
} from '../types/errors.types'

// ============================================================================
// AppointmentService
//
// Orquestra os agendamentos da Central e é a ÚNICA porta de reserva de vaga —
// tanto a página de Agendamentos quanto as ferramentas do agente de WhatsApp
// passam por aqui. Se uma regra existir só em um dos dois caminhos, as duas
// superfícies vão divergir.
//
// Regras:
//   1. Reservar vaga de grade exige que a vaga exista como 'Livre' e esteja
//      livre agora. A checagem é prévia (mensagem boa) E o índice único é a
//      garantia real (corrida entre duas reservas simultâneas).
//   2. org mismatch retorna AppointmentNotFoundError — nunca vaza existência
//      cross-org (mesma política de ContactService).
//   3. Cancelar é UPDATE de status, nunca DELETE: devolve a vaga e preserva
//      o histórico.
//   4. audit.insert() é fire-and-forget (void) — falha não bloqueia o fluxo.
// ============================================================================

export interface AgendarVagaInput {
  // Identidade da vaga na grade do TiTa
  profissionalId:   number
  data:             string          // 'YYYY-MM-DD'
  hora:             string          // 'HH:MM' ou 'HH:MM:SS'
  // Contexto do agendamento
  titulo?:          string
  descricao?:       string | null
  tipo?:            AppointmentType
  duracao?:         number | null
  contactId?:       string | null
  conversationId?:  string | null
  titaPacienteId?:  number | null
  participantes?:   string[] | null
  // true quando a reserva vem do agente de IA, não de um operador humano
  criadoPorIa?:     boolean
}

export interface AgendamentoAdministrativoInput {
  titulo:           string
  data:             string
  hora?:            string | null
  duracao?:         number | null
  tipo?:            AppointmentType
  descricao?:       string | null
  contactId?:       string | null
  conversationId?:  string | null
  participantes?:   string[] | null
  criadoPorIa?:     boolean
}

export interface AtualizarAgendamentoInput {
  titulo?:        string
  descricao?:     string | null
  data?:          string
  hora?:          string | null
  duracao?:       number | null
  tipo?:          AppointmentType
  status?:        AppointmentStatus
  participantes?: string[] | null
  titaSessionId?: number | null
}

export class AppointmentService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly availability: AvailabilityRepository,
    private readonly audit:        AuditRepository,
  ) {}

  // --------------------------------------------------------------------------
  // Consulta
  // --------------------------------------------------------------------------

  async list(params: ListAppointmentsInput): Promise<PaginatedResult<Appointment>> {
    return this.appointments.list(params)
  }

  async getById(orgId: string, id: string): Promise<Appointment> {
    const appointment = await this.appointments.findById(id)
    if (!appointment || appointment.organization_id !== orgId) {
      throw new AppointmentNotFoundError(id)
    }
    return appointment
  }

  async listarVagas(input: Parameters<AvailabilityRepository['listarVagas']>[0] = {}): Promise<VagaDisponivel[]> {
    return this.availability.listarVagas(input)
  }

  async listarTerapiasComVaga(dataInicio?: string | null, dataFim?: string | null) {
    return this.availability.listarTerapiasComVaga(dataInicio, dataFim)
  }

  // Os nomes CRUS de especialidade com vaga, para o agente traduzir pelo
  // catálogo (agente/terapia.ts). Não agrega por terapia_id porque o id não
  // identifica a terapia — 2317 aparece com sete terapia_nome diferentes.
  async listarNomesDeTerapiaComVaga(dataInicio?: string | null, dataFim?: string | null) {
    return this.availability.listarNomesDeTerapiaComVaga(dataInicio, dataFim)
  }

  // --------------------------------------------------------------------------
  // Reserva de vaga de grade
  //
  // Este é o caminho que consome disponibilidade real. Ele resolve os dados do
  // profissional/terapia/sala a partir da própria grade em vez de aceitá-los do
  // chamador: se o cliente pudesse enviar profissional_nome livremente, o
  // agendamento passaria a afirmar coisas que a grade não confirma.
  // --------------------------------------------------------------------------

  async agendarVaga(orgId: string, input: AgendarVagaInput, actorId: string | null): Promise<Appointment> {
    const hora = normalizarHora(input.hora)

    const diagnostico = await this.availability.diagnosticarVaga(input.profissionalId, input.data, hora)

    // A ordem importa: "no passado" é a recusa mais informativa das três, e uma
    // vaga passada também deixa de aparecer na grade filtrada.
    if (diagnostico.no_passado)       throw new SlotInPastError(input.data, hora)
    if (!diagnostico.existe_na_grade) throw new SlotNotInGradeError(input.profissionalId, input.data, hora)
    if (diagnostico.ja_reservada)     throw new SlotAlreadyBookedError(input.profissionalId, input.data, hora)

    // Busca a vaga na grade para copiar os dados que descrevem o slot.
    // Filtra por profissional e pela data exata, e casa a hora no resultado.
    //
    // Note que esta consulta responde uma pergunta DIFERENTE da que o agente
    // faz: aqui não se quer "o que posso oferecer", e sim "quais são os dados
    // desta vaga específica, que o diagnóstico acima já aprovou". As duas
    // dividem a mesma chamada por herança, e isso tem uma consequência a
    // conhecer: `listarVagas` lê central.vw_vagas_livres, que exclui as salas
    // sem prefixo 'Unid. ' ('AT Externo Escola', 'AT Externo Casa', 'Sala
    // Teste'), enquanto `vaga_esta_disponivel` lê public.vw_grade_base, que as
    // contém.
    //
    // Ou seja: uma vaga em sala não-física é APROVADA pelo diagnóstico e não
    // aparece aqui, e o `!vaga` abaixo a reporta como SlotAlreadyBookedError —
    // "essa vaga já foi reservada" sobre uma vaga livre. Mensagem enganosa, e na
    // tela humana de Agendamentos, não só no agente.
    //
    // ISSO É ACEITO POR MEDIÇÃO, NÃO POR DESCUIDO. Contado em produção em
    // 04/09/2026: ZERO reservas em sala não-física em central.appointments,
    // desde sempre — ninguém reserva atendimento externo pela Central. Com zero
    // ocorrências, desacoplar seria código para um caso que não existe.
    //
    // Se algum dia der > 0, o conserto é esta chamada parar de usar listarVagas
    // e resolver os metadados por uma via própria (uma RPC
    // central.dados_da_vaga lendo vw_grade_base direto) — porque "resolver os
    // dados deste slot" e "listar o que posso oferecer" são perguntas
    // diferentes que só dividem esta chamada por herança. Evite um flag
    // `incluirNaoFisicas`: reintroduz parâmetro que só um chamador usa.
    //
    // Para refazer a contagem:
    //   supabase/snippets/20260904_diagnostico_reservas_em_sala_nao_fisica.sql
    const vagas = await this.availability.listarVagas({
      dataInicio:     input.data,
      dataFim:        input.data,
      profissionalId: input.profissionalId,
      limite:         500,
    })
    const vaga = vagas.find(v => normalizarHora(v.hora_inicial) === hora)

    // Corrida: o diagnóstico aprovou e a vaga sumiu entre as duas consultas.
    if (!vaga) throw new SlotAlreadyBookedError(input.profissionalId, input.data, hora)

    const duracao = input.duracao ?? duracaoEmMinutos(vaga.hora_inicial, vaga.hora_final)

    try {
      const appointment = await this.appointments.create({
        organization_id:   orgId,
        contact_id:        input.contactId       ?? null,
        conversation_id:   input.conversationId  ?? null,
        title:             input.titulo ?? tituloPadrao(vaga),
        description:       input.descricao       ?? null,
        date:              input.data,
        time:              hora,
        duration:          duracao,
        type:              input.tipo ?? 'other',
        attendees:         input.participantes   ?? null,
        status:            'scheduled',
        created_by_ai:     input.criadoPorIa     ?? false,
        // Copiados da grade, não do chamador
        profissional_id:   vaga.profissional_id,
        profissional_nome: vaga.profissional_nome,
        terapia_id:        vaga.terapia_id,
        terapia_nome:      vaga.terapia_nome,
        unidade_id:        vaga.unidade_id,
        sala_nome:         vaga.sala_nome,
        tita_paciente_id:  input.titaPacienteId  ?? null,
      })

      void this.audit.insert({
        organization_id: orgId,
        event_type:      'appointment.created',
        performed_by:    actorId ?? undefined,
        payload: {
          appointmentId:  appointment.id,
          profissionalId: vaga.profissional_id,
          data:           input.data,
          hora,
          terapiaId:      vaga.terapia_id,
          criadoPorIa:    input.criadoPorIa ?? false,
        },
      })

      return appointment
    } catch (err) {
      // O índice uq_appointments_slot_ocupada é o que de fato impede a reserva
      // dupla quando duas requisições passam pela checagem prévia ao mesmo tempo.
      if (isUniqueViolation(err)) {
        throw new SlotAlreadyBookedError(input.profissionalId, input.data, hora)
      }
      throw err
    }
  }

  // --------------------------------------------------------------------------
  // Agendamento administrativo (não consome vaga de grade)
  //
  // Reunião com responsável, followup pós-alta, visita. Fica fora da guarda de
  // vaga de propósito: profissional_id nulo não entra em
  // uq_appointments_slot_ocupada.
  // --------------------------------------------------------------------------

  async criarAdministrativo(
    orgId: string,
    input: AgendamentoAdministrativoInput,
    actorId: string | null,
  ): Promise<Appointment> {
    const hora = input.hora ? normalizarHora(input.hora) : null

    if (estaNoPassado(input.data, hora)) throw new SlotInPastError(input.data, hora)

    const appointment = await this.appointments.create({
      organization_id: orgId,
      contact_id:      input.contactId      ?? null,
      conversation_id: input.conversationId ?? null,
      title:           input.titulo,
      description:     input.descricao      ?? null,
      date:            input.data,
      time:            hora,
      duration:        input.duracao        ?? null,
      type:            input.tipo           ?? 'reuniao',
      attendees:       input.participantes  ?? null,
      status:          'scheduled',
      created_by_ai:   input.criadoPorIa    ?? false,
    })

    void this.audit.insert({
      organization_id: orgId,
      event_type:      'appointment.created',
      performed_by:    actorId ?? undefined,
      payload:         { appointmentId: appointment.id, administrativo: true, data: input.data },
    })

    return appointment
  }

  // --------------------------------------------------------------------------
  // Reagendamento
  //
  // Cancela o registro atual e cria um novo na vaga nova, em vez de mover o
  // registro existente. Motivo: mover exigiria liberar a vaga antiga e tomar a
  // nova no mesmo UPDATE, e se a vaga nova estiver ocupada o rollback deixaria
  // o paciente sem nenhuma das duas. Cancelar-e-criar sempre termina num estado
  // legível, e o histórico mostra que houve remarcação.
  // --------------------------------------------------------------------------

  async reagendar(
    orgId: string,
    id: string,
    destino: { profissionalId: number; data: string; hora: string },
    actorId: string | null,
    motivo?: string | null,
  ): Promise<Appointment> {
    const atual = await this.getById(orgId, id)

    // Valida a vaga nova ANTES de cancelar a atual — se ela não estiver
    // disponível, o paciente continua com o horário que já tinha.
    const hora = normalizarHora(destino.hora)
    const diagnostico = await this.availability.diagnosticarVaga(destino.profissionalId, destino.data, hora)

    if (diagnostico.no_passado)       throw new SlotInPastError(destino.data, hora)
    if (!diagnostico.existe_na_grade) throw new SlotNotInGradeError(destino.profissionalId, destino.data, hora)
    if (diagnostico.ja_reservada)     throw new SlotAlreadyBookedError(destino.profissionalId, destino.data, hora)

    await this.appointments.cancel(atual.id)

    try {
      const novo = await this.agendarVaga(orgId, {
        profissionalId:  destino.profissionalId,
        data:            destino.data,
        hora,
        titulo:          atual.title,
        descricao:       atual.description,
        tipo:            atual.type,
        contactId:       atual.contact_id,
        conversationId:  atual.conversation_id,
        titaPacienteId:  atual.tita_paciente_id,
        participantes:   atual.attendees,
        criadoPorIa:     atual.created_by_ai,
      }, actorId)

      void this.audit.insert({
        organization_id: orgId,
        event_type:      'appointment.rescheduled',
        performed_by:    actorId ?? undefined,
        payload: {
          de:     { id: atual.id, data: atual.date, hora: atual.time, profissionalId: atual.profissional_id },
          para:   { id: novo.id,  data: novo.date,  hora: novo.time,  profissionalId: novo.profissional_id },
          motivo: motivo ?? null,
        },
      })

      return novo
    } catch (err) {
      // A vaga nova escapou entre a validação e a criação. Restaura o horário
      // original para não deixar o paciente sem agendamento nenhum.
      await this.appointments.update(atual.id, { status: atual.status }).catch(() => {})
      throw err
    }
  }

  // --------------------------------------------------------------------------
  // Atualização e cancelamento
  // --------------------------------------------------------------------------

  async atualizar(
    orgId: string,
    id: string,
    input: AtualizarAgendamentoInput,
    actorId: string | null,
  ): Promise<Appointment> {
    const atual = await this.getById(orgId, id)

    // Mudança de data/hora numa reserva de vaga precisa passar por reagendar():
    // só ele revalida a grade e mantém a guarda de vaga coerente.
    const mudaHorario =
      (input.data !== undefined && input.data !== atual.date) ||
      (input.hora !== undefined && normalizarHora(input.hora ?? '') !== (atual.time ?? ''))

    if (mudaHorario && atual.profissional_id != null) {
      return this.reagendar(
        orgId,
        id,
        {
          profissionalId: atual.profissional_id,
          data:           input.data ?? atual.date,
          hora:           input.hora ?? atual.time ?? '',
        },
        actorId,
      )
    }

    const atualizado = await this.appointments.update(id, {
      title:           input.titulo,
      description:     input.descricao,
      date:            input.data,
      time:            input.hora === undefined ? undefined : (input.hora ? normalizarHora(input.hora) : null),
      duration:        input.duracao,
      type:            input.tipo,
      status:          input.status,
      attendees:       input.participantes,
      tita_session_id: input.titaSessionId,
    })

    void this.audit.insert({
      organization_id: orgId,
      event_type:      'appointment.updated',
      performed_by:    actorId ?? undefined,
      payload:         { appointmentId: id, campos: Object.keys(input) },
    })

    return atualizado
  }

  async cancelar(orgId: string, id: string, actorId: string | null, motivo?: string | null): Promise<Appointment> {
    await this.getById(orgId, id)
    const cancelado = await this.appointments.cancel(id)

    void this.audit.insert({
      organization_id: orgId,
      event_type:      'appointment.cancelled',
      performed_by:    actorId ?? undefined,
      payload:         { appointmentId: id, motivo: motivo ?? null },
    })

    return cancelado
  }

  // DELETE físico — só para admin corrigir lixo. O fluxo normal é cancelar().
  async remover(orgId: string, id: string, actorId: string | null): Promise<void> {
    await this.getById(orgId, id)
    await this.appointments.remove(id)

    void this.audit.insert({
      organization_id: orgId,
      event_type:      'appointment.deleted',
      performed_by:    actorId ?? undefined,
      payload:         { appointmentId: id },
    })
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// 'HH:MM' → 'HH:MM:SS'. O Postgres devolve time com segundos e a grade compara
// hora exata, então 09:20 e 09:20:00 precisam ser a mesma coisa em todo lugar.
function normalizarHora(hora: string): string {
  const partes = hora.trim().split(':')
  if (partes.length === 2) return `${pad(partes[0])}:${pad(partes[1])}:00`
  if (partes.length >= 3)  return `${pad(partes[0])}:${pad(partes[1])}:${pad(partes[2].slice(0, 2))}`
  return hora
}

function pad(v: string): string {
  return v.padStart(2, '0')
}

// Duração real da vaga a partir da grade (as sessões da clínica são de 40 min,
// mas quem afirma isso é a grade, não uma constante nossa).
function duracaoEmMinutos(inicio: string, fim: string | null): number | null {
  if (!fim) return null
  const [hi, mi] = normalizarHora(inicio).split(':').map(Number)
  const [hf, mf] = normalizarHora(fim).split(':').map(Number)
  const minutos = (hf * 60 + mf) - (hi * 60 + mi)
  return minutos > 0 ? minutos : null
}

function tituloPadrao(vaga: VagaDisponivel): string {
  const terapia = vaga.terapia_nome?.split(',')[0]?.trim() || 'Atendimento'
  return vaga.profissional_nome ? `${terapia} — ${vaga.profissional_nome}` : terapia
}

// Comparação em São Paulo. O servidor pode rodar em UTC, e usar a data local do
// processo faria a validação de passado errar por 3 horas.
function estaNoPassado(data: string, hora: string | null): boolean {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const [ano, mes, dia] = data.split('-').map(Number)
  const [h, m] = (hora ?? '23:59:59').split(':').map(Number)
  const alvo = new Date(ano, mes - 1, dia, h || 0, m || 0, 0, 0)
  return alvo.getTime() <= agora.getTime()
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === PG_UNIQUE_VIOLATION
}
