import type { EntidadeAuditada, EntradaAuditoria, RegistroAuditoria } from "@/types/auditoria"

// Diff legível entre `antes` e `depois`. Mesmo papel de
// lib/cronograma/auditoriaFormat.ts, para a trilha de cadastros.
//
// O `resumo` é calculado AQUI e gravado pronto no banco: a listagem do
// histórico não deve precisar diffar jsonb a cada render, e o texto tem que
// continuar fiel ao que os rótulos significavam na época da alteração.

/** Ruído de infraestrutura — muda em toda escrita e não diz nada ao usuário. */
const CAMPOS_IGNORADOS = new Set([
  "id",
  "id_paciente",
  // Chaves das tabelas de laudos/altas depois do rename de 20260826140400 —
  // vêm dentro dos payloads de auditoria e não dizem nada ao usuário.
  "id_paciente_pulsar",
  "id_laudo",
  "id_alta",
  "id_individualidade",
  "id_suspensao",
  "id_alta_clinica",
  // Quem criou já aparece no cabeçalho de cada linha da trilha (usuario_nome);
  // repetir como campo do snapshot da suspensão seria redundante.
  "criado_por_usuario_id",
  "criado_por_usuario_nome",
  "id_laudo_especialidade",
  "criado_em",
  "atualizado_em",
  "id_usuario",
  "nome_usuario_responsavel",
  "nome_normalizado",
  "sincronizado_em",
])

const LABEL_POR_ENTIDADE: Record<EntidadeAuditada, Record<string, string>> = {
  paciente: {
    nome: "Nome",
    nome_civil: "Nome civil",
    tem_nome_civil: "Usa nome social",
    // Deixou de ser "ID" em 2026-08-26: o identificador visível passou a ser
    // id_paciente_tita ou id_paciente_pulsar conforme a origem (idExibicao, em
    // types/paciente.ts). `matricula` continua existindo, só não é mais o ID.
    matricula: "Matrícula (legado)",
    cpf: "CPF",
    data_nascimento: "Data de nascimento",
    sexo: "Sexo",
    cor_raca: "Cor ou raça",
    estado_civil: "Estado civil",
    rg: "RG",
    rg_orgao_emissor: "Órgão emissor",
    rg_uf: "UF do órgão emissor",
    rg_data_emissao: "Data de emissão do RG",
    email: "E-mail",
    // A coluna foi dropada em 20260828170200 (estava vazia na maioria dos
    // cadastros; o telefone útil é o do responsável). O rótulo FICA: a trilha
    // guarda o JSON de antes/depois, e sem esta linha toda alteração histórica
    // desse campo passaria a aparecer como "telefone" cru na tela.
    telefone: "Celular do paciente (campo removido)",
    telefone_residencial: "Telefone residencial",
    falecido: "Falecido",
    ativo: "Cadastro ativo",
    observacoes: "Observações",
    cep: "CEP",
    logradouro: "Logradouro",
    numero: "Número",
    complemento: "Complemento",
    bairro: "Bairro",
    cidade: "Cidade",
    uf: "UF",
    foto_path: "Foto",
  },
  responsavel: {
    nome: "Nome",
    cpf: "CPF",
    rg: "RG",
    rg_orgao_emissor: "Órgão emissor",
    rg_uf: "UF do órgão emissor",
    data_nascimento: "Data de nascimento",
    celular: "Celular",
    telefone_residencial: "Telefone residencial",
    email: "E-mail",
    cep: "CEP",
    logradouro: "Logradouro",
    numero: "Número",
    complemento: "Complemento",
    bairro: "Bairro",
    cidade: "Cidade",
    uf: "UF",
    ativo: "Ativo",
    tipo: "Vínculo",
    parentesco: "Parentesco",
    // Chave sintética de salvarVinculos (responsaveis.service.ts): a trilha
    // guarda o conjunto de vínculos do paciente como um valor só.
    vinculos: "Responsáveis vinculados",
  },
  ficha_medica: {
    tipo_sanguineo: "Tipo sanguíneo",
    restricoes_alimentares: "Restrições alimentares",
    alergias: "Alergias",
    doencas: "Doenças",
    plano_saude_id: "Plano de saúde",
    numero_carteirinha: "Carteirinha",
  },
  convenio: {
    nome: "Nome",
    razao_social: "Razão social",
    cnpj: "CNPJ",
    ans: "Registro ANS",
    observacao: "Observação",
    email: "E-mail",
    telefone: "Telefone",
    cep: "CEP",
    logradouro: "Logradouro",
    numero: "Número",
    bairro: "Bairro",
    cidade: "Cidade",
    uf: "UF",
    ativo: "Ativo",
  },
  plano_saude: {
    nome: "Nome",
    convenio_id: "Convênio",
    ativo: "Ativo",
  },
  laudo: {
    data_laudo: "Data do laudo",
    validade: "Validade",
    situacao: "Situação",
    autorizado_em: "Autorizado em",
    comp_agressivo: "Comp. agressivo",
    paciente_verbal: "Paciente verbal",
    ambiente_natural: "Autorização de ambiente natural",
    nivel_suporte: "Nível de suporte clínico",
    alta: "Alta",
    data_alta: "Data da alta",
    especialidade_alta: "Especialidade da alta",
    arquivo_path: "Arquivo do laudo",
    observacoes: "Observações",
    especialidade: "Especialidade",
    qt_laudo: "Qt. laudo",
    qt_autorizacao: "Qt. autorização",
  },
  alta: {
    data_alta: "Data da alta",
    especialidade_alta: "Especialidade da alta",
    arquivo_alta_path: "Anexo da alta",
  },
  alta_individualidade: {
    comp_agressivo: "Comp. agressivo",
    paciente_verbal: "Paciente verbal",
    ambiente_natural: "Autorização de ambiente natural",
    nivel_suporte: "Nível de suporte clínico",
    origem_judicial: "Origem judicial",
  },
  suspensao_temporaria: {
    data_suspensao: "Data da suspensão",
    especialidade_suspensao: "Especialidade da suspensão",
    prazo_indefinido: "Prazo indefinido",
    prazo_fim: "Prazo para fim da suspensão",
    arquivo_suspensao_path: "Anexo da suspensão",
    observacoes: "Observações",
  },
  alta_clinica: {
    data_alta_clinica: "Data da alta clínica",
    arquivo_alta_clinica_path: "Anexo da alta clínica",
  },
  // Os `snap_*` são o retrato do laudo no momento do save, e entram na trilha de
  // propósito: seis meses depois, "avisado em 14/08" só significa algo ao lado
  // de "e a validade era 01/07". O laudo em si vive no Órbita e pode sair do
  // relatório — a trilha é o que sobra.
  laudo_acompanhamento: {
    mensagem_enviada_em: "Mensagem enviada em",
    observacao: "Observação",
    snap_paciente_nome: "Paciente (no relatório)",
    snap_data_laudo: "Data do laudo",
    snap_validade: "Validade",
    snap_situacao: "Situação do laudo",
    snap_autorizado_em: "Autorizado em",
  },
  pdi_controle_prazos: {
    especialista_tita_id: "Especialista",
    data_avaliacao: "Data da avaliação",
    data_validade: "Data de validade",
    observacoes: "Observações",
  },
  previsao_receitas_faturamento: {
    paciente_id: "Paciente (ID TITA)",
    competencia: "Mês de atendimento",
    numero_nf: "N° da NF",
    data_pagamento: "Data do pagamento",
    valor_pago: "Valor pago",
  },
}

const VALOR_LEGIVEL: Record<string, Record<string, string>> = {
  sexo: { M: "Masculino", F: "Feminino", outro: "Outro" },
  cor_raca: {
    branca: "Branca",
    preta: "Preta",
    parda: "Parda",
    amarela: "Amarela",
    indigena: "Indígena",
    nao_declarada: "Não declarada",
  },
  estado_civil: {
    solteiro: "Solteiro(a)",
    casado: "Casado(a)",
    divorciado: "Divorciado(a)",
    viuvo: "Viúvo(a)",
    separado: "Separado(a)",
    uniao_estavel: "União estável",
  },
  tipo: {
    filiacao_1: "Filiação 1",
    filiacao_2: "Filiação 2",
    financeiro: "Responsável financeiro",
    pedagogico: "Responsável pedagógico",
  },
}

export function rotuloCampo(entidade: EntidadeAuditada, campo: string): string {
  return LABEL_POR_ENTIDADE[entidade]?.[campo] ?? campo
}

/** Data ISO -> DD/MM/AAAA. Só para campos que são data pura. */
function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  return `${dia}/${mes}/${ano}`
}

export function formatarValor(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—"
  if (typeof valor === "boolean") return valor ? "Sim" : "Não"

  const mapa = VALOR_LEGIVEL[campo]
  if (mapa && typeof valor === "string" && mapa[valor]) return mapa[valor]

  // `campo.includes("data")` cobria `data_laudo`, `data_alta`… e deixava de fora
  // os campos cujo nome termina em `_em`, que também são data pura:
  // `autorizado_em` do laudo e `mensagem_enviada_em` do acompanhamento apareciam
  // no histórico como "2026-08-14". Os `_em` de infraestrutura (`criado_em`,
  // `atualizado_em`) não passam por aqui — estão em CAMPOS_IGNORADOS.
  if (
    typeof valor === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(valor) &&
    (campo.includes("data") || campo.endsWith("_em"))
  ) {
    return dataBR(valor)
  }
  if (campo === "foto_path") return "imagem enviada"

  return String(valor)
}

export type CampoAlteracao = { campo: string; label: string; antes: string; depois: string }

/**
 * Só os campos que realmente mudaram. Compara por JSON.stringify para `null` e
 * `undefined` contarem como o mesmo "vazio" — sem isso, toda gravação acusaria
 * alteração em campo que ninguém tocou.
 */
export function camposAlterados(
  entidade: EntidadeAuditada,
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown> | null
): CampoAlteracao[] {
  if (!antes || !depois) return []

  const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)])
  const saida: CampoAlteracao[] = []

  for (const campo of chaves) {
    if (CAMPOS_IGNORADOS.has(campo)) continue
    const a = antes[campo] ?? null
    const d = depois[campo] ?? null
    if (JSON.stringify(a) === JSON.stringify(d)) continue
    saida.push({
      campo,
      label: rotuloCampo(entidade, campo),
      antes: formatarValor(campo, a),
      depois: formatarValor(campo, d),
    })
  }

  return saida.sort((x, y) => x.label.localeCompare(y.label, "pt-BR"))
}

export type CampoSnapshot = { campo: string; label: string; valor: string }

/** Para criar/excluir, onde não há dois lados a comparar. */
export function camposSnapshot(
  entidade: EntidadeAuditada,
  registro: Record<string, unknown> | null
): CampoSnapshot[] {
  if (!registro) return []
  return Object.keys(registro)
    .filter((campo) => !CAMPOS_IGNORADOS.has(campo))
    .filter((campo) => registro[campo] !== null && registro[campo] !== "")
    .map((campo) => ({
      campo,
      label: rotuloCampo(entidade, campo),
      valor: formatarValor(campo, registro[campo]),
    }))
    .sort((x, y) => x.label.localeCompare(y.label, "pt-BR"))
}

/** A linha única que aparece sem expandir o item. */
export function resumoAlteracao(entrada: EntradaAuditoria): string {
  const { tabela, acao, antes, depois } = entrada

  if (acao === "criar") return "Registro criado."
  if (acao === "excluir") return "Registro excluído."
  if (acao === "inativar") return "Cadastro inativado."
  if (acao === "reativar") return "Cadastro reativado."

  const alteracoes = camposAlterados(tabela, antes ?? null, depois ?? null)
  if (alteracoes.length === 0) return "Nenhum campo alterado."

  // Trunca para o resumo não virar um parágrafo quando alguém salva a ficha
  // inteira de uma vez; o detalhe completo está no item expandido.
  const MAX = 4
  const texto = alteracoes
    .slice(0, MAX)
    .map((c) => `${c.label}: ${c.antes} → ${c.depois}`)
    .join(" · ")

  const resto = alteracoes.length - MAX
  return resto > 0 ? `${texto} · e mais ${resto} campo${resto > 1 ? "s" : ""}` : texto
}

/** O nome que identifica a linha na listagem. */
export function nomeContextual(item: RegistroAuditoria): string {
  if (item.alvo_nome) return item.alvo_nome
  if (item.paciente_nome) return item.paciente_nome
  if (item.convenio_nome) return item.convenio_nome
  return `Registro ${item.registro_id}`
}

export function dataHoraAuditoria(item: RegistroAuditoria): string {
  // `criado_em_brasilia` é gravado por trigger; o toLocaleString é fallback
  // para qualquer linha anterior ao trigger.
  return (
    item.criado_em_brasilia ??
    new Date(item.criado_em).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    })
  )
}
