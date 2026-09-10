'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  ClipboardPlus,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Monitor,
  Pencil,
  PlusCircle,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  UserCheck,
  UserRound,
  Users,
  Database,
  Wallet,
  History,
  Handshake,
  DoorOpen,
  UserSearch,
  UserPlus,
  Package,
  UsersRound,
  Trash2,
  X,
  XCircle,
  Lock,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useHeader } from '@/contexts/HeaderContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { changeUserRole, getAdminUsers } from '@/services/admin.service'
import type { AdminUser } from '@/services/admin.service'
import {
  getAllUsuariosPermissoes,
  getPermissoes,
  getUsuarioPermissoes,
  restaurarPermissoesDoPerfil,
  salvarPermissoesUsuario,
} from '@/services/permissoes.service'
import type { Permissao } from '@/services/permissoes.service'
import {
  adicionarMembro,
  aplicarModelosAosUsuarios,
  criarGrupo,
  excluirGrupo,
  getAllMembrosPorGrupo,
  getGrupos,
  removerMembro,
  renomearGrupo,
  salvarModeloGrupo,
  unirModelos,
} from '@/services/grupos.service'
import type { Grupo } from '@/services/grupos.service'
import { getRoleDefaultPermissions, hasPermission } from '@/lib/permissions/hasPermission'
import { getAvatarColor } from '@/lib/admin/avatar-color'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const supabase = getSupabaseClient()

// ─── Constantes ───────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  diretoria: 'Diretoria',
  recepcao: 'Recepção',
  autorizacao: 'Autorização',
  terapeutico: 'Terapêutico',
  faturamento: 'Faturamento',
  rp: 'RP',
  cronograma: 'Cronograma',
  marketing: 'Marketing',
  // Mesmo rótulo do roleOptions em AdminUsersTable — sem ele o valor cru do
  // banco ("disponibilidade_terapeuta") vazava pra tela e estourava a linha.
  disponibilidade_terapeuta: 'Disponib. Terapeuta',
}

const ROLES = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))

function labelSetor(role?: string) {
  return ROLE_LABELS[role || ''] || role || '—'
}

const MODULE_ICONS: Record<string, React.ElementType> = {
  dashboard: LayoutDashboard,
  atendimentos: PlusCircle,
  // Mesmo ícone do MenuItem em Sidebar.tsx:514 — não ClipboardList (auditoria_assim)
  // nem PlusCircle (atendimentos), pra não confundir com os dois vizinhos do
  // grupo 'Pacientes'.
  autorizacoes_avulsas: ClipboardPlus,
  gestao: Activity,
  escala_terapeutica: UserRound,
  auditoria_assim: ClipboardList,
  usuarios: Users,
  permissoes: KeyRound,
  // Mesmo ícone do MenuItem em Sidebar.tsx — o módulo tem de ser reconhecível
  // como a mesma tela nas duas listas.
  tv_avisos: Monitor,
  cronograma_solicitacoes: UserPlus,
  cronograma_saida_profissional: LogOut,
  cronograma_ocupacao_paciente: UserCheck,
  cronograma_ocupacao_salas: DoorOpen,
  cronograma_disponibilidade_interna: UserSearch,
  ocupacao_clinica: XCircle,
  ocupacao_clinica_gaps: BarChart3,
  ocupacao_clinica_inconsistencias: AlertTriangle,
  ocupacao_profissionais: BarChart3,
  indicadores_ocupacao_unidades: Building2,
  indicadores_pacientes: UserCheck,
  indicadores_previsao_receitas: Wallet,
  indicadores_historico_receitas: History,
  indicadores_comparativo_sessoes: ArrowRightLeft,
}

const GROUP_ICONS: Record<string, React.ElementType> = {
  Sistema: LayoutDashboard,
  Geral: LayoutDashboard,
  Pacientes: Users,
  Terapêutico: Stethoscope,
  Operações: BriefcaseBusiness,
  Insumos: Package,
  Cronograma: CalendarRange,
  Indicadores: TrendingUp,
  Cadastros: Database,
  'Relacionamento Prestador': Handshake,
  Marketing: Megaphone,
  Administração: ShieldCheck,
}

// Marketing vem imediatamente antes de Administração — a mesma posição que o
// grupo ocupa no Sidebar. Duas telas que listam os mesmos módulos em ordens
// diferentes obrigam quem procura um acesso a reaprender o mapa em cada uma.
const GROUP_ORDER = ['Pacientes', 'Terapêutico', 'Operações', 'Insumos', 'Cronograma', 'Indicadores', 'Cadastros', 'Relacionamento Prestador', 'Marketing', 'Administração', 'Sistema', 'Geral']

const INITIAL_OPEN = new Set(GROUP_ORDER)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeEffectivePerms(
  overrideMap: Record<string, boolean>,
  role: string,
  allPermissoes: Permissao[]
): Record<string, boolean> {
  const defaults = getRoleDefaultPermissions(role)
  const effective: Record<string, boolean> = {}
  for (const p of allPermissoes) {
    effective[p.codigo] =
      p.codigo in overrideMap ? overrideMap[p.codigo] : defaults.includes(p.codigo)
  }
  return effective
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function Avatar({ name, userId, size = 'md' }: {
  name?: string
  userId: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const color = getAvatarColor(userId)
  const initial = (name || '?').charAt(0).toUpperCase()
  const cls = size === 'sm' ? 'w-8 h-8 text-sm' : size === 'lg' ? 'w-12 h-12 text-xl' : 'w-10 h-10 text-base'
  return (
    <div
      className={`${cls} rounded-full flex items-center justify-center font-semibold text-white shrink-0`}
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  )
}

// Setor + grupos numa única linha nas listas de usuário das três visões.
//
// O seed criou um grupo por role (ver 20260819120000_create_grupos_permissoes),
// então na maioria dos casos o setor e o grupo têm o mesmo nome — repetir os
// dois viraria "RP / RP". Quando o setor está entre os grupos, o nome aparece
// uma vez só, sob o ícone de grupo, e os demais grupos vêm depois:
// "Cronograma, Autorização". Quando não está (ou não há grupo nenhum), o setor
// vem separado, pra nunca dar a entender que existe um grupo com o nome dele.
function SetorEGrupos({ setor, grupos }: { setor: string; grupos: string[] }) {
  const setorEhGrupo = grupos.includes(setor)
  const listados = setorEhGrupo ? [setor, ...grupos.filter(g => g !== setor)] : grupos

  return (
    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 leading-tight">
      {!setorEhGrupo && (
        <>
          <span className="truncate">{setor}</span>
          <span aria-hidden="true" className="shrink-0 text-slate-300">·</span>
        </>
      )}
      {listados.length > 0 ? (
        <>
          <UsersRound size={11} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{listados.join(', ')}</span>
        </>
      ) : (
        // shrink-0: "Sem grupo" nunca é a parte que encolhe — quem trunca é o
        // nome do setor, que é o pedaço adivinhável.
        <span className="shrink-0 whitespace-nowrap text-slate-500 italic">Sem grupo</span>
      )}
    </p>
  )
}

function Checkbox({ checked, indeterminate, onChange, label }: {
  checked: boolean
  indeterminate?: boolean
  onChange?: (value: boolean) => void
  label?: string
}) {
  const isActive = checked || (indeterminate ?? false)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate && !checked ? 'mixed' : checked}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      className={`w-5 h-5 rounded flex items-center justify-center border-2 shrink-0 transition-all duration-150 ${
        isActive
          ? 'bg-brand border-brand'
          : 'bg-white border-slate-300 hover:border-brand/60'
      }`}
    >
      {indeterminate && !checked ? (
        <svg viewBox="0 0 10 2" className="w-2.5 h-1" fill="none">
          <line x1="1" y1="1" x2="9" y2="1" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      ) : checked ? (
        <svg viewBox="0 0 12 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1,5 4.5,8.5 11,1" />
        </svg>
      ) : null}
    </button>
  )
}

function GroupCard({ grupo, items, perms, isOpen, onToggleOpen, onToggle }: {
  grupo: string
  items: Permissao[]
  perms: Record<string, boolean>
  isOpen: boolean
  onToggleOpen: () => void
  onToggle: (codigo: string, value: boolean) => void
}) {
  const checkedCount = items.filter(p => perms[p.codigo] ?? false).length
  const allChecked = checkedCount === items.length && items.length > 0
  const someChecked = checkedCount > 0 && !allChecked

  const GroupIcon = GROUP_ICONS[grupo] || ShieldCheck

  function handleGroupCheck() {
    const newValue = !allChecked
    for (const p of items) onToggle(p.codigo, newValue)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50/70 transition-colors duration-150">
        <Checkbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={handleGroupCheck}
          label={`Selecionar todas as permissões de ${grupo}`}
        />

        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
          className="flex flex-1 items-center gap-3 text-left select-none"
        >
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <GroupIcon size={14} className="text-slate-500" aria-hidden="true" />
          </div>

          <span className="flex-1 text-sm font-semibold text-slate-700">{grupo}</span>

          <span className="text-xs text-slate-500">
            {checkedCount}/{items.length}
          </span>

          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`text-slate-400 transition-transform duration-200 ml-1 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* Itens */}
      {isOpen && (
        <div className="border-t border-slate-100">
          {items.map((p, idx) => {
            const Icon = MODULE_ICONS[p.codigo] || ShieldCheck
            const permitted = perms[p.codigo] ?? false
            return (
              <div
                key={p.codigo}
                className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors duration-100 ${
                  idx > 0 ? 'border-t border-slate-50' : ''
                }`}
              >
                <Checkbox checked={permitted} onChange={val => onToggle(p.codigo, val)} label={p.nome} />
                <button
                  type="button"
                  onClick={() => onToggle(p.codigo, !permitted)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                    <Icon size={12} className="text-slate-500" aria-hidden="true" />
                  </div>
                  <span className={`text-sm transition-colors ${permitted ? 'text-slate-700' : 'text-slate-500'}`}>
                    {p.nome}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PermissoesPageShell() {
  const { setHeader } = useHeader()

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [permissoes, setPermissoes] = useState<Permissao[]>([])
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [perms, setPerms] = useState<Record<string, boolean>>({})
  const [originalPerms, setOriginalPerms] = useState<Record<string, boolean>>({})
  const [loadingUser, setLoadingUser] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [showEditRole, setShowEditRole] = useState(false)
  const [newRole, setNewRole] = useState('')
  const [savingRole, setSavingRole] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(INITIAL_OPEN)

  // ─── View "por permissão" (quem tem acesso a X) ──────────────────────────
  const [viewMode, setViewMode] = useState<'usuario' | 'permissao' | 'grupo'>('usuario')
  const [allOverrides, setAllOverrides] = useState<Record<string, Record<string, boolean>>>({})
  const [loadingOverrides, setLoadingOverrides] = useState(false)
  const [selectedCodigo, setSelectedCodigo] = useState<string | null>(null)
  const [permissaoSearch, setPermissaoSearch] = useState('')
  const [userSearchByPerm, setUserSearchByPerm] = useState('')
  const [onlyGranted, setOnlyGranted] = useState(true)
  const [openGroupsPermView, setOpenGroupsPermView] = useState<Set<string>>(INITIAL_OPEN)
  const [grantingUserId, setGrantingUserId] = useState<string | null>(null)

  // ─── View "por grupo" (membros + modelo de permissões em lote) ──────────
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [loadingGrupos, setLoadingGrupos] = useState(false)
  const [selectedGrupo, setSelectedGrupo] = useState<Grupo | null>(null)
  const [grupoSearch, setGrupoSearch] = useState('')
  const [membrosPorGrupo, setMembrosPorGrupo] = useState<Record<string, string[]>>({})
  const [grupoModeloPerms, setGrupoModeloPerms] = useState<Record<string, boolean>>({})
  const [openGroupsGrupoView, setOpenGroupsGrupoView] = useState<Set<string>>(INITIAL_OPEN)
  const [addMemberSearch, setAddMemberSearch] = useState('')
  const [memberActionId, setMemberActionId] = useState<string | null>(null)
  const [applyingModelo, setApplyingModelo] = useState(false)
  const [showNovoGrupoModal, setShowNovoGrupoModal] = useState(false)
  const [novoGrupoNome, setNovoGrupoNome] = useState('')
  const [creatingGrupo, setCreatingGrupo] = useState(false)
  const [showEditGrupoModal, setShowEditGrupoModal] = useState(false)
  const [editGrupoNome, setEditGrupoNome] = useState('')
  const [editGrupoDescricao, setEditGrupoDescricao] = useState('')
  const [savingGrupoEdit, setSavingGrupoEdit] = useState(false)
  const [showDeleteGrupoConfirm, setShowDeleteGrupoConfirm] = useState(false)
  const [deletingGrupo, setDeletingGrupo] = useState(false)
  const [memberToRemove, setMemberToRemove] = useState<AdminUser | null>(null)
  const [memberToSync, setMemberToSync] = useState<AdminUser | null>(null)

  useEffect(() => {
    setHeader('Permissões', 'Gerencie as permissões de acesso dos usuários aos módulos do sistema.')
  }, [setHeader])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setIsAdmin(false); return }
      const { data: perfil } = await supabase
        .from('usuarios').select('role').eq('id', data.user.id).single()
      // 'diretoria' já tem RLS própria pra gerenciar usuarios/usuarios_permissoes
      // (ver migration 20260713140000_diretoria_gerencia_permissoes.sql,
      // função is_diretoria()) — só a tela nunca tinha sido atualizada pra
      // deixar entrar, ficava restrita a 'admin' aqui mesmo com o banco já
      // liberando escrita.
      if (perfil?.role === 'admin' || perfil?.role === 'diretoria') { setIsAdmin(true); return }
      // Qualquer outro papel só entra com o override individual do código
      // "permissoes" (ver usuarios_permissoes / hasPermission.ts).
      setIsAdmin(await hasPermission(data.user.id, 'permissoes'))
    })
  }, [])

  useEffect(() => {
    if (isAdmin !== true) return
    Promise.all([getAdminUsers(), getPermissoes()]).then(([u, p]) => {
      setUsers(u)
      setPermissoes(p)
    })
  }, [isAdmin])

  useEffect(() => {
    if ((viewMode !== 'permissao' && viewMode !== 'grupo') || isAdmin !== true) return
    if (Object.keys(allOverrides).length > 0) return
    setLoadingOverrides(true)
    getAllUsuariosPermissoes().then(overrides => {
      const map: Record<string, Record<string, boolean>> = {}
      for (const o of overrides) {
        if (!map[o.usuario_id]) map[o.usuario_id] = {}
        map[o.usuario_id][o.permissao_codigo] = o.permitido
      }
      setAllOverrides(map)
      setLoadingOverrides(false)
    })
  }, [viewMode, isAdmin, allOverrides])

  // Grupos entram no carregamento inicial (e não só na aba "Por grupo") porque
  // as três visões mostram os grupos de cada usuário separados por vírgula.
  useEffect(() => {
    if (isAdmin !== true) return
    setLoadingGrupos(true)
    Promise.all([getGrupos(), getAllMembrosPorGrupo()]).then(([g, m]) => {
      setGrupos(g)
      setMembrosPorGrupo(m)
      setLoadingGrupos(false)
    })
  }, [isAdmin])

  // ─── Computados ──────────────────────────────────────────────────────────

  const filteredUsers = useMemo(() => {
    if (!search) return users
    const q = search.toLowerCase()
    return users.filter(u => (u.nome || u.email || '').toLowerCase().includes(q))
  }, [users, search])

  const isDirty = useMemo(
    () => JSON.stringify(perms) !== JSON.stringify(originalPerms),
    [perms, originalPerms]
  )

  const liberadosCount = useMemo(
    () => permissoes.filter(p => perms[p.codigo] === true).length,
    [perms, permissoes]
  )

  const sortedGroups = useMemo<[string, Permissao[]][]>(() => {
    const map = new Map<string, Permissao[]>()
    for (const p of permissoes) {
      const g = p.grupo || 'Outros'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(p)
    }
    const ordered = GROUP_ORDER
      .filter(g => map.has(g))
      .map(g => [g, map.get(g)!] as [string, Permissao[]])
    const rest = Array.from(map.entries()).filter(([g]) => !GROUP_ORDER.includes(g))
    return [...ordered, ...rest]
  }, [permissoes])

  const permissaoGroupsFiltered = useMemo(() => {
    if (!permissaoSearch) return sortedGroups
    const q = permissaoSearch.toLowerCase()
    return sortedGroups
      .map(([g, items]) => [g, items.filter(p => p.nome.toLowerCase().includes(q))] as [string, Permissao[]])
      .filter(([, items]) => items.length > 0)
  }, [sortedGroups, permissaoSearch])

  const selectedPermissao = useMemo(
    () => permissoes.find(p => p.codigo === selectedCodigo) || null,
    [permissoes, selectedCodigo]
  )

  const usersForSelectedCodigo = useMemo(() => {
    if (!selectedCodigo) return []
    return users.map(u => {
      const overrideMap = allOverrides[u.id] || {}
      const hasOverride = selectedCodigo in overrideMap
      const roleDefault = getRoleDefaultPermissions(u.role || '').includes(selectedCodigo)
      const granted = hasOverride ? overrideMap[selectedCodigo] : roleDefault
      const origem: 'perfil' | 'override_liberado' | 'override_negado' = !hasOverride
        ? 'perfil'
        : overrideMap[selectedCodigo]
          ? 'override_liberado'
          : 'override_negado'
      return { user: u, granted, origem }
    })
  }, [users, allOverrides, selectedCodigo])

  const filteredUsersForSelectedCodigo = useMemo(() => {
    let list = usersForSelectedCodigo
    if (onlyGranted) list = list.filter(x => x.granted)
    if (userSearchByPerm) {
      const q = userSearchByPerm.toLowerCase()
      list = list.filter(x => (x.user.nome || x.user.email || '').toLowerCase().includes(q))
    }
    return list
  }, [usersForSelectedCodigo, onlyGranted, userSearchByPerm])

  const grantedCountForSelectedCodigo = useMemo(
    () => usersForSelectedCodigo.filter(x => x.granted).length,
    [usersForSelectedCodigo]
  )

  const filteredGrupos = useMemo(() => {
    if (!grupoSearch) return grupos
    const q = grupoSearch.toLowerCase()
    return grupos.filter(g => g.nome.toLowerCase().includes(q))
  }, [grupos, grupoSearch])

  // usuário → grupos a que pertence, na ordem alfabética de `grupos`. É a base
  // do "Cronograma, Autorização" mostrado em todas as visões.
  const gruposDoUsuario = useMemo(() => {
    const map: Record<string, Grupo[]> = {}
    for (const g of grupos) {
      for (const uid of membrosPorGrupo[g.id] || []) {
        if (!map[uid]) map[uid] = []
        map[uid].push(g)
      }
    }
    return map
  }, [grupos, membrosPorGrupo])

  // Modelo efetivo de cada usuário: união dos modelos de todos os grupos dele —
  // as permissões dos grupos não se excluem, se complementam.
  const modelosResolvidos = useMemo(() => {
    const map: Record<string, Record<string, boolean>> = {}
    for (const [uid, gs] of Object.entries(gruposDoUsuario)) {
      map[uid] = unirModelos(gs.map(g => g.modelo_permissoes))
    }
    return map
  }, [gruposDoUsuario])

  function nomesGrupos(userId: string) {
    return (gruposDoUsuario[userId] || []).map(g => g.nome)
  }

  const selectedGrupoMembroIds = useMemo(
    () => (selectedGrupo ? membrosPorGrupo[selectedGrupo.id] || [] : []),
    [selectedGrupo, membrosPorGrupo]
  )

  const selectedGrupoMembros = useMemo(
    () => users.filter(u => selectedGrupoMembroIds.includes(u.id)),
    [users, selectedGrupoMembroIds]
  )

  const usersDisponiveisParaGrupo = useMemo(() => {
    let list = users.filter(u => !selectedGrupoMembroIds.includes(u.id))
    if (addMemberSearch) {
      const q = addMemberSearch.toLowerCase()
      list = list.filter(u => (u.nome || u.email || '').toLowerCase().includes(q))
    }
    return list
  }, [users, selectedGrupoMembroIds, addMemberSearch])

  const isModeloDirty = useMemo(
    () =>
      JSON.stringify(grupoModeloPerms) !== JSON.stringify(selectedGrupo?.modelo_permissoes || {}),
    [grupoModeloPerms, selectedGrupo]
  )

  const modeloLiberadosCount = useMemo(
    () => Object.values(grupoModeloPerms).filter(Boolean).length,
    [grupoModeloPerms]
  )

  // Membros cujas permissões efetivas (padrão do role + overrides individuais)
  // não batem mais com o modelo resolvido — ficaram assim porque alguém editou
  // "Por usuário"/"Por permissão" depois da última aplicação do modelo, porque
  // o modelo foi alterado depois, ou porque o membro entrou/saiu de outro grupo
  // (a comparação é contra a UNIÃO dos modelos dos grupos dele, não só o deste).
  const driftedMemberIds = useMemo(() => {
    if (!selectedGrupo || loadingOverrides) return new Set<string>()
    const drifted = new Set<string>()
    for (const uid of selectedGrupoMembroIds) {
      const user = users.find(u => u.id === uid)
      if (!user) continue
      const modelo = modelosResolvidos[uid] || {}
      const effective = computeEffectivePerms(allOverrides[uid] || {}, user.role || '', permissoes)
      const isDrifted = permissoes.some(p => (effective[p.codigo] ?? false) !== (modelo[p.codigo] ?? false))
      if (isDrifted) drifted.add(uid)
    }
    return drifted
  }, [selectedGrupo, selectedGrupoMembroIds, users, allOverrides, permissoes, loadingOverrides, modelosResolvidos])

  // ─── Handlers (lógica de negócio inalterada) ─────────────────────────────

  async function handleSelectUser(user: AdminUser) {
    setSelectedUser(user)
    setLoadingUser(true)
    const overrides = await getUsuarioPermissoes(user.id)
    const overrideMap = Object.fromEntries(overrides.map(o => [o.permissao_codigo, o.permitido]))
    const effective = computeEffectivePerms(overrideMap, user.role || '', permissoes)
    setPerms(effective)
    setOriginalPerms({ ...effective })
    setLoadingUser(false)
  }

  async function handleSave() {
    if (!selectedUser) return
    setSaving(true)
    const ok = await salvarPermissoesUsuario(selectedUser.id, perms)
    if (ok) {
      setOriginalPerms({ ...perms })
      toast.success('Permissões salvas com sucesso')
    } else {
      toast.error('Erro ao salvar permissões')
    }
    setSaving(false)
  }

  async function handleRestore() {
    if (!selectedUser) return
    setRestoring(true)
    const ok = await restaurarPermissoesDoPerfil(selectedUser.id)
    if (ok) {
      const effective = computeEffectivePerms({}, selectedUser.role || '', permissoes)
      setPerms(effective)
      setOriginalPerms({ ...effective })
      toast.success('Permissões restauradas para o perfil padrão')
    } else {
      toast.error('Erro ao restaurar permissões')
    }
    setRestoring(false)
  }

  async function handleSaveRole() {
    if (!selectedUser || !newRole) return
    setSavingRole(true)
    const ok = await changeUserRole(selectedUser.id, newRole)
    if (ok) {
      const updated = { ...selectedUser, role: newRole }
      setSelectedUser(updated)
      setUsers(prev => prev.map(u => (u.id === selectedUser.id ? updated : u)))
      const overrides = await getUsuarioPermissoes(selectedUser.id)
      const overrideMap = Object.fromEntries(overrides.map(o => [o.permissao_codigo, o.permitido]))
      const effective = computeEffectivePerms(overrideMap, newRole, permissoes)
      setPerms(effective)
      setOriginalPerms({ ...effective })
      toast.success('Perfil atualizado com sucesso')
      setShowEditRole(false)
    } else {
      toast.error('Erro ao atualizar perfil')
    }
    setSavingRole(false)
  }

  function handleToggle(codigo: string, value: boolean) {
    setPerms(prev => ({ ...prev, [codigo]: value }))
  }

  async function handleGrantAccessToCodigo(userId: string) {
    if (!selectedCodigo) return
    setGrantingUserId(userId)
    const ok = await salvarPermissoesUsuario(userId, { [selectedCodigo]: true })
    if (ok) {
      setAllOverrides(prev => ({
        ...prev,
        [userId]: { ...prev[userId], [selectedCodigo]: true },
      }))
      toast.success('Acesso liberado com sucesso')
    } else {
      toast.error('Erro ao liberar acesso')
    }
    setGrantingUserId(null)
  }

  async function handleRevokeAccessToCodigo(userId: string) {
    if (!selectedCodigo) return
    setGrantingUserId(userId)
    const ok = await salvarPermissoesUsuario(userId, { [selectedCodigo]: false })
    if (ok) {
      setAllOverrides(prev => ({
        ...prev,
        [userId]: { ...prev[userId], [selectedCodigo]: false },
      }))
      toast.success('Acesso retirado com sucesso')
    } else {
      toast.error('Erro ao retirar acesso')
    }
    setGrantingUserId(null)
  }

  function toggleGroup(grupo: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(grupo)) next.delete(grupo)
      else next.add(grupo)
      return next
    })
  }

  function toggleGroupPermView(grupo: string) {
    setOpenGroupsPermView(prev => {
      const next = new Set(prev)
      if (next.has(grupo)) next.delete(grupo)
      else next.add(grupo)
      return next
    })
  }

  function toggleGroupGrupoView(grupo: string) {
    setOpenGroupsGrupoView(prev => {
      const next = new Set(prev)
      if (next.has(grupo)) next.delete(grupo)
      else next.add(grupo)
      return next
    })
  }

  function handleSelectGrupo(g: Grupo) {
    setSelectedGrupo(g)
    setGrupoModeloPerms({ ...g.modelo_permissoes })
    setAddMemberSearch('')
  }

  async function handleCriarGrupo() {
    const nome = novoGrupoNome.trim()
    if (!nome) return
    setCreatingGrupo(true)
    const novo = await criarGrupo(nome)
    if (novo) {
      setGrupos(prev => [...prev, novo].sort((a, b) => a.nome.localeCompare(b.nome)))
      setMembrosPorGrupo(prev => ({ ...prev, [novo.id]: [] }))
      handleSelectGrupo(novo)
      setShowNovoGrupoModal(false)
      setNovoGrupoNome('')
      toast.success('Grupo criado com sucesso')
    } else {
      toast.error('Erro ao criar grupo — verifique se já existe um grupo com esse nome')
    }
    setCreatingGrupo(false)
  }

  function handleAbrirEditGrupo() {
    if (!selectedGrupo) return
    setEditGrupoNome(selectedGrupo.nome)
    setEditGrupoDescricao(selectedGrupo.descricao || '')
    setShowEditGrupoModal(true)
  }

  async function handleSalvarEditGrupo() {
    if (!selectedGrupo) return
    const nome = editGrupoNome.trim()
    if (!nome) return
    setSavingGrupoEdit(true)
    const ok = await renomearGrupo(selectedGrupo.id, { nome, descricao: editGrupoDescricao.trim() || null })
    if (ok) {
      const updated = { ...selectedGrupo, nome, descricao: editGrupoDescricao.trim() || null }
      setSelectedGrupo(updated)
      setGrupos(prev =>
        prev.map(g => (g.id === updated.id ? updated : g)).sort((a, b) => a.nome.localeCompare(b.nome))
      )
      toast.success('Grupo atualizado com sucesso')
      setShowEditGrupoModal(false)
    } else {
      toast.error('Erro ao atualizar grupo — verifique se já existe um grupo com esse nome')
    }
    setSavingGrupoEdit(false)
  }

  async function handleExcluirGrupo() {
    if (!selectedGrupo) return
    setDeletingGrupo(true)
    const ok = await excluirGrupo(selectedGrupo.id)
    if (ok) {
      setGrupos(prev => prev.filter(g => g.id !== selectedGrupo.id))
      setMembrosPorGrupo(prev => {
        const next = { ...prev }
        delete next[selectedGrupo.id]
        return next
      })
      setSelectedGrupo(null)
      setShowDeleteGrupoConfirm(false)
      toast.success('Grupo excluído com sucesso')
    } else {
      toast.error('Erro ao excluir grupo')
    }
    setDeletingGrupo(false)
  }

  async function handleAddMembro(userId: string) {
    if (!selectedGrupo) return
    setMemberActionId(userId)
    const ok = await adicionarMembro(selectedGrupo.id, userId)
    if (ok) {
      setMembrosPorGrupo(prev => ({
        ...prev,
        [selectedGrupo.id]: [...(prev[selectedGrupo.id] || []), userId],
      }))
    } else {
      toast.error('Erro ao adicionar membro ao grupo')
    }
    setMemberActionId(null)
  }

  async function handleRemoveMembro(userId: string) {
    if (!selectedGrupo) return
    setMemberActionId(userId)
    const ok = await removerMembro(selectedGrupo.id, userId)
    if (ok) {
      setMembrosPorGrupo(prev => ({
        ...prev,
        [selectedGrupo.id]: (prev[selectedGrupo.id] || []).filter(id => id !== userId),
      }))
    } else {
      toast.error('Erro ao remover membro do grupo')
    }
    setMemberActionId(null)
  }

  async function handleConfirmRemoveMembro() {
    if (!memberToRemove) return
    await handleRemoveMembro(memberToRemove.id)
    setMemberToRemove(null)
  }

  function handleToggleModeloPerm(codigo: string, value: boolean) {
    setGrupoModeloPerms(prev => ({ ...prev, [codigo]: value }))
  }

  // Salva o modelo (com o valor de todos os códigos, não só os marcados) e
  // aplica como override explícito aos usuarioIds informados. Usada tanto por
  // "Aplicar a todos os membros" quanto por "Aplicar somente a este usuário".
  //
  // O que cada membro recebe não é o modelo deste grupo, e sim a UNIÃO dos
  // modelos de todos os grupos dele — quem está em "Cronograma, Autorização"
  // fica com as permissões dos dois. Sem isso, aplicar um grupo apagaria as
  // permissões que vêm do outro (o upsert escreve `false` explícito em tudo que
  // o modelo não libera).
  async function aplicarModeloAUsuarios(usuarioIds: string[]) {
    if (!selectedGrupo || usuarioIds.length === 0) return
    setApplyingModelo(true)

    const todosOsCodigos = permissoes.map(p => p.codigo)
    const modeloCompleto: Record<string, boolean> = {}
    for (const codigo of todosOsCodigos) modeloCompleto[codigo] = grupoModeloPerms[codigo] ?? false

    const savedModelo = await salvarModeloGrupo(selectedGrupo.id, modeloCompleto)
    if (!savedModelo) {
      toast.error('Erro ao salvar modelo de permissões do grupo')
      setApplyingModelo(false)
      return
    }
    const updated = { ...selectedGrupo, modelo_permissoes: modeloCompleto }
    setSelectedGrupo(updated)
    setGrupos(prev => prev.map(g => (g.id === updated.id ? updated : g)))

    // `gruposDoUsuario` ainda carrega o modelo antigo deste grupo (o setGrupos
    // acima só vale no próximo render), então o modelo recém-salvo entra na
    // união por substituição explícita.
    const modelosPorUsuario: Record<string, Record<string, boolean>> = {}
    for (const uid of usuarioIds) {
      const uniao = unirModelos(
        (gruposDoUsuario[uid] || []).map(g =>
          g.id === selectedGrupo.id ? modeloCompleto : g.modelo_permissoes
        )
      )
      const completo: Record<string, boolean> = {}
      for (const codigo of todosOsCodigos) completo[codigo] = uniao[codigo] ?? false
      modelosPorUsuario[uid] = completo
    }

    const ok = await aplicarModelosAosUsuarios(modelosPorUsuario, todosOsCodigos)
    if (ok) {
      setAllOverrides(prev => {
        const next = { ...prev }
        for (const uid of usuarioIds) next[uid] = { ...modelosPorUsuario[uid] }
        return next
      })
      toast.success(`Modelo aplicado a ${usuarioIds.length} membro${usuarioIds.length !== 1 ? 's' : ''}`)
    } else {
      toast.error('Erro ao aplicar modelo aos membros do grupo')
    }
    setApplyingModelo(false)
  }

  function handleAplicarModelo() {
    if (!selectedGrupo) return
    return aplicarModeloAUsuarios(membrosPorGrupo[selectedGrupo.id] || [])
  }

  function handleAplicarModeloAUsuario(userId: string) {
    return aplicarModeloAUsuarios([userId])
  }

  // ─── Guards ───────────────────────────────────────────────────────────────

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-10 text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={28} className="text-rose-400" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-slate-500">
            Apenas administradores podem gerenciar permissões.
          </p>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Alternador de visão ── */}
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-2xl p-1 mb-4">
        <button
          onClick={() => setViewMode('usuario')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
            viewMode === 'usuario' ? 'bg-white text-brand-fg shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <UserRound size={14} />
          Por usuário
        </button>
        <button
          onClick={() => setViewMode('permissao')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
            viewMode === 'permissao' ? 'bg-white text-brand-fg shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Lock size={14} />
          Por permissão
        </button>
        <button
          onClick={() => setViewMode('grupo')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
            viewMode === 'grupo' ? 'bg-white text-brand-fg shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <UsersRound size={14} />
          Por grupo
        </button>
      </div>

      {viewMode === 'grupo' ? (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* ── Lista de grupos ── */}
          <div className="w-full lg:w-72 lg:shrink-0">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold text-slate-700">Grupos</h2>
                <button
                  type="button"
                  onClick={() => { setNovoGrupoNome(''); setShowNovoGrupoModal(true) }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-brand-fg hover:underline"
                >
                  <PlusCircle size={13} />
                  Novo grupo
                </button>
              </div>

              <label className="relative block">
                <span className="sr-only">Buscar grupo</span>
                <Search size={13} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar grupo..."
                  value={grupoSearch}
                  onChange={e => setGrupoSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </label>

              <div className="space-y-0.5 max-h-[calc(100vh-300px)] overflow-y-auto">
                {loadingGrupos ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-slate-500">Carregando grupos...</span>
                  </div>
                ) : (
                  <>
                    {filteredGrupos.map(g => {
                      const active = selectedGrupo?.id === g.id
                      const count = (membrosPorGrupo[g.id] || []).length
                      return (
                        <button
                          key={g.id}
                          onClick={() => handleSelectGrupo(g)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors duration-150 ${
                            active
                              ? 'bg-brand-surface border border-brand/20'
                              : 'hover:bg-slate-50 border border-transparent'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                            <UsersRound size={14} className="text-slate-500" aria-hidden="true" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium truncate leading-tight ${active ? 'text-brand-fg' : 'text-slate-700'}`}>
                              {g.nome}
                            </p>
                            <p className="text-xs text-slate-500 truncate leading-tight mt-0.5">
                              {count} membro{count !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                    {filteredGrupos.length === 0 && (
                      <p className="text-center text-sm text-slate-500 py-6">Nenhum grupo encontrado</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Painel: detalhe do grupo ── */}
          <div className="flex-1 space-y-4 min-w-0">
            {!selectedGrupo ? (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-12 flex flex-col items-center justify-center text-center min-h-96">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                  <UsersRound size={26} aria-hidden="true" className="text-slate-300" />
                </div>
                <p className="text-slate-500 text-sm">
                  Selecione um grupo para ver os membros e o modelo de permissões.
                </p>
              </div>
            ) : (
              <>
                {/* ── Card: dados do grupo ── */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Grupo selecionado
                      </p>
                      <h2 className="text-lg font-bold text-slate-800">{selectedGrupo.nome}</h2>
                      {selectedGrupo.descricao && (
                        <p className="text-sm text-slate-500 mt-1">{selectedGrupo.descricao}</p>
                      )}
                      <p className="text-sm text-slate-500 mt-1">
                        {selectedGrupoMembros.length} membro{selectedGrupoMembros.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleAbrirEditGrupo}
                        className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all duration-150"
                      >
                        <Pencil size={13} />
                        Editar
                      </button>
                      <button
                        onClick={() => setShowDeleteGrupoConfirm(true)}
                        className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-rose-500 border border-rose-200 rounded-2xl hover:bg-rose-50 transition-all duration-150"
                      >
                        <Trash2 size={13} />
                        Excluir
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Card: membros ── */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-800">Membros do grupo</h3>

                  <div className="space-y-0.5 max-h-64 overflow-y-auto">
                    {selectedGrupoMembros.map(user => (
                      <div
                        key={user.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors duration-100"
                      >
                        <Avatar name={user.nome} userId={user.id} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate leading-tight text-slate-700">
                            {user.nome || user.email}
                          </p>
                          <SetorEGrupos setor={labelSetor(user.role)} grupos={nomesGrupos(user.id)} />
                        </div>
                        {driftedMemberIds.has(user.id) && (
                          <button
                            type="button"
                            onClick={() => setMemberToSync(user)}
                            className="shrink-0 w-7 h-7 flex items-center justify-center text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors duration-150"
                            aria-label={`${user.nome || user.email} tem permissões fora do modelo do grupo`}
                            title="Permissões fora do modelo do grupo — clique para sincronizar"
                          >
                            <AlertTriangle size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => setMemberToRemove(user)}
                          disabled={memberActionId === user.id}
                          className="shrink-0 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors duration-150 disabled:opacity-50"
                          aria-label={`Remover ${user.nome || user.email} do grupo`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    {selectedGrupoMembros.length === 0 && (
                      <p className="text-center text-sm text-slate-500 py-4">Nenhum membro neste grupo ainda</p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <label className="relative block mb-2">
                      <span className="sr-only">Adicionar membro</span>
                      <Search size={13} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Adicionar usuário ao grupo..."
                        value={addMemberSearch}
                        onChange={e => setAddMemberSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                      />
                    </label>
                    {addMemberSearch && (
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        {usersDisponiveisParaGrupo.slice(0, 20).map(user => (
                          <button
                            key={user.id}
                            onClick={() => handleAddMembro(user.id)}
                            disabled={memberActionId === user.id}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 text-left transition-colors duration-100 disabled:opacity-50"
                          >
                            <Avatar name={user.nome} userId={user.id} size="sm" />
                            <span className="text-sm text-slate-700 truncate flex-1">{user.nome || user.email}</span>
                            <PlusCircle size={14} className="text-brand shrink-0" />
                          </button>
                        ))}
                        {usersDisponiveisParaGrupo.length === 0 && (
                          <p className="text-center text-sm text-slate-500 py-3">Nenhum usuário encontrado</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Modelo de permissões do grupo ── */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">Modelo de permissões do grupo</h3>
                  <div className="flex items-center gap-2">
                    {driftedMemberIds.size > 0 && (
                      <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600">
                        <AlertTriangle size={12} />
                        {driftedMemberIds.size} fora do modelo
                      </span>
                    )}
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-brand-surface text-brand-fg">
                      {modeloLiberadosCount} de {permissoes.length} módulos no modelo
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sortedGroups.map(([grupo, items]) => (
                    <GroupCard
                      key={grupo}
                      grupo={grupo}
                      items={items}
                      perms={grupoModeloPerms}
                      isOpen={openGroupsGrupoView.has(grupo)}
                      onToggleOpen={() => toggleGroupGrupoView(grupo)}
                      onToggle={handleToggleModeloPerm}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-3.5">
                  <span className="text-xs text-slate-500">
                    Aplicar substitui as permissões individuais dos {selectedGrupoMembros.length} membro
                    {selectedGrupoMembros.length !== 1 ? 's' : ''} pela união deste modelo com os dos
                    outros grupos de cada um
                  </span>
                  <button
                    onClick={handleAplicarModelo}
                    disabled={applyingModelo || selectedGrupoMembros.length === 0}
                    className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl transition-all duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save size={13} />
                    {applyingModelo ? 'Aplicando...' : 'Aplicar a todos os membros'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : viewMode === 'permissao' ? (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* ── Lista de permissões ── */}
          <div className="w-full lg:w-80 lg:shrink-0">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-700 px-1">Módulos e abas</h2>

              <label className="relative block">
                <span className="sr-only">Buscar módulo ou aba</span>
                <Search size={13} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar módulo ou aba..."
                  value={permissaoSearch}
                  onChange={e => setPermissaoSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </label>

              <div className="space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto">
                {permissaoGroupsFiltered.map(([grupo, items]) => {
                  const GroupIcon = GROUP_ICONS[grupo] || ShieldCheck
                  const isOpen = openGroupsPermView.has(grupo)
                  return (
                    <div key={grupo} className="rounded-xl border border-slate-100 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroupPermView(grupo)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50/70 select-none"
                      >
                        <GroupIcon size={13} className="text-slate-400" aria-hidden="true" />
                        <span className="flex-1 text-xs font-semibold text-slate-600">{grupo}</span>
                        <ChevronDown
                          size={12}
                          aria-hidden="true"
                          className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {isOpen && (
                        <div className="border-t border-slate-50">
                          {items.map(p => {
                            const Icon = MODULE_ICONS[p.codigo] || ShieldCheck
                            const active = selectedCodigo === p.codigo
                            return (
                              <button
                                key={p.codigo}
                                onClick={() => setSelectedCodigo(p.codigo)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100 ${
                                  active ? 'bg-brand-surface' : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                                  <Icon size={12} className="text-slate-500" aria-hidden="true" />
                                </div>
                                <span className={`text-sm truncate ${active ? 'text-brand-fg font-medium' : 'text-slate-600'}`}>
                                  {p.nome}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                {permissaoGroupsFiltered.length === 0 && (
                  <p className="text-center text-sm text-slate-500 py-6">Nenhum módulo encontrado</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Painel: usuários com acesso ── */}
          <div className="flex-1 space-y-4 min-w-0">
            {!selectedCodigo || !selectedPermissao ? (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-12 flex flex-col items-center justify-center text-center min-h-96">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                  <Users size={26} aria-hidden="true" className="text-slate-300" />
                </div>
                <p className="text-slate-500 text-sm">
                  Selecione um módulo ou aba para ver quem tem acesso.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                    Módulo selecionado
                  </p>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-brand-surface flex items-center justify-center shrink-0">
                        {(() => {
                          const Icon = MODULE_ICONS[selectedPermissao.codigo] || ShieldCheck
                          return <Icon size={18} aria-hidden="true" className="text-brand" />
                        })()}
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-800">{selectedPermissao.nome}</h2>
                        <p className="text-sm text-slate-500">{selectedPermissao.grupo || 'Outros'}</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-brand-surface text-brand-fg">
                      {grantedCountForSelectedCodigo} de {users.length} usuários têm acesso
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="relative flex-1 min-w-[200px]">
                      <span className="sr-only">Buscar usuário</span>
                      <Search size={13} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar usuário..."
                        value={userSearchByPerm}
                        onChange={e => setUserSearchByPerm(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                      <Checkbox checked={onlyGranted} onChange={setOnlyGranted} label="Somente com acesso" />
                      Somente com acesso
                    </label>
                  </div>

                  {loadingOverrides ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                      <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-slate-500">Carregando permissões...</span>
                    </div>
                  ) : (
                    <div className="space-y-0.5 max-h-[calc(100vh-420px)] overflow-y-auto">
                      {filteredUsersForSelectedCodigo.map(({ user, granted }) => (
                        <div
                          key={user.id}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors duration-100"
                        >
                          <Avatar name={user.nome} userId={user.id} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate leading-tight text-slate-700">
                              {user.nome || user.email}
                            </p>
                            <SetorEGrupos setor={labelSetor(user.role)} grupos={nomesGrupos(user.id)} />
                          </div>
                          <span
                            className={`shrink-0 w-24 text-center px-2.5 py-1 rounded-lg text-xs font-semibold ${
                              granted
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {granted ? 'Liberado' : 'Sem acesso'}
                          </span>
                          {granted ? (
                            <button
                              onClick={() => handleRevokeAccessToCodigo(user.id)}
                              disabled={grantingUserId === user.id}
                              className="shrink-0 px-3 py-3.5 text-xs font-semibold text-rose-500 border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors duration-150 disabled:opacity-50"
                            >
                              {grantingUserId === user.id ? 'Retirando...' : 'Retirar acesso'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleGrantAccessToCodigo(user.id)}
                              disabled={grantingUserId === user.id}
                              className="shrink-0 px-3 py-3.5 text-xs font-semibold text-brand-fg border border-brand/30 rounded-lg hover:bg-brand-hover transition-colors duration-150 disabled:opacity-50"
                            >
                              {grantingUserId === user.id ? 'Liberando...' : 'Liberar acesso'}
                            </button>
                          )}
                        </div>
                      ))}
                      {filteredUsersForSelectedCodigo.length === 0 && (
                        <p className="text-center text-sm text-slate-500 py-6">Nenhum usuário encontrado</p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
      <div className="flex flex-col lg:flex-row gap-4 items-start">

        {/* ── Lista de usuários ── */}
        <div className="w-full lg:w-72 lg:shrink-0">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 px-1">Usuários</h2>

            <label className="relative block">
              <span className="sr-only">Buscar usuário</span>
              <Search size={13} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar usuário..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
              />
            </label>

            <div className="space-y-0.5 max-h-[calc(100vh-300px)] overflow-y-auto">
              {filteredUsers.map(user => {
                const active = selectedUser?.id === user.id
                return (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors duration-150 ${
                      active
                        ? 'bg-brand-surface border border-brand/20'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <Avatar name={user.nome} userId={user.id} size="sm" />
                    <div className="min-w-0">
                      <p className={`text-sm font-medium truncate leading-tight ${active ? 'text-brand-fg' : 'text-slate-700'}`}>
                        {user.nome || user.email}
                      </p>
                      <SetorEGrupos setor={labelSetor(user.role)} grupos={nomesGrupos(user.id)} />
                    </div>
                  </button>
                )
              })}
              {filteredUsers.length === 0 && (
                <p className="text-center text-sm text-slate-500 py-6">Nenhum usuário encontrado</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Painel principal ── */}
        <div className="flex-1 space-y-4 min-w-0">

          {!selectedUser ? (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-12 flex flex-col items-center justify-center text-center min-h-96">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                <KeyRound size={26} aria-hidden="true" className="text-slate-300" />
              </div>
              <p className="text-slate-500 text-sm">
                Selecione um usuário para visualizar as permissões.
              </p>
            </div>
          ) : (
            <>
              {/* ── Card: dados do usuário ── */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                  Usuário selecionado
                </p>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <Avatar name={selectedUser.nome} userId={selectedUser.id} size="lg" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-slate-800">
                          {selectedUser.nome || selectedUser.email}
                        </h2>
                        <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-brand-surface text-brand-fg">
                          {ROLE_LABELS[selectedUser.role || ''] || selectedUser.role}
                        </span>
                      </div>
                      {selectedUser.email && (
                        <p className="text-sm text-slate-500 mt-0.5">E-mail: {selectedUser.email}</p>
                      )}
                      <p className="text-sm text-slate-500 mt-1">
                        Perfil padrão:{' '}
                        <button
                          onClick={() => { setNewRole(selectedUser.role || ''); setShowEditRole(true) }}
                          className="text-brand-fg font-medium hover:underline"
                        >
                          {ROLE_LABELS[selectedUser.role || ''] || selectedUser.role}
                        </button>
                      </p>
                      <p className="text-sm text-slate-500 mt-1">
                        Grupos:{' '}
                        <span className="text-slate-700 font-medium">
                          {nomesGrupos(selectedUser.id).join(', ') || 'Sem grupo'}
                        </span>
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setNewRole(selectedUser.role || ''); setShowEditRole(true) }}
                    className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 shrink-0"
                  >
                    <Pencil size={13} />
                    Editar perfil
                  </button>
                </div>
              </div>

              {/* ── Seção: permissões por módulo ── */}
              {loadingUser ? (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center justify-center py-14 gap-3">
                  <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-slate-500">Carregando permissões...</span>
                </div>
              ) : (
                <>
                  {/* Título + resumo */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">Permissões por módulo</h3>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-brand-surface text-brand-fg">
                      {liberadosCount} de {permissoes.length} módulos liberados
                    </span>
                  </div>

                  {/* Grid de grupos */}
                  {sortedGroups.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
                      <p className="text-sm text-slate-500">Nenhum módulo encontrado.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {sortedGroups.map(([grupo, items]) => (
                        <GroupCard
                          key={grupo}
                          grupo={grupo}
                          items={items}
                          perms={perms}
                          isOpen={openGroups.has(grupo)}
                          onToggleOpen={() => toggleGroup(grupo)}
                          onToggle={handleToggle}
                        />
                      ))}
                    </div>
                  )}

                  {/* Barra de ações */}
                  <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-3.5">
                    <span className="text-xs text-slate-500">
                      {permissoes.length} módulo{permissoes.length !== 1 ? 's' : ''}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleRestore}
                        disabled={restoring}
                        className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all duration-150 disabled:opacity-50"
                      >
                        <RotateCcw size={13} className={restoring ? 'animate-spin' : ''} />
                        {restoring ? 'Restaurando...' : 'Restaurar padrão do perfil'}
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving || !isDirty}
                        className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl transition-all duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save size={13} />
                        {saving ? 'Salvando...' : 'Salvar alterações'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* ── Modal: Editar perfil ── */}
      {selectedUser && (
        <Dialog open={showEditRole} onOpenChange={setShowEditRole}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Editar perfil</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Alterar o perfil de{' '}
                <strong className="text-slate-700">{selectedUser.nome || selectedUser.email}</strong>
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Perfil</label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setShowEditRole(false)}
                  className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveRole}
                  disabled={savingRole || newRole === selectedUser.role}
                  className="flex-1 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {savingRole ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Novo grupo ── */}
      <Dialog open={showNovoGrupoModal} onOpenChange={setShowNovoGrupoModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo grupo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome do grupo</label>
              <input
                type="text"
                autoFocus
                value={novoGrupoNome}
                onChange={e => setNovoGrupoNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCriarGrupo() }}
                placeholder="Ex: Financeiro"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setShowNovoGrupoModal(false)}
                className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCriarGrupo}
                disabled={creatingGrupo || !novoGrupoNome.trim()}
                className="flex-1 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {creatingGrupo ? 'Criando...' : 'Criar grupo'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Editar grupo ── */}
      {selectedGrupo && (
        <Dialog open={showEditGrupoModal} onOpenChange={setShowEditGrupoModal}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Editar grupo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome</label>
                <input
                  type="text"
                  autoFocus
                  value={editGrupoNome}
                  onChange={e => setEditGrupoNome(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Descrição (opcional)</label>
                <input
                  type="text"
                  value={editGrupoDescricao}
                  onChange={e => setEditGrupoDescricao(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setShowEditGrupoModal(false)}
                  className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSalvarEditGrupo}
                  disabled={savingGrupoEdit || !editGrupoNome.trim()}
                  className="flex-1 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {savingGrupoEdit ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Confirmar exclusão de grupo ── */}
      {selectedGrupo && (
        <Dialog open={showDeleteGrupoConfirm} onOpenChange={setShowDeleteGrupoConfirm}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Excluir grupo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Tem certeza que deseja excluir o grupo{' '}
                <strong className="text-slate-700">{selectedGrupo.nome}</strong>? Os{' '}
                {selectedGrupoMembros.length} membro{selectedGrupoMembros.length !== 1 ? 's' : ''} deixam de
                fazer parte do grupo, mas as permissões já aplicadas a cada um continuam valendo — só o
                agrupamento é removido.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setShowDeleteGrupoConfirm(false)}
                  className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleExcluirGrupo}
                  disabled={deletingGrupo}
                  className="flex-1 py-3 text-sm font-semibold text-white bg-rose-500 rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {deletingGrupo ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Confirmar remoção de membro ── */}
      {memberToRemove && (
        <Dialog open={!!memberToRemove} onOpenChange={open => { if (!open) setMemberToRemove(null) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remover membro do grupo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Tem certeza que deseja remover{' '}
                <strong className="text-slate-700">{memberToRemove.nome || memberToRemove.email}</strong> do
                grupo <strong className="text-slate-700">{selectedGrupo?.nome}</strong>? As permissões
                individuais já aplicadas a essa pessoa continuam valendo — só o vínculo com o grupo é
                removido.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setMemberToRemove(null)}
                  className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmRemoveMembro}
                  disabled={memberActionId === memberToRemove.id}
                  className="flex-1 py-3 text-sm font-semibold text-white bg-rose-500 rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {memberActionId === memberToRemove.id ? 'Removendo...' : 'Remover'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Sincronizar membro fora do modelo ── */}
      {memberToSync && (
        <Dialog open={!!memberToSync} onOpenChange={open => { if (!open) setMemberToSync(null) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Fora do modelo do grupo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                <strong className="text-slate-700">{memberToSync.nome || memberToSync.email}</strong> tem
                permissões liberadas que não seguem exatamente a união dos modelos dos grupos dela (
                <strong className="text-slate-700">{nomesGrupos(memberToSync.id).join(', ')}</strong>) —
                alguém deve ter ajustado as permissões dessa pessoa individualmente depois da última
                aplicação, ou os modelos mudaram desde então. Você pode sincronizar só ela, ou aplicar o
                modelo a todos os membros de uma vez.
              </p>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={async () => { await handleAplicarModeloAUsuario(memberToSync.id); setMemberToSync(null) }}
                  disabled={applyingModelo}
                  className="w-full py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {applyingModelo ? 'Aplicando...' : 'Aplicar somente a este usuário'}
                </button>
                <button
                  onClick={async () => { await handleAplicarModelo(); setMemberToSync(null) }}
                  disabled={applyingModelo}
                  className="w-full py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Aplicar a todos os membros
                </button>
                <button
                  onClick={() => setMemberToSync(null)}
                  className="w-full py-2 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
