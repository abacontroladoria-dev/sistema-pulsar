// npx tsx modules/atendimento/services/tags-do-contato.test.mts
//
// A validação das chaves de tag, sem banco e sem rede.
//
// POR QUE ISTO PRECISA DE TESTE
//
// A migration 20260701010000 escolheu TEXT[] em vez de tabela de junção e
// escreveu, no próprio comentário, que validar as chaves é trabalho "da camada
// da aplicação". O banco, portanto, aceita QUALQUER string nesta coluna: não há
// FK, não há CHECK, não há nada. Esta camada é a única barreira, e uma tag
// fantasma que entre aqui não aparece em filtro nenhum e não pode ser removida
// pela tela — a tela só oferece o que está no catálogo.
//
// Os casos que importam:
//   1. chave fora do catálogo é RECUSADA (o motivo de tudo isto existir);
//   2. tag desativada conta como fora do catálogo;
//   3. sem catálogo injetado, o update FALHA FECHADO em vez de gravar sem ver;
//   4. `null` limpa as tags e não passa pela validação (não há o que validar);
//   5. `undefined` não toca na coluna — é diferente de limpar;
//   6. a normalização (espaços, duplicatas, vazios) acontece antes de gravar.

import { ContactService }       from './contact.service.js'
import { TagDefinitionService } from './tag-definition.service.js'
import { TagDesconhecidaError } from '../types/errors.types.js'
import type { Contact }         from '../types/central.types'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

const ORG     = 'org-1'
const USUARIO = 'user-1'
const CATALOGO = new Set(['urgente', 'convenio', 'particular'])

const CONTATO = { id: 'ct-1', organization_id: ORG, name: 'Maria' } as unknown as Contact

// --- dublês -----------------------------------------------------------------

function montar(opcoes: { comCatalogo?: boolean } = { comCatalogo: true }) {
  // O que chegou ao repositório, que é o que de fato iria ao banco.
  const patches: Record<string, unknown>[] = []

  const contactRepo = {
    findById: async () => CONTATO,
    update:   async (_id: string, patch: Record<string, unknown>) => {
      patches.push(patch)
      return { ...CONTATO, ...patch } as Contact
    },
  }
  const audit = { insert: async () => {} }

  const tagRepo = {
    chavesAtivas: async () => CATALOGO,
    listarAtivas: async () => [],
  }

  const service = new ContactService(
    contactRepo as any,
    audit as any,
    opcoes.comCatalogo ? new TagDefinitionService(tagRepo as any) : undefined,
  )
  return { service, patches }
}

// --- 1 e 2: chave fora do catálogo ------------------------------------------

console.log('\nvalidação das chaves')
{
  const { service, patches } = montar()
  let erro: unknown
  try {
    await service.update(ORG, 'ct-1', { tags: ['urgente', 'inventada'] }, USUARIO)
  } catch (e) { erro = e }

  checar('recusa chave fora do catálogo', erro instanceof TagDesconhecidaError, true)
  // O mais importante: NADA foi gravado. Recusar depois de escrever metade
  // deixaria o contato num estado que ninguém pediu.
  checar('não grava nada quando recusa', patches.length, 0)
  checar('a mensagem nomeia a chave recusada',
    (erro as Error).message.includes('inventada'), true)
}
{
  // Uma tag desativada some de `chavesAtivas`, então cai no mesmo caminho —
  // é o que impede reaplicar um rótulo que a clínica aposentou.
  const { service } = montar()
  let erro: unknown
  try { await service.update(ORG, 'ct-1', { tags: ['aposentada'] }, USUARIO) } catch (e) { erro = e }
  checar('tag desativada é tratada como desconhecida', erro instanceof TagDesconhecidaError, true)
}

// --- 3: falha fechada sem catálogo ------------------------------------------
{
  const { service, patches } = montar({ comCatalogo: false })
  let erro: unknown
  try {
    await service.update(ORG, 'ct-1', { tags: ['urgente'] }, USUARIO)
  } catch (e) { erro = e }

  // Mesmo com uma chave VÁLIDA: sem como conferir, não grava. O contrário
  // (gravar sem validar quando o catálogo não foi injetado) abriria um buraco
  // que só apareceria em produção, meses depois.
  checar('sem catálogo injetado, recusa mesmo chave válida',
    erro instanceof TagDesconhecidaError, true)
  checar('e não grava',                    patches.length, 0)
}

// --- 4, 5: null limpa, undefined não toca -----------------------------------

console.log('\nnull x undefined')
{
  const { service, patches } = montar()
  await service.update(ORG, 'ct-1', { tags: null }, USUARIO)
  checar('null chega ao repositório',      patches[0]?.tags, null)
}
{
  const { service, patches } = montar()
  await service.update(ORG, 'ct-1', { name: 'Maria Silva' }, USUARIO)
  // Se `tags` aparecesse no patch, editar o nome apagaria as tags da pessoa.
  checar('tags ausente não entra no patch', 'tags' in (patches[0] ?? {}), false)
}
{
  const { service, patches } = montar()
  await service.update(ORG, 'ct-1', { source: null }, USUARIO)
  checar('source null chega (limpar origem)', patches[0]?.source, null)
}

// --- 6: normalização --------------------------------------------------------

console.log('\nnormalização')
{
  const { service, patches } = montar()
  await service.update(ORG, 'ct-1', { tags: [' urgente ', 'convenio', 'urgente', ''] }, USUARIO)
  // Espaços aparados, duplicata removida, string vazia descartada.
  checar('apara, deduplica e descarta vazios', patches[0]?.tags, ['urgente', 'convenio'])
}
{
  const { service, patches } = montar()
  await service.update(ORG, 'ct-1', { tags: [] }, USUARIO)
  checar('array vazio grava array vazio',  patches[0]?.tags, [])
}

console.log(falhas === 0 ? '\nTudo certo.\n' : `\n${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
