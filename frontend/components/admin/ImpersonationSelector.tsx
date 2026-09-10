'use client'

import { useImpersonation } from '@/contexts/ImpersonationContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { ROLE_LABELS } from '@/constants/roleLabels'
import { ChevronDown, Eye } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const AVAILABLE_ROLES = [
  'diretoria',
  'recepcao',
  'terapeutico',
  'faturamento',
  'autorizacao',
  'rp',
  'cronograma',
  'marketing',
  'disponibilidade_terapeuta',
]

interface Usuario {
  id: string
  nome: string
  role: string
}

export function ImpersonationSelector() {
  const { canImpersonate, isImpersonating, impersonatedTarget, startImpersonation, stopImpersonation } =
    useImpersonation()
  const supabase = getSupabaseClient()

  const [isOpen, setIsOpen] = useState(false)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  if (!canImpersonate) {
    return null
  }

  useEffect(() => {
    const loadUsuarios = async () => {
      setIsLoadingUsers(true)
      try {
        const { data } = await supabase
          .from('usuarios')
          .select('id, nome, role')
          .eq('ativo', true)
          .order('nome')

        setUsuarios(data || [])
      } catch (error) {
        console.error('Erro ao carregar usuários:', error)
      } finally {
        setIsLoadingUsers(false)
      }
    }

    if (isOpen && usuarios.length === 0) {
      loadUsuarios()
    }
  }, [isOpen])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectRole = (role: string) => {
    startImpersonation({
      role,
      nome: `Função: ${ROLE_LABELS[role] || role}`,
    })
    setIsOpen(false)
  }

  const handleSelectUsuario = (usuario: Usuario) => {
    startImpersonation({
      id: usuario.id,
      role: usuario.role,
      nome: usuario.nome,
    })
    setIsOpen(false)
  }

  const handleToggleDropdown = () => {
    if (isImpersonating) {
      stopImpersonation()
      setIsOpen(false)
    } else {
      setIsOpen(!isOpen)
    }
  }

  const displayText = isImpersonating ? `Impersonando: ${impersonatedTarget?.nome}` : 'Visualizar como...'

  return (
    <div ref={dropdownRef} className="relative w-full">
      <button
        onClick={handleToggleDropdown}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Eye size={16} className="flex-shrink-0" />
          <span className="truncate">{displayText}</span>
        </div>
        <ChevronDown size={16} className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg">
          <div className="max-h-96 overflow-y-auto">
            {/* Por Função */}
            <div className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800">
                Por Função
              </div>
              <div className="py-1">
                {AVAILABLE_ROLES.map((role) => {
                  const isSelected =
                    isImpersonating && !impersonatedTarget?.id && impersonatedTarget?.role === role
                  return (
                    <button
                      key={role}
                      onClick={() => handleSelectRole(role)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      {ROLE_LABELS[role] || role}
                      {isSelected && ' ✓'}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Por Usuário */}
            {usuarios.length > 0 && (
              <div>
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800">
                  Por Usuário
                </div>
                <div className="py-1">
                  {isLoadingUsers ? (
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Carregando...</div>
                  ) : (
                    usuarios.map((usuario) => {
                      const isSelected = isImpersonating && impersonatedTarget?.id === usuario.id
                      return (
                        <button
                          key={usuario.id}
                          onClick={() => handleSelectUsuario(usuario)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          <div>
                            {usuario.nome}
                            {isSelected && ' ✓'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {ROLE_LABELS[usuario.role] || usuario.role}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
