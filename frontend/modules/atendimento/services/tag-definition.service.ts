// Sem `import 'server-only'`, como os demais services de dados
// (conversation.service, contact.service): o guarda de servidor fica nas
// factories de services/index.ts, que é onde o cliente do Supabase é escolhido.
// Aqui ele só impediria os testes em tsx de importarem a classe.
import type { TagDefinitionRepository } from '../repositories/tag-definition.repository'
import type { TagDefinition } from '../types/central.types'
import { TagDesconhecidaError, TagNaoAplicavelPelaMaiaError } from '../types/errors.types'

// ============================================================================
// TagDefinitionService
//
// O catálogo de tags, e o guarda das chaves que entram em contacts.tags.
//
// A migration 20260701010000 escolheu TEXT[] em vez de tabela de junção e
// escreveu, no próprio comentário, que a validação das chaves fica "na camada
// da aplicação". Esta é a camada. Sem ela o banco aceita qualquer string: um
// erro de digitação vira uma tag fantasma que não aparece em filtro nenhum e
// que ninguém consegue remover pela tela, porque a tela só oferece o catálogo.
// ============================================================================

export class TagDefinitionService {
  constructor(private readonly repo: TagDefinitionRepository) {}

  async listar(orgId: string): Promise<TagDefinition[]> {
    return this.repo.listarAtivas(orgId)
  }

  // Normaliza e valida um conjunto de chaves antes de gravar.
  //
  // Devolve o array já limpo em vez de só aprovar/reprovar: a deduplicação e a
  // remoção de vazios precisam acontecer em algum lugar, e deixá-las para o
  // caller faria cada caller fazer diferente.
  async validarChaves(orgId: string, chaves: string[]): Promise<string[]> {
    const limpas = [...new Set(chaves.map(c => c.trim()).filter(c => c !== ''))]
    if (limpas.length === 0) return []

    const validas = await this.repo.chavesAtivas(orgId)
    const desconhecidas = limpas.filter(c => !validas.has(c))

    if (desconhecidas.length > 0) throw new TagDesconhecidaError(desconhecidas)

    return limpas
  }

  // Segunda camada de defesa da ferramenta `registrar_tags` (Regra 3 do
  // maia_tagging_BUILD.md): mesmo que o enum da ferramenta já devesse ter
  // impedido isso (agente/tags.ts monta os enums só com maia_pode_aplicar =
  // true), esta chamada revalida direto no catálogo antes de gravar — cobre
  // o caso raro de o catálogo mudar entre a montagem do enum e a resposta do
  // modelo, e é a fronteira que qualquer novo caller da Maia também atravessa,
  // sem precisar repetir o filtro.
  //
  // Reusa validarChaves para a validação de existência/ativo; aqui só
  // acrescenta o filtro de "quem aplica".
  async validarAplicacaoPelaMaia(orgId: string, chaves: string[]): Promise<string[]> {
    const limpas = await this.validarChaves(orgId, chaves)
    if (limpas.length === 0) return []

    const catalogo = await this.repo.listarAtivas(orgId)
    const naoAplicaveis = limpas.filter((chave) => {
      const def = catalogo.find((t) => t.key === chave)
      return !def?.maia_pode_aplicar
    })

    if (naoAplicaveis.length > 0) throw new TagNaoAplicavelPelaMaiaError(naoAplicaveis)

    return limpas
  }
}
