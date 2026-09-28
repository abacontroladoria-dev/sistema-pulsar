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
  status?: string
  user_id?: string
}

import { getSupabaseClient } from '@/lib/supabase/client'
import { getFunctionHeaders, getFunctionUrl } from '@/lib/supabase/functions'

export async function getAdminUsers(): Promise<AdminUser[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, role, ativo, created_at, username, unidades')
    .order('nome', { ascending: true })

  if (error) {
    console.error('Erro ao buscar usuários:', error)
    return []
  }

  return data || []
}

export async function getAdminMachines(): Promise<AdminMachine[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('maquinas')
    .select('id, nome, ativa, last_seen, hostname, sistema_operacional, ip, user_id')
    .order('nome', { ascending: true })

  if (error) {
    console.error('Erro ao buscar máquinas:', error)
    return []
  }

  return data || []
}

export async function toggleUserActive(userId: string, active: boolean) {
  const response = await fetch(getFunctionUrl('admin-toggle-user'), {
    method: 'POST',
    headers: await getFunctionHeaders(),
    body: JSON.stringify({ userId, active }),
  })

  return response.ok
}

export async function updateUserRoleUnidades(
  userId: string,
  role: string,
  unidades: string[]
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch('/api/admin/user/update', {
    method: 'POST',
    headers: await getFunctionHeaders(),
    body: JSON.stringify({ userId, role, unidades }),
  })

  const json = await response.json()
  if (!response.ok) return { ok: false, error: json.error }
  return { ok: true }
}

export async function updateMachineStatus(machineId: string, ativa: boolean) {
  const response = await fetch(getFunctionUrl('admin-update-machine'), {
    method: 'POST',
    headers: await getFunctionHeaders(),
    body: JSON.stringify({ machineId, ativa }),
  })

  return response.ok
}

export async function deleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch('/api/admin/user/delete', {
    method: 'POST',
    headers: await getFunctionHeaders(),
    body: JSON.stringify({ userId }),
  })

  const json = await response.json()
  if (!response.ok) return { ok: false, error: json.error }
  return { ok: true }
}

export async function resetUserPassword(
  userId: string
): Promise<{ ok: boolean; password?: string; error?: string }> {
  const response = await fetch('/api/admin/user/reset-password', {
    method: 'POST',
    headers: await getFunctionHeaders(),
    body: JSON.stringify({ userId }),
  })

  const json = await response.json()
  if (!response.ok) return { ok: false, error: json.error }
  return { ok: true, password: json.password }
}
