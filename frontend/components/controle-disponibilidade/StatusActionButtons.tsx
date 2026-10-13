'use client'

type StatusDisponibilidade =
  | 'pendente'
  | 'disponivel'
  | 'indisponivel'

type Grupo = {
  terapeuta: string
  status: StatusDisponibilidade
}

type Props = {
  grupo: Grupo

  salvandoStatus: boolean

  abrirModalStatus: (
    grupo: Grupo
  ) => void

  atualizarStatusDireto: (
    grupo: Grupo,
    status: StatusDisponibilidade
  ) => void

  onSubstituicao?: () => void
}

export default function StatusActionButtons({
  grupo,
  salvandoStatus,
  abrirModalStatus,
  atualizarStatusDireto,
  onSubstituicao,
}: Props) {

  const pendente =
    grupo.status === 'pendente'

  const disponivel =
    grupo.status === 'disponivel'

  const indisponivel =
    grupo.status === 'indisponivel'

  return (
    <div className="p-3 bg-slate-50 flex gap-2">

      {pendente && (
        <>
          <button
            disabled={salvandoStatus}
            onClick={() =>
              atualizarStatusDireto(
                grupo,
                'disponivel'
              )
            }
            className="flex-1 h-11 rounded-xl bg-green-600 text-white text-sm font-semibold"
          >
            Disponível
          </button>

          <button
            disabled={salvandoStatus}
            onClick={() =>
              atualizarStatusDireto(
                grupo,
                'indisponivel'
              )
            }
            className="flex-1 h-11 rounded-xl bg-red-600 text-white text-sm font-semibold"
          >
            Indisponível
          </button>
        </>
      )}

      {disponivel && (
        <button
          disabled={salvandoStatus}
          onClick={() =>
            abrirModalStatus(grupo)
          }
          className="flex-1 h-11 rounded-xl bg-red-600 text-white text-sm font-semibold"
        >
          Encerrar disponibilidade
        </button>
      )}

      {indisponivel && (
        <>
          <button
            disabled={salvandoStatus}
            onClick={() =>
              abrirModalStatus(grupo)
            }
            className="flex-1 h-11 rounded-xl border border-emerald-300 bg-white text-[var(--status-ok)] text-sm font-semibold transition hover:bg-emerald-50"
          >
            Disponível agora
          </button>

          {onSubstituicao && (
            <button
              onClick={onSubstituicao}
              className="px-4 rounded-xl border border-[#3A8FB7] text-[#3A8FB7] text-sm font-semibold"
            >
              Substituição
            </button>
          )}

        </>
      )}

    </div>
  )
}