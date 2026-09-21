import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// CentralUserRepository
//
// Quem pode ser responsável por uma conversa.
//
// A fonte é public.usuarios.central_role (migration 20260701000001) — NÃO
// central.inbox_members. Aquela tabela existe, mas seus próprios comentários a
// declaram "para RLS futuro" e nenhuma policy atual a consulta; usá-la aqui
// mostraria uma lista que não corresponde a quem o sistema de fato autoriza.
//
// `central_role is null` = sem acesso à Central. É exatamente o mesmo teste que
// lib/central/auth.ts faz para recusar a sessão, então a lista que sai daqui é
// a lista de quem consegue abrir esta tela.
//
// ATENÇÃO: esta é a única tabela `public` do módulo — sem `.schema('central')`.
//
// POR QUE ESTE REPOSITÓRIO EXIGE service_role
//
// A RLS de public.usuarios tem duas policies de SELECT: "Admin pode ver todos
// usuarios" (public.is_admin()) e "Usuário pode ver próprio perfil"
// (auth.uid() = id). Com o client do usuário, um `director` da Central — que
// não é admin do Pulsar — enxergaria apenas a si mesmo, e o seletor de
// responsável chegaria com um nome só, silenciosamente. Não é um caso teórico:
// em produção há exatamente esse usuário.
//
// Por isso o caller passa `supabaseService` e o filtro por organização vira
// responsabilidade desta camada — `orgId` vem sempre da sessão validada em
// extractUser(), nunca do pedido. É o mesmo arranjo do fallback em
// lib/central/auth.ts, que lê `usuarios` com service role pela mesma razão.
// ============================================================================

export interface UsuarioCentral {
  id:           string
  nome:         string
  central_role: string
}

export class CentralUserRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listarAtribuiveis(orgId: string): Promise<UsuarioCentral[]> {
    const { data, error } = await this.supabase
      .from('usuarios')
      .select('id, nome, central_role')
      .eq('organization_id', orgId)
      .eq('ativo', true)
      .not('central_role', 'is', null)
      .order('nome', { ascending: true })

    if (error) throw error

    return ((data ?? []) as { id: string; nome: string | null; central_role: string }[])
      // `nome` é nullable na tabela. Um item de <select> em branco é
      // inselecionável na prática — o e-mail não está aqui, então o id curto é
      // o que resta para distinguir a pessoa.
      .map(u => ({
        id:           u.id,
        nome:         u.nome?.trim() || `Usuário ${u.id.slice(0, 8)}`,
        central_role: u.central_role,
      }))
  }
}
