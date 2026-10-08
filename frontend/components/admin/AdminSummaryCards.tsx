import {
  Users,
  UserCheck,
  UserX,
  Monitor,
  Wifi,
  WifiOff,
} from 'lucide-react'

export default function AdminSummaryCards({
  counts,
}: {
  counts: {
    totalUsers: number
    activeUsers: number
    inactiveUsers: number
    totalMachines: number
    onlineMachines: number
    offlineMachines: number
  }
}) {
  const cards = [
    {
      title: 'Usuários cadastrados',
      value: counts.totalUsers,
      subtitle: 'total',
      icon: Users,
      iconColor: 'text-blue-500',
      bg: 'bg-white',
      border: 'border-slate-200',
    },

    {
      title: 'Usuários ativos',
      value: counts.activeUsers,
      subtitle: 'ativos',
      icon: UserCheck,
      iconColor: 'text-emerald-500',
      bg: 'bg-emerald-50/60',
      border: 'border-emerald-100',
    },

    {
      title: 'Usuários inativos',
      value: counts.inactiveUsers,
      subtitle: 'inativos',
      icon: UserX,
      iconColor: 'text-rose-500',
      bg: 'bg-rose-50/60',
      border: 'border-rose-100',
    },

    {
      title: 'Máquinas registradas',
      value: counts.totalMachines,
      subtitle: 'total',
      icon: Monitor,
      iconColor: 'text-sky-500',
      bg: 'bg-white',
      border: 'border-slate-200',
    },

    {
      title: 'Máquinas online',
      value: counts.onlineMachines,
      subtitle: 'online',
      icon: Wifi,
      iconColor: 'text-teal-600',
      bg: 'bg-emerald-50/60',
      border: 'border-emerald-100',
    },

    {
      title: 'Máquinas sem sinal',
      value: counts.offlineMachines,
      subtitle: 'ativas e sem sinal',
      icon: WifiOff,
      iconColor: 'text-rose-500',
      bg: 'bg-rose-50/60',
      border: 'border-rose-100',
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {cards.map((card) => {
        const Icon = card.icon

        return (
          <div
            key={card.title}
            className={`
              relative overflow-hidden rounded-2xl border px-5 py-4
              shadow-sm transition-all duration-200
              hover:-translate-y-0.5 hover:shadow-md
              ${card.bg}
              ${card.border}
            `}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-slate-500">
                  {card.title}
                </p>

                <div className="mt-3 flex items-end gap-2">
                  <span className="text-2xl font-bold tracking-tight text-slate-900">
                    {card.value}
                  </span>
                </div>

                <p className="mt-1 text-xs font-medium text-slate-400">
                  {card.subtitle}
                </p>
              </div>

              <div
                className={`
                  flex h-11 w-11 items-center justify-center
                  rounded-xl bg-white/80 shadow-sm
                  ${card.iconColor}
                `}
              >
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}