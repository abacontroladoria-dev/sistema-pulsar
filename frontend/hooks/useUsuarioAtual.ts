'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { carregarGruposDoUsuario, rotuloDosGrupos } from '@/lib/permissions/carregar'

// ============================================================================
// useUsuarioAtual
//
// Identidade do usuário logado como o Pulsar a entende: o nome e o papel moram
// em public.usuarios, não nos metadados do Auth.
//
// Existe porque o sidebar do Connect lia user.user_metadata.full_name — chave
// que ninguém grava: create-user-with-password escreve `nome` (não `full_name`)
// e a fonte canônica é public.usuarios. O fallback era a string 'Usuário', e
// abaixo dela o e-mail. Resultado: a mesma pessoa que no Pulsar é "Caio /
// Administrador" virava "Usuário / aba.controladoria@gmail.com" ao atravessar
// para o Connect.
//
// Lê o banco direto do browser, e não /api/central/organization, de propósito:
// aquela rota exige central_role e responde 401 para quem ainda não o tem — ou
// seja, justamente quem mais precisa entender o que está vendo ficaria sem nome
// na tela.
//
// central_role vem junto porque é ele, e não `role`, que governa o que a Central
// de Atendimento libera. Quando é null a pessoa entra na tela e toda chamada a
// /api/central/* responde 401; quem consome este hook consegue dizer isso em vez
// de exibir um papel que ali não vale nada.
// ============================================================================

export type UsuarioAtual = {
  userId:           string | null
  email:            string
  nomeCompleto:     string
  // Primeiro nome — é o que o sidebar do Pulsar mostra, e as duas telas devem
  // concordar sobre como a pessoa se chama.
  primeiroNome:     string
  role:             string | null
  // Os grupos de permissão da pessoa ("Recepção, Suprimentos") — é o que se
  // mostra dela. O `role` é nível técnico do banco e não aparece em tela.
  // `null` enquanto/quando não deu para ler.
  gruposLabel:      string | null
  centralRole:      string | null
  // Só é conclusão quando o perfil foi realmente lido. Se a leitura falhar,
  // `false` significaria "não tem acesso" quando o certo é "não sei" — e quem
  // consome ficaria afirmando ausência de permissão por causa de um erro de
  // rede. Por isso `perfilLido` acompanha.
  temAcessoCentral: boolean
  perfilLido:       boolean
  loading:          boolean
  erro:             string | null
}

const VAZIO: UsuarioAtual = {
  userId:           null,
  email:            '',
  nomeCompleto:     '',
  primeiroNome:     'Usuário',
  role:             null,
  gruposLabel:      null,
  centralRole:      null,
  temAcessoCentral: false,
  perfilLido:       false,
  loading:          true,
  erro:             null,
}

export function useUsuarioAtual(): UsuarioAtual {
  const [estado, setEstado] = useState<UsuarioAtual>(VAZIO)

  useEffect(() => {
    let ativo = true
    const supabase = getSupabaseClient()

    async function carregar() {
      const { data: { user }, error: authErr } = await supabase.auth.getUser()

      if (!ativo) return

      if (authErr || !user) {
        setEstado({ ...VAZIO, loading: false, erro: 'Sessão não encontrada' })
        return
      }

      const email = user.email ?? ''

      const { data: perfil, error } = await supabase
        .from('usuarios')
        .select('nome, role, central_role')
        .eq('id', user.id)
        .maybeSingle()

      if (!ativo) return

      if (error) {
        // Sem o perfil ainda dá para identificar a pessoa pelo e-mail — pior é
        // afirmar um papel que não foi lido.
        setEstado({
          ...VAZIO,
          userId:       user.id,
          email,
          primeiroNome: email.split('@')[0] || 'Usuário',
          loading:      false,
          erro:         error.message,
        })
        return
      }

      const grupos = await carregarGruposDoUsuario(supabase)
      if (!ativo) return

      const nomeCompleto = (perfil?.nome as string | undefined)?.trim() ?? ''
      const role         = (perfil?.role as string | undefined) ?? null
      const centralRole  = (perfil?.central_role as string | undefined) ?? null

      setEstado({
        userId:           user.id,
        email,
        nomeCompleto,
        primeiroNome:     nomeCompleto.split(' ')[0] || email.split('@')[0] || 'Usuário',
        role,
        gruposLabel:      rotuloDosGrupos(grupos),
        centralRole,
        temAcessoCentral: !!centralRole,
        perfilLido:       true,
        loading:          false,
        erro:             null,
      })
    }

    void carregar()

    return () => { ativo = false }
  }, [])

  return estado
}
