'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { Home, LogOut } from 'lucide-react'
import { carregarGruposDoUsuario, rotuloDosGrupos } from '@/lib/permissions/carregar'

interface Perfil {
  nome: string
  // Os grupos de permissão da pessoa — é o que decide o acesso e o que ela
  // reconhece. `null` quando não deu para ler: a frase sai sem o parêntese.
  grupos: string | null
}

export default function SemPermissaoPage() {
  const router = useRouter()
  const [perfil, setPerfil] = useState<Perfil | null>(null)

  useEffect(() => {
    const supabase = getSupabaseClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      Promise.all([
        supabase.from('usuarios').select('nome').eq('id', user.id).single(),
        carregarGruposDoUsuario(supabase),
      ]).then(([{ data }, grupos]) => {
        if (data) setPerfil({ nome: data.nome, grupos: rotuloDosGrupos(grupos) })
      })
    })
  }, [])

  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center relative px-4 py-8 overflow-hidden"
      style={{ background: 'radial-gradient(ellipse 120% 80% at 50% -10%, #2a6080 0%, #1a3a55 45%, #0f2540 100%)' }}
    >
      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(58,143,183,0.10) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          WebkitMaskImage: 'radial-gradient(ellipse 110% 90% at 50% 50%, black 30%, transparent 85%)',
          maskImage: 'radial-gradient(ellipse 110% 90% at 50% 50%, black 30%, transparent 85%)',
        }}
      />

      {/* Card */}
      <div
        className="relative w-full max-w-md rounded-3xl overflow-hidden"
        style={{
          boxShadow: [
            '0 4px 8px rgba(0,0,0,0.15)',
            '0 12px 24px rgba(0,0,0,0.3)',
            '0 32px 56px rgba(0,0,0,0.45)',
            '0 64px 100px rgba(0,0,0,0.5)',
            '0 0 0 1px rgba(255,255,255,0.09)',
            '0 0 80px rgba(58,143,183,0.1)',
          ].join(', '),
        }}
      >
        {/* Top light reflection */}
        <div
          className="pointer-events-none"
          style={{
            height: '1px',
            background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.25) 50%, transparent 95%)',
          }}
        />

        {/* Zona escura — ancora o logo no mesmo universo visual da página */}
        <div
          className="flex items-center justify-center py-9 px-8"
          style={{ background: 'linear-gradient(135deg, #1e4a6b 0%, #152e47 100%)' }}
        >
          {/* Variante de tinta clara: o bloco atrás é o gradiente navy
              (#1e4a6b -> #152e47) e o lockup escuro sumiria nele. Este arquivo
              é recorte justo (sem a margem embutida do outro), por isso h-14
              e não h-24 — na mesma altura a marca sairia 66% maior. */}
          <img
            src="/pulsar-lockup-tv-light.png"
            alt="Pulsar"
            className="h-14 w-auto object-contain"
          />
        </div>

        {/* Divisor âmbar — separa identidade de mensagem */}
        <div
          style={{
            height: '2px',
            background: 'linear-gradient(90deg, transparent 0%, #f59e0b 30%, #f59e0b 70%, transparent 100%)',
          }}
        />

        {/* Zona branca — mensagem e ações */}
        <div className="px-8 pt-8 pb-10" style={{ background: '#ffffff' }}>
          <div className="text-center mb-8">
            <h1 className="text-xl font-bold leading-snug mb-3" style={{ color: '#1e5a7d' }}>
              Esta área não está disponível para você
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: '#6b7280' }}>
              {perfil ? (
                <>
                  Você está acessando como{' '}
                  <strong style={{ color: '#1e5a7d' }}>{perfil.nome}</strong>
                  {perfil.grupos ? ` (${perfil.grupos})` : ''} e não tem permissão para esta seção.
                </>
              ) : (
                'Sua conta não tem permissão para acessar esta seção do sistema.'
              )}
            </p>
            <p className="mt-2 text-sm" style={{ color: '#9ca3af' }}>
              Fale com o administrador se precisar de acesso.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => router.push('/')}
              className="flex items-center justify-center gap-2 w-full h-12 text-white rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2"
              style={{ background: 'linear-gradient(135deg, #2a8ba8 0%, #1e5a7d 100%)' }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 16px rgba(42,139,168,0.3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
            >
              <Home size={16} aria-hidden="true" />
              Ir ao painel
            </button>

            <button
              onClick={() => router.push('/login')}
              className="flex items-center justify-center gap-2 w-full h-12 rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'transparent',
                border: '1.5px solid rgba(30, 90, 125, 0.25)',
                color: '#1e5a7d',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(58,143,183,0.06)' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <LogOut size={16} aria-hidden="true" />
              Entrar com outra conta
            </button>
          </div>
        </div>
      </div>

      <p className="relative mt-5 text-xs text-white/55 select-none tracking-wide">
        Universo ABA — Sistema de Gestão Clínica
      </p>
    </main>
  )
}
