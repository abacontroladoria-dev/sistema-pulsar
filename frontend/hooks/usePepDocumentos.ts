'use client'

import { useCallback, useEffect, useState } from 'react'
import { analisarPendentes, listarDocumentos, listarSemelhancas, type OutroDocumento } from '@/services/pepDocumentos.service'
import type { DocumentoPep, SemelhancaPep } from '@/lib/pepDocumentos/tipos'

/**
 * Conferência do conteúdo dos documentos do analista e mês abertos na PEP.
 * Ao abrir, se algum documento está esperando análise, pede a análise (só dos
 * pendentes — chamar de novo não gasta IA de novo) e recarrega; repete
 * enquanto o servidor disser que sobrou, até 4 vezes.
 */
export function usePepDocumentos(spIds: string[]) {
  const [documentos, setDocumentos] = useState<DocumentoPep[]>([])
  const [pares, setPares] = useState<SemelhancaPep[]>([])
  const [outros, setOutros] = useState<Map<string, OutroDocumento>>(new Map())
  const [disponivel, setDisponivel] = useState(true)
  const [carregando, setCarregando] = useState(false)
  const [analisando, setAnalisando] = useState(false)
  // A lista vira texto: muda só quando muda o conjunto (outro analista/mês).
  const chave = spIds.slice().sort().join('|')

  const carregar = useCallback(async () => {
    const lista = chave ? chave.split('|') : []
    if (lista.length === 0) { setDocumentos([]); setPares([]); return [] as DocumentoPep[] }
    setCarregando(true)
    try {
      const r = await listarDocumentos(lista)
      setDisponivel(r.disponivel)
      setDocumentos(r.documentos)
      if (r.disponivel) {
        const s = await listarSemelhancas(lista)
        setPares(s.pares)
        setOutros(s.outros)
      }
      return r.documentos
    } catch {
      // Sem permissão ou erro passageiro: a tela PEP funciona igual sem a conferência.
      setDocumentos([])
      setPares([])
      return [] as DocumentoPep[]
    } finally {
      setCarregando(false)
    }
  }, [chave])

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      let docs = await carregar()
      for (let volta = 0; volta < 4 && !cancelado; volta++) {
        const pendentes = docs.filter(d => d.analise_status === 'pendente').map(d => d.sp_id)
        if (pendentes.length === 0) break
        setAnalisando(true)
        try {
          const r = await analisarPendentes(pendentes)
          docs = await carregar()
          if (!r.restantes) break
        } catch {
          break
        } finally {
          if (!cancelado) setAnalisando(false)
        }
      }
    })()
    return () => { cancelado = true }
  }, [carregar])

  return { documentos, pares, outros, disponivel, carregando, analisando, recarregar: carregar }
}
