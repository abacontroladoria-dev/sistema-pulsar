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
// `pacientes_select` é `using (true)` para `authenticated` (20260826100500
// documenta que ela não deve ser tocada: Cronograma, CCO e Central de Pacientes
// dependem dela). Esta leitura passa por ela como as outras telas passam — não
// foi preciso abrir nada para o atendimento.
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
}
