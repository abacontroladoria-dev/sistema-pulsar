'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Smartphone, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useUsuarioAtual } from '@/hooks/useUsuarioAtual'
import { CabecalhoPastel, SecaoPastel, tom } from '@/components/ui/pastel/pecas'
import { useConfirmacao } from '@/components/ui/pastel/confirmacao'
import { dataBR, papelPrecisaDeSegundoFator, situacaoExigencia } from '@/lib/auth/segundoFator'
import { mensagemDoSegundoFator } from '@/lib/auth/mensagensSegundoFator'

// Segurança da conta: cadastrar o app autenticador (QR + código de
// confirmação), confirmar o código numa sessão que entrou só com a senha, e
// remover o app. Tudo pelo Supabase Auth (mfa.enroll/challenge/verify) com a
// sessão da própria pessoa — nenhum dado sai daqui para outra tabela.

type Fator = { id: string; friendly_name?: string | null; created_at: string; status: string }
type Cadastro = { factorId: string; qr: string; segredo: string }

const supabase = getSupabaseClient()

export function SegurancaContaShell() {
  const { role } = useUsuarioAtual()
  const { confirmar, dialogo } = useConfirmacao()

  const [carregando, setCarregando] = useState(true)
  const [fator, setFator] = useState<Fator | null>(null)
  const [nivel, setNivel] = useState<'aal1' | 'aal2' | null>(null)
  const [cadastro, setCadastro] = useState<Cadastro | null>(null)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const exigencia = situacaoExigencia()
  const precisa = papelPrecisaDeSegundoFator(role)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: fatores }, { data: aal }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
    const verificado = (fatores?.totp ?? [])[0] as Fator | undefined
    setFator(verificado ?? null)
    setNivel((aal?.currentLevel as 'aal1' | 'aal2' | null) ?? null)
    setCarregando(false)
  }, [])

  useEffect(() => { void recarregar() }, [recarregar])

  async function comecarCadastro() {
    setErro(null)
    setOcupado(true)
    try {
      // Tentativa abandonada deixa um fator "não verificado" que impede outro.
      const { data: todos } = await supabase.auth.mfa.listFactors()
      for (const f of (todos?.all ?? []).filter(f => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Celular ${Date.now()}` })
      if (error || !data) throw error ?? new Error('sem resposta')
      setCadastro({ factorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret })
      setCodigo('')
    } catch (e) {
      setErro(mensagemDoSegundoFator(e))
    } finally {
      setOcupado(false)
    }
  }

  async function cancelarCadastro() {
    if (cadastro) await supabase.auth.mfa.unenroll({ factorId: cadastro.factorId }).catch(() => null)
    setCadastro(null)
    setCodigo('')
    setErro(null)
  }

  /** Confirma o código: fecha o cadastro novo ou eleva a sessão (aal1 → aal2). */
  async function confirmarCodigo(e: React.FormEvent) {
    e.preventDefault()
    const factorId = cadastro?.factorId ?? fator?.id
    if (!factorId || codigo.length !== 6) return
    setErro(null)
    setOcupado(true)
    const eraCadastro = cadastro != null
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo })
      if (error) throw error
      toast.success(eraCadastro ? 'App autenticador cadastrado.' : 'Código confirmado.')
      setCadastro(null)
      setCodigo('')
      // Confirmou o código de uma sessão que entrou só com a senha, ou cadastrou
      // por exigência: o proxy o trouxe para cá — segue para o sistema. Recarga
      // inteira para o proxy ler o cookie da sessão nova.
      if (!eraCadastro || (precisa && exigencia.tipo === 'obrigatoria')) {
        window.location.assign('/')
        return
      }
      await recarregar()
    } catch (err) {
      setErro(mensagemDoSegundoFator(err))
    } finally {
      setOcupado(false)
    }
  }

  async function remover() {
    if (!fator) return
    const ok = await confirmar({
      titulo: 'Remover o app autenticador?',
      texto: precisa && exigencia.tipo !== 'desligada'
        ? `Para administradores e diretoria o app é obrigatório a partir de ${dataBR(exigencia.desde)}. Sem ele você só volta a entrar no sistema depois de cadastrar outro.`
        : 'Você volta a entrar só com a senha. Pode cadastrar de novo quando quiser.',
      confirmar: 'Remover',
      t: 'vermelho',
      Icone: Trash2,
    })
    if (!ok) return
    setOcupado(true)
    const { error } = await supabase.auth.mfa.unenroll({ factorId: fator.id })
    setOcupado(false)
    if (error) {
      toast.error(mensagemDoSegundoFator(error))
      return
    }
    toast.success('App autenticador removido.')
    await recarregar()
  }

  const campoCodigo = (
    <form onSubmit={confirmarCodigo} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1">
        <span className="mb-1.5 block text-[13px] font-extrabold text-[var(--pp-ink)]">Código de 6 dígitos do app</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={codigo}
          onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          aria-invalid={erro ? true : undefined}
          className="pp-busca !pl-3 text-center text-lg font-extrabold tracking-[0.4em] tabular-nums sm:max-w-[220px]"
        />
      </label>
      <button type="submit" disabled={ocupado || codigo.length !== 6} className={`${tom('aco')} pp-btn`}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirmar
      </button>
    </form>
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {precisa && exigencia.tipo !== 'desligada' && !(fator && nivel === 'aal2') && (
        <div role="status" className={`pp ${tom(exigencia.tipo === 'obrigatoria' ? 'vermelho' : 'amber')} flex items-start gap-3 rounded-2xl bg-[var(--c-suave)] p-4 text-[var(--c-tinta)]`}>
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p className="text-sm font-bold">
            {exigencia.tipo === 'obrigatoria'
              ? 'Administradores e diretoria só usam o sistema com o app autenticador. Cadastre ou confirme o código abaixo para continuar.'
              : `A partir de ${dataBR(exigencia.desde)}, administradores e diretoria só entram com o app autenticador. Cadastre agora para não ficar sem acesso.`}
          </p>
        </div>
      )}

      <SecaoPastel titulo="seguranca-app">
        <CabecalhoPastel
          id="seguranca-app"
          titulo="App autenticador"
          t={fator ? 'verde' : 'aco'}
          Icone={fator ? ShieldCheck : Smartphone}
          apoio="Além da senha, o sistema pede um código de 6 dígitos que muda a cada 30 segundos no app do celular."
        />

        {carregando ? (
          <p className="text-sm font-semibold text-[var(--pp-ink-muted)]">Carregando…</p>
        ) : cadastro ? (
          <div>
            <ol className="list-decimal space-y-1 pl-5 text-sm font-semibold text-[var(--pp-ink)]">
              <li>Abra o Google Authenticator, o Microsoft Authenticator ou outro app autenticador.</li>
              <li>Toque em adicionar e leia o QR abaixo com a câmera.</li>
              <li>Digite o código que aparecer no app.</li>
            </ol>
            <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {/* QR do próprio Supabase (data: URL em SVG). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cadastro.qr} alt="QR para o app autenticador" className="size-44 rounded-xl bg-white p-2 shadow-[var(--pp-sombra)]" />
              <div className="min-w-0 text-[13px] font-semibold text-[var(--pp-ink-muted)]">
                <p>Sem câmera? No app, escolha digitar a chave:</p>
                <p className="mt-1 break-all rounded-lg bg-[var(--pp-muted)] px-2 py-1.5 font-mono text-[13px] text-[var(--pp-ink)]">{cadastro.segredo}</p>
              </div>
            </div>
            {campoCodigo}
            <button type="button" onClick={cancelarCadastro} disabled={ocupado} className={`${tom('cinza')} pp-btn pp-btn-suave mt-3`}>
              Cancelar
            </button>
          </div>
        ) : fator && nivel !== 'aal2' ? (
          <div>
            <p className="text-sm font-semibold text-[var(--pp-ink)]">
              Você entrou só com a senha. Digite o código do app para confirmar que é você.
            </p>
            {campoCodigo}
          </div>
        ) : fator ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-bold text-[var(--pp-ink)]">
              <KeyRound className="h-4 w-4" aria-hidden />
              Ativo desde {new Date(fator.created_at).toLocaleDateString('pt-BR')}
            </p>
            <button type="button" onClick={remover} disabled={ocupado} className={`${tom('vermelho')} pp-btn pp-btn-suave`}>
              <Trash2 className="h-4 w-4" aria-hidden /> Remover
            </button>
          </div>
        ) : (
          <button type="button" onClick={comecarCadastro} disabled={ocupado} className={`${tom('aco')} pp-btn`}>
            <Smartphone className="h-4 w-4" aria-hidden /> {ocupado ? 'Preparando…' : 'Cadastrar app autenticador'}
          </button>
        )}

        {erro && (
          <p role="alert" className={`${tom('vermelho')} mt-3 rounded-xl bg-[var(--c-suave)] px-3 py-2 text-sm font-bold text-[var(--c-tinta)]`}>
            {erro}
          </p>
        )}
      </SecaoPastel>

      <p className="px-1 text-[13px] font-semibold text-muted-foreground">
        Trocou ou perdeu o celular? Peça a um administrador para remover o app da sua conta; depois você entra com a senha e cadastra de novo.
      </p>
      {dialogo}
    </div>
  )
}
