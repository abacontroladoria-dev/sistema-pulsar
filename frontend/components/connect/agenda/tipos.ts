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
//   violeta → reunião com responsável/equipe (era sky; no bloco preenchido da
//             grade horária sky e cyan não se distinguem)
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

// Cor do tipo no calendário: `ponto` marca o tipo na lista (mês, "Próximos",
// filtro, detalhe) e `suave` preenche o bloco na grade horária.
//
// A tinta é declarada nos DOIS temas de propósito, e o fundo leva modificador
// de opacidade: o shim de tema escuro do globals.css remapeia `bg-*-100` e
// brigaria com o `dark:`. Texto `-950` sobre o fundo `/15` no claro, `-50`
// sobre `/20` no escuro — a mesma família dos dois lados, que é o que faz o
// bloco continuar dizendo "triagem" pela cor e não só pelo rótulo.
export const TIPO_COR: Record<AppointmentType, { ponto: string; suave: string }> = {
  triagem:  { ponto: 'bg-amber-500',   suave: 'bg-amber-500/15   text-amber-950   hover:bg-amber-500/25   dark:bg-amber-400/20   dark:text-amber-50   dark:hover:bg-amber-400/30' },
  retorno:  { ponto: 'bg-cyan-500',    suave: 'bg-cyan-500/15    text-cyan-950    hover:bg-cyan-500/25    dark:bg-cyan-400/20    dark:text-cyan-50    dark:hover:bg-cyan-400/30' },
  reuniao:  { ponto: 'bg-violet-500',  suave: 'bg-violet-500/15  text-violet-950  hover:bg-violet-500/25  dark:bg-violet-400/20  dark:text-violet-50  dark:hover:bg-violet-400/30' },
  followup: { ponto: 'bg-slate-500',   suave: 'bg-slate-500/15   text-slate-950   hover:bg-slate-500/25   dark:bg-slate-400/20   dark:text-slate-50   dark:hover:bg-slate-400/30' },
  demo:     { ponto: 'bg-emerald-500', suave: 'bg-emerald-500/15 text-emerald-950 hover:bg-emerald-500/25 dark:bg-emerald-400/20 dark:text-emerald-50 dark:hover:bg-emerald-400/30' },
  other:    { ponto: 'bg-slate-500',   suave: 'bg-slate-500/15   text-slate-950   hover:bg-slate-500/25   dark:bg-slate-400/20   dark:text-slate-50   dark:hover:bg-slate-400/30' },
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

// 'HH:MM' → minutos desde 00:00
export function minutosDoDia(hora: string | null): number {
  const [h, m] = (hora ?? '00:00').slice(0, 5).split(':').map(Number)
  return h * 60 + (m || 0)
}

// Sessão terapêutica tem 40 min; é a duração assumida quando o registro não traz.
export const DURACAO_PADRAO = 40

export function duracaoPorExtenso(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const resto = min % 60
  return resto ? `${h}h${String(resto).padStart(2, '0')}` : `${h}h`
}

export function isoParaData(iso: string): Date {
  const [ano, mes, dia] = iso.split('-').map(Number)
  return new Date(ano, mes - 1, dia)
}

export function somarDias(d: Date, dias: number): Date {
  const nova = new Date(d)
  nova.setDate(nova.getDate() + dias)
  return nova
}

// Domingo da semana de `d`, à meia-noite.
export function inicioDaSemana(d: Date): Date {
  return somarDias(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay())
}

export function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// "Quarta-feira, 1 de outubro"
export function dataPorExtenso(iso: string): string {
  return capitalizar(isoParaData(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))
}

// Primeira terapia de uma lista separada por vírgula.
// 34 das 619 vagas livres trazem terapia_nome como lista ("Aplicador ABA (PS),
// Psicopedagogia") porque o profissional atende mais de uma especialidade
// naquele horário — no chip do calendário só cabe a primeira.
export function terapiaCurta(nome: string | null): string {
  if (!nome) return ''
  return nome.split(',')[0].trim()
}
