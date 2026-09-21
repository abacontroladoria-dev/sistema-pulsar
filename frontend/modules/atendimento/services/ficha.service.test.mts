// Verifica o merge da ficha e a normalização do que a Maia ouve. Funções
// puras: não tocam banco, não pedem rede.
//
//   npx tsx modules/atendimento/services/ficha.service.test.mts
//
// O QUE SE PROVA, E POR QUE IMPORTA
//
// 1. O CADASTRO VENCE. É a regra pela qual esta feature foi desenhada assim, e
//    a única cuja violação tem custo fora da tela: um plano de saúde errado no
//    painel é lido por quem pede autorização, e a autorização pedida ao convênio
//    errado volta como glosa semanas depois.
//
// 2. A DATA NÃO INVERTE. 03/12 e 12/03 são ambos válidos, e trocá-los dá à
//    criança um aniversário errado que ninguém confere.
//
// 3. 30/02 NÃO VIRA 02/03. `new Date(2019, 1, 30)` não falha — ele rola para
//    março. Sem a checagem de volta, uma data impossível entra no banco como
//    uma data plausível.

import {
  resolverCampos,
  normalizarData,
  normalizarTurno,
  idadeEmAnos,
} from './ficha.service.js'
import type { ContactIntake } from '../types/central.types.js'
import type { PacienteCadastro } from '../repositories/paciente.repository.js'

let falhas = 0
function ok(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}`)
  if (extra !== undefined) console.error('        ', extra)
}
function eq<T>(recebido: T, esperado: T, oque: string) {
  ok(recebido === esperado, oque, `recebido: ${JSON.stringify(recebido)}`)
}

const HOJE = new Date('2026-09-21T12:00:00Z')

function cadastro(over: Partial<PacienteCadastro> = {}): PacienteCadastro {
  return {
    tita_paciente_id:   4242,
    nome:               'Pedro Henrique Alves',
    data_nascimento:    '2019-03-12',
    responsavel_nome:   'Maria Alves',
    convenio_nome:      'Bradesco Saúde',
    numero_carteirinha: '123456',
    sincronizado_em:    '2026-09-20T03:00:00Z',
    ...over,
  }
}

function coleta(over: Partial<ContactIntake> = {}): ContactIntake {
  return {
    contact_id:       'c-1',
    organization_id:  'o-1',
    patient_name:     null,
    birth_date:       null,
    guardian_name:    null,
    shift:            null,
    health_plan:      null,
    fontes:           {},
    coleta_concluida: false,
    created_at:       '2026-09-01T10:00:00Z',
    updated_at:       '2026-09-01T10:00:00Z',
    ...over,
  }
}

console.log('\n1. o cadastro vence — a regra que justifica o desenho')

{
  // A Maia ouviu OUTRO plano na conversa. O cadastro tem o dela com documento na
  // mão. Este é o teste que a feature inteira existe para não falhar.
  const campos = resolverCampos(
    cadastro({ convenio_nome: 'Bradesco Saúde' }),
    coleta({ health_plan: 'Amil', fontes: { health_plan: 'ia' } }),
  )

  eq(campos.health_plan.valor, 'Bradesco Saúde', 'o plano do TiTa vence o que a Maia ouviu')
  eq(campos.health_plan.origem, 'cadastro', 'e a tela diz que veio do cadastro')
}

{
  // Mesmo com o nome: a conversa diz "Pedrinho", o cadastro diz o nome completo.
  const campos = resolverCampos(
    cadastro(),
    coleta({ patient_name: 'Pedrinho', fontes: { patient_name: 'ia' } }),
  )
  eq(campos.patient_name.valor, 'Pedro Henrique Alves', 'o nome do TiTa vence o apelido da conversa')
}

{
  // Campo em BRANCO no TiTa não vence nada. Uma string vazia renderiza como
  // nada na tela, e tratá-la como preenchida esconderia o buraco.
  const campos = resolverCampos(
    cadastro({ responsavel_nome: '   ' }),
    coleta({ guardian_name: 'Maria Alves', fontes: { guardian_name: 'ia' } }),
  )
  eq(campos.guardian_name.valor, 'Maria Alves', 'cadastro em branco cede para a coleta')
  eq(campos.guardian_name.origem, 'ia', 'e a origem diz que foi a Maia')
}

{
  // O turno NÃO existe no TiTa. É o único campo que vem da conversa mesmo para
  // paciente antigo — se este teste quebrar, o de-para ganhou uma entrada que
  // não deveria ter.
  const campos = resolverCampos(
    cadastro(),
    coleta({ shift: 'tarde', fontes: { shift: 'ia' } }),
  )
  eq(campos.shift.valor, 'tarde', 'o turno vem da conversa mesmo com cadastro completo')
  eq(campos.shift.origem, 'ia', 'turno nunca tem origem cadastro')
}

{
  const campos = resolverCampos(null, coleta())
  eq(campos.patient_name.valor, null, 'sem cadastro e sem coleta, o campo é nulo')
  eq(campos.patient_name.origem, null, 'e não inventa origem')
  ok(campos.health_plan.valor === null, 'nulo, não string vazia', campos.health_plan.valor)
}

{
  // Correção do atendente sobrevive: ele conferiu, a origem tem que dizer isso.
  const campos = resolverCampos(
    null,
    coleta({ patient_name: 'Sofia', fontes: { patient_name: 'atendente' } }),
  )
  eq(campos.patient_name.origem, 'atendente', 'a correção humana mantém sua procedência')
}

console.log('\n2. a data não inverte, e a impossível não entra')

{
  const r = normalizarData('12/03/2019', HOJE)
  ok(r.ok && r.valor === '2019-03-12', 'dia vem antes do mês (formato brasileiro)', r)
}

{
  // O par que prova a regra: 03/12 é 3 de dezembro, não 12 de março.
  const r = normalizarData('03/12/2019', HOJE)
  ok(r.ok && r.valor === '2019-12-03', '03/12 é dezembro, não março', r)
}

{
  // Quatro dígitos primeiro é a única forma inequívoca: ISO.
  const r = normalizarData('2019-03-12', HOJE)
  ok(r.ok && r.valor === '2019-03-12', 'ISO é reconhecido pelo ano de 4 dígitos', r)
}

{
  const r = normalizarData('12 de março de 2019', HOJE)
  ok(r.ok && r.valor === '2019-03-12', 'mês por extenso, com acento', r)
}

{
  const r = normalizarData('12 de marco 2019', HOJE)
  ok(r.ok && r.valor === '2019-03-12', 'mês por extenso, sem acento e sem o segundo "de"', r)
}

{
  // `new Date(2019, 1, 30)` NÃO falha: vira 02/03. Sem a checagem de volta,
  // uma data impossível entraria como uma plausível.
  const r = normalizarData('30/02/2019', HOJE)
  ok(!r.ok, '30 de fevereiro é recusado, não rolado para março', r)
  ok(!r.ok && /dia/i.test(r.motivo), 'e a recusa diz o que perguntar de novo', r)
}

{
  const r = normalizarData('12/03/2029', HOJE)
  ok(!r.ok, 'data no futuro é recusada', r)
  ok(!r.ok && /futuro|ano/i.test(r.motivo), 'a recusa aponta o ano', r)
}

{
  // Ano de dois dígitos: "19" para uma criança é 2019. Assumir o século errado
  // produziria uma data válida com 100 anos de erro.
  const r = normalizarData('12/03/19', HOJE)
  ok(r.ok && r.valor === '2019-03-12', 'ano de 2 dígitos assume o século que não é futuro', r)
}

{
  const r = normalizarData('não sei', HOJE)
  ok(!r.ok, 'texto que não é data é recusado')
  // A mensagem volta ao modelo e vira a próxima pergunta. Se não disser o
  // formato, a Maia repete a mesma pergunta e cai no detector de laço.
  ok(!r.ok && /12\/03\/2019|dia\/mês\/ano/i.test(r.motivo), 'a recusa ensina o formato', r)
}

console.log('\n3. turno: "tanto faz" é resposta, não ausência')

eq(normalizarTurno('de manhã'), 'manha', 'manhã')
eq(normalizarTurno('à tarde'), 'tarde', 'tarde')
eq(normalizarTurno('o dia todo'), 'integral', 'integral')
eq(normalizarTurno('tanto faz'), 'indiferente', '"tanto faz" vira indiferente, não null')
eq(normalizarTurno('qualquer um'), 'indiferente', '"qualquer um" também')
eq(normalizarTurno('MANHA'), 'manha', 'maiúsculas e sem acento')
eq(normalizarTurno('na sexta'), null, 'o que não é turno não vira turno')

console.log('\n4. idade: derivada do nascimento, nunca guardada')

eq(idadeEmAnos('2019-03-12', HOJE), 7, '12/03/2019 tem 7 anos em 21/09/2026')

// O erro clássico de dividir por 365.25: faz 7 amanhã, ainda tem 6 hoje.
eq(idadeEmAnos('2019-09-22', HOJE), 6, 'aniversário amanhã ainda não conta')
eq(idadeEmAnos('2019-09-21', HOJE), 7, 'aniversário hoje já conta')
eq(idadeEmAnos(null, HOJE), null, 'sem nascimento não há idade')

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
