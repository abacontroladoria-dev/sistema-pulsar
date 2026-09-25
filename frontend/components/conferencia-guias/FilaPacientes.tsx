'use client'

import { memo } from 'react'
import { CircleCheck } from 'lucide-react'
import { formatarDia, somarDias } from '@/components/auditoria-assim/reconciliacao/datas'
import { resumoDoGrupo, type Aba, type GrupoFolhas, type TomResumo } from './folhas'

/*
  Sem `dark:` nem opacidade: o shim de tema escuro remapeia os degraus usados
  aqui.
*/
const COR_NUMERO: Record<TomResumo, string> = {
  pendente: 'text-slate-700',
  problema: 'text-rose-700',
  recepcao: 'text-sky-700',
  pronta: 'text-emerald-700',
  futura: 'text-slate-500',
}

type Props = {
  grupos: GrupoFolhas[]
  /** O grupo da folha na mesa. */
  selecionadoId: string | null
  mostrarSemana: boolean
  /** A aba aberta: o número responde à pergunta dela. */
  foco: Aba
  onSelecionar: (grupo: GrupoFolhas) => void
}

/** O número ao lado do nome: o que a aba pergunta, somado nas folhas do paciente. */
function numeroDoGrupo(g: GrupoFolhas, tom: TomResumo): number | null {
  const soma = (k: 'pendentes' | 'divergentes' | 'comRecepcao') => g.folhas.reduce((n, f) => n + f[k], 0)
  if (tom === 'pendente') return soma('pendentes')
  if (tom === 'problema') return soma('divergentes')
  if (tom === 'recepcao') return soma('comRecepcao')
  return null
}

/**
 * A fila, em ordem alfabética — a ordem da pilha de papel. Um paciente por
 * linha (as folhas 1 e 2 da semana são um item só), com o número que a aba
 * pergunta ao lado. O resto do detalhe está no cartão da folha.
 */
function FilaPacientesBase({ grupos, selecionadoId, mostrarSemana, foco, onSelecionar }: Props) {
  return (
    <ul className="flex flex-col gap-0.5">
      {grupos.map((g) => {
        const atual = g.id === selecionadoId
        const resumo = resumoDoGrupo(g, foco)
        const numero = numeroDoGrupo(g, resumo.tom)
        return (
          <li key={g.id}>
            <button
              type="button"
              data-grupo-id={g.id}
              onClick={() => onSelecionar(g)}
              aria-current={atual ? 'true' : undefined}
              aria-label={`${g.paciente_nome}: ${resumo.texto}`}
              title={resumo.texto}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                atual ? 'bg-blue-50' : 'hover:bg-slate-50'
              }`}
            >
              <span className="flex min-w-0 flex-col">
                <span className={`truncate text-sm ${atual ? 'font-bold text-blue-700' : 'font-medium text-slate-700'}`}>
                  {g.paciente_nome}
                </span>
                {mostrarSemana && (
                  <span className="text-xs text-slate-500">
                    semana de {formatarDia(g.semana)} a {formatarDia(somarDias(g.semana, 4))}
                  </span>
                )}
              </span>
              {numero !== null ? (
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${atual ? 'text-blue-700' : COR_NUMERO[resumo.tom]}`}
                >
                  {numero}
                </span>
              ) : resumo.tom === 'pronta' ? (
                <CircleCheck size={16} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-emerald-600" />
              ) : (
                <span className="shrink-0 text-xs text-slate-500">{resumo.texto}</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export const FilaPacientes = memo(FilaPacientesBase)
