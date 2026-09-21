'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  Appointment,
  Task,
  TagDefinition,
  LeituraSentimento,
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

  // Leitura de sentimento — estado próprio, separado das listas acima.
  //
  // Separado porque o ciclo é outro: as listas carregam juntas e falham juntas
  // sem consequência, enquanto a leitura tem uma ação que CUSTA (uma chamada ao
  // modelo) e cujo erro precisa chegar à tela. Enfiá-la no mesmo
  // `carregandoListas` faria o botão de reanalisar piscar o bloco de tarefas.
  sentimento:            LeituraSentimento | null
  carregandoSentimento:  boolean
  analisandoSentimento:  boolean
  erroSentimento:        string | null
  reanalisarSentimento:  () => Promise<void>
}

export function usePainelDetalhamento(contactId: string | null): UsePainelDetalhamento {
  const [catalogoTags, setCatalogoTags] = useState<TagDefinition[]>([])
  const [usuarios, setUsuarios]         = useState<UsuarioAtribuivel[]>([])
  const [agendamentos, setAgendamentos] = useState<Appointment[]>([])
  const [tarefas, setTarefas]           = useState<Task[]>([])
  const [carregandoListas, setCarregando] = useState(false)

  const [sentimento, setSentimento]     = useState<LeituraSentimento | null>(null)
  const [carregandoSentimento, setCarregandoSentimento] = useState(false)
  const [analisandoSentimento, setAnalisando]           = useState(false)
  const [erroSentimento, setErroSentimento]             = useState<string | null>(null)

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

  // ------------------------------------------------------------------------
  // Leitura de sentimento
  //
  // GET na troca de contato, e só. Nunca no polling: o resultado muda quando o
  // worker analisa (a cada vários minutos, no melhor caso), não a cada 5
  // segundos — e o corpo é maior que o das outras listas.
  //
  // A BARRA FINAL NO POST NÃO É ENFEITE. `next.config.ts` tem
  // `trailingSlash: true`, então `POST /…/sentimento` responde 308 e o handler
  // NUNCA roda. Medido nesta rota: sem barra = 308, com barra = chega. O GET
  // não sofre disso porque o navegador segue o redirect sem perder nada, mas o
  // POST fica igual em qualquer caso — e escrever as duas do mesmo jeito evita
  // que alguém "limpe" a barra depois.

  const carregarSentimento = useCallback(async (signal: AbortSignal) => {
    if (!contactId) {
      setSentimento(null)
      return
    }
    try {
      const leitura = await buscar<LeituraSentimento>(
        `/api/central/contacts/${contactId}/sentimento/`, signal,
      )
      setSentimento(leitura)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // Some com a leitura velha: ela é de OUTRA pessoa se a troca de contato
      // foi o que disparou esta carga. Mostrar o sentimento do contato anterior
      // na ficha do atual é pior que não mostrar nada.
      setSentimento(null)
    }
  }, [contactId])

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true
    setCarregandoSentimento(true)
    // O erro é da tentativa de ANALISAR, não da de ler. Trocar de conversa
    // limpa o aviso — ele não fala mais sobre quem está na tela.
    setErroSentimento(null)
    carregarSentimento(controller.signal).finally(() => {
      if (vivo) setCarregandoSentimento(false)
    })
    return () => { vivo = false; controller.abort() }
  }, [carregarSentimento])

  const reanalisarSentimento = useCallback(async () => {
    if (!contactId || analisandoSentimento) return

    setAnalisando(true)
    setErroSentimento(null)
    try {
      const res  = await fetch(`/api/central/contacts/${contactId}/sentimento/`, { method: 'POST' })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        // A mensagem do servidor é a única que distingue "conversa curta
        // demais" de "acabou o crédito da OpenAI" — duas coisas que o atendente
        // resolve de formas opostas. Um "não foi possível analisar" genérico
        // mandaria as duas para o mesmo lugar.
        setErroSentimento(json?.error?.message ?? `A análise respondeu ${res.status}.`)
        return
      }

      // Recarrega em vez de encaixar a linha nova no estado: a tendência
      // depende da leitura ANTERIOR, e o POST devolve só a atual. Montar o par
      // aqui duplicaria a regra que o service já aplica.
      const controller = new AbortController()
      await carregarSentimento(controller.signal)
    } catch (e) {
      setErroSentimento((e as Error).message || 'Falha de rede ao analisar.')
    } finally {
      setAnalisando(false)
    }
  }, [contactId, analisandoSentimento, carregarSentimento])

  return {
    catalogoTags, usuarios, agendamentos, tarefas, carregandoListas, recarregarListas,
    sentimento, carregandoSentimento, analisandoSentimento, erroSentimento, reanalisarSentimento,
  }
}
