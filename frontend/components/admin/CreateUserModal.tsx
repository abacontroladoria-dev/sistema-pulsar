'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { getFunctionHeaders, getFunctionUrl } from '@/lib/supabase/functions'
import { normalizarParaUsername } from '@/lib/username'
import { UNIDADES_DISPONIVEIS } from '@/lib/admin/unidades'
import { getSupabaseClient } from '@/lib/supabase/client'
import { sincronizarGruposDoUsuario } from '@/services/grupos.service'
import type { Grupo } from '@/services/grupos.service'
import { MultiSearchCombobox } from '@/components/cronograma/ui/MultiSearchCombobox'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import GeneratedPasswordReveal from './GeneratedPasswordReveal'

// As rotas de criação exigem um nível técnico (usuarios.role). Ele não é
// escolhido aqui: quem o define é o banco, a partir dos grupos, no instante em
// que a pessoa entra neles (gatilho da migration 20260929130000). Este valor só
// vale até esse instante.
const NIVEL_INICIAL = 'recepcao'

// O banco demora um instante para ter a linha em public.usuarios depois do
// convite (quem cria é o trigger handle_new_user) — tenta algumas vezes.
async function buscarUsuarioIdPorEmail(email: string): Promise<string | null> {
  const supabase = getSupabaseClient()
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { data } = await supabase.from('usuarios').select('id').eq('email', email).maybeSingle()
    if (data?.id) return data.id
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

export default function CreateUserModal({
  grupos,
  podeCriar,
  onCriado,
}: {
  grupos: Grupo[]
  /** Criar conta passa por rotas que só aceitam admin (create-user*). */
  podeCriar: boolean
  onCriado?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [grupoIds, setGrupoIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [comSenha, setComSenha] = useState(false)
  const [username, setUsername] = useState('')
  const [usernameEditado, setUsernameEditado] = useState(false)
  const [unidades, setUnidades] = useState<string[]>([...UNIDADES_DISPONIVEIS])
  const [createdResult, setCreatedResult] = useState<{
    nome: string
    email: string
    username: string
    password: string
  } | null>(null)

  function resetForm() {
    setNome('')
    setEmail('')
    setGrupoIds(new Set())
    setUsername('')
    setUsernameEditado(false)
    setUnidades([...UNIDADES_DISPONIVEIS])
    setComSenha(false)
    setCreatedResult(null)
  }

  function handleNomeChange(value: string) {
    setNome(value)
    if (!usernameEditado) {
      setUsername(normalizarParaUsername(value))
    }
  }

  function handleUsernameChange(value: string) {
    setUsername(value.toLowerCase())
    setUsernameEditado(true)
  }

  function toggleGrupo(id: string) {
    const next = new Set(grupoIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setGrupoIds(next)
  }

  // Depois da conta criada: entrar nos grupos basta — as telas vêm deles ao vivo
  // e o nível técnico é acertado pelo gatilho do banco. Falha aqui não desfaz a
  // conta — avisa o que ficou faltando.
  async function vincularGrupos(emailCriado: string): Promise<boolean> {
    const usuarioId = await buscarUsuarioIdPorEmail(emailCriado)
    if (!usuarioId) return false
    return sincronizarGruposDoUsuario(usuarioId, [...grupoIds], [])
  }

  function toggleUnidade(unidade: string) {
    setUnidades((current) =>
      current.includes(unidade)
        ? current.filter((u) => u !== unidade)
        : [...current, unidade]
    )
  }

  async function handleCreateUser() {
    if (!nome.trim() || !email.trim()) {
      toast.error('Preencha nome e email.')
      return
    }
    // É o grupo que dá as telas (e o nível no banco): conta sem grupo nasceria
    // sem acesso a nada.
    if (grupoIds.size === 0) {
      toast.error('Escolha ao menos um grupo de permissão.')
      return
    }

    try {
      setLoading(true)

      if (comSenha) {
        const res = await fetch('/api/admin/create-user-with-password', {
          method: 'POST',
          headers: await getFunctionHeaders(),
          body: JSON.stringify({ nome, email, role: NIVEL_INICIAL, username: username || null, unidades }),
        })

        const json = await res.json()

        if (!res.ok) throw new Error(json.error ?? 'Erro ao criar usuário')

        const gruposOk = await vincularGrupos(email)
        if (!gruposOk) toast.error('Usuário criado, mas os grupos não foram aplicados — ajuste em Permissões.')
        setCreatedResult({ nome, email, username, password: json.password })
        onCriado?.()
      } else {
        const res = await fetch(getFunctionUrl('admin-create-user'), {
          method: 'POST',
          headers: await getFunctionHeaders(),
          body: JSON.stringify({ nome, email, role: NIVEL_INICIAL, unidades }),
        })

        const json = await res.json()

        if (!res.ok) throw new Error(json.error ?? 'Erro ao enviar convite')

        const gruposOk = await vincularGrupos(email)
        if (!gruposOk) toast.error('Convite enviado, mas os grupos não foram aplicados — ajuste em Permissões.')
        toast.success(`Convite enviado para ${email}`)
        onCriado?.()
        resetForm()
        setOpen(false)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger asChild>
        <button
          disabled={!podeCriar}
          title={podeCriar ? undefined : 'Só administradores criam contas'}
          className="rounded-xl bg-brand-fg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Novo usuário
        </button>
      </DialogTrigger>

      {/* Sem `overflow-hidden`: cortaria a lista de grupos, que abre dentro do
          Dialog (portal={false}) e passa da borda de baixo. O arredondamento
          que ele garantia passou para o bloco branco. */}
      <DialogContent
        className="sm:max-w-120 rounded-3xl border-0 p-0"
        // O Esc na busca de grupos fecha só a lista — o Radix fecharia o
        // Dialog junto e o formulário preenchido se perderia.
        onEscapeKeyDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.('[data-multisearch-aberto]')) e.preventDefault()
        }}
      >
        <div className="rounded-3xl bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900">
              Adicionar usuário
            </DialogTitle>
          </DialogHeader>

          {createdResult ? (
            <GeneratedPasswordReveal
              nome={createdResult.nome}
              email={createdResult.email}
              username={createdResult.username}
              password={createdResult.password}
              description={
                <>
                  Usuário <strong>{createdResult.nome}</strong> criado com sucesso. Envie a
                  senha temporária abaixo. No primeiro login, será solicitado que ele crie
                  uma nova senha.
                </>
              }
              closeLabel="Concluir"
              onClose={() => {
                resetForm()
                setOpen(false)
              }}
            />
          ) : (
            <div className="mt-6 space-y-4">

              {/* Toggle convite / senha */}
              <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-medium">
                <button
                  type="button"
                  onClick={() => setComSenha(false)}
                  className={`flex-1 py-2.5 transition ${!comSenha ? 'bg-brand-fg text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                >
                  Enviar convite
                </button>
                <button
                  type="button"
                  onClick={() => setComSenha(true)}
                  className={`flex-1 py-2.5 transition ${comSenha ? 'bg-brand-fg text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                >
                  Criar com senha temporária
                </button>
              </div>

              <label className="block">
                <span className="sr-only">Nome completo</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  placeholder="Nome completo"
                  value={nome}
                  onChange={(e) => handleNomeChange(e.target.value)}
                />
              </label>

              <label className="block">
                <span className="sr-only">Email</span>
                <input
                  type="email"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              {comSenha && (
                <label className="block">
                  <span className="sr-only">Usuário</span>
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    placeholder="Usuário (sugestão automática)"
                    value={username}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                  />
                </label>
              )}

              {/* Grupos no lugar do antigo "Setor": a conta nasce com as telas
                  dos grupos escolhidos (união dos modelos). */}
              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">Grupos de permissão</p>
                <MultiSearchCombobox<string>
                  opcoes={grupos.map(g => ({ id: g.id, nome: g.nome }))}
                  selecionados={grupoIds}
                  onToggle={toggleGrupo}
                  placeholder="Sem grupo"
                  nomePlural="grupos"
                  resumoCompleto
                  portal={false}
                  ariaLabel="Grupos de permissão do novo usuário"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  A pessoa recebe as telas dos grupos escolhidos.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">
                  Unidade(s) que este usuário pode ver
                </p>
                <div className="flex flex-wrap gap-2">
                  {UNIDADES_DISPONIVEIS.map((unidade) => {
                    const ativa = unidades.includes(unidade)
                    return (
                      <button
                        key={unidade}
                        type="button"
                        onClick={() => toggleUnidade(unidade)}
                        className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                          ativa
                            ? 'bg-brand-fg text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {unidade}
                      </button>
                    )
                  })}
                </div>
              </div>

              <button
                onClick={handleCreateUser}
                disabled={loading}
                className="w-full rounded-2xl bg-brand-fg py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {loading
                  ? 'Criando...'
                  : comSenha
                  ? 'Criar usuário'
                  : 'Enviar convite'}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
