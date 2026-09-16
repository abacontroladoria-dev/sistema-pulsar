'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  Appointment,
  Task,
  TagDefinition,
} from '@/modules/atendimento/types/central.types'
import type { UsuarioAtribuivel } from '@/components/nina/detalhamento/BlocoResponsavel'

// ============================================================================
// Os dados do painel de detalhamento que NÃO vêm no detalhe da conversa.
//
// POR QUE ESTE HOOK NÃO FAZ POLLING
//
// `useCentralInbox` recarrega a cada 5s porque mensagem chega do outro lado do
// WhatsApp a qualquer momento. Nada aqui tem essa natureza:
//
//   - o catálogo de tags e a lista de usuários mudam quando alguém mexe na
//     configuração da clínica, o que acontece talvez uma vez por mês;
//   - agendamento e tarefa desta pessoa só mudam quando alguém desta tela os
//     cria — não há robô marcando retorno sozinho.
//
// Se cada bloco entrasse no polling, as 3 requisições por tique virariam 7, e
// as 4 novas seriam desperdício puro. Em vez disso: carga no mount (catálogos)
// ou na troca de contato (listas), e recarga explícita após cada escrita.
//
// POR QUE O ERRO NÃO SOBE
//
// Falha aqui NÃO vai para o `erro` do inbox. Aquele estado pinta a tela inteira
// de "Sem acesso à Central"; catálogo de tags que não respondeu não pode
// derrubar a caixa de entrada. O painel degrada — bloco sem catálogo mostra os
// chips que o contato já tem — e a conversa continua funcionando.
// ============================================================================

async function buscar<T>(url: string, signal: AbortSignal): Promise<T> {
  const res  = await fetch(url, { signal, cache: 'no-store' })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message ?? `A rota respondeu ${res.status}.`)
  return json.data as T
}

export interface UsePainelDetalhamento {
  catalogoTags: TagDefinition[]
  usuarios:     UsuarioAtribuivel[]
  agendamentos: Appointment[]
  tarefas:      Task[]
  carregandoListas: boolean
  // Chamado pelo painel depois de criar agendamento ou tarefa.
  recarregarListas: () => Promise<void>
}

export function usePainelDetalhamento(contactId: string | null): UsePainelDetalhamento {
  const [catalogoTags, setCatalogoTags] = useState<TagDefinition[]>([])
  const [usuarios, setUsuarios]         = useState<UsuarioAtribuivel[]>([])
  const [agendamentos, setAgendamentos] = useState<Appointment[]>([])
  const [tarefas, setTarefas]           = useState<Task[]>([])
  const [carregandoListas, setCarregando] = useState(false)

  // ------------------------------------------------------------------------
  // Catálogos — uma vez, no mount

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true

    // Independentes: uma rota fora do ar não pode levar a outra junto. Por isso
    // dois try/catch e não um Promise.all com um catch só.
    ;(async () => {
      try {
        const tags = await buscar<TagDefinition[]>('/api/central/tag-definitions', controller.signal)
        if (vivo) setCatalogoTags(tags)
      } catch { /* o bloco de tags degrada para leitura */ }

      try {
        const us = await buscar<UsuarioAtribuivel[]>('/api/central/users', controller.signal)
        if (vivo) setUsuarios(us)
      } catch { /* o seletor de responsável fica sem nomes */ }
    })()

    return () => { vivo = false; controller.abort() }
  }, [])

  // ------------------------------------------------------------------------
  // Listas da pessoa — a cada troca de contato

  const carregarListas = useCallback(async (signal: AbortSignal) => {
    // Sem contato não há a quem pedir. Chamar a rota sem `contactId` traria os
    // agendamentos da ORGANIZAÇÃO inteira para a ficha de uma pessoa.
    if (!contactId) {
      setAgendamentos([])
      setTarefas([])
      return
    }

    try {
      const [ags, tks] = await Promise.all([
        buscar<Appointment[]>(`/api/central/appointments?contactId=${contactId}`, signal),
        // Só as pendentes: o bloco responde "o que falta fazer com esta
        // pessoa", e histórico de tarefa concluída empurraria a pendência para
        // fora da vista no espaço curto do painel.
        buscar<Task[]>(`/api/central/tasks?contactId=${contactId}&status=pending`, signal),
      ])
      setAgendamentos(ags)
      setTarefas(tks)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setAgendamentos([])
      setTarefas([])
    }
  }, [contactId])

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true
    setCarregando(true)
    carregarListas(controller.signal).finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false; controller.abort() }
  }, [carregarListas])

  const recarregarListas = useCallback(async () => {
    const controller = new AbortController()
    await carregarListas(controller.signal)
  }, [carregarListas])

  return { catalogoTags, usuarios, agendamentos, tarefas, carregandoListas, recarregarListas }
}
