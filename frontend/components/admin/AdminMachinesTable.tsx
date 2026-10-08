'use client'

import { useState } from 'react'
import { MoreVertical, Pause, Play, Trash2 } from 'lucide-react'
import { AdminMachine } from './AdminPageShell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Worker envia heartbeat a cada 30s; toleramos 3 batidas perdidas antes de marcar offline
export const ONLINE_THRESHOLD_MS = 90 * 1000

export function isMachineOnline(lastSeen?: string | null) {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS
}

// Os dois eixos (heartbeat × ativa) viram um estado só. "Pausada" é decisão de
// alguém e fica neutra; vermelho é reservado para a máquina ativa que parou de
// mandar sinal — o único caso que pede ação.
export type MachineEstado = 'sem_sinal' | 'online' | 'pausada'

export function machineEstado(machine: AdminMachine): MachineEstado {
  if (!(machine.ativa ?? false)) return 'pausada'
  return isMachineOnline(machine.last_seen) ? 'online' : 'sem_sinal'
}

const ESTADO_STYLES: Record<MachineEstado, { label: string; text: string; dot: string }> = {
  sem_sinal: { label: 'Sem sinal', text: 'text-rose-700', dot: 'bg-rose-500' },
  online: { label: 'Online', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  pausada: { label: 'Pausada', text: 'text-slate-600', dot: 'bg-slate-400' },
}

function formatLastSeen(lastSeen?: string | null) {
  if (!lastSeen) return 'nunca'
  const diff = Date.now() - new Date(lastSeen).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'há 1 dia' : `há ${days} dias`
}

function nomeMaquina(machine: AdminMachine) {
  return machine.nome || machine.hostname || `Máquina ${machine.id.slice(0, 8)}`
}

export default function AdminMachinesTable({
  machines,
  totalMachines,
  onToggle,
  onDelete,
  podeAdministrar,
  loadingId,
  erros,
  onDismissErro,
  searchMachine,
  onSearchMachineChange,
}: {
  machines: AdminMachine[]
  totalMachines: number
  onToggle: (machineId: string, currentAtiva: boolean) => Promise<void>
  onDelete: (machineId: string) => Promise<void>
  podeAdministrar: boolean
  loadingId: string | null
  erros: Record<string, string>
  onDismissErro: (machineId: string) => void
  searchMachine: string
  onSearchMachineChange: (value: string) => void
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Máquinas</h2>
          <p className="mt-1 text-sm text-slate-500">
            Robôs autorizadores. As que estão sem sinal aparecem primeiro.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label>
          <span className="sr-only">Buscar máquina por nome ou hostname</span>
          <input
            placeholder="Buscar por nome ou hostname..."
            value={searchMachine}
            onChange={(e) => onSearchMachineChange(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
        </label>
      </div>

      <div className="-mx-5 -mb-5 mt-5 rounded-b-3xl border-t border-slate-200 bg-slate-50 p-5">
        {machines.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            {totalMachines === 0 ? (
              <>
                <p className="font-medium text-slate-700">Nenhuma máquina registrada.</p>
                <p className="mt-1">
                  A máquina aparece aqui sozinha quando o robô autorizador é iniciado nela.
                </p>
              </>
            ) : (
              <p>Nenhuma máquina encontrada para “{searchMachine}”.</p>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {machines.map((machine) => (
              <MachineRow
                key={machine.id}
                machine={machine}
                podeAdministrar={podeAdministrar}
                isLoading={loadingId === machine.id}
                erro={erros[machine.id]}
                onDismissErro={() => onDismissErro(machine.id)}
                onToggle={onToggle}
                confirmDelete={confirmDeleteId === machine.id}
                onRequestDelete={() => setConfirmDeleteId(machine.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onConfirmDelete={async () => {
                  await onDelete(machine.id)
                  setConfirmDeleteId(null)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function MachineRow({
  machine,
  podeAdministrar,
  isLoading,
  erro,
  onDismissErro,
  onToggle,
  confirmDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  machine: AdminMachine
  podeAdministrar: boolean
  isLoading: boolean
  erro?: string
  onDismissErro: () => void
  onToggle: (machineId: string, currentAtiva: boolean) => Promise<void>
  confirmDelete: boolean
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => Promise<void>
}) {
  const ativa = machine.ativa ?? false
  const estado = ESTADO_STYLES[machineEstado(machine)]
  const nome = nomeMaquina(machine)

  return (
    <li className="relative rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-[border-color,box-shadow] duration-150 hover:border-slate-300 hover:shadow-md">
      <div className="grid grid-cols-1 items-center gap-x-5 gap-y-3 p-5 pr-16 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_8.5rem_minmax(160px,1fr)_2.75rem] lg:pr-5">
        {/* MÁQUINA — nome + hostname/SO */}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">{nome}</p>
          <p className="truncate text-sm text-slate-500">
            {[machine.hostname && machine.hostname !== nome ? machine.hostname : null, machine.sistema_operacional]
              .filter(Boolean)
              .join(' · ') || '—'}
          </p>
        </div>

        {/* ESTADO — texto sempre presente; a cor só reforça */}
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${estado.text}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${estado.dot}`} aria-hidden="true" />
          {estado.label}
        </span>

        {/* ÚLTIMO SINAL */}
        <p className="text-sm text-slate-500">
          Último sinal: <span className="tabular-nums text-slate-700">{formatLastSeen(machine.last_seen)}</span>
        </p>

        {/* AÇÕES — mesmo menu ⋯ dos usuários */}
        <div className="absolute top-3 right-3 lg:static lg:flex lg:justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isLoading}
              aria-label={`Ações para ${nome}`}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 data-open:bg-slate-100 data-open:text-slate-900"
            >
              <MoreVertical size={18} aria-hidden="true" />
            </DropdownMenuTrigger>

            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onToggle(machine.id, ativa)}>
                {ativa ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {ativa ? 'Pausar' : 'Retomar'}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" disabled={!podeAdministrar} onSelect={onRequestDelete}>
                <Trash2 aria-hidden="true" />
                Excluir
              </DropdownMenuItem>

              {!podeAdministrar && (
                <p className="px-2 py-1.5 text-xs text-slate-500">Exclusão: só administradores.</p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {erro ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-rose-100 bg-rose-50/70 px-5 py-3"
        >
          <p className="text-sm font-medium text-rose-700">{erro}</p>
          <button
            onClick={onDismissErro}
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>
      ) : confirmDelete ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-rose-100 bg-rose-50/70 px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-rose-700">Excluir {nome} definitivamente?</p>
            <p className="mt-0.5 text-sm text-rose-700/80">
              Só é possível se a máquina nunca autorizou guias. Para tirá-la de uso, pause.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              autoFocus
              onClick={onCancelDelete}
              disabled={isLoading}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>

            {ativa && (
              <button
                onClick={async () => {
                  onCancelDelete()
                  await onToggle(machine.id, ativa)
                }}
                disabled={isLoading}
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Pausar
              </button>
            )}

            <button
              onClick={onConfirmDelete}
              disabled={isLoading}
              className="inline-flex min-h-11 items-center rounded-xl border border-red-300 bg-red-50 px-4 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
            >
              {isLoading ? 'Excluindo...' : 'Confirmar exclusão'}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
