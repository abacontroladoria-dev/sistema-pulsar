import { getSupabaseClient } from "@/lib/supabase/client"

// Dados escolares do paciente. Dois caminhos de escrita, nenhum por aqui direto:
//
//   - a família, no formulário público /ficha-escolar (route handler
//     /api/ficha-escolar/enviar, service_role);
//   - a equipe, na seção Escola do Cadastro, pela RPC escola_salvar_equipe
//     (20261022150000), que grava o usuário logado.
//
// Nenhum dos dois edita o que já existe: cada gravação é um envio novo, e o
// histórico preserva todos. A equipe NÃO corrige o envio da família — registra
// o seu, marcado como "Equipe". Por isso não existe `upsert...` aqui.

const supabase = getSupabaseClient()

export type OrigemEscola = "formulario" | "equipe"

export type DadosEscolares = {
  id: number
  paciente_id: number
  escola_nome: string
  escola_endereco: string | null
  escola_telefone: string | null
  escola_email: string | null
  coordenador_nome: string | null
  turma: string | null
  turno: string | null
  /** Obrigatório no formulário; opcional quando a equipe registra. */
  preenchido_por_nome: string | null
  preenchido_por_parentesco: string | null
  preenchido_por_telefone: string | null
  telefone_confere: boolean | null
  criado_em: string
  origem: OrigemEscola
  registrado_por_nome: string | null
  observacao: string | null
}

const COLUNAS_ANTIGAS =
  "id, paciente_id, escola_nome, escola_endereco, escola_telefone, escola_email, " +
  "coordenador_nome, turma, turno, preenchido_por_nome, preenchido_por_parentesco, " +
  "preenchido_por_telefone, telefone_confere, criado_em"
const COLUNAS = COLUNAS_ANTIGAS + ", origem, registrado_por_nome, observacao"

const MSG_MIGRACAO_PENDENTE =
  "O registro da escola pela equipe ainda não está ativo no banco (falta aplicar a migration 20261022150000)."

function ehMigracaoPendente(erro: { code?: string } | null): boolean {
  return ["42703", "42883", "PGRST202", "PGRST204"].includes(erro?.code ?? "")
}

export class ErroEscola extends Error {}

/** Resumo por paciente, para a LISTAGEM saber quem respondeu sem abrir a ficha. */
export type ResumoEscolar = {
  /** Envio mais recente. */
  criado_em: string
  escola_nome: string
  /** Quantos envios existem — >1 significa que a escola mudou no caminho. */
  envios: number
}

/**
 * Um resumo por paciente que TEM dados escolares, para a lista de cadastro.
 *
 * Quem não respondeu simplesmente não aparece no Map — a ausência da chave é a
 * resposta "não preencheu", porque é exatamente assim que o dado existe: não há
 * flag em `pacientes`, só a existência (ou não) de linha aqui.
 *
 * Traz `paciente_id, criado_em, escola_nome` da tabela inteira e agrupa no
 * cliente, em vez de uma RPC agregada. São ~1 linha por paciente respondente
 * (poucos milhares no pior caso), o índice (paciente_id, criado_em desc) já
 * serve a ordenação, e evita uma migration nova só para alimentar um contador.
 * Se um dia a tabela crescer a ponto de doer, aí vale um `group by` no banco.
 */
export async function getResumoEscolarPorPaciente(): Promise<Map<number, ResumoEscolar>> {
  const porPaciente = new Map<number, ResumoEscolar>()
  // Página a página: o PostgREST corta QUALQUER resposta em max_rows (1000) sem
  // erro, então sem paginar o Map nasceria incompleto em silêncio — e paciente
  // que respondeu apareceria como "não preencheu".
  const TAMANHO = 1000
  for (let de = 0; ; de += TAMANHO) {
    const { data, error } = await supabase
      .from("pacientes_dados_escolares")
      .select("paciente_id, criado_em, escola_nome")
      // Ordenação TOTAL (criado_em pode repetir; id desempata) para o range não
      // pular nem repetir linha entre páginas.
      .order("paciente_id", { ascending: true })
      .order("criado_em", { ascending: false })
      .order("id", { ascending: false })
      .range(de, de + TAMANHO - 1)

    if (error) throw error

    const linhas = (data ?? []) as unknown as {
      paciente_id: number
      criado_em: string
      escola_nome: string
    }[]

    for (const linha of linhas) {
      const atual = porPaciente.get(linha.paciente_id)
      // A ordenação garante que a PRIMEIRA linha vista de cada paciente é a mais
      // recente; as seguintes só incrementam a contagem.
      if (atual) atual.envios += 1
      else
        porPaciente.set(linha.paciente_id, {
          criado_em: linha.criado_em,
          escola_nome: linha.escola_nome,
          envios: 1,
        })
    }

    if (linhas.length < TAMANHO) break
  }

  return porPaciente
}

/**
 * Todos os envios do paciente, do mais recente para o mais antigo.
 *
 * A lista inteira, e não só o último: a criança troca de escola no meio do
 * acompanhamento, e a mudança é justamente o que a equipe precisa enxergar. A
 * tela destaca o primeiro item e recolhe o resto como histórico.
 */
export async function listarDadosEscolares(pacienteId: number): Promise<DadosEscolares[]> {
  const consultar = (colunas: string) =>
    supabase
      .from("pacientes_dados_escolares")
      .select(colunas)
      .eq("paciente_id", pacienteId)
      .order("criado_em", { ascending: false })

  let { data, error } = await consultar(COLUNAS)

  // O localhost usa o banco de produção: antes da migration 20261022150000 as
  // colunas novas não existem (42703) e a seção inteira quebraria. Sem elas,
  // todo envio é do formulário — era o único caminho de escrita.
  let semColunasNovas = false
  if (error?.code === "42703") {
    ;({ data, error } = await consultar(COLUNAS_ANTIGAS))
    semColunasNovas = true
  }

  if (error) throw error

  // `as unknown as` como no resto dos serviços: os tipos gerados do Supabase não
  // acompanham migrations novas, e sem a ponte o TS reclama do shape da linha.
  const linhas = (data ?? []) as unknown as DadosEscolares[]
  return semColunasNovas
    ? linhas.map((l) => ({ ...l, origem: "formulario", registrado_por_nome: null, observacao: null }))
    : linhas
}

export type DadosEscolaresEquipe = {
  escola_nome: string
  escola_endereco: string | null
  escola_telefone: string | null
  escola_email: string | null
  coordenador_nome: string | null
  turma: string | null
  turno: string | null
  preenchido_por_nome: string | null
  preenchido_por_parentesco: string | null
  observacao: string | null
}

/**
 * Seção Escola do Cadastro: a equipe registra um envio novo (origem = equipe).
 * Só devolve sucesso com a linha gravada na mão — escrita barrada sem erro não
 * pode virar "salvo" na tela.
 */
export async function salvarDadosEscolaresEquipe(
  pacienteId: number,
  dados: DadosEscolaresEquipe
): Promise<DadosEscolares> {
  const { data, error } = await supabase.rpc("escola_salvar_equipe", {
    p_paciente_id: pacienteId,
    p_dados: dados,
  })

  if (error) {
    if (ehMigracaoPendente(error)) throw new ErroEscola(MSG_MIGRACAO_PENDENTE)
    // Os textos da RPC já vêm em português ("Sem permissão…", "Informe o nome da escola.").
    if ((error.code === "42501" || error.code === "P0002") && error.message) throw new ErroEscola(error.message)
    if (error.code === "23514") {
      throw new ErroEscola(
        error.message?.startsWith("Informe") ? error.message : "Algum campo está inválido ou passou do tamanho permitido."
      )
    }
    throw new ErroEscola("Não foi possível salvar a escola.")
  }

  const linha = data as unknown as DadosEscolares | null
  if (!linha || typeof linha.id !== "number") {
    throw new ErroEscola("O banco não confirmou a gravação. Recarregue e confira o histórico.")
  }
  return linha
}
