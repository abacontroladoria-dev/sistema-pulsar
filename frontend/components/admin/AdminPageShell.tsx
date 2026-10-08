'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useHeader } from '@/contexts/HeaderContext'
import AdminSummaryCards from './AdminSummaryCards'
import AdminUsersTable, { FILTRO_SEM_GRUPO } from './AdminUsersTable'
import { useUsuarioAtual } from '@/hooks/useUsuarioAtual'
import AdminMachinesTable, { isMachineOnline, machineEstado } from './AdminMachinesTable'
import {
  deleteMachine,
  deleteUser,
  getAdminMachines,
  getAdminUsers,
  resetUserPassword,
  toggleUserActive,
  updateMachineStatus,
  updateUserRoleUnidades,
} from '@/services/admin.service'
import {
  getAllMembrosPorGrupo,
  getGrupos,
  sincronizarGruposDoUsuario,
} from '@/services/grupos.service'
import type { Grupo } from '@/services/grupos.service'
import ResetPasswordModal from './ResetPasswordModal'
import { getFunctionHeaders, getFunctionUrl } from '@/lib/supabase/functions'
import { UNIDADES_DISPONIVEIS } from '@/lib/admin/unidades'

export type AdminUser = {
  id: string
  nome?: string
  email?: string
  role?: string
  ativo?: boolean
  created_at?: string
  username?: string | null
  unidades?: string[] | null
}

export type AdminMachine = {
  id: string
  nome?: string
  ativa?: boolean | null
  last_seen?: string | null
  hostname?: string | null
  sistema_operacional?: string | null
  ip?: string | null
  user_id?: string
}

export default function AdminPageShell({
  initialUsers,
  initialMachines,
}: {
  initialUsers: AdminUser[]
  initialMachines: AdminMachine[]
}) {
  const { setHeader } = useHeader()
  const { role: meuNivel } = useUsuarioAtual()

  const [users, setUsers] = useState(initialUsers)
  const [machines, setMachines] = useState(initialMachines)
  const [grupos, setGrupos] = useState<Grupo[]>([])
  // grupo_id → ids dos membros, como vem de grupos_permissoes_membros.
  const [membrosPorGrupo, setMembrosPorGrupo] = useState<Record<string, string[]>>({})
  const [searchUser, setSearchUser] = useState('')
  const [searchMachine, setSearchMachine] = useState('')
  const [grupoFilter, setGrupoFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // Erro de máquina mora na própria linha, não no banner do topo.
  const [machineErros, setMachineErros] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState('')
  const [resetPasswordResult, setResetPasswordResult] = useState<{
    nome: string
    email: string
    username: string
    password: string
  } | null>(null)

  useEffect(() => {
    setHeader(
      'Painel Administrativo',
      'Gestão de usuários, máquinas e regras do sistema'
    )
  }, [setHeader])

  async function recarregarUsuariosEGrupos() {
    const [loadedUsers, loadedGrupos, loadedMembros] = await Promise.all([
      getAdminUsers(),
      getGrupos(),
      getAllMembrosPorGrupo(),
    ])
    setUsers(loadedUsers)
    setGrupos(loadedGrupos)
    setMembrosPorGrupo(loadedMembros)
  }

  useEffect(() => {
    async function load() {
      const [loadedUsers, loadedMachines, loadedGrupos, loadedMembros] = await Promise.all([
        getAdminUsers(),
        getAdminMachines(),
        getGrupos(),
        getAllMembrosPorGrupo(),
      ])
      setUsers(loadedUsers)
      setMachines(loadedMachines)
      setGrupos(loadedGrupos)
      setMembrosPorGrupo(loadedMembros)
    }
    load()

    // Atualiza periodicamente para refletir o heartbeat das máquinas (last_seen)
    const interval = setInterval(async () => {
      setMachines(await getAdminMachines())
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const totals = useMemo(() => {
    const activeUsers = users.filter((user) => user.ativo).length
    const inactiveUsers = users.length - activeUsers
    const onlineMachines = machines.filter(
      (machine) => isMachineOnline(machine.last_seen)
    ).length
    // Pausada é intencional e não entra na conta de alerta.
    const offlineMachines = machines.filter((machine) => machineEstado(machine) === 'sem_sinal').length

    return {
      totalUsers: users.length,
      activeUsers,
      inactiveUsers,
      totalMachines: machines.length,
      onlineMachines,
      offlineMachines,
    }
  }, [users, machines])

  // usuário → ids dos grupos a que pertence (o inverso de membrosPorGrupo).
  const gruposPorUsuario = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const grupo of grupos) {
      for (const usuarioId of membrosPorGrupo[grupo.id] || []) {
        if (!map[usuarioId]) map[usuarioId] = []
        map[usuarioId].push(grupo.id)
      }
    }
    return map
  }, [grupos, membrosPorGrupo])

  const grupoOptions = useMemo(
    () => grupos.map((grupo) => ({ id: grupo.id, nome: grupo.nome })),
    [grupos]
  )

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (searchUser) {
        const normalized = searchUser.toLowerCase()
        const campos = [user.nome, user.email, user.username].map((v) => (v || '').toLowerCase())
        if (!campos.some((c) => c.includes(normalized.replace(/^@/, '')))) {
          return false
        }
      }

      if (grupoFilter === FILTRO_SEM_GRUPO) {
        if ((gruposPorUsuario[user.id] || []).length > 0) return false
      } else if (grupoFilter && !(gruposPorUsuario[user.id] || []).includes(grupoFilter)) {
        return false
      }

      return true
    })
  }, [users, grupoFilter, searchUser, gruposPorUsuario])

  // Ordem por urgência: sem sinal (ativa e calada) primeiro, depois online, por
  // fim as pausadas — quem abre a tela quer saber qual robô caiu.
  const filteredMachines = useMemo(() => {
    const ordem = { sem_sinal: 0, online: 1, pausada: 2 }
    const termo = searchMachine.trim().toLowerCase()
    return machines
      .filter((machine) => {
        if (!termo) return true
        return [machine.nome, machine.hostname].some((v) => (v || '').toLowerCase().includes(termo))
      })
      .sort(
        (a, b) =>
          ordem[machineEstado(a)] - ordem[machineEstado(b)] ||
          (a.nome || '').localeCompare(b.nome || '', 'pt-BR')
      )
  }, [machines, searchMachine])

  async function handleToggleActive(userId: string, active: boolean) {
    setBusyId(userId)
    setErrorMessage('')

    const updated = await toggleUserActive(userId, !active)

    if (!updated) {
      setErrorMessage('Não foi possível atualizar o usuário. Tente novamente.')
      setBusyId(null)
      return
    }

    setUsers((current) =>
      current.map((user) =>
        user.id === userId ? { ...user, ativo: !active } : user
      )
    )
    setBusyId(null)
  }

  async function handleSaveUser(
    userId: string,
    role: string,
    unidades: string[],
    grupoIds: string[]
  ) {
    setBusyId(userId)
    setErrorMessage('')

    // Unidades passam por /api/admin/user/update, que só aceita admin. Só chama
    // quando elas mudaram — senão a diretoria, que pode mexer em grupos (a RLS
    // de grupos_permissoes_membros aceita is_diretoria), nunca conseguia salvar
    // um grupo: a primeira chamada falhava e a segunda não acontecia.
    const atual = users.find((u) => u.id === userId)
    const unidadesAtuais = atual?.unidades && atual.unidades.length > 0 ? atual.unidades : []
    const unidadesMudaram =
      unidadesAtuais.length !== unidades.length || unidadesAtuais.some((u) => !unidades.includes(u))
    const todasMarcadas = unidadesAtuais.length === 0 && unidades.length === UNIDADES_DISPONIVEIS.length

    if (unidadesMudaram && !todasMarcadas) {
      const result = await updateUserRoleUnidades(userId, role, unidades)

      if (!result.ok) {
        setErrorMessage(result.error ?? 'Não foi possível salvar as alterações do usuário.')
        setBusyId(null)
        return false
      }

      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? { ...user, role, unidades: unidades.length > 0 ? unidades : null }
            : user
        )
      )
    }

    // Grupo é vínculo puramente organizacional (tabela própria) — muda quem está
    // no grupo, não as permissões já aplicadas a cada um. Quem aplica as
    // permissões do modelo é a aba "Por grupo" em Permissões.
    const gruposAtuais = gruposPorUsuario[userId] || []
    const gruposOk = await sincronizarGruposDoUsuario(userId, grupoIds, gruposAtuais)

    if (!gruposOk) {
      setErrorMessage('Perfil e unidades foram salvos, mas não foi possível salvar os grupos.')
      setBusyId(null)
      return false
    }

    const alvo = new Set(grupoIds)
    setMembrosPorGrupo((current) => {
      const next: Record<string, string[]> = {}
      for (const grupo of grupos) {
        const membros = (current[grupo.id] || []).filter((id) => id !== userId)
        next[grupo.id] = alvo.has(grupo.id) ? [...membros, userId] : membros
      }
      return next
    })

    // Entrar/sair de grupo pode mudar o nível técnico no banco (gatilho da
    // migration 20260929130000). Relê a lista: o próximo "Salvar" de unidades
    // manda o `role` da tela e, com o valor velho, desfaria o que o banco acertou.
    setUsers(await getAdminUsers())

    setBusyId(null)
    return true
  }

  async function handleResendInvite(userId: string, email: string, nome: string, role: string) {
    setBusyId(userId)
    setErrorMessage('')

    const res = await fetch(getFunctionUrl('admin-resend-invite'), {
      method: 'POST',
      headers: await getFunctionHeaders(),
      body: JSON.stringify({ email, nome, role }),
    })

    const json = await res.json()

    if (!res.ok) {
      setErrorMessage(json.error ?? 'Não foi possível reenviar o convite.')
    } else {
      toast.success(`Convite reenviado para ${email}`)
    }

    setBusyId(null)
  }

  async function handleDeleteUser(userId: string) {
    setBusyId(userId)
    setErrorMessage('')

    const result = await deleteUser(userId)

    if (!result.ok) {
      setErrorMessage(result.error ?? 'Não foi possível excluir o usuário.')
      setBusyId(null)
      return
    }

    toast.success('Usuário excluído com sucesso')
    setUsers((current) => current.filter((u) => u.id !== userId))
    setBusyId(null)
  }

  async function handleResetPassword(userId: string, nome: string, email: string, username: string) {
    setBusyId(userId)
    setErrorMessage('')

    const result = await resetUserPassword(userId)

    if (!result.ok || !result.password) {
      setErrorMessage(result.error ?? 'Não foi possível redefinir a senha do usuário.')
      setBusyId(null)
      return
    }

    setResetPasswordResult({ nome, email, username, password: result.password })
    setBusyId(null)
  }

  function setMachineErro(machineId: string, mensagem: string | null) {
    setMachineErros((current) => {
      const next = { ...current }
      if (mensagem) next[machineId] = mensagem
      else delete next[machineId]
      return next
    })
  }

  async function handleMachineToggle(machineId: string, currentAtiva: boolean) {
    setBusyId(machineId)
    setMachineErro(machineId, null)

    const updated = await updateMachineStatus(machineId, !currentAtiva)

    if (!updated) {
      setMachineErro(
        machineId,
        currentAtiva ? 'Não foi possível pausar a máquina. Tente novamente.' : 'Não foi possível retomar a máquina. Tente novamente.'
      )
      setBusyId(null)
      return
    }

    setMachines((current) =>
      current.map((machine) =>
        machine.id === machineId ? { ...machine, ativa: !currentAtiva } : machine
      )
    )
    setBusyId(null)
  }

  async function handleMachineDelete(machineId: string) {
    setBusyId(machineId)
    setMachineErro(machineId, null)

    const result = await deleteMachine(machineId)

    if (!result.ok) {
      setMachineErro(machineId, result.error ?? 'Não foi possível excluir a máquina. Tente novamente.')
      setBusyId(null)
      return
    }

    toast.success('Máquina excluída com sucesso')
    setMachines((current) => current.filter((m) => m.id !== machineId))
    setBusyId(null)
  }

  return (
    <div className="bg-card rounded-2xl p-6">
      <div className="space-y-4">
        <div className="space-y-4">
          <AdminSummaryCards counts={totals} />

          {errorMessage ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="space-y-4">
            <AdminUsersTable
              users={filteredUsers}
              grupos={grupoOptions}
              gruposCompletos={grupos}
              podeAdministrar={meuNivel === 'admin'}
              onUsuarioCriado={recarregarUsuariosEGrupos}
              gruposPorUsuario={gruposPorUsuario}
              onToggleActive={handleToggleActive}
              onSaveUser={handleSaveUser}
              onResendInvite={handleResendInvite}
              onDeleteUser={handleDeleteUser}
              onResetPassword={handleResetPassword}
              loadingId={busyId}
              searchUser={searchUser}
              onSearchUserChange={setSearchUser}
              grupoFilter={grupoFilter}
              onGrupoFilterChange={setGrupoFilter}
            />

            <AdminMachinesTable
              machines={filteredMachines}
              totalMachines={machines.length}
              onToggle={handleMachineToggle}
              onDelete={handleMachineDelete}
              podeAdministrar={meuNivel === 'admin'}
              loadingId={busyId}
              erros={machineErros}
              onDismissErro={(id) => setMachineErro(id, null)}
              searchMachine={searchMachine}
              onSearchMachineChange={setSearchMachine}
            />
          </div>
        </div>
      </div>

      <ResetPasswordModal
        result={resetPasswordResult}
        onClose={() => setResetPasswordResult(null)}
      />
    </div>
  )
}
