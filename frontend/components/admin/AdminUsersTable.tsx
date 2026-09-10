'use client'

import { useRef, useState } from 'react'
import {
  Ban,
  CircleCheck,
  KeyRound,
  MoreVertical,
  Pencil,
  Send,
  Trash2,
} from 'lucide-react'
import { AdminUser } from './AdminPageShell'
import CreateUserModal from './CreateUserModal'
import { UNIDADES_DISPONIVEIS } from '@/lib/admin/unidades'
import { getAvatarColor } from '@/lib/admin/avatar-color'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MultiSearchCombobox } from '@/components/cronograma/ui/MultiSearchCombobox'

export type GrupoOption = { id: string; nome: string }

// Cor fixa por unidade — nunca a cor de marca (essa fica reservada a estado/foco).
// O anel é o que separa o chip de unidade da pill de setor, que usa a mesma família.
const UNIDADE_STYLES: Record<string, string> = {
  Realengo: 'bg-blue-100 text-blue-800 ring-blue-200',
  Fazendinha: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  'Padre Miguel': 'bg-amber-100 text-amber-900 ring-amber-300',
}

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'autorizacao', label: 'Autorização' },
  { value: 'cronograma', label: 'Cronograma' },
  { value: 'disponibilidade_terapeuta', label: 'Disponib. Terapeuta' },
  { value: 'diretoria', label: 'Diretoria' },
  { value: 'faturamento', label: 'Faturamento' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'recepcao', label: 'Recepção' },
  { value: 'rp', label: 'RP' },
  { value: 'terapeutico', label: 'Terapêutico' },
]

// Uma cor por grupo — nunca as cores de status (emerald/rose/amber/sky/slate já
// têm significado fixo em Status; grupo usa uma paleta própria pra não colidir).
// Os nomes abaixo são os grupos criados pelo seed (um por setor), então a pill
// mantém a mesma cor que a de setor tinha antes; grupo criado à mão cai no
// fallback determinístico por nome.
const GRUPO_STYLES: Record<string, { bg: string; text: string }> = {
  Administrador: { bg: 'bg-slate-100', text: 'text-slate-700' },
  Diretoria: { bg: 'bg-orange-100', text: 'text-orange-700' },
  Recepção: { bg: 'bg-blue-100', text: 'text-blue-700' },
  Autorização: { bg: 'bg-violet-100', text: 'text-violet-700' },
  Terapêutico: { bg: 'bg-teal-100', text: 'text-teal-700' },
  Faturamento: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  RP: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  Cronograma: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  'Disponib. Terapeuta': { bg: 'bg-pink-100', text: 'text-pink-700' },
}

const GRUPO_PALETA = Object.values(GRUPO_STYLES)
const SEM_GRUPO_STYLE = { bg: 'bg-slate-50 ring-1 ring-inset ring-slate-200', text: 'text-slate-500' }

// Cor da pill: a do primeiro grupo listado (a lista é alfabética, então a cor é
// estável e casa com o primeiro nome que aparece no campo).
function grupoStyle(nomes: string[]) {
  const nome = nomes[0]
  if (!nome) return SEM_GRUPO_STYLE
  if (GRUPO_STYLES[nome]) return GRUPO_STYLES[nome]
  let hash = 0
  for (const char of nome) hash = (hash + char.codePointAt(0)!) % GRUPO_PALETA.length
  return GRUPO_PALETA[hash]
}

function mesmoConjunto(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((u) => setB.has(u))
}

export default function AdminUsersTable({
  users,
  grupos,
  gruposPorUsuario,
  onToggleActive,
  onSaveUser,
  onResendInvite,
  onDeleteUser,
  onResetPassword,
  loadingId,
  searchUser,
  onSearchUserChange,
  roleFilter,
  onRoleFilterChange,
  searchMachine,
  onSearchMachineChange,
}: {
  users: AdminUser[]
  grupos: GrupoOption[]
  gruposPorUsuario: Record<string, string[]>
  onToggleActive: (userId: string, active: boolean) => Promise<void>
  onSaveUser: (
    userId: string,
    role: string,
    unidades: string[],
    grupoIds: string[]
  ) => Promise<boolean>
  onResendInvite: (userId: string, email: string, nome: string, role: string) => Promise<void>
  onDeleteUser: (userId: string) => Promise<void>
  onResetPassword: (userId: string, nome: string, email: string, username: string) => Promise<void>
  loadingId: string | null
  searchUser: string
  onSearchUserChange: (value: string) => void
  roleFilter: string
  onRoleFilterChange: (value: string) => void
  searchMachine: string
  onSearchMachineChange: (value: string) => void
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      {/*  CABEÇALHO */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Usuários
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Gerencie perfis, status e permissões da plataforma.
          </p>
        </div>

        <CreateUserModal />
      </div>

      {/*FILTROS*/}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label>
          <span className="sr-only">Buscar usuário</span>
          <input
            placeholder="Buscar usuário..."
            value={searchUser}
            onChange={(e) => onSearchUserChange(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
        </label>

        <label>
          <span className="sr-only">Filtrar por setor</span>
          <select
            value={roleFilter}
            onChange={(e) => onRoleFilterChange(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
          >
            <option value="">Todos os setores</option>
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">Buscar máquina</span>
          <input
            placeholder="Buscar máquina..."
            value={searchMachine}
            onChange={(e) => onSearchMachineChange(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
        </label>
      </div>

      {/* LISTA — bandeja levemente rebaixada pra que os cards brancos leiam como
          itens de lista, e não como card dentro de card. */}
      <div className="-mx-5 -mb-5 mt-5 rounded-b-3xl border-t border-slate-200 bg-slate-50 p-5">
        {users.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Nenhum usuário encontrado.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                grupos={grupos}
                grupoIds={gruposPorUsuario[user.id] ?? []}
                isLoading={loadingId === user.id}
                onToggleActive={onToggleActive}
                onSaveUser={onSaveUser}
                onResendInvite={onResendInvite}
                onResetPassword={onResetPassword}
                confirmDelete={confirmDeleteId === user.id}
                onRequestDelete={() => setConfirmDeleteId(user.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onConfirmDelete={async () => {
                  setConfirmDeleteId(null)
                  await onDeleteUser(user.id)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function UserRow({
  user,
  grupos,
  grupoIds,
  isLoading,
  onToggleActive,
  onSaveUser,
  onResendInvite,
  onResetPassword,
  confirmDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  user: AdminUser
  grupos: GrupoOption[]
  grupoIds: string[]
  isLoading: boolean
  onToggleActive: (userId: string, active: boolean) => Promise<void>
  onSaveUser: (
    userId: string,
    role: string,
    unidades: string[],
    grupoIds: string[]
  ) => Promise<boolean>
  onResendInvite: (userId: string, email: string, nome: string, role: string) => Promise<void>
  onResetPassword: (userId: string, nome: string, email: string, username: string) => Promise<void>
  confirmDelete: boolean
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => Promise<void>
}) {
  // unidades NULL/vazio = sem restrição no banco, equivalente a "todas marcadas" —
  // exibir como nenhuma marcada seria enganoso (pareceria restrito a zero unidades).
  function unidadesEfetivas(u: AdminUser) {
    return u.unidades && u.unidades.length > 0 ? u.unidades : [...UNIDADES_DISPONIVEIS]
  }

  const [unidadesDraft, setUnidadesDraft] = useState<string[]>(unidadesEfetivas(user))
  const [gruposDraft, setGruposDraft] = useState<Set<string>>(new Set(grupoIds))

  // Ressincroniza o rascunho quando o usuário é atualizado de fora (ex.: após salvar),
  // ajustando o estado durante a renderização em vez de um useEffect (evita um
  // re-render em cascata — ver https://react.dev/learn/you-might-not-need-an-effect).
  // `grupoIds` vem de um array recriado a cada render do pai, então a comparação
  // aqui é pelo conteúdo (chave ordenada), nunca pela identidade.
  const grupoIdsKey = [...grupoIds].sort().join(',')
  const [syncedFrom, setSyncedFrom] = useState({
    unidades: user.unidades,
    grupos: grupoIdsKey,
  })
  if (syncedFrom.unidades !== user.unidades || syncedFrom.grupos !== grupoIdsKey) {
    setSyncedFrom({ unidades: user.unidades, grupos: grupoIdsKey })
    setUnidadesDraft(unidadesEfetivas(user))
    setGruposDraft(new Set(grupoIds))
  }

  // Na ordem em que o campo lista (alfabética), pra a cor da pill casar com o
  // primeiro nome exibido.
  const nomesGruposDraft = grupos.filter((g) => gruposDraft.has(g.id)).map((g) => g.nome)

  const dirty =
    !mesmoConjunto(unidadesDraft, unidadesEfetivas(user)) ||
    !mesmoConjunto([...gruposDraft], grupoIds)
  const disabled = isLoading

  function toggleUnidade(unidade: string) {
    setUnidadesDraft((current) =>
      current.includes(unidade)
        ? current.filter((u) => u !== unidade)
        : [...current, unidade]
    )
  }

  function toggleGrupo(grupoId: string) {
    setGruposDraft((current) => {
      const next = new Set(current)
      if (next.has(grupoId)) next.delete(grupoId)
      else next.add(grupoId)
      return next
    })
  }

  // "Editar" no menu leva o foco pro primeiro campo editável do card (a edição é
  // inline). O Radix devolve o foco ao gatilho ao fechar, então interceptamos.
  const grupoTriggerRef = useRef<HTMLButtonElement>(null)
  const focarGrupoAoFechar = useRef(false)

  return (
    <li className="relative rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-[border-color,box-shadow] duration-150 hover:border-slate-300 hover:shadow-md">
      <div className="grid grid-cols-1 items-center gap-x-5 gap-y-4 p-5 pr-16 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(200px,300px)_220px_8.5rem_104px_minmax(170px,1fr)_2.75rem] xl:pr-5">
        {/* USUÁRIO — avatar + nome + @usuário */}
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white"
            style={{ backgroundColor: getAvatarColor(user.id) }}
            aria-hidden="true"
          >
            {(user.nome || user.email || '?').charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">
              {user.nome || user.email || 'Sem nome'}
            </p>

            {user.username ? (
              <p className="truncate font-mono text-sm text-slate-500">@{user.username}</p>
            ) : (
              <span className="mt-1 inline-flex items-center rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                Convite pendente
              </span>
            )}
          </div>
        </div>

        {/* GRUPO(S) — pill editável, com a mesma cor que a de setor tinha. O
            gatilho já mostra os grupos separados por vírgula. O setor (`role`)
            não é editável aqui de propósito: ele é comparado literalmente em
            dezenas de policies de RLS, então mora só em Permissões → "Editar
            perfil", onde a troca é uma decisão consciente. */}
        <div className={`w-full max-w-55 ${grupoStyle(nomesGruposDraft).text}`}>
          <MultiSearchCombobox<string>
            opcoes={grupos}
            selecionados={gruposDraft}
            onToggle={toggleGrupo}
            placeholder="Sem grupo"
            nomePlural="grupos"
            resumoCompleto
            variant="plano"
            disabled={disabled}
            triggerRef={grupoTriggerRef}
            ariaLabel={`Grupos de ${user.nome || user.email || 'usuário'}`}
            className={`min-h-11 cursor-pointer rounded-full py-2 pl-4 pr-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${grupoStyle(nomesGruposDraft).bg}`}
          />
        </div>

        {/* UNIDADE(S) — chips empilhados */}
        <div
          role="group"
          aria-label={`Unidades de ${user.nome || user.email || 'usuário'}`}
          className="flex flex-col items-start gap-1"
        >
          {UNIDADES_DISPONIVEIS.map((unidade) => {
            const ativa = unidadesDraft.includes(unidade)
            return (
              <button
                key={unidade}
                type="button"
                disabled={disabled}
                aria-pressed={ativa}
                onClick={() => toggleUnidade(unidade)}
                className={`w-32 rounded-full px-3 py-1.5 text-center text-xs font-semibold ring-1 ring-inset transition disabled:opacity-50 ${
                  ativa
                    ? UNIDADE_STYLES[unidade]
                    : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {unidade}
              </button>
            )
          })}
        </div>

        {/* STATUS */}
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
            user.ativo ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${user.ativo ? 'bg-emerald-500' : 'bg-rose-500'}`}
            aria-hidden="true"
          />
          {user.ativo ? 'Ativo' : 'Inativo'}
        </span>

        {/* EMAIL — quebra em vez de esticar a linha */}
        <p className="min-w-0 text-sm wrap-break-word text-slate-500">{user.email || '-'}</p>

        {/* AÇÕES — fora da grade nos tamanhos menores, pra ancorar no topo direito
            do card em vez de sobrar numa linha só dele. */}
        <div className="absolute top-3 right-3 xl:static xl:flex xl:justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              aria-label={`Ações para ${user.nome || user.email || 'usuário'}`}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 data-open:bg-slate-100 data-open:text-slate-900"
            >
              <MoreVertical size={18} aria-hidden="true" />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              onCloseAutoFocus={(event) => {
                if (!focarGrupoAoFechar.current) return
                focarGrupoAoFechar.current = false
                event.preventDefault()
                grupoTriggerRef.current?.focus()
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  focarGrupoAoFechar.current = true
                }}
              >
                <Pencil aria-hidden="true" />
                Editar
              </DropdownMenuItem>

              {!user.username ? (
                <DropdownMenuItem
                  onSelect={() =>
                    onResendInvite(user.id, user.email ?? '', user.nome ?? '', user.role ?? '')
                  }
                >
                  <Send aria-hidden="true" />
                  {isLoading ? 'Enviando...' : 'Reenviar convite'}
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      onResetPassword(
                        user.id,
                        user.nome ?? user.email ?? 'usuário',
                        user.email ?? '',
                        user.username ?? ''
                      )
                    }
                  >
                    <KeyRound aria-hidden="true" />
                    Redefinir senha
                  </DropdownMenuItem>

                  <DropdownMenuItem onSelect={() => onToggleActive(user.id, !!user.ativo)}>
                    {user.ativo ? <Ban aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                    {user.ativo ? 'Desativar' : 'Ativar'}
                  </DropdownMenuItem>
                </>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" onSelect={onRequestDelete}>
                <Trash2 aria-hidden="true" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Rodapés contextuais — a confirmação de exclusão tem prioridade sobre o
          aviso de alterações pendentes por ser uma decisão bloqueante. */}
      {confirmDelete ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-rose-100 bg-rose-50/70 px-5 py-3">
          <p className="text-sm font-medium text-rose-700">
            Excluir {user.nome || user.email || 'este usuário'} definitivamente?
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onCancelDelete}
              disabled={disabled}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              onClick={onConfirmDelete}
              disabled={disabled}
              className="inline-flex min-h-11 items-center rounded-xl border border-red-300 bg-red-50 px-4 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
            >
              Confirmar exclusão
            </button>
          </div>
        </div>
      ) : dirty ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <p className="text-sm text-slate-500">Alterações não salvas.</p>

          <button
            onClick={() => onSaveUser(user.id, user.role ?? '', unidadesDraft, [...gruposDraft])}
            disabled={disabled}
            className="inline-flex min-h-11 items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {isLoading ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      ) : null}
    </li>
  )
}
