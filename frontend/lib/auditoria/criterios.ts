import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CHAVES_PILARES,
  CHAVES_STATUS_RISCO,
  type CriteriosAuditoria,
  type VersaoCriteriosAuditoria
} from '@/types/auditoriaCriterios'

/**
 * A v1 dos critérios, em TypeScript.
 *
 * DOIS PAPÉIS, e ambos importam:
 *
 * 1. É a fonte do seed da versão 1 no banco. O teste de paridade
 *    (__tests__/paridadePrompt.test.ts) garante que montarSystemPrompt() sobre
 *    este objeto reproduz SYSTEM_PROMPT_AUDITORIA_EVOLUCAO byte-a-byte — é o
 *    que faz o deploy desta feature não mudar o comportamento da IA.
 *
 * 2. É o fallback quando a tabela está vazia, a RLS barrou ou o banco falhou.
 *    Sem ele, um erro de leitura deixaria a auditoria sem critérios; com ele,
 *    a ferramenta continua auditando pela régua conhecida.
 *
 * Ao editar aqui, o teste de paridade vai falhar de propósito: ele compara com
 * a constante legada. Se a mudança for intencional, a constante legada também
 * precisa mudar — e aí a régua mudou para todo mundo, que é exatamente o que a
 * tela de critérios existe para evitar.
 */
export const CRITERIOS_FALLBACK: CriteriosAuditoria = {
  abertura:
    'Você atua como auditor de convênio especializado em revisão de evolução terapêutica de atendimentos realizados para a Clínica Universo ABA. Sua função é revisar rigorosamente as evoluções clínicas antes do envio ao convênio, identificando tudo o que pode gerar GLOSA, apontando as falhas e devolvendo o texto já corrigido e pronto para constar no prontuário.',

  conferencia_estrutural: [
    'Correspondência de especialidade, profissional e data do atendimento.',
    'Inconsistências de registro documental.'
  ],

  pilares: [
    {
      chave: 'chegou',
      rotulo: 'Estado na chegada',
      descricao:
        'Como o paciente chegou à sessão (estado emocional e comportamental na chegada).'
    },
    {
      chave: 'objetivo',
      rotulo: 'Objetivo planejado',
      descricao: 'Qual o objetivo do atendimento (o que estava planejado trabalhar).'
    },
    {
      chave: 'recursos',
      rotulo: 'Recursos / Materiais',
      descricao:
        'Quais recursos, estratégias ou materiais foram utilizados (específicos, não genéricos).'
    },
    {
      chave: 'reacao_saida',
      rotulo: 'Reação e saída',
      descricao:
        'Como o paciente reagiu e como a sessão foi encerrada (nível de engajamento, suporte/ajuda necessária, condição de saída).'
    }
  ],

  regras_especificas: [
    {
      titulo: 'Paciente desregulado/desengajado',
      texto:
        'Manter as 4 etapas descrevendo o que foi planejado, que a atividade não ocorreu e o suporte dado.'
    },
    {
      titulo: 'Psicoterapia',
      texto:
        'Respeitar o sigilo profissional (Código de Ética do CFP). Nunca expor intimidades ou falas confidenciais de terceiros. Se houver detalhes sensíveis, substituir por descrição técnica generalizada.'
    },
    {
      titulo: 'Instrumentos de Avaliação (VB-MAPP, ABLLS-R, PEAK, etc.)',
      texto:
        'Nunca aceitar apenas o nome isolado. Deve conter domínio, objetivo, recursos e resposta do paciente.'
    },
    {
      titulo: 'Atrasos/Saída antecipada',
      texto:
        'Focar sempre na intervenção realizada, nunca no tempo de permanência ("não deu tempo de fazer nada").'
    }
  ],

  termos_proibidos: [
    {
      categoria: 'Termos vagos',
      termos: [
        'sessão normal',
        'atendimento de rotina',
        'tudo correu bem',
        'atividades de costume',
        'nada a registrar'
      ]
    },
    {
      categoria: 'Negação pura sem contexto',
      termos: ['paciente não fez nada', 'sem produtividade', 'sem evolução']
    },
    {
      categoria: 'Termos absolutos/prognósticos',
      termos: ['cura', 'curado', 'resolvido definitivamente', '100% de melhora']
    },
    {
      categoria: 'Julgamento subjetivo',
      termos: ['mal educado', 'família não coopera', 'mãe negligente']
    },
    {
      categoria: 'Termos aversivos/fora de protocolo',
      termos: ['castigo', 'punição', 'conteve à força', 'bloqueio físico']
    },
    {
      categoria: 'Foco no tempo',
      termos: ['sessão perdida', 'sessão incompleta']
    },
    {
      categoria: 'Abreviações ou siglas não padronizadas sem explicação',
      termos: []
    }
  ],

  status_risco: [
    {
      chave: 'sem_risco',
      descricao: 'Texto completo, cumpre os 4 pilares, sem termos proibidos.'
    },
    {
      chave: 'risco_especifico',
      descricao: 'Pequena falha pontual fácil de ajustar (ex: faltou apenas o estado de saída).'
    },
    {
      chave: 'risco_relevante',
      descricao:
        'Falta de estrutura essencial, termos proibidos, violação de sigilo, relato vago ou risco claro de glosa de convênio.'
    }
  ]
}

export class CriteriosInvalidosError extends Error {
  constructor(motivo: string) {
    super(`Critérios de auditoria inválidos: ${motivo}`)
    this.name = 'CriteriosInvalidosError'
  }
}

function exigirTexto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new CriteriosInvalidosError(`"${campo}" precisa ser um texto não vazio.`)
  }
  return valor
}

/**
 * Valida o JSONB vindo do banco (ou de um POST) contra as chaves congeladas.
 *
 * O ponto desta função é recusar o que quebraria a ferramenta: pilar com chave
 * inventada não casaria com `checklist_perguntas`, e status fora do trio
 * violaria o CHECK da tabela. Melhor falhar aqui, alto, do que produzir
 * auditoria com aparência de válida.
 */
export function parseCriterios(conteudo: unknown): CriteriosAuditoria {
  if (!conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)) {
    throw new CriteriosInvalidosError('o conteúdo precisa ser um objeto.')
  }

  const bruto = conteudo as Record<string, unknown>

  const abertura = exigirTexto(bruto.abertura, 'abertura')

  if (!Array.isArray(bruto.conferencia_estrutural)) {
    throw new CriteriosInvalidosError('"conferencia_estrutural" precisa ser uma lista.')
  }
  const conferencia = bruto.conferencia_estrutural.map((item, i) =>
    exigirTexto(item, `conferencia_estrutural[${i}]`)
  )

  // Pilares: exatamente as 4 chaves congeladas, sem faltar, sobrar nem repetir.
  if (!Array.isArray(bruto.pilares) || bruto.pilares.length !== CHAVES_PILARES.length) {
    throw new CriteriosInvalidosError(
      `"pilares" precisa ter exatamente ${CHAVES_PILARES.length} itens.`
    )
  }
  const pilares = CHAVES_PILARES.map(chave => {
    const achados = (bruto.pilares as Record<string, unknown>[]).filter(p => p?.chave === chave)
    if (achados.length !== 1) {
      throw new CriteriosInvalidosError(
        `esperado exatamente um pilar com a chave "${chave}" (encontrados: ${achados.length}).`
      )
    }
    const p = achados[0]
    return {
      chave,
      rotulo: exigirTexto(p.rotulo, `pilar ${chave}.rotulo`),
      descricao: exigirTexto(p.descricao, `pilar ${chave}.descricao`)
    }
  })

  if (!Array.isArray(bruto.regras_especificas)) {
    throw new CriteriosInvalidosError('"regras_especificas" precisa ser uma lista.')
  }
  const regras = (bruto.regras_especificas as Record<string, unknown>[]).map((r, i) => ({
    titulo: exigirTexto(r?.titulo, `regras_especificas[${i}].titulo`),
    texto: exigirTexto(r?.texto, `regras_especificas[${i}].texto`)
  }))

  if (!Array.isArray(bruto.termos_proibidos)) {
    throw new CriteriosInvalidosError('"termos_proibidos" precisa ser uma lista.')
  }
  const termos = (bruto.termos_proibidos as Record<string, unknown>[]).map((g, i) => {
    if (!Array.isArray(g?.termos)) {
      throw new CriteriosInvalidosError(`"termos_proibidos[${i}].termos" precisa ser uma lista.`)
    }
    return {
      categoria: exigirTexto(g?.categoria, `termos_proibidos[${i}].categoria`),
      termos: g.termos.map((t, j) => exigirTexto(t, `termos_proibidos[${i}].termos[${j}]`))
    }
  })

  // Status de risco: mesmo rigor dos pilares — o CHECK da tabela depende disso.
  if (
    !Array.isArray(bruto.status_risco) ||
    bruto.status_risco.length !== CHAVES_STATUS_RISCO.length
  ) {
    throw new CriteriosInvalidosError(
      `"status_risco" precisa ter exatamente ${CHAVES_STATUS_RISCO.length} itens.`
    )
  }
  const status = CHAVES_STATUS_RISCO.map(chave => {
    const achados = (bruto.status_risco as Record<string, unknown>[]).filter(s => s?.chave === chave)
    if (achados.length !== 1) {
      throw new CriteriosInvalidosError(
        `esperado exatamente um status com a chave "${chave}" (encontrados: ${achados.length}).`
      )
    }
    return {
      chave,
      descricao: exigirTexto(achados[0].descricao, `status ${chave}.descricao`)
    }
  })

  return {
    abertura,
    conferencia_estrutural: conferencia,
    pilares,
    regras_especificas: regras,
    termos_proibidos: termos,
    status_risco: status
  }
}

export interface CriteriosVigentes {
  criterios: CriteriosAuditoria
  versaoId: string | null
  versaoNumero: number | null
}

/**
 * Lê a versão vigente (a de maior número). Qualquer falha — tabela vazia, RLS,
 * rede, JSONB corrompido — cai no fallback em código e a auditoria segue
 * funcionando. Versão nula sinaliza justamente "não veio do banco".
 */
export async function carregarCriteriosVigentes(
  supabase: SupabaseClient
): Promise<CriteriosVigentes> {
  const semBanco: CriteriosVigentes = {
    criterios: CRITERIOS_FALLBACK,
    versaoId: null,
    versaoNumero: null
  }

  try {
    const { data, error } = await supabase
      .from('auditoria_criterios_versoes')
      .select('id, versao, conteudo')
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      if (error) {
        console.error('[auditoria] falha ao ler critérios vigentes, usando fallback:', error.message)
      }
      return semBanco
    }

    return {
      criterios: parseCriterios(data.conteudo),
      versaoId: data.id,
      versaoNumero: data.versao
    }
  } catch (e) {
    console.error(
      '[auditoria] critérios do banco inválidos, usando fallback:',
      e instanceof Error ? e.message : e
    )
    return semBanco
  }
}

export type { VersaoCriteriosAuditoria }
