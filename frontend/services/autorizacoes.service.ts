import { getSupabaseClient } from "@/lib/supabase/client"


type CriarAutorizacaoPayload = {

  agenda_id?: number

  paciente_id?: number

  paciente_nome?: string

  cpf?: string | null

  data_nascimento?: string | null

  matricula?: string

  data?: string

  horario?: string

  terapia_nome?: string
  
  terapia_exibicao_id?: number

  tuss1?: string

  status?: string

  empresa?: string

  dep?: string

  crm?: string

  nome_medico?: string

  usuario_id?: string

  criado_por?: string

  machine_id?: string

  horario_autorizacao?: string
   
}

function semDadosPacienteComplementares(error: any) {
  const mensagem = [
    error?.message,
    error?.details,
    error?.hint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    mensagem.includes('cpf') ||
    mensagem.includes('data_nascimento')
  )
}

// Nome da atendente logada — resolvido uma vez por sessão (mesmo lookup usado no
// cancelamento). Gravado em fila_autorizacoes.criado_por para a Ficha Operacional
// (SidePanel "Solicitado por") exibir o responsável sem depender de join/RPC.
let _nomeUsuarioAtual: string | null = null
export async function resolverNomeUsuario(
  supabase: ReturnType<typeof getSupabaseClient>
): Promise<string | null> {
  if (_nomeUsuarioAtual) return _nomeUsuarioAtual
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  let nome: string | null = user.email ?? null
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nome')
    .eq('id', user.id)
    .maybeSingle()
  if (perfil?.nome) nome = perfil.nome
  _nomeUsuarioAtual = nome
  return nome
}

	
export async function criarAutorizacao(
  payload: CriarAutorizacaoPayload
) {

  const supabase =
    getSupabaseClient()

  const criadoPor =
    payload.criado_por ?? (await resolverNomeUsuario(supabase))

  const insertPayload = {

    // =========================
    // IDENTIFICAÇÃO
    // =========================

    agenda_id:
      null,

    paciente_id:
      payload.paciente_id || null,

    paciente_nome:
      payload.paciente_nome || null,

    cpf:
      payload.cpf || null,

    data_nascimento:
      payload.data_nascimento || null,

    matricula:
      payload.matricula || null,

    // =========================
    // ATENDIMENTO
    // =========================

    data_atendimento:
      payload.data || null,

    horario:
      payload.horario || null,

    terapia_nome:
      payload.terapia_nome || null,
	  
	terapia_exibicao_id:
	  payload.terapia_exibicao_id != null
		? Number(payload.terapia_exibicao_id)
		: null,

    tuss:
      payload.tuss1 || null,

    // =========================
    // STATUS
    // =========================

    status:
      payload.status || 'pendente',

    data_horario:

	  payload.data && payload.horario

		? `${payload.data}T${payload.horario}`

		: null,

    // =========================
    // CONVÊNIO / MÉDICO
    // =========================

    empresa:
      payload.empresa || null,

    dep:
      payload.dep || null,

    crm:
      payload.crm || null,

    nome_medico:
      payload.nome_medico || null,

    // =========================
    // EXECUÇÃO
    // =========================

    usuario_id:
      payload.usuario_id || null,

    criado_por:
      criadoPor,

    machine_id:
      payload.machine_id || null,
  }

  console.log(
    'INSERT AUTORIZAÇÃO:',
    insertPayload
  )

  let {
    data,
    error
  } = await supabase
    .from('fila_autorizacoes')
    .insert([insertPayload])
    .select()
    .single()

  if (
    error &&
    semDadosPacienteComplementares(error)
  ) {
    const legacyPayload: Partial<typeof insertPayload> = {
      ...insertPayload
    }

    delete legacyPayload.cpf
    delete legacyPayload.data_nascimento

    const retry = await supabase
      .from('fila_autorizacoes')
      .insert([legacyPayload])
      .select()
      .single()

    data = retry.data
    error = retry.error
  }

	if (error) {

		console.error(
		  'ERRO COMPLETO:',
		  JSON.stringify(error, null, 2)
		)

		const msg = [error.message, error.details, error.hint]
		  .filter(Boolean)
		  .join(' | ')
		console.error('ERRO DETALHADO:', msg)

	  return null
	}

	  console.log(
		'SALVOU:',
		data
	  )

	  return data
	}

export async function listarCentralAutorizacoes(data: string): Promise<Record<string, any>[]> {
  const supabase = getSupabaseClient()
  const { data: rows, error } = await supabase
    .rpc('listar_central_autorizacoes', { p_data: data })
  if (error) throw error
  return rows ?? []
}

// ============================================================================
// FALTA EM LOTE
//
// Feriado, ponto facultativo, falta de energia: o dia inteiro cai. O caminho
// individual (handleFalta) faz 2-3 round-trips por sessão sem transação — num
// feriado de 300 sessões isso é ~900 requisições e um estado pela metade se algo
// interromper no meio. Aqui é uma chamada só, atômica no banco.
//
// Ver supabase/migrations/20260908100100_registrar_falta_em_lote.sql.
// ============================================================================

export type MotivoFalta =
  | 'feriado'
  | 'ponto_facultativo'
  | 'falta_energia'
  | 'evento_climatico'
  | 'outro'

export const MOTIVOS_FALTA: { valor: MotivoFalta; rotulo: string }[] = [
  { valor: 'feriado',           rotulo: 'Feriado' },
  { valor: 'ponto_facultativo', rotulo: 'Ponto facultativo' },
  { valor: 'falta_energia',     rotulo: 'Falta de energia' },
  { valor: 'evento_climatico',  rotulo: 'Eventos Climáticos' },
  { valor: 'outro',             rotulo: 'Outro' },
]

export type FaltaLoteParams = {
  data: string                       // 'YYYY-MM-DD', direto do <input type="date">
  motivo: MotivoFalta
  justificativa: string
  // 'unidade' = a clínica não abriu (feriado, ponto facultativo, falta de
  // energia). Não é ausência de ninguém: fica fora da assiduidade do paciente e
  // da fila de reposição. É o padrão do lote.
  tipoFalta?: 'paciente' | 'terapeuta' | 'unidade'
  unidade?: string | null            // null = todas
  horario?: string | null            // 'HH:MM', null = todos
  convenioNome?: string | null       // null = todos
  loteId?: string
}

export type FaltaLoteResultado = {
  lote_id: string
  dry_run: boolean
  aplicadas: number
  atualizadas: number
  criadas: number
  ignoradas: number
  ignoradas_por_motivo: Record<string, number>
}

// Rótulos das razões pelas quais uma sessão fica de fora do lote. A confirmação
// mostra só o total, mas o detalhe é o que permite entender um lote que veio
// menor do que o esperado.
export const ROTULO_IGNORADA: Record<string, string> = {
  autorizado_externo:  'já autorizadas fora do Pulsar',
  concluido:           'já concluídas',
  concluido_sem_guia:  'concluídas sem guia',
  glosa:               'glosadas',
  falta:               'já em falta',
  em_processamento:    'sendo autorizadas agora',
}

function paramsParaRpc(p: FaltaLoteParams, dryRun: boolean) {
  return {
    p_data:          p.data,
    p_motivo:        p.motivo,
    p_justificativa: p.justificativa,
    p_tipo_falta:    p.tipoFalta ?? 'unidade',
    // String vazia é o valor das opções "Todas as unidades" / "Todos os
    // horários" / "Todos os convênios"; o banco espera NULL para "sem filtro".
    p_unidade:       p.unidade || null,
    p_horario:       p.horario || null,
    p_convenio_nome: p.convenioNome || null,
    p_dry_run:       dryRun,
    p_lote_id:       p.loteId ?? null,
  }
}

function traduzirErroLote(error: { code?: string; message?: string } | null): Error {
  // 57014 = statement timeout. A transação inteira aborta (o que é o
  // comportamento seguro), mas o erro cru não diz nada de útil à atendente.
  if (error?.code === '57014') {
    return new Error(
      'O lote é grande demais para uma tentativa. Filtre por unidade ou horário e repita.'
    )
  }
  if (error?.code === '42501') {
    return new Error('Você não tem permissão para lançar falta em lote.')
  }
  if (error?.code === '23505') {
    return new Error('Este lote já foi aplicado.')
  }
  return new Error(error?.message || 'Erro ao processar falta em lote')
}

/**
 * Conta o que o lote faria, sem escrever nada.
 *
 * A contagem de ignoradas SÓ pode vir daqui: a /solicitar recebe apenas cards
 * com mostrar_na_tela = true, então as sessões já autorizadas nunca chegam ao
 * browser e não há como contá-las no cliente.
 */
export async function previewFaltaEmLote(
  params: FaltaLoteParams
): Promise<FaltaLoteResultado> {

  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc(
    'registrar_falta_em_lote',
    paramsParaRpc(params, true)
  )

  if (error) {
    console.error('Erro no preview de falta em lote:', error)
    throw traduzirErroLote(error)
  }

  return data as FaltaLoteResultado
}

/**
 * Aplica o lote de verdade.
 *
 * Passe o mesmo `loteId` do preview: se a confirmação der timeout de rede e a
 * atendente clicar de novo, o banco recusa o segundo lançamento em vez de
 * duplicar as faltas.
 */
export async function aplicarFaltaEmLote(
  params: FaltaLoteParams
): Promise<FaltaLoteResultado> {

  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc(
    'registrar_falta_em_lote',
    paramsParaRpc(params, false)
  )

  if (error) {
    console.error('Erro ao aplicar falta em lote:', error)
    throw traduzirErroLote(error)
  }

  return data as FaltaLoteResultado
}

/**
 * Desfaz um lote inteiro pelo id.
 *
 * As sessões voltam como `cancelado`, não `pendente`: parte delas foi criada
 * pelo próprio lote, e devolvê-las a pendente as transformaria em tarefa para o
 * robô. Como `cancelado` aparece na /solicitar, a recepção age normalmente.
 */
export async function reverterFaltaEmLote(
  loteId: string
): Promise<{ lote_id: string; revertidas: number; ignoradas: number }> {

  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc(
    'reverter_falta_em_lote',
    { p_lote_id: loteId }
  )

  if (error) {
    console.error('Erro ao reverter falta em lote:', error)
    throw traduzirErroLote(error)
  }

  return data as { lote_id: string; revertidas: number; ignoradas: number }
}

export async function listarAutorizacoes(): Promise<Record<string, any>[]> {

  const supabase =
    getSupabaseClient()

  const {
    data,
    error
  } = await supabase

	.from('fila_autorizacoes')
	.select('*')
	.order('created_at', {
	  ascending: false
	})

  if (error) {

    console.error(
      'Erro ao buscar autorizações:',
      error
    )

    return []
  }

  return data || []
}
