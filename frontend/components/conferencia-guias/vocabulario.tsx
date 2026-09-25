import { AlertTriangle, Check, FileText, Minus } from 'lucide-react'
import { estadoEvolucao, type SessaoConferencia } from './folhas'

/*
  Sem variantes `dark:` e sem opacidade: este módulo depende do shim global de
  tema escuro, que cobre `bg-`/`text-`/`border-` sólidos nos degraus
  50/100/200/300/600/700. Um `-400`/`-800` ou um `/60` atravessa claro para o
  escuro, calado.
*/

const EVOLUCAO = {
  ok: { rotulo: 'Com evolução', classe: 'bg-emerald-50 text-emerald-700', Icone: Check },
  parcial: { rotulo: '', classe: 'bg-amber-50 text-amber-700', Icone: AlertTriangle },
  ausente: { rotulo: 'Sem evolução', classe: 'bg-rose-50 text-rose-700', Icone: AlertTriangle },
  sem_grade: { rotulo: 'Sem grade', classe: 'bg-slate-100 text-slate-600', Icone: Minus },
} as const

export function EvolucaoBadge({ sessao }: { sessao: SessaoConferencia }) {
  const estado = estadoEvolucao(sessao)
  const cfg = EVOLUCAO[estado]
  const rotulo =
    estado === 'parcial' ? `${sessao.grade_com_evolucao} de ${sessao.grade_total} com evolução` : cfg.rotulo
  const titulo =
    estado === 'sem_grade'
      ? 'A grade do TiTa não tem esta sessão — não há onde procurar a evolução'
      : estado === 'parcial'
        ? 'Sessão com mais de um profissional; nem todos escreveram'
        : undefined
  return (
    <span className="inline-flex flex-col items-start gap-0.5" title={titulo}>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cfg.classe}`}
      >
        <cfg.Icone size={11} strokeWidth={2.5} />
        {rotulo}
      </span>
      {sessao.risco_evolucao === 'risco_relevante' && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700">
          <FileText size={10} />
          Risco de glosa
        </span>
      )}
    </span>
  )
}

export function formatarCarimbo(nome: string | null, em: string | null): string {
  if (!em) return nome ?? ''
  const d = new Date(em)
  const quando = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  return nome ? `${nome} em ${quando}` : quando
}
