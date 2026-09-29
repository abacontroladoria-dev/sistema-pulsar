'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  KeyRound,
  MinusCircle,
  Pencil,
  PlusCircle,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound,
  Trash2,
  X,
  Lock,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useHeader } from '@/contexts/HeaderContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getAdminUsers } from '@/services/admin.service'
import type { AdminUser } from '@/services/admin.service'
import {
  getAllUsuariosPermissoes,
  getPermissoes,
  getUsuarioPermissoes,
  removerAjustes,
  salvarAjustes,
} from '@/services/permissoes.service'
import type { Permissao } from '@/services/permissoes.service'
import {
  adicionarMembro,
  criarGrupo,
  excluirGrupo,
  getAllMembrosPorGrupo,
  getGrupos,
  removerMembro,
  renomearGrupo,
  salvarModeloGrupo,
  sincronizarGruposDoUsuario,
} from '@/services/grupos.service'
import type { Grupo } from '@/services/grupos.service'
import { podeAcessarRota, resolverPermissoes, uniaoDosModelos } from '@/lib/permissions/resolver'
import type { OverridePermissao } from '@/lib/permissions/resolver'
import { carregarPermissoesEfetivas } from '@/lib/permissions/carregar'
import { MENU_ICONE_GRUPO, MENU_ORDEM_GRUPOS, MENU_ORDEM_ITEM, MENU_POR_CODIGO } from '@/lib/permissions/menu'
import { getAvatarColor } from '@/lib/admin/avatar-color'
import { MultiSearchCombobox } from '@/components/cronograma/ui/MultiSearchCombobox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const supabase = getSupabaseClient()

// ─── Constantes ───────────────────────────────────────────────────────────────

// Nome, grupo, ícone e ordem vêm do menu (lib/permissions/menu.ts), a mesma
// fonte do Sidebar — a tela nunca mostra uma tela com nome diferente do menu.
const INITIAL_OPEN = new Set(MENU_ORDEM_GRUPOS)

function iconeDoModulo(codigo: string): React.ElementType {
  return MENU_POR_CODIGO[codigo]?.icon || ShieldCheck
}

// O catálogo do banco, alinhado ao menu: só entram códigos que têm item no
// Sidebar (o que sobra no banco é tela que não existe), com rótulo e grupo do
// menu e na ordem dele. Não depende da coluna `ordem` do banco, então a tela já
// sai certa mesmo antes da migration 20260929120000 ser aplicada.
function alinharAoMenu(permissoes: Permissao[]): Permissao[] {
  return permissoes
    .filter(p => MENU_POR_CODIGO[p.codigo])
    .map(p => ({ ...p, nome: MENU_POR_CODIGO[p.codigo].label, grupo: MENU_POR_CODIGO[p.codigo].grupo }))
    .sort((a, b) => MENU_ORDEM_ITEM[a.codigo] - MENU_ORDEM_ITEM[b.codigo])
}

// O catálogo do banco (public.permissoes) não se auto-atualiza quando o menu
// muda — um código novo em menu.ts só vira concedível depois de uma migration
// (o FK de usuarios_permissoes.permissao_codigo exige a linha existir). Sem
// isso, um item novo do Sidebar simplesmente não aparece aqui, e ninguém
// percebe até alguém pedir a tela por engano — foi assim que o catálogo e o
// menu divergiram por meses antes de 29/09/2026. Este aviso torna a divergência
// visível sozinha, sem depender de alguém lembrar de conferir.
function calcularDriftCatalogo(banco: Permissao[]): { faltamNoBanco: string[]; sobramNoBanco: string[] } {
  const codigosBanco = new Set(banco.map(p => p.codigo))
  const codigosMenu = new Set(Object.keys(MENU_POR_CODIGO))
  return {
    faltamNoBanco: Object.keys(MENU_POR_CODIGO).filter(c => !codigosBanco.has(c)),
    sobramNoBanco: banco.map(p => p.codigo).filter(c => !codigosMenu.has(c)),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Telas efetivas: grupos ao vivo + ajustes individuais — a mesma regra que o
// banco aplica em permissoes_efetivas() (resolver.ts). `ajustes` são as linhas de
// usuarios_permissoes da pessoa; `modelos`, os dos grupos dela.
function computeEffectivePerms(
  ajustes: Record<string, boolean>,
  modelos: Record<string, boolean>[],
  allPermissoes: Permissao[]
): Record<string, boolean> {
  const lista: OverridePermissao[] = Object.entries(ajustes).map(
    ([permissao_codigo, permitido]) => ({ permissao_codigo, permitido })
  )
  const codigos = resolverPermissoes(lista, modelos)
  const effective: Record<string, boolean> = {}
  for (const p of allPermissoes) effective[p.codigo] = codigos.has(p.codigo)
  return effective
}

// Códigos em que as telas da pessoa diferem do que os grupos dela dão — o
// "fora do modelo". Por VALOR, e não por existir linha gravada: uma linha que só
// repete o grupo não é ajuste.
function codigosAjustados(
  efetivo: Record<string, boolean>,
  uniao: Set<string>,
  allPermissoes: Permissao[]
): Set<string> {
  const ajustados = new Set<string>()
  for (const p of allPermissoes) if ((efetivo[p.codigo] ?? false) !== uniao.has(p.codigo)) ajustados.add(p.codigo)
  return ajustados
}

// Modelos dos grupos de `userId`. `troca` substitui o modelo de um grupo (o
// modelo em edição, ainda não salvo) e `semGrupoId` tira um grupo — é assim que
// as confirmações mostram o que muda ANTES de gravar.
function modelosDoUsuario(
  gruposDoUsuario: Record<string, Grupo[]>,
  userId: string,
  opcoes?: { troca?: { grupoId: string; modelo: Record<string, boolean> }; semGrupoId?: string }
): Record<string, boolean>[] {
  return (gruposDoUsuario[userId] || [])
    .filter(g => g.id !== opcoes?.semGrupoId)
    .map(g => (opcoes?.troca && g.id === opcoes.troca.grupoId ? opcoes.troca.modelo : g.modelo_permissoes))
}

// Detalhe do "fora do modelo", comparando a pessoa com a SOMA dos grupos dela:
//   * faltam: telas que algum grupo dá e a pessoa não tem (retiradas só dela) —
//     com os grupos que as dão, porque com dois grupos importa saber de onde vem;
//   * aMais: telas que a pessoa tem e nenhum grupo dá (liberadas só para ela).
// Uma tela que um grupo dá e o outro não dá NÃO é ajuste: a soma já a inclui.
function detalheDoAjuste(
  ajustes: Record<string, boolean>,
  grupos: Grupo[],
  allPermissoes: Permissao[]
): { faltam: { permissao: Permissao; grupos: string[] }[]; aMais: Permissao[] } {
  const efetivo = computeEffectivePerms(ajustes, grupos.map(g => g.modelo_permissoes), allPermissoes)
  const faltam: { permissao: Permissao; grupos: string[] }[] = []
  const aMais: Permissao[] = []
  for (const p of allPermissoes) {
    const deQuais = grupos.filter(g => g.modelo_permissoes[p.codigo]).map(g => g.nome)
    const tem = efetivo[p.codigo] ?? false
    if (deQuais.length > 0 && !tem) faltam.push({ permissao: p, grupos: deQuais })
    if (deQuais.length === 0 && tem) aMais.push(p)
  }
  return { faltam, aMais }
}

// "O grupo passa a condizer com o usuário": os modelos que resultam de levar o
// ajuste individual da pessoa para os grupos dela.
//   * o que ela tem a mais entra no grupo escolhido (`destinoId`);
//   * o que falta nela sai de TODOS os grupos dela que dão a tela — se saísse de
//     um só, o outro continuaria dando, e ela continuaria fora do modelo.
// Devolve só os grupos que mudam, com o modelo completo de cada um.
function modelosLevandoAjusteAosGrupos(
  gruposDela: Grupo[],
  detalhe: { faltam: { permissao: Permissao; grupos: string[] }[]; aMais: Permissao[] },
  destinoId: string | null
): Record<string, Record<string, boolean>> {
  const novos: Record<string, Record<string, boolean>> = {}
  const modeloDe = (g: Grupo) => (novos[g.id] ??= { ...g.modelo_permissoes })
  if (destinoId) {
    const destino = gruposDela.find(g => g.id === destinoId)
    if (destino) for (const p of detalhe.aMais) modeloDe(destino)[p.codigo] = true
  }
  for (const { permissao, grupos: deQuais } of detalhe.faltam) {
    for (const g of gruposDela) if (deQuais.includes(g.nome)) modeloDe(g)[permissao.codigo] = false
  }
  return novos
}

// O que muda para uma pessoa entre dois estados: telas que ela passa a ter e
// telas que perde. Mostrado ANTES de gravar — nada retira acesso às cegas.
function diferencaDoModelo(
  efetivo: Record<string, boolean>,
  modelo: Record<string, boolean>,
  allPermissoes: Permissao[]
): { ganha: Permissao[]; perde: Permissao[] } {
  const ganha: Permissao[] = []
  const perde: Permissao[] = []
  for (const p of allPermissoes) {
    const tem = efetivo[p.codigo] ?? false
    const vai = modelo[p.codigo] ?? false
    if (vai && !tem) ganha.push(p)
    if (tem && !vai) perde.push(p)
  }
  return { ganha, perde }
}

function listarNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? ''
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
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

// Grupos da pessoa numa única linha nas listas das três visões. O nível técnico
// (`role`) não aparece aqui de propósito: quem organiza o acesso é o grupo; o
// nível só é mostrado no detalhe da pessoa.
function GruposDaPessoa({ grupos }: { grupos: string[] }) {
  return (
    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 leading-tight">
      {grupos.length > 0 ? (
        <>
          <UsersRound size={11} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{grupos.join(', ')}</span>
        </>
      ) : (
        <span className="shrink-0 whitespace-nowrap text-slate-500 italic">Sem grupo</span>
      )}
    </p>
  )
}

// Uma tela na lista do "fora do modelo": o ícone e a seção do menu (os mesmos do
// Sidebar) para a pessoa reconhecer a tela de relance; o tom diz se ela está a
// mais ou a menos. `grupos`: de onde a tela vem, só quando falta na pessoa.
function LinhaAjuste({ permissao, tom, grupos }: {
  permissao: Permissao
  tom: 'falta' | 'aMais'
  grupos?: string[]
}) {
  const Icon = MENU_POR_CODIGO[permissao.codigo]?.icon ?? ShieldCheck
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          tom === 'falta' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
        }`}
      >
        <Icon size={15} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800">{permissao.nome}</span>
        <span className="block truncate text-xs text-slate-500">Menu: {permissao.grupo}</span>
      </span>
      {grupos && grupos.length > 0 && (
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {grupos.map(g => (
            <span key={g} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              <UsersRound size={11} aria-hidden="true" />
              {g}
            </span>
          ))}
        </span>
      )}
    </li>
  )
}

// Lista de telas que um "Aplicar" vai liberar ou retirar.
function ListaDiferenca({ titulo, itens, tom }: { titulo: string; itens: Permissao[]; tom: 'ganha' | 'perde' }) {
  if (itens.length === 0) return null
  return (
    <div>
      <p className={`text-xs font-semibold mb-1 ${tom === 'ganha' ? 'text-emerald-700' : 'text-rose-700'}`}>
        {titulo} ({itens.length})
      </p>
      <ul className="max-h-40 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
        {itens.map(p => (
          <li key={p.codigo} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm text-slate-700">
            <span className="truncate">{p.nome}</span>
            <span className="shrink-0 text-xs text-slate-500">{p.grupo}</span>
          </li>
        ))}
      </ul>
    </div>
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

function GroupCard({ grupo, items, perms, isOpen, onToggleOpen, onToggle, ajustados }: {
  grupo: string
  items: Permissao[]
  perms: Record<string, boolean>
  isOpen: boolean
  onToggleOpen: () => void
  onToggle: (codigo: string, value: boolean) => void
  /** "Por usuário": telas em que a pessoa difere dos grupos dela. */
  ajustados?: Set<string>
}) {
  const checkedCount = items.filter(p => perms[p.codigo] ?? false).length
  const allChecked = checkedCount === items.length && items.length > 0
  const someChecked = checkedCount > 0 && !allChecked

  const GroupIcon = MENU_ICONE_GRUPO[grupo] || ShieldCheck

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
            const Icon = iconeDoModulo(p.codigo)
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
                  {ajustados?.has(p.codigo) && (
                    <span
                      className="ml-auto shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                      title={permitted ? 'Liberada só para esta pessoa — os grupos dela não dão' : 'Retirada só desta pessoa — os grupos dela dão'}
                    >
                      Ajuste individual
                    </span>
                  )}
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
  const [motivoBloqueio, setMotivoBloqueio] = useState<'codigo' | 'nivel' | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [permissoes, setPermissoes] = useState<Permissao[]>([])
  const [driftCatalogo, setDriftCatalogo] = useState<{ faltamNoBanco: string[]; sobramNoBanco: string[] } | null>(null)
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [perms, setPerms] = useState<Record<string, boolean>>({})
  const [originalPerms, setOriginalPerms] = useState<Record<string, boolean>>({})
  const [loadingUser, setLoadingUser] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(INITIAL_OPEN)

  // ─── View "por permissão" (quem tem acesso a X) ──────────────────────────
  const [viewMode, setViewMode] = useState<'usuario' | 'permissao' | 'grupo'>('usuario')
  const [allOverrides, setAllOverrides] = useState<Record<string, Record<string, boolean>>>({})
  const [loadingOverrides, setLoadingOverrides] = useState(false)
  const [selectedCodigo, setSelectedCodigo] = useState<string | null>(null)
  const [permissaoSearch, setPermissaoSearch] = useState('')
  const [userSearchByPerm, setUserSearchByPerm] = useState('')
  const [onlyGranted, setOnlyGranted] = useState(true)
  // Liberar/retirar a tela de um GRUPO inteiro, direto da visão "Por permissão".
  // `grupoToggleAlvo` segura a confirmação: mexer no modelo muda a tela de todos
  // os membros de uma vez, então nada é gravado sem mostrar quem muda.
  const [grupoToggleAlvo, setGrupoToggleAlvo] = useState<{ grupo: Grupo; valor: boolean } | null>(null)
  const [grupoActionId, setGrupoActionId] = useState<string | null>(null)
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
  const [savingModelo, setSavingModelo] = useState(false)
  const [showSalvarModeloConfirm, setShowSalvarModeloConfirm] = useState(false)
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
  const [usuarioDetalhe, setUsuarioDetalhe] = useState<AdminUser | null>(null)
  // Terceira saída do "fora do modelo": o grupo passa a seguir a pessoa.
  const [levandoAoGrupo, setLevandoAoGrupo] = useState(false)
  const [grupoDestinoId, setGrupoDestinoId] = useState<string | null>(null)
  // "Editar grupos" da pessoa selecionada em "Por usuário".
  const [showEditGruposUsuario, setShowEditGruposUsuario] = useState(false)
  const [gruposDraftUsuario, setGruposDraftUsuario] = useState<Set<string>>(new Set())
  const [salvandoGruposUsuario, setSalvandoGruposUsuario] = useState(false)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)

  useEffect(() => {
    setHeader('Permissões', 'Gerencie as permissões de acesso dos usuários aos módulos do sistema.')
  }, [setHeader])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setIsAdmin(false); return }
      const [{ data: perfil }, codigos] = await Promise.all([
        supabase.from('usuarios').select('role').eq('id', data.user.id).single(),
        carregarPermissoesEfetivas(supabase),
      ])
      const role = perfil?.role ?? ''
      // 1. A tela: mesma regra do proxy e do Sidebar (código `permissoes`).
      if (!podeAcessarRota(role, codigos, '/admin/permissoes')) {
        setMotivoBloqueio('codigo')
        setIsAdmin(false)
        return
      }
      // 2. O banco: as policies de usuarios_permissoes e grupos_permissoes só
      // aceitam escrita de admin e diretoria (is_admin/is_diretoria,
      // 20260713140000 e 20260819120000). Deixar outro nível entrar mostraria
      // uma lista de grupos vazia e salvamentos que falham.
      if (role !== 'admin' && role !== 'diretoria') {
        setMotivoBloqueio('nivel')
        setIsAdmin(false)
        return
      }
      setIsAdmin(true)
    })
  }, [])

  useEffect(() => {
    if (isAdmin !== true) return
    Promise.all([getAdminUsers(), getPermissoes()]).then(([u, p]) => {
      setUsers(u)
      setPermissoes(alinharAoMenu(p))
      setDriftCatalogo(calcularDriftCatalogo(p))
    })
  }, [isAdmin])

  useEffect(() => {
    // Todas as visões usam: "Por usuário" marca quem está fora do modelo na lista.
    if (isAdmin !== true) return
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
  }, [isAdmin, allOverrides])

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
    const ordered = MENU_ORDEM_GRUPOS
      .filter(g => map.has(g))
      .map(g => [g, map.get(g)!] as [string, Permissao[]])
    const rest = Array.from(map.entries()).filter(([g]) => !MENU_ORDEM_GRUPOS.includes(g))
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

  function modelosDe(
    userId: string,
    opcoes?: { troca?: { grupoId: string; modelo: Record<string, boolean> }; semGrupoId?: string }
  ) {
    return modelosDoUsuario(gruposDoUsuario, userId, opcoes)
  }

  // O que os grupos de `userId` dão, com todos os códigos do catálogo.
  function modeloCompletoDe(userId: string) {
    const uniao = uniaoDosModelos(modelosDe(userId))
    const completo: Record<string, boolean> = {}
    for (const p of permissoes) completo[p.codigo] = uniao.has(p.codigo)
    return completo
  }

  // Em "Por permissão", cada pessoa vem com a ORIGEM do acesso: `viaGrupo` diz
  // se algum grupo dela dá a tela. Sem isso, a lista mostra "Liberado" sem dizer
  // se veio do grupo ou de um ajuste só dela — e quem confere não sabe onde
  // mexer para corrigir.
  const usersForSelectedCodigo = useMemo(() => {
    if (!selectedCodigo) return []
    return users.map(u => {
      const modelos = modelosDoUsuario(gruposDoUsuario, u.id)
      const efetivo = computeEffectivePerms(allOverrides[u.id] || {}, modelos, permissoes)
      return {
        user: u,
        granted: efetivo[selectedCodigo] ?? false,
        viaGrupo: uniaoDosModelos(modelos).has(selectedCodigo),
      }
    })
  }, [users, allOverrides, selectedCodigo, permissoes, gruposDoUsuario])

  // Grupos que dão (ou não) a tela selecionada, com quantos membros cada um tem.
  // É a outra metade da conferência: a lista de usuários mostra QUEM tem acesso,
  // esta mostra DE ONDE ele vem — um grupo indevido libera a tela para todo
  // mundo nele de uma vez, e só aqui isso aparece.
  const gruposForSelectedCodigo = useMemo(() => {
    if (!selectedCodigo) return []
    return grupos
      .map(g => ({
        grupo: g,
        granted: g.modelo_permissoes?.[selectedCodigo] === true,
        membros: (membrosPorGrupo[g.id] || []).length,
      }))
      .sort((a, b) => Number(b.granted) - Number(a.granted) || a.grupo.nome.localeCompare(b.grupo.nome))
  }, [grupos, membrosPorGrupo, selectedCodigo])

  const gruposComAcessoCount = useMemo(
    () => gruposForSelectedCodigo.filter(x => x.granted).length,
    [gruposForSelectedCodigo]
  )

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

  // "Fora do modelo": membro com ajuste individual — uma tela a mais ou a menos
  // do que os grupos dele dão, liberada/retirada em "Por usuário" ou "Por
  // permissão". Com os grupos ao vivo, é o ÚNICO jeito de alguém divergir: mudar
  // o modelo ou os grupos da pessoa já muda as telas dela.
  const usuariosForaDoModelo = useMemo(() => {
    const fora = new Set<string>()
    if (loadingOverrides) return fora
    for (const u of users) {
      const modelos = modelosDoUsuario(gruposDoUsuario, u.id)
      const efetivo = computeEffectivePerms(allOverrides[u.id] || {}, modelos, permissoes)
      if (codigosAjustados(efetivo, uniaoDosModelos(modelos), permissoes).size > 0) fora.add(u.id)
    }
    return fora
  }, [users, allOverrides, permissoes, loadingOverrides, gruposDoUsuario])

  const driftedMemberIds = useMemo(
    () => new Set(selectedGrupo ? selectedGrupoMembroIds.filter(uid => usuariosForaDoModelo.has(uid)) : []),
    [selectedGrupo, selectedGrupoMembroIds, usuariosForaDoModelo]
  )

  // "Por usuário": telas em que a pessoa selecionada difere dos grupos dela,
  // já contando o que foi marcado/desmarcado e ainda não salvo.
  const ajustadosDoSelecionado = useMemo(() => {
    if (!selectedUser) return new Set<string>()
    return codigosAjustados(perms, uniaoDosModelos(modelosDoUsuario(gruposDoUsuario, selectedUser.id)), permissoes)
  }, [selectedUser, perms, permissoes, gruposDoUsuario])

  // ─── Handlers (lógica de negócio inalterada) ─────────────────────────────

  async function handleSelectUser(user: AdminUser) {
    setSelectedUser(user)
    setLoadingUser(true)
    const overrides = await getUsuarioPermissoes(user.id)
    const overrideMap = Object.fromEntries(overrides.map(o => [o.permissao_codigo, o.permitido]))
    const effective = computeEffectivePerms(overrideMap, modelosDe(user.id), permissoes)
    setPerms(effective)
    setOriginalPerms({ ...effective })
    setLoadingUser(false)
  }

  // Espelha localmente o que salvarAjustes gravou: só ficam os códigos que
  // diferem dos grupos. Só mexe em allOverrides se ele já foi carregado (as
  // visões "Por permissão"/"Por grupo" o carregam na primeira abertura).
  function atualizarAjustesLocais(userId: string, desejado: Record<string, boolean>, uniao: Set<string>) {
    setAllOverrides(prev => {
      if (Object.keys(prev).length === 0) return prev
      const atual = { ...(prev[userId] || {}) }
      for (const [codigo, valor] of Object.entries(desejado)) {
        if (valor === uniao.has(codigo)) delete atual[codigo]
        else atual[codigo] = valor
      }
      return { ...prev, [userId]: atual }
    })
  }

  async function handleSave() {
    if (!selectedUser) return
    setSaving(true)
    // Grava só o que difere dos grupos (ajuste individual); o que voltou a ser
    // igual ao grupo deixa de ser ajuste.
    const uniao = uniaoDosModelos(modelosDe(selectedUser.id))
    const ok = await salvarAjustes(selectedUser.id, perms, uniao)
    if (ok) {
      setOriginalPerms({ ...perms })
      atualizarAjustesLocais(selectedUser.id, perms, uniao)
      toast.success('Permissões salvas com sucesso')
    } else {
      toast.error('Erro ao salvar permissões')
    }
    setSaving(false)
  }

  // "Restaurar modelo dos grupos": apaga os ajustes individuais — a pessoa fica
  // exatamente com o que os grupos dela dão (e acompanha qualquer mudança neles).
  async function handleRestore() {
    if (!selectedUser) return
    setRestoring(true)
    const ok = await removerAjustes(selectedUser.id)
    if (ok) {
      const effective = modeloCompletoDe(selectedUser.id)
      setPerms(effective)
      setOriginalPerms({ ...effective })
      setAllOverrides(prev => (Object.keys(prev).length > 0 ? { ...prev, [selectedUser.id]: {} } : prev))
      toast.success('Permissões restauradas para o modelo dos grupos')
      setShowRestoreConfirm(false)
    } else {
      toast.error('Erro ao restaurar permissões')
    }
    setRestoring(false)
  }

  function handleToggle(codigo: string, value: boolean) {
    setPerms(prev => ({ ...prev, [codigo]: value }))
  }

  async function handleGrantAccessToCodigo(userId: string) {
    if (!selectedCodigo) return
    setGrantingUserId(userId)
    const uniao = uniaoDosModelos(modelosDe(userId))
    const ok = await salvarAjustes(userId, { [selectedCodigo]: true }, uniao)
    if (ok) {
      atualizarAjustesLocais(userId, { [selectedCodigo]: true }, uniao)
      toast.success('Acesso liberado com sucesso')
    } else {
      toast.error('Erro ao liberar acesso')
    }
    setGrantingUserId(null)
  }

  async function handleRevokeAccessToCodigo(userId: string) {
    if (!selectedCodigo) return
    setGrantingUserId(userId)
    const uniao = uniaoDosModelos(modelosDe(userId))
    const ok = await salvarAjustes(userId, { [selectedCodigo]: false }, uniao)
    if (ok) {
      atualizarAjustesLocais(userId, { [selectedCodigo]: false }, uniao)
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
      // O nível técnico pode ter mudado no banco (gatilho de grupos) — relê.
      setUsers(await getAdminUsers())
      toast.success(`Adicionado — já tem as telas de ${selectedGrupo.nome}`)
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
      setUsers(await getAdminUsers())
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

  // O que salvar o modelo em edição muda para cada membro — mostrado na
  // confirmação. Compara as telas de hoje com as telas com o modelo novo, já
  // contando os outros grupos e os ajustes individuais de cada um.
  function impactoDoModeloEmEdicao() {
    if (!selectedGrupo) return []
    return selectedGrupoMembros
      .map(user => {
        const ajustes = allOverrides[user.id] || {}
        const antes = computeEffectivePerms(ajustes, modelosDe(user.id), permissoes)
        const depois = computeEffectivePerms(
          ajustes,
          modelosDe(user.id, { troca: { grupoId: selectedGrupo.id, modelo: grupoModeloPerms } }),
          permissoes
        )
        return { user, ...diferencaDoModelo(antes, depois, permissoes) }
      })
      .filter(x => x.ganha.length > 0 || x.perde.length > 0)
  }

  // O modelo de `grupo` com a tela selecionada ligada/desligada, completo (todos
  // os códigos do catálogo), pronto para salvar.
  function modeloComCodigo(grupo: Grupo, codigo: string, valor: boolean) {
    const completo: Record<string, boolean> = {}
    for (const p of permissoes) completo[p.codigo] = grupo.modelo_permissoes?.[p.codigo] ?? false
    completo[codigo] = valor
    return completo
  }

  // O que trocar o modelo de um grupo muda para cada membro dele — a mesma conta
  // de impactoDoModeloEmEdicao, para um grupo qualquer.
  function impactoDoModeloDeGrupo(grupo: Grupo, modeloNovo: Record<string, boolean>) {
    return users
      .filter(u => (membrosPorGrupo[grupo.id] || []).includes(u.id))
      .map(user => {
        const ajustes = allOverrides[user.id] || {}
        const antes = computeEffectivePerms(ajustes, modelosDe(user.id), permissoes)
        const depois = computeEffectivePerms(
          ajustes,
          modelosDe(user.id, { troca: { grupoId: grupo.id, modelo: modeloNovo } }),
          permissoes
        )
        return { user, ...diferencaDoModelo(antes, depois, permissoes) }
      })
      .filter(x => x.ganha.length > 0 || x.perde.length > 0)
  }

  // Liberar/retirar a tela selecionada de um grupo inteiro, em "Por permissão".
  // Grava só o modelo: as telas dos membros acompanham (grupos ao vivo). Quem
  // tem ajuste individual nessa tela continua com o ajuste — por isso a
  // confirmação mostra o impacto real, membro a membro, e não a lista de membros.
  async function handleToggleGrupoCodigo(grupo: Grupo, valor: boolean) {
    if (!selectedCodigo) return
    setGrupoActionId(grupo.id)
    const modeloCompleto = modeloComCodigo(grupo, selectedCodigo, valor)
    const ok = await salvarModeloGrupo(grupo.id, modeloCompleto)
    if (ok) {
      setGrupos(prev => prev.map(g => (g.id === grupo.id ? { ...g, modelo_permissoes: modeloCompleto } : g)))
      if (selectedGrupo?.id === grupo.id) {
        setSelectedGrupo({ ...selectedGrupo, modelo_permissoes: modeloCompleto })
        setGrupoModeloPerms({ ...modeloCompleto })
      }
      toast.success(valor ? `Acesso liberado para ${grupo.nome}` : `Acesso retirado de ${grupo.nome}`)
      setGrupoToggleAlvo(null)
    } else {
      toast.error('Erro ao salvar o modelo do grupo')
    }
    setGrupoActionId(null)
  }

  // Salva o modelo — e é só isso: com os grupos ao vivo, o modelo salvo JÁ é o
  // que os membros têm (o banco calcula na hora, permissoes_efetivas). Grava o
  // valor de todos os códigos do catálogo, não só os marcados, para o modelo
  // nunca ter código "não decidido".
  async function handleSalvarModelo() {
    if (!selectedGrupo) return
    setSavingModelo(true)
    const modeloCompleto: Record<string, boolean> = {}
    for (const p of permissoes) modeloCompleto[p.codigo] = grupoModeloPerms[p.codigo] ?? false

    const ok = await salvarModeloGrupo(selectedGrupo.id, modeloCompleto)
    if (ok) {
      const updated = { ...selectedGrupo, modelo_permissoes: modeloCompleto }
      setSelectedGrupo(updated)
      setGrupoModeloPerms({ ...modeloCompleto })
      setGrupos(prev => prev.map(g => (g.id === updated.id ? updated : g)))
      const n = selectedGrupoMembros.length
      toast.success(`Modelo salvo — já vale para ${n} membro${n !== 1 ? 's' : ''}`)
      setShowSalvarModeloConfirm(false)
    } else {
      toast.error('Erro ao salvar modelo de permissões do grupo')
    }
    setSavingModelo(false)
  }

  // "Editar grupos" da pessoa selecionada. Grava só o vínculo: as telas mudam
  // sozinhas (grupos ao vivo) e o nível técnico é acertado pelo gatilho do banco.
  // Os ajustes individuais dela continuam valendo.
  function handleAbrirEditGruposUsuario() {
    if (!selectedUser) return
    setGruposDraftUsuario(new Set((gruposDoUsuario[selectedUser.id] || []).map(g => g.id)))
    setShowEditGruposUsuario(true)
  }

  function toggleGrupoDraftUsuario(grupoId: string) {
    setGruposDraftUsuario(prev => {
      const next = new Set(prev)
      if (next.has(grupoId)) next.delete(grupoId)
      else next.add(grupoId)
      return next
    })
  }

  async function handleSalvarGruposUsuario() {
    if (!selectedUser) return
    setSalvandoGruposUsuario(true)
    const atuais = (gruposDoUsuario[selectedUser.id] || []).map(g => g.id)
    const alvo = [...gruposDraftUsuario]
    const ok = await sincronizarGruposDoUsuario(selectedUser.id, alvo, atuais)
    if (ok) {
      const uid = selectedUser.id
      const alvoSet = new Set(alvo)
      const novoMembros: Record<string, string[]> = {}
      for (const g of grupos) {
        const semEle = (membrosPorGrupo[g.id] || []).filter(id => id !== uid)
        novoMembros[g.id] = alvoSet.has(g.id) ? [...semEle, uid] : semEle
      }
      setMembrosPorGrupo(novoMembros)
      // As telas da pessoa com os grupos novos (os ajustes dela continuam).
      const modelosNovos = grupos.filter(g => alvoSet.has(g.id)).map(g => g.modelo_permissoes)
      const efetivo = computeEffectivePerms(allOverrides[uid] || {}, modelosNovos, permissoes)
      setPerms(efetivo)
      setOriginalPerms({ ...efetivo })
      // O nível técnico pode ter mudado no banco (gatilho de grupos) — relê.
      const lista = await getAdminUsers()
      setUsers(lista)
      setSelectedUser(lista.find(u => u.id === uid) ?? selectedUser)
      toast.success('Grupos atualizados — as telas já seguem os grupos novos')
      setShowEditGruposUsuario(false)
    } else {
      toast.error('Erro ao salvar os grupos')
    }
    setSalvandoGruposUsuario(false)
  }

  function fecharDetalhe() {
    setUsuarioDetalhe(null)
    setLevandoAoGrupo(false)
    setGrupoDestinoId(null)
  }

  // "O grupo passa a condizer com o usuário": grava os modelos novos e apaga os
  // ajustes da pessoa — que viraram redundantes, porque agora o grupo dá (ou
  // deixa de dar) exatamente o que ela tinha. As telas DELA não mudam; as dos
  // outros membros mudam como mostrado na confirmação.
  async function handleLevarAjusteAoGrupo(
    userId: string,
    novos: Record<string, Record<string, boolean>>
  ) {
    setSavingModelo(true)
    const completos: Record<string, Record<string, boolean>> = {}
    for (const [grupoId, modelo] of Object.entries(novos)) {
      const completo: Record<string, boolean> = {}
      for (const p of permissoes) completo[p.codigo] = modelo[p.codigo] ?? false
      completos[grupoId] = completo
    }

    for (const [grupoId, completo] of Object.entries(completos)) {
      if (!(await salvarModeloGrupo(grupoId, completo))) {
        toast.error('Erro ao salvar o modelo do grupo — nada mais foi alterado')
        setSavingModelo(false)
        return
      }
    }
    setGrupos(prev => prev.map(g => (completos[g.id] ? { ...g, modelo_permissoes: completos[g.id] } : g)))
    if (selectedGrupo && completos[selectedGrupo.id]) {
      setSelectedGrupo({ ...selectedGrupo, modelo_permissoes: completos[selectedGrupo.id] })
      setGrupoModeloPerms({ ...completos[selectedGrupo.id] })
    }

    const ok = await removerAjustes(userId)
    if (ok) {
      setAllOverrides(prev => ({ ...prev, [userId]: {} }))
      toast.success('Grupo atualizado — agora condiz com a pessoa')
    } else {
      toast.error('O grupo foi atualizado, mas os ajustes da pessoa não foram removidos')
    }
    setSavingModelo(false)
  }

  // "Voltar ao modelo" de um membro fora do modelo: apaga os ajustes individuais
  // dele — passa a ter só o que os grupos dele dão.
  async function handleVoltarAoModelo(userId: string) {
    setSavingModelo(true)
    const ok = await removerAjustes(userId)
    if (ok) {
      setAllOverrides(prev => ({ ...prev, [userId]: {} }))
      if (selectedUser?.id === userId) {
        const efetivo = modeloCompletoDe(userId)
        setPerms(efetivo)
        setOriginalPerms({ ...efetivo })
      }
      toast.success('Ajustes individuais removidos')
    } else {
      toast.error('Erro ao remover os ajustes individuais')
    }
    setSavingModelo(false)
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
            {motivoBloqueio === 'nivel'
              ? 'Gerenciar acessos é exclusivo dos grupos Administrador e Diretoria.'
              : 'Apenas administradores podem gerenciar permissões.'}
          </p>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Aviso: catálogo do banco divergente do menu ── */}
      {driftCatalogo && (driftCatalogo.faltamNoBanco.length > 0 || driftCatalogo.sobramNoBanco.length > 0) && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={15} aria-hidden="true" />
            O catálogo de permissões do banco está desatualizado em relação ao menu
          </p>
          {driftCatalogo.faltamNoBanco.length > 0 && (
            <p className="mt-1.5">
              <strong>Sem linha no banco</strong> (não podem ser concedidas a ninguém):{' '}
              {driftCatalogo.faltamNoBanco.join(', ')}
            </p>
          )}
          {driftCatalogo.sobramNoBanco.length > 0 && (
            <p className="mt-1.5">
              <strong>No banco, mas sem item no menu</strong> (tela que não existe mais):{' '}
              {driftCatalogo.sobramNoBanco.join(', ')}
            </p>
          )}
          <p className="mt-1.5 text-amber-800">
            Gere a migration com <code className="rounded bg-amber-100 px-1 py-0.5">npm run permissoes:gerar-catalogo</code>{' '}
            em frontend/ e aplique-a.
          </p>
        </div>
      )}

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
                          <GruposDaPessoa grupos={nomesGrupos(user.id)} />
                        </div>
                        {driftedMemberIds.has(user.id) && (
                          <button
                            type="button"
                            onClick={() => setUsuarioDetalhe(user)}
                            className="shrink-0 w-7 h-7 flex items-center justify-center text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors duration-150"
                            aria-label={`${user.nome || user.email} está fora do modelo: tem ajuste individual`}
                            title="Tem ajuste individual — clique para ver"
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

                <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-3.5">
                  <span className="text-xs text-slate-500">
                    {isModeloDirty
                      ? 'Alterações não salvas no modelo.'
                      : `O modelo vale na hora para os ${selectedGrupoMembros.length} membro${selectedGrupoMembros.length !== 1 ? 's' : ''} do grupo.`}
                  </span>
                  <div className="flex items-center gap-2">
                    {isModeloDirty && (
                      <button
                        onClick={() => setGrupoModeloPerms({ ...selectedGrupo.modelo_permissoes })}
                        disabled={savingModelo}
                        className="px-4 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all duration-150 disabled:opacity-50"
                      >
                        Descartar
                      </button>
                    )}
                    <button
                      onClick={() => setShowSalvarModeloConfirm(true)}
                      disabled={savingModelo || !isModeloDirty}
                      className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl transition-all duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save size={13} />
                      {savingModelo ? 'Salvando...' : 'Salvar modelo'}
                    </button>
                  </div>
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
                  const GroupIcon = MENU_ICONE_GRUPO[grupo] || ShieldCheck
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
                            const Icon = iconeDoModulo(p.codigo)
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
                          const Icon = iconeDoModulo(selectedPermissao.codigo)
                          return <Icon size={18} aria-hidden="true" className="text-brand" />
                        })()}
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-800">{selectedPermissao.nome}</h2>
                        <p className="text-sm text-slate-500">{selectedPermissao.grupo || 'Outros'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-brand-surface text-brand-fg">
                        {grantedCountForSelectedCodigo} de {users.length} usuários têm acesso
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                        {gruposComAcessoCount} de {grupos.length} grupos liberam
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Grupos que liberam a tela ── */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 px-1 flex-wrap">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700">Grupos com acesso</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        O modelo do grupo libera a tela para todos os membros de uma vez. Liberar
                        ou retirar aqui mexe no modelo — a confirmação mostra quem muda.
                      </p>
                    </div>
                  </div>

                  {loadingGrupos ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-slate-500">Carregando grupos...</span>
                    </div>
                  ) : gruposForSelectedCodigo.length === 0 ? (
                    <p className="text-center text-sm text-slate-500 py-6">Nenhum grupo cadastrado</p>
                  ) : (
                    <div className="space-y-0.5 max-h-72 overflow-y-auto">
                      {gruposForSelectedCodigo.map(({ grupo, granted, membros }) => (
                        <div
                          key={grupo.id}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors duration-100"
                        >
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              granted ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            <UsersRound size={14} aria-hidden="true" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate leading-tight text-slate-700">
                              {grupo.nome}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500 leading-tight">
                              {membros} membro{membros !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 w-24 text-center px-2.5 py-1 rounded-lg text-xs font-semibold ${
                              granted ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {granted ? 'Liberado' : 'Sem acesso'}
                          </span>
                          {granted ? (
                            <button
                              onClick={() => setGrupoToggleAlvo({ grupo, valor: false })}
                              disabled={grupoActionId === grupo.id}
                              className="shrink-0 px-3 py-3.5 text-xs font-semibold text-rose-500 border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors duration-150 disabled:opacity-50"
                            >
                              {grupoActionId === grupo.id ? 'Retirando...' : 'Retirar acesso'}
                            </button>
                          ) : (
                            <button
                              onClick={() => setGrupoToggleAlvo({ grupo, valor: true })}
                              disabled={grupoActionId === grupo.id}
                              className="shrink-0 px-3 py-3.5 text-xs font-semibold text-brand-fg border border-brand/30 rounded-lg hover:bg-brand-hover transition-colors duration-150 disabled:opacity-50"
                            >
                              {grupoActionId === grupo.id ? 'Liberando...' : 'Liberar acesso'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectGrupo(grupo)
                              setViewMode('grupo')
                            }}
                            className="shrink-0 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-brand-fg hover:bg-slate-100 rounded-lg transition-colors duration-150"
                            aria-label={`Abrir o grupo ${grupo.nome}`}
                            title="Abrir grupo"
                          >
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
                      {filteredUsersForSelectedCodigo.map(({ user, granted, viaGrupo }) => (
                        <div
                          key={user.id}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors duration-100"
                        >
                          <Avatar name={user.nome} userId={user.id} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate leading-tight text-slate-700">
                              {user.nome || user.email}
                            </p>
                            <GruposDaPessoa grupos={nomesGrupos(user.id)} />
                          </div>
                          {granted !== viaGrupo && (
                            <span
                              className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                              title={
                                granted
                                  ? 'Liberada só para esta pessoa — os grupos dela não dão'
                                  : 'Retirada só desta pessoa — os grupos dela dão'
                              }
                            >
                              Ajuste individual
                            </span>
                          )}
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
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectUser(user)
                              setViewMode('usuario')
                            }}
                            className="shrink-0 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-brand-fg hover:bg-slate-100 rounded-lg transition-colors duration-150"
                            aria-label={`Abrir ${user.nome || user.email}`}
                            title="Abrir usuário"
                          >
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </button>
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
                  <div
                    key={user.id}
                    className={`flex items-center gap-1 rounded-xl transition-colors duration-150 ${
                      active
                        ? 'bg-brand-surface border border-brand/20'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <button
                      onClick={() => handleSelectUser(user)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <Avatar name={user.nome} userId={user.id} size="sm" />
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate leading-tight ${active ? 'text-brand-fg' : 'text-slate-700'}`}>
                          {user.nome || user.email}
                        </p>
                        <GruposDaPessoa grupos={nomesGrupos(user.id)} />
                      </div>
                    </button>
                    {usuariosForaDoModelo.has(user.id) && (
                      <button
                        type="button"
                        onClick={() => setUsuarioDetalhe(user)}
                        className="mr-2 shrink-0 w-7 h-7 flex items-center justify-center text-amber-600 hover:bg-amber-50 rounded-lg transition-colors duration-150"
                        aria-label={`${user.nome || user.email} está fora do modelo: ver detalhes`}
                        title="Fora do modelo — ver detalhes"
                      >
                        <AlertTriangle size={14} />
                      </button>
                    )}
                  </div>
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
                {/* Só grupos: é o que decide as telas. O nível técnico (`role`)
                    que as regras do banco respeitam é mantido pelo próprio banco
                    a partir dos grupos (migration 20260929130000) e não aparece. */}
                <div className="flex items-center gap-4 min-w-0">
                  <Avatar name={selectedUser.nome} userId={selectedUser.id} size="lg" />
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-slate-800 truncate">
                      {selectedUser.nome || selectedUser.email}
                    </h2>
                    {selectedUser.email && (
                      <p className="text-sm text-slate-500 mt-0.5 break-all">E-mail: {selectedUser.email}</p>
                    )}
                    <p className="text-sm text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        Grupos:{' '}
                        <span className="text-slate-700 font-medium">
                          {nomesGrupos(selectedUser.id).join(', ') || 'Sem grupo'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={handleAbrirEditGruposUsuario}
                        disabled={isDirty}
                        title={isDirty ? 'Salve ou descarte as alterações das telas antes de mudar os grupos' : undefined}
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-fg hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                      >
                        <Pencil size={12} aria-hidden="true" />
                        Editar grupos
                      </button>
                    </p>
                    {usuariosForaDoModelo.has(selectedUser.id) && (
                      <button
                        type="button"
                        onClick={() => setUsuarioDetalhe(selectedUser)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                      >
                        <AlertTriangle size={12} aria-hidden="true" />
                        Fora do modelo · ver detalhes
                      </button>
                    )}
                  </div>
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
                          ajustados={ajustadosDoSelecionado}
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
                        onClick={() => setShowRestoreConfirm(true)}
                        disabled={restoring || nomesGrupos(selectedUser.id).length === 0}
                        title={nomesGrupos(selectedUser.id).length === 0 ? 'A pessoa não está em nenhum grupo' : undefined}
                        className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RotateCcw size={13} className={restoring ? 'animate-spin' : ''} />
                        {restoring ? 'Restaurando...' : 'Restaurar modelo dos grupos'}
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

      {/* ── Modal: Editar grupos da pessoa ── */}
      {selectedUser && showEditGruposUsuario && (() => {
        const ajustes = allOverrides[selectedUser.id] || {}
        const antes = computeEffectivePerms(ajustes, modelosDe(selectedUser.id), permissoes)
        const depois = computeEffectivePerms(
          ajustes,
          grupos.filter(g => gruposDraftUsuario.has(g.id)).map(g => g.modelo_permissoes),
          permissoes
        )
        const { ganha, perde } = diferencaDoModelo(antes, depois, permissoes)
        const mudou =
          gruposDraftUsuario.size !== (gruposDoUsuario[selectedUser.id] || []).length ||
          (gruposDoUsuario[selectedUser.id] || []).some(g => !gruposDraftUsuario.has(g.id))
        return (
          <Dialog open={showEditGruposUsuario} onOpenChange={setShowEditGruposUsuario}>
            {/* Sem overflow-hidden: a lista de grupos abre dentro do Dialog. */}
            <DialogContent
              className="max-w-md"
              onEscapeKeyDown={(e) => {
                if ((e.target as HTMLElement | null)?.closest?.('[data-multisearch-aberto]')) e.preventDefault()
              }}
            >
              <DialogHeader>
                <DialogTitle>Grupos de {selectedUser.nome || selectedUser.email}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <MultiSearchCombobox<string>
                  opcoes={grupos.map(g => ({ id: g.id, nome: g.nome }))}
                  selecionados={gruposDraftUsuario}
                  onToggle={toggleGrupoDraftUsuario}
                  placeholder="Sem grupo"
                  nomePlural="grupos"
                  resumoCompleto
                  portal={false}
                  ariaLabel={`Grupos de ${selectedUser.nome || selectedUser.email}`}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"
                />
                {mudou && (ganha.length > 0 || perde.length > 0) ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">Vale na hora ao salvar:</p>
                    <ListaDiferenca titulo="Passa a ter" itens={ganha} tom="ganha" />
                    <ListaDiferenca titulo="Deixa de ter" itens={perde} tom="perde" />
                  </div>
                ) : mudou ? (
                  <p className="text-xs text-slate-500">Nenhuma tela muda com essa troca.</p>
                ) : null}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setShowEditGruposUsuario(false)}
                    className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSalvarGruposUsuario}
                    disabled={salvandoGruposUsuario || !mudou}
                    className="flex-1 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                  >
                    {salvandoGruposUsuario ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* ── Modal: Restaurar modelo dos grupos ── */}
      {selectedUser && showRestoreConfirm && (() => {
        const { ganha, perde } = diferencaDoModelo(originalPerms, modeloCompletoDe(selectedUser.id), permissoes)
        return (
          <Dialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Restaurar modelo dos grupos</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-500">
                  <strong className="text-slate-700">{selectedUser.nome || selectedUser.email}</strong> passa a
                  ter exatamente a união dos modelos de{' '}
                  <strong className="text-slate-700">{nomesGrupos(selectedUser.id).join(', ')}</strong>. As
                  permissões individuais fora desses modelos são desfeitas.
                </p>
                {ganha.length === 0 && perde.length === 0 ? (
                  <p className="text-sm text-slate-600">Nada muda — as permissões já seguem os grupos.</p>
                ) : (
                  <div className="space-y-3">
                    <ListaDiferenca titulo="Passa a ter" itens={ganha} tom="ganha" />
                    <ListaDiferenca titulo="Deixa de ter" itens={perde} tom="perde" />
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setShowRestoreConfirm(false)}
                    className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleRestore}
                    disabled={restoring || (ganha.length === 0 && perde.length === 0)}
                    className="flex-1 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                  >
                    {restoring ? 'Restaurando...' : 'Restaurar'}
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}

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
                {selectedGrupoMembros.length} membro{selectedGrupoMembros.length !== 1 ? 's' : ''} perdem, na
                hora, as telas que só este grupo dava. O que vem de outros grupos deles e os ajustes
                individuais continuam.
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
      {memberToRemove && selectedGrupo && (() => {
        // O que a pessoa perde ao sair: telas que só este grupo dava (os outros
        // grupos dela e os ajustes individuais continuam valendo).
        const ajustes = allOverrides[memberToRemove.id] || {}
        const { perde } = diferencaDoModelo(
          computeEffectivePerms(ajustes, modelosDe(memberToRemove.id), permissoes),
          computeEffectivePerms(ajustes, modelosDe(memberToRemove.id, { semGrupoId: selectedGrupo.id }), permissoes),
          permissoes
        )
        return (
        <Dialog open={!!memberToRemove} onOpenChange={open => { if (!open) setMemberToRemove(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Remover membro do grupo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Remover{' '}
                <strong className="text-slate-700">{memberToRemove.nome || memberToRemove.email}</strong> do
                grupo <strong className="text-slate-700">{selectedGrupo.nome}</strong>?{' '}
                {perde.length > 0
                  ? 'A pessoa perde, na hora, as telas abaixo — os outros grupos dela não as dão.'
                  : 'Nenhuma tela muda: os outros grupos dela já dão as mesmas.'}
              </p>
              <ListaDiferenca titulo="Deixa de ter" itens={perde} tom="perde" />
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
        )
      })()}

      {/* ── Modal: Salvar modelo do grupo ── */}
      {selectedGrupo && showSalvarModeloConfirm && (() => {
        const impacto = impactoDoModeloEmEdicao()
        return (
          <Dialog open={showSalvarModeloConfirm} onOpenChange={setShowSalvarModeloConfirm}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Salvar modelo de {selectedGrupo.nome}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-500">
                  {impacto.length === 0
                    ? 'Nenhum membro muda de tela — os outros grupos e os ajustes individuais deles já cobrem a mudança.'
                    : `Vale na hora. ${impacto.length} pessoa${impacto.length !== 1 ? 's mudam' : ' muda'} de tela:`}
                </p>
                {impacto.length > 0 && (
                  <ul className="max-h-72 space-y-3 overflow-y-auto">
                    {impacto.map(({ user, ganha, perde }) => (
                      <li key={user.id} className="rounded-xl border border-slate-100 p-3">
                        <p className="mb-2 text-sm font-medium text-slate-700">{user.nome || user.email}</p>
                        <div className="space-y-2">
                          <ListaDiferenca titulo="Passa a ter" itens={ganha} tom="ganha" />
                          <ListaDiferenca titulo="Deixa de ter" itens={perde} tom="perde" />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setShowSalvarModeloConfirm(false)}
                    className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSalvarModelo}
                    disabled={savingModelo}
                    className="flex-1 py-3 text-sm font-semibold text-white bg-brand-fg rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50"
                  >
                    {savingModelo ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* ── Modal: liberar/retirar a tela de um grupo inteiro ("Por permissão") ── */}
      {grupoToggleAlvo && selectedPermissao && (() => {
        const { grupo, valor } = grupoToggleAlvo
        const modeloNovo = modeloComCodigo(grupo, selectedPermissao.codigo, valor)
        const impacto = impactoDoModeloDeGrupo(grupo, modeloNovo)
        return (
          <Dialog open onOpenChange={aberto => { if (!aberto) setGrupoToggleAlvo(null) }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {valor ? 'Liberar' : 'Retirar'} {selectedPermissao.nome} {valor ? 'para' : 'de'} {grupo.nome}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-500">
                  {impacto.length === 0
                    ? 'Nenhum membro muda de tela — os outros grupos e os ajustes individuais deles já cobrem a mudança.'
                    : `Vale na hora. ${impacto.length} pessoa${impacto.length !== 1 ? 's mudam' : ' muda'} de tela:`}
                </p>
                {impacto.length > 0 && (
                  <ul className="max-h-72 space-y-3 overflow-y-auto">
                    {impacto.map(({ user, ganha, perde }) => (
                      <li key={user.id} className="rounded-xl border border-slate-100 p-3">
                        <p className="mb-2 text-sm font-medium text-slate-700">{user.nome || user.email}</p>
                        <div className="space-y-2">
                          <ListaDiferenca titulo="Passa a ter" itens={ganha} tom="ganha" />
                          <ListaDiferenca titulo="Deixa de ter" itens={perde} tom="perde" />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setGrupoToggleAlvo(null)}
                    className="flex-1 py-3 text-sm font-medium text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleToggleGrupoCodigo(grupo, valor)}
                    disabled={grupoActionId === grupo.id}
                    className={`flex-1 py-3 text-sm font-semibold text-white rounded-2xl hover:opacity-90 transition-colors disabled:opacity-50 ${
                      valor ? 'bg-brand-fg' : 'bg-rose-500'
                    }`}
                  >
                    {grupoActionId === grupo.id
                      ? 'Salvando...'
                      : valor
                        ? 'Liberar acesso'
                        : 'Retirar acesso'}
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* ── Modal: Membro fora do modelo ── */}
      {usuarioDetalhe && (() => {
        // O ajuste individual, contra a SOMA dos grupos da pessoa.
        const gruposDela = gruposDoUsuario[usuarioDetalhe.id] || []
        const detalhe = detalheDoAjuste(allOverrides[usuarioDetalhe.id] || {}, gruposDela, permissoes)
        const { faltam, aMais } = detalhe
        const primeiroNome = (usuarioDetalhe.nome || usuarioDetalhe.email || 'A pessoa').split(' ')[0]

        // "Ajustar o grupo": com um grupo só, o destino é ele; com mais, é preciso
        // escolher — mas só se houver tela a MAIS para levar.
        const destinoId = gruposDela.length === 1 ? gruposDela[0].id : grupoDestinoId
        const precisaEscolher = aMais.length > 0 && gruposDela.length > 1 && !destinoId
        const novosModelos = precisaEscolher ? {} : modelosLevandoAjusteAosGrupos(gruposDela, detalhe, destinoId)
        const gruposAlterados = gruposDela.filter(g => novosModelos[g.id])
        // Os OUTROS membros dos grupos alterados: o que muda para cada um.
        const impactoOutros = users
          .filter(u => u.id !== usuarioDetalhe.id && gruposAlterados.some(g => (membrosPorGrupo[g.id] || []).includes(u.id)))
          .map(u => {
            const ajustes = allOverrides[u.id] || {}
            const seus = gruposDoUsuario[u.id] || []
            const antes = computeEffectivePerms(ajustes, seus.map(g => g.modelo_permissoes), permissoes)
            const depois = computeEffectivePerms(ajustes, seus.map(g => novosModelos[g.id] ?? g.modelo_permissoes), permissoes)
            return { user: u, ...diferencaDoModelo(antes, depois, permissoes) }
          })
          .filter(x => x.ganha.length > 0 || x.perde.length > 0)

        // Frases das consequências, com os nomes reais.
        const mudancasDoGrupo = gruposAlterados.map(g => {
          const entra = g.id === destinoId ? aMais.map(p => p.nome) : []
          const sai = faltam.filter(x => x.grupos.includes(g.nome)).map(x => x.permissao.nome)
          const partes = [
            entra.length > 0 ? `passa a dar ${listarNomes(entra)}` : null,
            sai.length > 0 ? `deixa de dar ${listarNomes(sai)}` : null,
          ].filter(Boolean)
          return { grupo: g, frase: partes.join(' e ') }
        })
        const consequenciaPessoa = [
          faltam.length > 0 ? `passa a ter ${listarNomes(faltam.map(x => x.permissao.nome))}` : null,
          aMais.length > 0 ? `deixa de ter ${listarNomes(aMais.map(p => p.nome))}` : null,
        ].filter(Boolean).join(' e ')
        const consequenciaGrupo = precisaEscolher
          ? `Você escolhe em qual grupo entra ${listarNomes(aMais.map(p => p.nome))}.`
          : `${mudancasDoGrupo.map(m => `${m.grupo.nome} ${m.frase}`).join('; ')}. ${
              impactoOutros.length === 0
                ? 'Nenhum outro membro muda de tela.'
                : `Muda também para ${impactoOutros.length} outra${impactoOutros.length !== 1 ? 's pessoas' : ' pessoa'}.`
            }`

        const cartaoAcao =
          'group flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors duration-150 hover:border-brand/40 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

        return (
        <Dialog open={!!usuarioDetalhe} onOpenChange={open => { if (!open) fecharDetalhe() }}>
          <DialogContent className="max-w-md gap-5">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">
                {levandoAoGrupo ? 'Ajustar o grupo' : 'Fora do modelo'}
              </DialogTitle>
            </DialogHeader>

            {/* Quem, e em quais grupos */}
            <div className="flex items-center gap-3">
              <Avatar name={usuarioDetalhe.nome} userId={usuarioDetalhe.id} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {usuarioDetalhe.nome || usuarioDetalhe.email}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {gruposDela.length > 0 ? gruposDela.map(g => (
                    <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      <UsersRound size={11} aria-hidden="true" />
                      {g.nome}
                    </span>
                  )) : (
                    <span className="text-xs italic text-slate-500">Sem grupo</span>
                  )}
                </div>
              </div>
            </div>

            {!levandoAoGrupo ? (
              <>
                {/* As diferenças */}
                <div className="space-y-3">
                  {gruposDela.length > 1 && (
                    <p className="text-xs text-slate-500">Comparado com a soma dos {gruposDela.length} grupos.</p>
                  )}
                  {faltam.length > 0 && (
                    <section aria-label="Telas que o grupo dá e a pessoa não tem">
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-700">
                        <MinusCircle size={13} aria-hidden="true" />
                        No grupo, mas não em {primeiroNome}
                        <span className="rounded-full bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700">{faltam.length}</span>
                      </h3>
                      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {faltam.map(({ permissao, grupos: deQuais }) => (
                          <LinhaAjuste key={permissao.codigo} permissao={permissao} tom="falta" grupos={deQuais} />
                        ))}
                      </ul>
                    </section>
                  )}
                  {aMais.length > 0 && (
                    <section aria-label="Telas que só a pessoa tem">
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                        <PlusCircle size={13} aria-hidden="true" />
                        Em {primeiroNome}, mas em nenhum de seus grupos
                        <span className="rounded-full bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700">{aMais.length}</span>
                      </h3>
                      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {aMais.map(p => (
                          <LinhaAjuste key={p.codigo} permissao={p} tom="aMais" />
                        ))}
                      </ul>
                    </section>
                  )}
                </div>

                {/* O que fazer — cada escolha diz o que muda */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={async () => { await handleVoltarAoModelo(usuarioDetalhe.id); fecharDetalhe() }}
                    disabled={savingModelo}
                    className={cartaoAcao}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-surface text-brand-fg">
                      <UserRound size={16} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">
                        {savingModelo ? 'Salvando...' : `${primeiroNome} segue o grupo`}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {primeiroNome} {consequenciaPessoa}. O grupo não muda.
                      </span>
                    </span>
                  </button>

                  {gruposDela.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setLevandoAoGrupo(true)}
                      disabled={savingModelo}
                      className={cartaoAcao}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-surface text-brand-fg">
                        <UsersRound size={16} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-800">
                          O grupo segue {primeiroNome}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-600">{consequenciaGrupo}</span>
                      </span>
                    </button>
                  )}
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={fecharDetalhe}
                    className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
                  >
                    Manter como está
                  </button>
                </div>
              </>
            ) : (
              <>
                {aMais.length > 0 && gruposDela.length > 1 && (
                  <fieldset>
                    <legend className="mb-2 text-sm text-slate-700">
                      Em qual grupo entra <strong>{listarNomes(aMais.map(p => p.nome))}</strong>?
                    </legend>
                    <div className="space-y-2">
                      {gruposDela.map(g => {
                        const n = (membrosPorGrupo[g.id] || []).length
                        const escolhido = grupoDestinoId === g.id
                        return (
                          <label
                            key={g.id}
                            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
                              escolhido ? 'border-brand bg-brand-surface' : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="grupo-destino"
                              checked={escolhido}
                              onChange={() => setGrupoDestinoId(g.id)}
                              className="accent-(--color-brand)"
                            />
                            <span className="flex-1 font-medium text-slate-800">{g.nome}</span>
                            <span className="text-xs text-slate-600">{n} membro{n !== 1 ? 's' : ''}</span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                )}

                {!precisaEscolher && (
                  <div className="space-y-4">
                    <ul className="space-y-1.5">
                      {mudancasDoGrupo.map(({ grupo, frase }) => (
                        <li key={grupo.id} className="flex items-start gap-2 text-sm text-slate-700">
                          <UsersRound size={14} className="mt-0.5 shrink-0 text-brand-fg" aria-hidden="true" />
                          <span><strong className="font-semibold text-slate-800">{grupo.nome}</strong> {frase}.</span>
                        </li>
                      ))}
                    </ul>

                    <p className="text-xs text-slate-600">
                      As telas de {primeiroNome} não mudam.{' '}
                      {impactoOutros.length === 0
                        ? 'Nenhum outro membro muda de tela.'
                        : `Vale na hora para ${impactoOutros.length} outra${impactoOutros.length !== 1 ? 's pessoas' : ' pessoa'}:`}
                    </p>

                    {impactoOutros.length > 0 && (
                      <ul className="max-h-56 space-y-2 overflow-y-auto">
                        {impactoOutros.map(({ user, ganha, perde }) => (
                          <li key={user.id} className="rounded-xl border border-slate-200 p-3">
                            <p className="mb-2 text-sm font-semibold text-slate-800">{user.nome || user.email}</p>
                            <div className="space-y-2">
                              <ListaDiferenca titulo="Passa a ter" itens={ganha} tom="ganha" />
                              <ListaDiferenca titulo="Deixa de ter" itens={perde} tom="perde" />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setLevandoAoGrupo(false); setGrupoDestinoId(null) }}
                    className="min-h-11 flex-1 rounded-2xl border border-slate-200 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await handleLevarAjusteAoGrupo(usuarioDetalhe.id, novosModelos); fecharDetalhe() }}
                    disabled={savingModelo || precisaEscolher || gruposAlterados.length === 0}
                    className="min-h-11 flex-1 rounded-2xl bg-brand-fg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingModelo ? 'Salvando...' : 'Confirmar'}
                  </button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
        )
      })()}
    </div>
  )
}
