import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// PacienteRepository
//
// A ÚNICA porta do módulo `atendimento` para `public.pacientes`.
//
// Até 21/09/2026 o módulo não tocava o cadastro de pacientes: ele conhecia
// `central.contact_patient_links.tita_paciente_id` e parava ali, no número. A
// rota do contato fazia `select('*')` na tabela de vínculo e devolvia o id sem
// nome, sem nascimento, sem plano. O caminho existia no banco e ninguém o
// percorria.
//
// POR QUE COLUNAS NOMEADAS, E NUNCA select('*')
//
// `public.pacientes` guarda CPF do paciente, CPF do responsável, endereço
// completo, telefone e e-mail. Nada disso tem razão de atravessar uma rota de
// painel de atendimento — e `select('*')` faria tudo isso viajar até o
// navegador do atendente a cada abertura de conversa, onde ficaria no cache do
// fetch e em qualquer captura de rede. O painel precisa de cinco campos;
// são cinco campos que saem daqui.
//
// SOBRE RLS
//
// Desde 20261019180100 o login comum NÃO lê `public.pacientes` (só quem tem
// `cadastros_pacientes` ou papel admin/diretoria/cronograma). Quem usa este
// repositório passa o cliente de serviço: os workers da Central e a rota da
// ficha (depois de extractUser, que exige a permissão `connect`).
// ============================================================================

// `sincronizado_em` entra porque `convenio_nome` NÃO é digitado: é cache
// derivado da linha mais recente de `agenda_tita` pelo sync (20260817190000).
// Sem a data, o painel mostraria um plano possivelmente velho com cara de dado
// atual, e ninguém teria como saber a diferença.
const COLUNAS = `
  tita_paciente_id,
  nome,
  data_nascimento,
  responsavel_nome,
  convenio_nome,
  numero_carteirinha,
  sincronizado_em
`

export interface PacienteCadastro {
  tita_paciente_id:   number
  nome:               string | null
  data_nascimento:    string | null
  responsavel_nome:   string | null
  convenio_nome:      string | null
  numero_carteirinha: string | null
  sincronizado_em:    string | null
}

export class PacienteRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // O paciente vinculado a este contato, ou null.
  //
  // `tita_paciente_id` é UNIQUE em `pacientes` (20260817190000), então o
  // maybeSingle é seguro. Devolve null tanto para "não existe vínculo" quanto
  // para "o vínculo aponta para um paciente que o sync ainda não trouxe" — os
  // dois casos produzem a mesma tela (ficha sem cadastro), e distingui-los aqui
  // só adicionaria um estado que ninguém trata.
  async porTitaId(titaPacienteId: number): Promise<PacienteCadastro | null> {
    const { data, error } = await (this.supabase as any)
      .from('pacientes')
      .select(COLUNAS)
      .eq('tita_paciente_id', titaPacienteId)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as PacienteCadastro | null
  }

  // ------------------------------------------------------------------------
  // O vínculo deste contato, se houver.
  //
  // Um contato pode ter VÁRIOS vínculos: "Maria é responsável de Pedro E Lucas"
  // está escrito na própria migration do schema (20260701000400). A ficha do
  // painel mostra UM paciente, então esta função escolhe — e a escolha é o
  // vínculo mais recente, porque é o do atendimento em curso.
  //
  // É uma simplificação consciente, e o lugar onde ela está registrada. O dia em
  // que o painel precisar mostrar irmãos, é aqui que a lista volta inteira.
  // ------------------------------------------------------------------------
  async titaIdDoContato(orgId: string, contactId: string): Promise<number | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_patient_links')
      .select('tita_paciente_id, created_at')
      .eq('organization_id', orgId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw error

    const linhas = (data ?? []) as { tita_paciente_id: number }[]
    return linhas[0]?.tita_paciente_id ?? null
  }

  // TODOS os pacientes vinculados a este contato (irmãos inclusive), com o
  // nome — para a Maia responder sobre as sessões de quem já é da clínica
  // (15/10/2026). Ao contrário de `titaIdDoContato`, aqui a lista vem inteira:
  // a mãe de dois pergunta pelos dois. Vínculo cujo paciente o sync ainda não
  // trouxe entra sem nome — o id basta para ler a agenda.
  async vinculadosDoContato(
    orgId: string,
    contactId: string,
  ): Promise<{ titaPacienteId: number; nome: string | null }[]> {
    const { data: links, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_patient_links')
      .select('tita_paciente_id')
      .eq('organization_id', orgId)
      .eq('contact_id', contactId)

    if (error) throw error
    const ids = [...new Set(((links ?? []) as { tita_paciente_id: number }[]).map((l) => l.tita_paciente_id))]
    if (ids.length === 0) return []

    const { data: pacientes, error: e2 } = await (this.supabase as any)
      .from('pacientes')
      .select('tita_paciente_id, nome')
      .in('tita_paciente_id', ids)

    if (e2) throw e2
    const nomes = new Map(
      ((pacientes ?? []) as { tita_paciente_id: number; nome: string | null }[])
        .map((p) => [p.tita_paciente_id, p.nome]),
    )
    return ids.map((id) => ({ titaPacienteId: id, nome: nomes.get(id) ?? null }))
  }
}
