import type { AIMode, ConversationStatus } from '../types/central.types'

// ============================================================================
// As quatro caixas da triagem — a REGRA, sem I/O
//
// A pergunta "quem está atendendo esta conversa?" não tem resposta em coluna
// nenhuma. Ela cruza TRÊS eixos que o banco mantém ortogonais de propósito:
//
//   status            open | assigned | waiting | resolved | archived
//   ai_mode efetivo   off | assisted | autonomous   (já com a herança resolvida
//                     por resolverModoEfetivo — ver modo-efetivo.ts)
//   assigned_user_id  quem pegou, ou ninguém
//
// Colapsar isso em quatro caixas é uma decisão de produto, e é aqui que ela
// mora — uma vez só, testável com `npx tsx` e nada mais. Espalhada em `if` pelo
// componente e pela query, ela divergiria entre o contador e a lista, e ninguém
// notaria: o número no card e o conteúdo da caixa simplesmente deixariam de
// combinar.
//
// A ENTRADA É O MODO EFETIVO, nunca `conversations.ai_mode` cru. A coluna é
// NULL na maioria das conversas (significa "ninguém decidiu, vale o padrão da
// clínica"), então classificar pela coluna marcaria como "Humano" justamente as
// conversas que a Maia está atendendo. Ver 20260915220000.
// ============================================================================

export const CAIXAS = ['maia', 'humano', 'ninguem', 'encerradas'] as const
export type Caixa = typeof CAIXAS[number]

export function isCaixa(valor: unknown): valor is Caixa {
  return typeof valor === 'string' && (CAIXAS as readonly string[]).includes(valor)
}

// Encerrada é o fim da linha, não um modo de atendimento. Vive aqui porque esta
// é a única definição que a triagem consulta; os services têm a sua própria
// cópia para o guard de "conversa já fechada", que é outra pergunta.
export const STATUS_ENCERRADOS: readonly ConversationStatus[] = ['resolved', 'archived']

export function classificarCaixa(
  status: ConversationStatus,
  // Já resolvido: saída de resolverModoEfetivo, não a coluna.
  modoEfetivo: string,
  assignedUserId: string | null,
): Caixa {
  // A ordem é a regra. `encerradas` vence tudo porque uma conversa arquivada com
  // ai_mode 'autonomous' (o caso comum — arquivar não mexe no ai_mode) não está
  // sendo atendida pela Maia: não está sendo atendida por ninguém. Classificá-la
  // como 'maia' inflaria a caixa ativa com histórico morto.
  if (STATUS_ENCERRADOS.includes(status)) return 'encerradas'

  // Só 'autonomous' é a Maia atendendo. 'assisted' NÃO entra: nesse modo ela
  // redige e a mensagem fica como rascunho esperando um humano mandar — quem
  // responde ao paciente é gente. Somá-lo aqui faria a caixa "Maia" prometer uma
  // autonomia que não existe, e as conversas ficariam paradas dentro dela.
  if (modoEfetivo === 'autonomous') return 'maia'

  // Resta o atendimento humano, e a distinção que mais importa numa central:
  // alguém assumiu, ou está largada? A conversa que a Maia escalou cai aqui com
  // assigned_user_id NULL, porque escalarParaHumano grava ai_mode/priority e
  // deliberadamente não atribui a ninguém.
  return assignedUserId ? 'humano' : 'ninguem'
}

// ----------------------------------------------------------------------------
// A mesma regra, vista do outro lado: o filtro que ENCONTRA as conversas de uma
// caixa.
//
// Vive coladinho em `classificarCaixa` de propósito. As duas dizem a mesma
// coisa em direções opostas — uma classifica uma linha que você já tem, a outra
// monta a consulta que acha essas linhas — e se divergirem, o número no card
// deixa de bater com a lista que ele rotula, sem erro nenhum aparecer.
// `caixas.test.mts` amarra as duas pontas.
// ----------------------------------------------------------------------------

export interface FiltroCaixa {
  status?:   ConversationStatus[]
  aiModeIn?: (AIMode | null)[]
  // 'nenhum'   → assigned_user_id IS NULL      (a caixa "ninguém")
  // 'qualquer' → assigned_user_id IS NOT NULL  (a caixa "humano")
  //
  // Os três estados são necessários e "sem filtro" NÃO serve para a caixa
  // humano: sem recorte, ela contaria também as não atribuídas e as mesmas
  // conversas apareceriam em duas caixas — a soma passaria do total e ninguém
  // desconfiaria, porque cada caixa isolada parece certa.
  responsavel?: 'nenhum' | 'qualquer'
}

// Os status vivos: tudo que não encerrou. Explícito em vez de "não encerrado"
// porque o filtro do PostgREST precisa da lista, e um `not.in` deixaria passar
// qualquer status novo que alguém acrescente ao enum sem pensar na triagem.
const STATUS_ATIVOS: ConversationStatus[] = ['open', 'assigned', 'waiting']

// `modoPadrao` é o ai_mode da clínica já resolvido (agent_settings, inbox vence
// org). É ele que decide se as conversas de coluna NULL entram ou não em cada
// caixa: com o padrão em 'autonomous', toda conversa intocada está sendo
// atendida pela Maia; com o padrão em 'off', nenhuma está.
export function filtroDaCaixa(caixa: Caixa, modoPadrao: string): FiltroCaixa {
  if (caixa === 'encerradas') {
    // Sem recorte de modo nem de responsável: encerrada é encerrada.
    return { status: [...STATUS_ENCERRADOS] }
  }

  // As herdadas (coluna NULL) acompanham o padrão da clínica, e por isso `null`
  // entra na lista de UMA das caixas — nunca de duas.
  const herdadasSaoAutonomas = modoPadrao === 'autonomous'

  if (caixa === 'maia') {
    return {
      status:   STATUS_ATIVOS,
      aiModeIn: herdadasSaoAutonomas ? ['autonomous', null] : ['autonomous'],
    }
  }

  // humano e ninguem: mesmo recorte de modo (tudo que não é a Maia atendendo),
  // separados só pelo responsável.
  const naoAutonomas: (AIMode | null)[] = herdadasSaoAutonomas
    ? ['off', 'assisted']
    : ['off', 'assisted', null]

  return {
    status:      STATUS_ATIVOS,
    aiModeIn:    naoAutonomas,
    responsavel: caixa === 'humano' ? 'qualquer' : 'nenhum',
  }
}
