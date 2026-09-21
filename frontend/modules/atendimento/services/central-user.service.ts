import type { CentralUserRepository, UsuarioCentral } from '../repositories/central-user.repository'

// ============================================================================
// CentralUserService
//
// Quem pode receber uma conversa. Fino de propósito: não há regra de negócio
// além de "tem central_role e está ativo", e essa regra é do repositório
// porque é uma cláusula de consulta.
//
// Existe assim mesmo para que a rota não fale com um repositório direto — o
// dia em que "atribuível" deixar de ser "qualquer um com acesso" (por caixa de
// entrada, por turno, por carga), a regra entra aqui e nada acima muda.
// ============================================================================

export class CentralUserService {
  constructor(private readonly repo: CentralUserRepository) {}

  async listarAtribuiveis(orgId: string): Promise<UsuarioCentral[]> {
    return this.repo.listarAtribuiveis(orgId)
  }
}
