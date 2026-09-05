import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosticoVaga, VagaDisponivel } from '../types/central.types'
import type { Unidade } from '../agente/unidade'

// ============================================================================
// AvailabilityRepository
//
// Disponibilidade NÃO é uma tabela. É a subtração:
//   central.vw_vagas_livres (grade com status 'Livre', unidade física derivada)
//     menos central.appointments com status que ocupa vaga
//     menos o passado
//
// Essa subtração vive em central.listar_vagas_disponiveis (20260810100100,
// reescrita em 20260904100100), não aqui, por dois motivos:
//   1. PostgREST não faz join entre schemas — no cliente seriam duas
//      requisições e a subtração em memória.
//   2. O agente de WhatsApp precisa da mesma regra. Duplicá-la em TypeScript
//      é como as duas superfícies passam a oferecer horários diferentes.
//
// O FILTRO DE UNIDADE TAMBÉM É DO BANCO (mudou em 04/09/2026)
//
// Ele era feito aqui e em ferramentas.ts, sobre a lista já devolvida. Como a
// RPC tem teto de 500 linhas ordenadas por (data, hora, profissional), filtrar
// depois significava que uma unidade sem vaga nas 500 primeiras virava "não
// temos vaga" falso. Agora `p_unidade` filtra no banco e o teto vale POR
// unidade. Não reintroduza o filtro em memória.
//
// Este repository é só o adaptador de chamada das RPCs.
// ============================================================================

export interface ListarVagasInput {
  // Default no banco: hoje (São Paulo) até hoje + 30 dias.
  dataInicio?:     string | null
  dataFim?:        string | null
  terapiaId?:      number | null
  // Os textos que a GRADE usa para a especialidade pedida, já traduzidos do
  // nome que o responsável falou (agente/terapia.ts). Filtra por parte do
  // nome-lista no banco.
  //
  // Existe além de `terapiaId` porque o id NÃO identifica a terapia: medido em
  // produção, `terapia_id` 2317 aparece com sete `terapia_nome` diferentes.
  // Filtrar por 2317 mistura quem só aplica ABA com quem faz psicologia; por
  // 2259 esconde as 12 vagas de psicologia que vivem sob 2317. A informação
  // está no nome, então é nele que o filtro cai.
  //
  // Array vazio é recusado pelo banco (22023): seria bug de chamador se
  // comportando como "sem filtro". Passe undefined para não filtrar.
  terapiaNomes?:   readonly string[] | null
  profissionalId?: number | null
  // Um dos três literais de UNIDADES. O banco valida e LANÇA (22023) em valor
  // desconhecido, em vez de não filtrar — passe por normalizarUnidade() antes.
  unidade?:        Unidade | null
  limite?:         number | null
}

export class AvailabilityRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listarVagas(input: ListarVagasInput = {}): Promise<VagaDisponivel[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .rpc('listar_vagas_disponiveis', {
        p_data_inicio:     input.dataInicio     ?? null,
        p_data_fim:        input.dataFim        ?? null,
        p_terapia_id:      input.terapiaId      ?? null,
        p_profissional_id: input.profissionalId ?? null,
        p_unidade:         input.unidade        ?? null,
        p_terapia_nomes:   input.terapiaNomes ? [...input.terapiaNomes] : null,
        p_limite:          input.limite         ?? null,
      })

    if (error) throw error
    return (data ?? []) as VagaDisponivel[]
  }

  // Diagnóstico de uma vaga específica no instante da reserva.
  // Separa os três motivos de recusa (não existe / já reservada / passado)
  // porque a resposta ao paciente é diferente em cada caso.
  //
  // Nota: esta RPC lê public.vw_grade_base direto, não central.vw_vagas_livres —
  // decisão registrada em 20260904100100. Ela aprova vagas em sala não-física
  // ('AT Externo Escola'), que listarVagas não oferece.
  async diagnosticarVaga(
    profissionalId: number,
    data: string,
    hora: string,
  ): Promise<DiagnosticoVaga> {
    const { data: rows, error } = await (this.supabase as any)
      .schema('central')
      .rpc('vaga_esta_disponivel', {
        p_profissional_id: profissionalId,
        p_data:            data,
        p_hora:            hora,
      })

    if (error) throw error

    // A função retorna TABLE com uma linha; o supabase-js entrega array.
    const row = Array.isArray(rows) ? rows[0] : rows
    if (!row) {
      // Sem linha significa que a própria função não avaliou — tratar como
      // indisponível é a leitura segura (nunca reservar no escuro).
      return { existe_na_grade: false, ja_reservada: false, no_passado: false }
    }
    return row as DiagnosticoVaga
  }

  // Terapias que têm ao menos uma vaga ofertável na janela, com as unidades em
  // que cada uma tem vaga. É o que o agente usa para responder "quais
  // especialidades vocês têm disponíveis?" sem despejar 500 horários.
  //
  // A agregação é do BANCO (central.contar_vagas_por_terapia_e_unidade,
  // 20260904100200), não em memória. Antes ela era feita sobre as 500 primeiras
  // linhas da janela, e o efeito era pior que uma contagem imprecisa: uma
  // terapia que só tem vaga em Padre Miguel a partir da linha 501 aparecia com
  // unidades = ['Realengo'], e o agente afirmava "temos fono, mas só em
  // Realengo" — falso, com a confiança de quem consultou o sistema. Um
  // `group by` não precisa de teto de linhas.
  // Os NOMES crus da grade que têm vaga na janela, com a unidade de cada um.
  //
  // Cru de propósito: quem traduz para o vocabulário de oferta é
  // agente/terapia.ts, e o de-para não pode viver em dois lugares. Aqui só se
  // sabe o que a grade diz.
  //
  // Não agrega por `terapia_id`, e isso é o conserto: o id não identifica a
  // terapia (2317 aparece com sete nomes), então um `group by terapia_id`
  // colapsava 'Aplicador ABA (PS)' com 'Aplicador ABA (PS), Psicologia' e
  // perdia justamente a distinção que interessa.
  async listarNomesDeTerapiaComVaga(
    dataInicio?: string | null,
    dataFim?: string | null,
  ): Promise<{ terapia_nome: string | null; unidade: Unidade | null }[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .rpc('listar_nomes_de_terapia_com_vaga', {
        p_data_inicio: dataInicio ?? null,
        p_data_fim:    dataFim    ?? null,
      })

    if (error) throw error
    return (data ?? []) as { terapia_nome: string | null; unidade: Unidade | null }[]
  }

  async listarTerapiasComVaga(
    dataInicio?: string | null,
    dataFim?: string | null,
  ): Promise<{ terapiaId: number; terapiaNome: string | null; vagas: number; unidades: Unidade[] }[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .rpc('contar_vagas_por_terapia_e_unidade', {
        p_data_inicio: dataInicio ?? null,
        p_data_fim:    dataFim    ?? null,
      })

    if (error) throw error

    type Linha = {
      terapia_id:   number
      terapia_nome: string | null
      unidade:      Unidade
      vagas:        number
    }
    const linhas = (data ?? []) as Linha[]

    // A RPC devolve uma linha por (terapia, unidade). O agente precisa de uma
    // entrada por terapia, com o conjunto de unidades — a dobra acontece aqui
    // porque é formato de apresentação, não regra de negócio.
    const porTerapia = new Map<number, { terapiaNome: string | null; vagas: number; unidades: Unidade[] }>()
    for (const linha of linhas) {
      if (linha.terapia_id == null) continue

      const atual = porTerapia.get(linha.terapia_id)
        ?? { terapiaNome: linha.terapia_nome, vagas: 0, unidades: [] as Unidade[] }

      // `vagas` é a soma das três unidades: o total ofertável da terapia.
      atual.vagas += Number(linha.vagas) || 0

      // Em QUAIS unidades essa terapia tem vaga. Sem isso o agente responde
      // "sim, temos psicomotricidade" para quem já disse que só pode ir a Padre
      // Miguel, e só descobre que não tem lá no passo seguinte.
      if (linha.unidade && !atual.unidades.includes(linha.unidade)) {
        atual.unidades.push(linha.unidade)
      }

      porTerapia.set(linha.terapia_id, atual)
    }

    return [...porTerapia.entries()]
      .map(([terapiaId, v]) => ({
        terapiaId,
        terapiaNome: v.terapiaNome,
        vagas:       v.vagas,
        unidades:    v.unidades,
      }))
      .sort((a, b) => b.vagas - a.vagas)
  }
}
