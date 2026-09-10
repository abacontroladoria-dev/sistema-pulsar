'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { getFunctionHeaders, getFunctionUrl } from '@/lib/supabase/functions'
import { normalizarParaUsername } from '@/lib/username'
import { UNIDADES_DISPONIVEIS } from '@/lib/admin/unidades'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import GeneratedPasswordReveal from './GeneratedPasswordReveal'

export default function CreateUserModal() {
  const [open, setOpen] = useState(false)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('recepcao')
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
    setRole('recepcao')
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

    try {
      setLoading(true)

      if (comSenha) {
        const res = await fetch('/api/admin/create-user-with-password', {
          method: 'POST',
          headers: await getFunctionHeaders(),
          body: JSON.stringify({ nome, email, role, username: username || null, unidades }),
        })

        const json = await res.json()

        if (!res.ok) throw new Error(json.error ?? 'Erro ao criar usuário')

        setCreatedResult({ nome, email, username, password: json.password })
      } else {
        const res = await fetch(getFunctionUrl('admin-create-user'), {
          method: 'POST',
          headers: await getFunctionHeaders(),
          body: JSON.stringify({ nome, email, role, unidades }),
        })

        const json = await res.json()

        if (!res.ok) throw new Error(json.error ?? 'Erro ao enviar convite')

        toast.success(`Convite enviado para ${email}`)
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
        <button className="rounded-xl bg-brand-fg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90">
          + Novo usuário
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-120 rounded-3xl border-0 p-0 overflow-hidden">
        <div className="bg-white p-6">
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

              <label className="block">
                <span className="sr-only">Setor</span>
                <select
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="recepcao">Recepção</option>
                  <option value="terapeutico">Terapêutico</option>
                  <option value="faturamento">Faturamento</option>
                  <option value="autorizacao">Autorização</option>
                  <option value="rp">RP</option>
                  <option value="cronograma">Cronograma</option>
                  <option value="marketing">Marketing</option>
                  <option value="diretoria">Diretoria</option>
                  <option value="admin">Admin</option>
                  <option value="disponibilidade_terapeuta">Disponib. Terapeuta</option>
                </select>
              </label>

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
