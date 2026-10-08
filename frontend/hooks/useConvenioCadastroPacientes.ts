"use client"

import { useEffect, useState } from "react"
import { montarMapaConvenioCadastro, type FavorecidoCadastroCliente, type MapaConvenioCadastro } from "@/lib/cronograma/convenioCadastro"

export interface ConvenioCadastroState {
  /** null enquanto carrega ou quando o TiTa falhou — quem consome cai no convênio da agenda. */
  mapa: MapaConvenioCadastro | null
  loading: boolean
  /** Código de erro da rota (ex.: "token_nao_configurado", "tita_http_500"), ou null. */
  erro: string | null
  /** A rota serviu um cache vencido porque o TiTa falhou agora. */
  obsoleto: boolean
}

/**
 * Convênio de cada paciente pelo CADASTRO do TiTa (ver lib/cronograma/convenioCadastro.ts).
 * Reaproveita a rota existente /api/tita/situacao-favorecidos (cache de 5 min no
 * servidor), a mesma que a modalidade Criar Novo Cronograma consulta.
 */
export function useConvenioCadastroPacientes(): ConvenioCadastroState {
  const [estado, setEstado] = useState<ConvenioCadastroState>({ mapa: null, loading: true, erro: null, obsoleto: false })

  useEffect(() => {
    let cancelado = false
    fetch("/api/tita/situacao-favorecidos")
      .then(async r => {
        const body = await r.json().catch(() => null) as
          | { ok: boolean; favorecidos?: FavorecidoCadastroCliente[]; error?: string; obsoleto?: boolean }
          | null
        if (cancelado) return
        if (!r.ok || !body?.ok || !Array.isArray(body.favorecidos)) {
          setEstado({ mapa: null, loading: false, erro: body?.error ?? `http_${r.status}`, obsoleto: false })
          return
        }
        setEstado({ mapa: montarMapaConvenioCadastro(body.favorecidos), loading: false, erro: null, obsoleto: !!body.obsoleto })
      })
      .catch(() => {
        if (!cancelado) setEstado({ mapa: null, loading: false, erro: "falha_de_rede", obsoleto: false })
      })
    return () => { cancelado = true }
  }, [])

  return estado
}
