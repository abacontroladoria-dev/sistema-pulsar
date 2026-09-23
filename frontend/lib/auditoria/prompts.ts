import type { CriteriosAuditoria } from '@/types/auditoriaCriterios'

/**
 * CONTRATO TÉCNICO — nunca vem do banco, nunca é editável pela tela.
 *
 * Este bloco descreve o JSON que auditorEngine.ts faz parse. Se alguém pudesse
 * editá-lo pela UI de critérios, uma alteração inocente quebraria o parser em
 * silêncio. Por isso montarSystemPrompt() o concatena SEMPRE ao final, depois
 * de tudo que veio da configuração.
 */
export const SCHEMA_RESPOSTA_AUDITORIA = `FORMATO DE RESPOSTA (Obrigatório JSON):
Você DEVE responder exclusivamente um objeto JSON com o seguinte schema:
{
  "status_risco": "sem_risco" | "risco_especifico" | "risco_relevante",
  "resumo_justificativa": "Uma ou duas frases resumindo a conformidade ou os motivos do risco de glosa",
  "checklist_perguntas": {
    "chegou": boolean,
    "objetivo": boolean,
    "recursos": boolean,
    "reacao_saida": boolean
  },
  "inconsistencias_estruturais": string[],
  "apontamentos": [
    {
      "tipo": "estrutura_incompleta" | "termo_vago" | "negacao_sem_contexto" | "termo_absoluto" | "julgamento_subjetivo" | "procedimento_aversivo" | "foco_tempo" | "sigla_sem_contexto" | "sigilo_cfp" | "inconsistencia_estrutural" | "outro",
      "titulo": "Título curto do problema",
      "descricao": "Explicação clara do risco de glosa",
      "trecho": "Trecho problemático original (se aplicável)",
      "gravidade": "alta" | "media" | "baixa"
    }
  ],
  "texto_revisado": "Texto completo corrigido, técnico e pronto para o prontuário. NÃO invente fatos clínicos não informados; se algo faltar e não puder ser inferido, complemente de forma técnica padrão ou sinalize."
}`

/**
 * Fixo e fora da tela, como o schema. Antes dizia "responder explicitamente a
 * estas quatro perguntas", o que vencia as exceções escritas em cada pergunta
 * (v2 dos critérios): a IA seguia cobrando chegada/saída já dispensadas. A
 * precedência sobre a classificação de risco é explícita porque o texto
 * editável de `risco_especifico` usa "faltou apenas o estado de saída" como
 * exemplo de risco.
 */
export const ENQUADRAMENTO_PILARES = `Toda evolução deve permitir responder a estas quatro perguntas, respeitando as exceções descritas em cada uma delas. Quando uma exceção dispensar uma pergunta, ela conta como atendida: marque true no checklist, não gere apontamento por ela e não a use para classificar o risco. Isso prevalece sobre os exemplos da classificação de risco abaixo.`

/**
 * O prompt ORIGINAL, anterior aos critérios editáveis.
 *
 * NÃO APAGUE. Ele não é mais enviado à IA — quem monta o prompt é
 * montarSystemPrompt(). Ele permanece como REFERÊNCIA DE PARIDADE: o teste
 * __tests__/paridadePrompt.test.ts exige que montarSystemPrompt(CRITERIOS_FALLBACK)
 * o reproduza byte-a-byte. É essa igualdade que garante que introduzir a
 * configuração não mudou o comportamento da auditoria.
 *
 * Única mudança deliberada desde então: a frase de abertura das 4 perguntas
 * virou ENQUADRAMENTO_PILARES (2026-09-23), aplicada aqui e no montador.
 */
export const SYSTEM_PROMPT_AUDITORIA_EVOLUCAO = `Você atua como auditor de convênio especializado em revisão de evolução terapêutica de atendimentos realizados para a Clínica Universo ABA. Sua função é revisar rigorosamente as evoluções clínicas antes do envio ao convênio, identificando tudo o que pode gerar GLOSA, apontando as falhas e devolvendo o texto já corrigido e pronto para constar no prontuário.

CRITÉRIOS DE AUDITORIA (em ordem de verificação):

1. CONFERÊNCIA ESTRUTURAL
- Correspondência de especialidade, profissional e data do atendimento.
- Inconsistências de registro documental.

2. ESTRUTURA MÍNIMA OBRIGATÓRIA (4 Perguntas Fundamentais):
${ENQUADRAMENTO_PILARES}
a) Como o paciente chegou à sessão (estado emocional e comportamental na chegada).
b) Qual o objetivo do atendimento (o que estava planejado trabalhar).
c) Quais recursos, estratégias ou materiais foram utilizados (específicos, não genéricos).
d) Como o paciente reagiu e como a sessão foi encerrada (nível de engajamento, suporte/ajuda necessária, condição de saída).

3. REGRAS PARA SITUAÇÕES ESPECÍFICAS:
- Paciente desregulado/desengajado: Manter as 4 etapas descrevendo o que foi planejado, que a atividade não ocorreu e o suporte dado.
- Psicoterapia: Respeitar o sigilo profissional (Código de Ética do CFP). Nunca expor intimidades ou falas confidenciais de terceiros. Se houver detalhes sensíveis, substituir por descrição técnica generalizada.
- Instrumentos de Avaliação (VB-MAPP, ABLLS-R, PEAK, etc.): Nunca aceitar apenas o nome isolado. Deve conter domínio, objetivo, recursos e resposta do paciente.
- Atrasos/Saída antecipada: Focar sempre na intervenção realizada, nunca no tempo de permanência ("não deu tempo de fazer nada").

4. PALAVRAS E FRASES PROIBIDAS / RISCO DE GLOSA:
- Termos vagos: "sessão normal", "atendimento de rotina", "tudo correu bem", "atividades de costume", "nada a registrar".
- Negação pura sem contexto: "paciente não fez nada", "sem produtividade", "sem evolução".
- Termos absolutos/prognósticos: "cura", "curado", "resolvido definitivamente", "100% de melhora".
- Julgamento subjetivo: "mal educado", "família não coopera", "mãe negligente".
- Termos aversivos/fora de protocolo: "castigo", "punição", "conteve à força", "bloqueio físico".
- Foco no tempo: "sessão perdida", "sessão incompleta".
- Abreviações ou siglas não padronizadas sem explicação.

5. CLASSIFICAÇÃO DE RISCO:
- 'sem_risco': Texto completo, cumpre os 4 pilares, sem termos proibidos.
- 'risco_especifico': Pequena falha pontual fácil de ajustar (ex: faltou apenas o estado de saída).
- 'risco_relevante': Falta de estrutura essencial, termos proibidos, violação de sigilo, relato vago ou risco claro de glosa de convênio.

${SCHEMA_RESPOSTA_AUDITORIA}`

/** Letras das 4 perguntas fundamentais, na ordem em que o prompt as numera. */
const LETRAS_PILARES = ['a', 'b', 'c', 'd']

/**
 * Monta o system prompt a partir dos critérios configurados.
 *
 * O formato de saída é fixo e replica o prompt original — é sobre ele que o
 * teste de paridade incide. Termina SEMPRE no schema, que não vem da
 * configuração: nenhuma entrada da UI alcança o contrato do parser.
 */
export function montarSystemPrompt(criterios: CriteriosAuditoria): string {
  const conferencia = criterios.conferencia_estrutural.map(item => `- ${item}`).join('\n')

  const pilares = criterios.pilares
    .map((p, i) => `${LETRAS_PILARES[i] ?? String(i + 1)}) ${p.descricao}`)
    .join('\n')

  const regras = criterios.regras_especificas.map(r => `- ${r.titulo}: ${r.texto}`).join('\n')

  // Grupo sem termos vira só a categoria — é o caso de "Abreviações ou siglas
  // não padronizadas sem explicação", que no prompt original não tem lista.
  const termos = criterios.termos_proibidos
    .map(g => {
      if (g.termos.length === 0) return `- ${g.categoria}.`
      const lista = g.termos.map(t => `"${t}"`).join(', ')
      return `- ${g.categoria}: ${lista}.`
    })
    .join('\n')

  const status = criterios.status_risco.map(s => `- '${s.chave}': ${s.descricao}`).join('\n')

  return `${criterios.abertura}

CRITÉRIOS DE AUDITORIA (em ordem de verificação):

1. CONFERÊNCIA ESTRUTURAL
${conferencia}

2. ESTRUTURA MÍNIMA OBRIGATÓRIA (4 Perguntas Fundamentais):
${ENQUADRAMENTO_PILARES}
${pilares}

3. REGRAS PARA SITUAÇÕES ESPECÍFICAS:
${regras}

4. PALAVRAS E FRASES PROIBIDAS / RISCO DE GLOSA:
${termos}

5. CLASSIFICAÇÃO DE RISCO:
${status}

${SCHEMA_RESPOSTA_AUDITORIA}`
}

export function montarMensagemAuditoria(params: {
  pacienteNome?: string
  profissionalNome?: string
  terapiaNome?: string | null
  dataSessao?: string
  /** Texto pronto de descreverPosicao(); ausente quando não foi possível calcular. */
  posicaoNoDia?: string
  textoOriginal: string
}) {
  // Anonimização total: nunca envia nomes de pessoas para a API externa.
  // O aviso abaixo existe porque, sem ele, a IA tratava o nome omitido como
  // falha de registro ("profissional não informado") e a troca do nome como
  // erro de concordância.
  return `AUDITAR A SEGUINTE EVOLUÇÃO TERAPÊUTICA:
- Especialidade/Terapia: ${params.terapiaNome || 'Terapia Multidisciplinar'}
- Data da Sessão: ${params.dataSessao || 'Sessão recente'}${params.posicaoNoDia ? `\n- Posição no dia: ${params.posicaoNoDia}` : ''}
- Profissional: registrado no sistema; nome omitido por privacidade.

PRIVACIDADE: os nomes foram substituídos por [PACIENTE] e [TERAPEUTA] antes do envio. Isso NÃO é falha do registro: não aponte ausência de identificação do profissional ou do paciente, nem concordância de gênero causada pelos marcadores. No texto_revisado, nunca escreva os marcadores; use "paciente" e "terapeuta", com o gênero que o próprio texto indicar.

TEXTO DA EVOLUÇÃO (Dados sensíveis e nomes desidentificados):
"""
${params.textoOriginal}
"""`
}
