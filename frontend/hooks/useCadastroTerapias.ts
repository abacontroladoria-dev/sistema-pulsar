"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { indicePorNome } from "@/lib/cadastros/terapias"
import { listarTerapias, MigrationPendenteError } from "@/services/cadastroTerapias.service"
import type { CadastroTerapia } from "@/types/terapia"

// Cache de módulo, como usePacientes: a tela de Terapias, a lista de
// Profissionais e o editor de disponibilidade leem o mesmo catálogo — uma
// edição de cor numa tela aparece nas outras sem recarregar a página.

type Estado = {
  terapias: CadastroTerapia[]
  loading: boolean
  error: string | null
  migrationPendente: boolean
}

let estado: Estado = { terapias: [], loading: true, error: null, migrationPendente: false }
let carregado = false
let emVoo: Promise<void> | null = null
const ouvintes = new Set<() => void>()

function publicar(novo: Partial<Estado>) {
  estado = { ...estado, ...novo }
  for (const f of ouvintes) f()
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

const ler = () => estado

export function refetchCadastroTerapias(): Promise<void> {
  if (emVoo) return emVoo
  publicar({ loading: !carregado, error: null })
  emVoo = listarTerapias()
    .then(terapias => {
      carregado = true
      publicar({ terapias, loading: false, error: null, migrationPendente: false })
    })
    .catch(e => {
      publicar({
        loading: false,
        error: String(e?.message ?? e),
        migrationPendente: e instanceof MigrationPendenteError,
      })
    })
    .finally(() => { emVoo = null })
  return emVoo
}

export function useCadastroTerapias() {
  const s = useSyncExternalStore(assinar, ler, ler)

  useEffect(() => {
    if (!carregado) void refetchCadastroTerapias()
  }, [])

  const indice = useMemo(() => indicePorNome(s.terapias), [s.terapias])

  return { ...s, indice, recarregar: refetchCadastroTerapias }
}
