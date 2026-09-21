import type { AppointmentType } from '@/modules/atendimento/types/central.types'

// ============================================================================
// Vocabulário clínico da agenda
//
// O componente herdado do Nina usava rótulos comerciais (Demo, Reunião,
// Suporte, Follow-up) porque nasceu num CRM de vendas. Numa clínica isso é
// ruído: quem atende precisa distinguir triagem de retorno, não demo de
// suporte. O enum central.appointment_type já foi adaptado na migration
// 20260701010000 — aqui só damos rótulo e cor a ele.
//
// Disciplina de cor: um matiz = um significado.
//   âmbar   → triagem (primeira vez, precisa de atenção da recepção)
//   cyan    → retorno (paciente em tratamento, fluxo normal)
//   sky     → reunião com responsável/equipe
//   slate   → followup administrativo
//   emerald → demo (lead comercial, raro)
// ============================================================================

export const TIPO_LABEL: Record<AppointmentType, string> = {
  triagem:  'Triagem',
  retorno:  'Retorno',
  reuniao:  'Reunião',
  followup: 'Follow-up',
  demo:     'Demo',
  other:    'Outro',
}

export const TIPOS_ORDENADOS: AppointmentType[] = [
  'triagem', 'retorno', 'reuniao', 'followup', 'demo', 'other',
]

// Classes para o "chip" do evento dentro do calendário.
//
// A tinta é declarada nos DOIS temas de propósito. O fundo é `/10` — quase
// transparente —, então quem dá contraste é o texto: o `-200` que funciona sobre
// o escuro fica ilegível sobre o branco (roda 1.2:1). O par é `-700` no claro,
// `-200` no escuro, mantendo a mesma família de cor dos dois lados, que é o que
// faz o chip continuar dizendo "triagem" pela cor e não só pelo rótulo.
export const TIPO_CHIP: Record<AppointmentType, string> = {
  triagem:  'bg-amber-500/10   text-amber-700   dark:text-amber-200   border-amber-500/25   hover:bg-amber-500/20',
  retorno:  'bg-cyan-500/10    text-cyan-700    dark:text-cyan-200    border-cyan-500/25    hover:bg-cyan-500/20',
  reuniao:  'bg-sky-500/10     text-sky-700     dark:text-sky-200     border-sky-500/25     hover:bg-sky-500/20',
  followup: 'bg-slate-500/10   text-slate-700   dark:text-slate-200   border-slate-500/25   hover:bg-slate-500/20',
  demo:     'bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 border-emerald-500/25 hover:bg-emerald-500/20',
  other:    'bg-slate-500/10   text-slate-700   dark:text-slate-200   border-slate-500/25   hover:bg-slate-500/20',
}

export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Realizado',
  no_show:   'Falta',
}

// ----------------------------------------------------------------------------
// Datas
//
// Toda conversão usa a data como string 'YYYY-MM-DD' e nunca passa por
// Date.toISOString(): o componente original fazia isso e, rodando em GMT-3,
// a data virava o dia anterior sempre que o horário local era antes das 21h.
// ----------------------------------------------------------------------------

export function dataParaISO(d: Date): string {
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

export function isoParaBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

// 'HH:MM:SS' → 'HH:MM'
export function horaCurta(hora: string | null): string {
  if (!hora) return '--:--'
  return hora.slice(0, 5)
}

export function horaFim(inicio: string | null, duracaoMin: number | null): string {
  if (!inicio) return '--:--'
  const [h, m] = inicio.split(':').map(Number)
  const total = h * 60 + m + (duracaoMin ?? 0)
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Primeira terapia de uma lista separada por vírgula.
// 34 das 619 vagas livres trazem terapia_nome como lista ("Aplicador ABA (PS),
// Psicopedagogia") porque o profissional atende mais de uma especialidade
// naquele horário — no chip do calendário só cabe a primeira.
export function terapiaCurta(nome: string | null): string {
  if (!nome) return ''
  return nome.split(',')[0].trim()
}
