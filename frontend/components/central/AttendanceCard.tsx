import { memo } from 'react'
import { Repeat2 } from 'lucide-react'
import {
  resolverStatus,
  SEVERIDADE_UI,
  realizouPor,
  houveSubstituicao,
} from '@/lib/central/severity'

/**
 * Linha de atendimento — layout uniforme para todas (sem categorização).
 * A diferenciação é só o status colorido (palavra + dot por severidade). A ordem
 * é cronológica (definida na página). Mostra também quem realizou (substituto, se
 * houve) e quem solicitou a autorização.
 */
function AttendanceCard({ item, rowId, ativo, onSelect }: any) {
  const token = resolverStatus(item)
  const ui = SEVERIDADE_UI[token.severidade]
  const Icon = token.icon

  const realizou = realizouPor(item)
  const subbed = houveSubstituicao(item)
  const terapia = item.classificacao_terapia || 'Sem terapia'
  const solicitante = item.criado_por

  return (
    <button
      onClick={() => onSelect(rowId)}
      aria-pressed={ativo}
      className={`
        group w-full text-left
        rounded-xl px-3 py-2.5
        transition-colors duration-150
        focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300
        ${ativo
          ? 'bg-slate-50 ring-1 ring-slate-200 shadow-sm'
          : 'bg-white hover:bg-slate-50/70'}
      `}
    >
      {/* Linha 1: horário · paciente · status */}
      <div className="flex items-center gap-3">
        <span className="text-[13px] tabular-nums text-slate-500 w-10.5 shrink-0">
          {item.horario?.slice(0, 5)}
        </span>

        <h3 className="truncate flex-1 text-sm font-medium text-slate-800">
          {item.paciente_nome}
        </h3>

        <span
          className={`inline-flex items-center gap-1.5 shrink-0 text-xs font-medium ${ui.text}`}
        >
          <Icon className={`w-3.5 h-3.5 ${token.spin ? 'animate-spin' : ''}`} />
          {token.label}
        </span>
      </div>

      {/* Linha 2: terapia · quem realizou (+subst.) · quem solicitou */}
      <div className="flex items-center gap-2 mt-0.5 pl-13.5 text-xs text-slate-400 min-w-0">
        <span className="truncate">{terapia}</span>

        {realizou && (
          <>
            <span aria-hidden>·</span>
            <span className={`truncate ${subbed ? 'text-amber-700' : ''}`}>
              {realizou}
            </span>
          </>
        )}

        {subbed && (
          <span
            className="inline-flex items-center gap-1 shrink-0 text-[var(--status-atencao)]"
            title="Realizado por substituto"
          >
            <Repeat2 className="w-3 h-3" />
            substituto
          </span>
        )}

        {solicitante && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate shrink-0">solic. {solicitante}</span>
          </>
        )}
      </div>
    </button>
  )
}

export default memo(AttendanceCard)
