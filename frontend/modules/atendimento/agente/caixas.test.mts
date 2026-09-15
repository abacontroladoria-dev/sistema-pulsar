// A classificação das quatro caixas da triagem, sem banco e sem rede.
//
// `classificarCaixa` é pura pelo mesmo motivo que `resolverModoEfetivo`: o
// contador do card e o conteúdo da lista são produzidos pela MESMA função, e se
// ela divergir os dois deixam de combinar sem que nada quebre — o pior tipo de
// defeito, porque a tela continua funcionando e mentindo.
//
// O que cada bloco prova:
//   1. Encerrada vence o modo. Arquivar não mexe no ai_mode, então quase toda
//      conversa encerrada ainda tem 'autonomous' na coluna; sem a precedência, a
//      caixa "Maia" encheria de histórico morto.
//   2. A entrada é o modo EFETIVO. A herança já foi resolvida antes de chegar
//      aqui — este teste fixa o contrato de que a coluna crua não serve.
//   3. 'assisted' não é a Maia atendendo: ela redige, o humano envia.
//   4. assigned_user_id separa "alguém pegou" de "largada" — e a conversa que a
//      Maia escalou cai em 'ninguem', que é o caso de uso que originou a página.
//
// Rodar:
//   npx tsx modules/atendimento/agente/caixas.test.mts

import type { AIMode, ConversationStatus } from '../types/central.types'
import { CAIXAS, classificarCaixa, filtroDaCaixa } from './caixas.js'

let falhas = 0
function checar(cond: boolean, desc: string, extra?: unknown) {
  if (cond) console.log(`  ok    ${desc}`)
  else {
    falhas++
    console.log(`  FALHA ${desc}`)
    if (extra !== undefined) console.log('        ', JSON.stringify(extra))
  }
}

console.log('\ncaixas da triagem — status > modo > responsável\n')

// 1. Encerrada vence tudo.
{
  checar(classificarCaixa('resolved', 'autonomous', null) === 'encerradas',
    'resolvida com a Maia ligada é encerrada, não da Maia')
  checar(classificarCaixa('archived', 'autonomous', 'u1') === 'encerradas',
    'arquivada com responsável é encerrada, não humano')
  checar(classificarCaixa('archived', 'off', null) === 'encerradas',
    'arquivada e desligada não vaza para a fila de ninguém')
}

// 2. A Maia é só 'autonomous', e vale para qualquer status ativo.
{
  for (const s of ['open', 'assigned', 'waiting'] as const) {
    checar(classificarCaixa(s, 'autonomous', null) === 'maia',
      `${s} + autonomous = Maia`)
  }
  // Atribuída a alguém E com a Maia ligada: a Maia é quem responde. O
  // assigned_user_id sozinho não tira a conversa dela.
  checar(classificarCaixa('assigned', 'autonomous', 'u1') === 'maia',
    'autonomous vence o responsável atribuído')
}

// 3. 'assisted' é atendimento humano — ela redige, o humano envia.
{
  checar(classificarCaixa('open', 'assisted', 'u1') === 'humano',
    'assisted com responsável é humano, não Maia')
  checar(classificarCaixa('open', 'assisted', null) === 'ninguem',
    'assisted sem responsável é rascunho parado, cai em ninguém')
}

// 4. A distinção que originou a página.
{
  // É exatamente o que escalarParaHumano deixa no banco: ai_mode 'off',
  // priority 'high', assigned_user_id intocado.
  checar(classificarCaixa('open', 'off', null) === 'ninguem',
    'escalada pela Maia e não assumida cai em ninguém')
  checar(classificarCaixa('assigned', 'off', 'u1') === 'humano',
    'desligada e assumida por alguém é humano')
  checar(classificarCaixa('waiting', 'off', null) === 'ninguem',
    'waiting sem responsável é largada, não "em espera saudável"')
}

// 5. As duas pontas da regra têm que fechar: toda combinação classificada numa
//    caixa precisa ser encontrada pelo filtro daquela caixa, e por nenhum outro.
//
//    É o que garante que o número do card bata com a lista. Sem isto, o erro
//    típico passa: deixar a caixa "humano" sem recorte de responsável faz ela
//    contar também as largadas, as mesmas conversas entram em duas caixas e a
//    soma estoura o total — cada caixa, sozinha, parecendo correta.
{
  const STATUS: ConversationStatus[] = ['open', 'assigned', 'waiting', 'resolved', 'archived']
  const MODOS = ['off', 'assisted', 'autonomous'] as const
  const COLUNA: (AIMode | null)[] = [null, 'off', 'assisted', 'autonomous']

  function casa(f: ReturnType<typeof filtroDaCaixa>,
                status: ConversationStatus,
                coluna: AIMode | null,
                responsavel: string | null): boolean {
    if (f.status && !f.status.includes(status)) return false
    if (f.aiModeIn && !f.aiModeIn.includes(coluna)) return false
    if (f.responsavel === 'nenhum'   && responsavel !== null) return false
    if (f.responsavel === 'qualquer' && responsavel === null) return false
    return true
  }

  // Percorre o produto cartesiano nos dois padrões possíveis da clínica.
  for (const modoPadrao of ['autonomous', 'off'] as const) {
    let divergencias = 0

    for (const status of STATUS)
    for (const coluna of COLUNA)
    for (const responsavel of [null, 'u1']) {
      // A herança, resolvida como resolverModoEfetivo faria.
      const efetivo = coluna ?? modoPadrao
      const esperada = classificarCaixa(status, efetivo, responsavel)

      const encontraramEm = CAIXAS.filter(c =>
        casa(filtroDaCaixa(c, modoPadrao), status, coluna, responsavel))

      if (encontraramEm.length !== 1 || encontraramEm[0] !== esperada) {
        divergencias++
        console.log('        ', JSON.stringify({
          modoPadrao, status, coluna, responsavel, esperada, encontraramEm,
        }))
      }
    }

    checar(divergencias === 0,
      `padrão ${modoPadrao}: toda conversa cai em exatamente uma caixa, a mesma que classificarCaixa diz`)
  }
}

console.log(falhas === 0 ? '\nTudo certo.\n' : `\n${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
