// Verifica o catálogo de especialidades ofertáveis e a resolução de nome. Em
// memória, sem banco e sem LLM — roda sem stack local.
//
//   npx tsx modules/atendimento/agente/terapia.test.mts
//
// POR QUE ESTE ARQUIVO EXISTE
//
// Três defeitos distintos convergem aqui, e cada um tem uma seção:
//
// 1. O id que o modelo não sabia. Em 04/09/2026 a IA passou `terapiaId: 1` para
//    psicologia, que é 2259, tendo usado o id certo um minuto antes. Três
//    reforços de prompt não impediram a reincidência.
//
// 2. O id que não identifica a terapia. Medido em produção: `terapia_id` 2317
//    aparece com SETE `terapia_nome` diferentes. Filtrar por id mistura quem só
//    aplica ABA com quem faz psicologia, e esconde as 12 vagas de psicologia que
//    vivem sob 2317.
//
// 3. Duas línguas para a mesma terapia. O TiTa grava 'Aplicador ABA (PS)'; o
//    laudo do responsável diz 'Psicologia ABA'. Sem de-para, 205 vagas ficam
//    inalcançáveis para quem as procura pelo nome que tem em mãos.
//
// Os NOMES E CONTAGENS abaixo são de produção (05/09/2026), não inventados.
//
// Sem framework, como os outros testes do módulo: sai com código 1 na primeira
// asserção falha.

import {
  ESPECIALIDADES,
  resolverTerapia,
  chaveTerapia,
  partesDoNome,
  vagaOferece,
  especialidadesNaGrade,
  nomesOfertaveis,
} from './terapia.js'

let falhas = 0
function checar(condicao: boolean, descricao: string, extra?: unknown) {
  if (condicao) {
    console.log(`  ok   ${descricao}`)
  } else {
    falhas++
    console.error(`  FALHA ${descricao}`)
    if (extra !== undefined) console.error('        ', extra)
  }
}

// O vocabulário REAL de central.vw_vagas_livres na janela de 30 dias, medido em
// 05/09/2026. Reproduzido inteiro de propósito: é a origem de todas as
// armadilhas testadas abaixo, e um resumo esconderia justamente os nomes-lista.
const GRADE_REAL = [
  { terapia_id: 2260, terapia_nome: 'Aplicador ABA (AE), Aplicador ABA (HS), Psicopedagogia', vagas: 63 },
  { terapia_id: 2260, terapia_nome: 'Aplicador ABA (AE), Arteterapia, Arteterapia (Psicologia ABA), Psicomotricidade, Psicopedagogia', vagas: 10 },
  { terapia_id: 2260, terapia_nome: 'Aplicador ABA (AE), Arteterapia, Psicomotricidade, Psicopedagogia', vagas: 32 },
  { terapia_id: 2264, terapia_nome: 'Aplicador ABA (AV), Aplicador ABA (SF)', vagas: 10 },
  { terapia_id: 2269, terapia_nome: 'Aplicador ABA (EF)', vagas: 1 },
  { terapia_id: 2317, terapia_nome: 'Aplicador ABA (PS)', vagas: 135 },
  { terapia_id: 2317, terapia_nome: 'Aplicador ABA (PS), Coordenador de Caso', vagas: 13 },
  { terapia_id: 2317, terapia_nome: 'Aplicador ABA (PS), Coordenador de Caso, Psicopedagogia', vagas: 21 },
  { terapia_id: 2317, terapia_nome: 'Aplicador ABA (PS), Psicologia', vagas: 12 },
  { terapia_id: 2317, terapia_nome: 'Aplicador ABA (PS), Psicologia ABA', vagas: 21 },
  { terapia_id: 2317, terapia_nome: 'Aplicador ABA (PS), Psicopedagogia', vagas: 11 },
  { terapia_id: 2317, terapia_nome: 'Aplicador ABA (PS), Supervisão ABA', vagas: 5 },
  { terapia_id: 2263, terapia_nome: 'Aplicador ABA (SF)', vagas: 180 },
  { terapia_id: 2331, terapia_nome: 'Aplicador Suporte', vagas: 40 },
  { terapia_id: 2268, terapia_nome: 'Avaliação Neuropsicológica', vagas: 23 },
  { terapia_id: 2248, terapia_nome: 'Coordenador de Caso', vagas: 586 },
  { terapia_id: 2267, terapia_nome: 'Equoterapia', vagas: 36 },
  { terapia_id: 2281, terapia_nome: 'Especialista Técnico de Área', vagas: 1 },
  { terapia_id: 2258, terapia_nome: 'Fisioterapia', vagas: 43 },
  { terapia_id: 2249, terapia_nome: 'Fisioterapia Aquática', vagas: 36 },
  { terapia_id: 2250, terapia_nome: 'Fonoaudiologia', vagas: 207 },
  { terapia_id: 2251, terapia_nome: 'Musicoterapia', vagas: 77 },
  { terapia_id: 2279, terapia_nome: 'Operações Clínicas', vagas: 5 },
  { terapia_id: 2259, terapia_nome: 'Psicologia', vagas: 61 },
  { terapia_id: 2253, terapia_nome: 'Psicomotricidade', vagas: 110 },
  { terapia_id: 2254, terapia_nome: 'Psicopedagogia', vagas: 208 },
  { terapia_id: 2353, terapia_nome: 'Supervisão ABA', vagas: 319 },
  { terapia_id: 2274, terapia_nome: 'Terapia Alimentar', vagas: 90 },
  { terapia_id: 2255, terapia_nome: 'Terapia Ocupacional', vagas: 111 },
  { terapia_id: 2270, terapia_nome: 'Triagem', vagas: 156 },
  { terapia_id: 2604, terapia_nome: 'Visita Guiada', vagas: 252 },
]

const NA_GRADE = especialidadesNaGrade(GRADE_REAL)

// ----------------------------------------------------------------------------
console.log('\n1. o de-para do laudo: Psicologia ABA ↔ Aplicador ABA (PS)')

// O responsável tem 'Psicologia ABA' escrito no laudo e nunca vai digitar
// "aplicador". Sem este de-para, 205 vagas são inalcançáveis e o agente responde
// que não há — o falso negativo que este trabalho existe para eliminar.
const aba = resolverTerapia('Psicologia ABA', NA_GRADE)
checar(aba.tipo === 'encontrada' && aba.nome === 'Psicologia ABA',
  "'Psicologia ABA' (a palavra do laudo) resolve", aba)
if (aba.tipo === 'encontrada') {
  checar(aba.casaCom.includes('Aplicador ABA (PS)'),
    'e casa com o nome que o TiTa realmente grava na escala', aba.casaCom)
}

// O que o TiTa grava também resolve — o agente pode reencontrar a especialidade
// a partir de uma vaga que já tem em mãos.
const porAcao = resolverTerapia('Aplicador ABA (PS)', NA_GRADE)
checar(porAcao.tipo === 'encontrada' && porAcao.nome === 'Psicologia ABA',
  "'Aplicador ABA (PS)' resolve para o nome de LAUDO, não para si mesmo", porAcao)

// As sete linhas que contêm 'Aplicador ABA (PS)' são todas Psicologia ABA —
// 135+13+21+12+21+11+5. É a contagem que prova que o de-para alcança o volume
// real, e é o número que o responsável perderia sem ele.
const vagasAba = GRADE_REAL
  .filter(v => vagaOferece(v.terapia_nome, ESPECIALIDADES.find(e => e.nome === 'Psicologia ABA')!))
  .reduce((s, v) => s + v.vagas, 0)
checar(vagasAba === 218, 'o de-para alcança as 218 vagas de Psicologia ABA', vagasAba)

// ----------------------------------------------------------------------------
console.log('\n2. Psicologia ≠ Psicologia ABA — terapias diferentes, TUSS diferente')

// Este é o check que o usuário apontou e que quebrava o desenho anterior.
// 'psicologia' é PREFIXO de 'psicologia aba'. Sem o exato ganhando sozinho, quem
// pede psicologia comum recebe ABA — a terapia errada, silenciosamente.
const psi = resolverTerapia('psicologia', NA_GRADE)
checar(psi.tipo === 'encontrada' && psi.nome === 'Psicologia',
  "'psicologia' resolve para Psicologia, NÃO para Psicologia ABA", psi)

// E o inverso: o texto mais longo não pode cair na terapia mais curta.
const psiAba = resolverTerapia('psicologia aba', NA_GRADE)
checar(psiAba.tipo === 'encontrada' && psiAba.nome === 'Psicologia ABA',
  "'psicologia aba' resolve para Psicologia ABA, NÃO para Psicologia", psiAba)

// As duas têm `casaCom` disjuntos: nenhuma vaga pode ser contada como as duas.
const eqPsi = ESPECIALIDADES.find(e => e.nome === 'Psicologia')!
const eqAba = ESPECIALIDADES.find(e => e.nome === 'Psicologia ABA')!
checar(!eqPsi.casaCom.some(c => eqAba.casaCom.includes(c)),
  'os textos de casamento das duas psicologias não se sobrepõem',
  { psicologia: eqPsi.casaCom, aba: eqAba.casaCom })

// A vaga 'Aplicador ABA (PS), Psicologia' oferece AS DUAS: o profissional atende
// as duas naquele horário. Isso é correto e é a razão de o filtro ser por nome —
// sob o id 2317 ela seria indistinguível de quem só aplica ABA.
const ambas = 'Aplicador ABA (PS), Psicologia'
checar(vagaOferece(ambas, eqPsi) && vagaOferece(ambas, eqAba),
  `'${ambas}' oferece as duas psicologias (o profissional atende ambas)`)

// E 'Aplicador ABA (PS)' puro NÃO oferece Psicologia comum — as 135 vagas que
// filtrar por id 2317 traria por engano.
checar(!vagaOferece('Aplicador ABA (PS)', eqPsi),
  "'Aplicador ABA (PS)' puro NÃO conta como Psicologia comum (135 vagas)")

// ----------------------------------------------------------------------------
console.log('\n3. o parêntese qualificador não sequestra a terapia')

// 'Arteterapia (Psicologia ABA)' é arteterapia feita dentro do ABA — não é
// Psicologia ABA. O casamento é por IGUALDADE de parte, não substring da linha,
// e é isso que a impede de ser contada errado.
checar(!vagaOferece('Arteterapia (Psicologia ABA)', eqAba),
  "'Arteterapia (Psicologia ABA)' NÃO conta como Psicologia ABA")

// Ela também não é Arteterapia pura, pelo mesmo critério de igualdade.
const eqArte = ESPECIALIDADES.find(e => e.nome === 'Arteterapia')!
checar(!vagaOferece('Arteterapia (Psicologia ABA)', eqArte),
  "'Arteterapia (Psicologia ABA)' NÃO conta como Arteterapia pura (é qualificada)")

// Mas a linha real que a contém tem 'Arteterapia' como parte SEPARADA, e essa
// sim conta.
const linhaMista = 'Aplicador ABA (AE), Arteterapia, Arteterapia (Psicologia ABA), Psicomotricidade, Psicopedagogia'
checar(vagaOferece(linhaMista, eqArte),
  'a mesma linha oferece Arteterapia pela parte não-qualificada')
checar(!vagaOferece(linhaMista, eqAba),
  'e essa linha NÃO oferece Psicologia ABA')

// As variantes de aplicador não podem colidir entre si: (PS), (SF), (AE), (AV),
// (EF), (HS) são ações diferentes. Se o parêntese fosse normalizado para espaço,
// todas virariam prefixos umas das outras.
checar(!vagaOferece('Aplicador ABA (SF)', eqAba),
  "'Aplicador ABA (SF)' NÃO é Psicologia ABA (variante diferente, 180 vagas)")
checar(!vagaOferece('Aplicador ABA (AE), Aplicador ABA (HS), Psicopedagogia', eqAba),
  "'Aplicador ABA (AE)/(HS)' NÃO é Psicologia ABA")

// ----------------------------------------------------------------------------
console.log('\n4. a allowlist — o que o agente NÃO oferece')

// Trabalho interno não é atendimento que uma mãe agenda por WhatsApp. Até
// 05/09/2026 o agente listava 'Coordenador de Caso' como se fosse terapia
// quando alguém perguntava o que a clínica tem disponível.
//
// Estas cinco estão fora POR DECISÃO DA CLÍNICA (05/09/2026), não por omissão —
// são 951 vagas, quase metade da grade. Se alguma delas voltar a ser oferecida,
// este bloco falha, e é isso que se quer: a volta tem que ser deliberada.
//
// A direção do erro é assimétrica: omitir uma vaga ofertável é visível (alguém
// pergunta por ela); oferecer supervisão interna a um responsável não é — ele
// aceita o horário e o erro só aparece na recepção.
const NAO_OFERTAVEIS = [
  'Coordenador de Caso',
  'Supervisão ABA',
  'Aplicador Suporte',
  'Operações Clínicas',
  'Especialista Técnico de Área',
]

// O catálogo tem exatamente 15 nomes. O número está aqui para que ACRESCENTAR
// uma especialidade seja um ato consciente: quem adicionar uma linha vê este
// teste falhar e precisa decidir se ela é mesmo ofertável ao responsável.
checar(ESPECIALIDADES.length === 15,
  'o catálogo tem 15 especialidades ofertáveis (mudou? confirme com a clínica)',
  ESPECIALIDADES.map(e => e.nome))

for (const nome of NAO_OFERTAVEIS) {
  checar(!ESPECIALIDADES.some(e => e.nome === nome),
    `'${nome}' não está no catálogo de oferta`)
  checar(!NA_GRADE.includes(nome),
    `'${nome}' não aparece como especialidade disponível`)
  checar(resolverTerapia(nome, NA_GRADE).tipo === 'nao_encontrada',
    `pedir '${nome}' explicitamente não resolve`)
}

// A linha 'Aplicador ABA (PS), Coordenador de Caso' oferece Psicologia ABA e
// nada mais: o cargo interno na lista não vaza para a oferta.
const comCargo = especialidadesNaGrade([{ terapia_nome: 'Aplicador ABA (PS), Coordenador de Caso' }])
checar(JSON.stringify(comCargo) === JSON.stringify(['Psicologia ABA']),
  'vaga com cargo interno na lista oferece só a especialidade', comCargo)

// ----------------------------------------------------------------------------
console.log('\n5. o que a grade real oferece')

// Toda especialidade do catálogo com vaga aparece; nenhum nome de escala vaza.
checar(NA_GRADE.includes('Psicologia') && NA_GRADE.includes('Psicologia ABA'),
  'as duas psicologias aparecem separadas', NA_GRADE)
checar(!NA_GRADE.some(n => n.startsWith('Aplicador')),
  'nenhum nome de escala ("Aplicador ...") é oferecido ao responsável', NA_GRADE)
checar(NA_GRADE.length > 0 && NA_GRADE.every(n => ESPECIALIDADES.some(e => e.nome === n)),
  'tudo que é oferecido está no catálogo', NA_GRADE)

// Nutrição não tem vaga na janela real: não pode aparecer como disponível.
checar(!NA_GRADE.includes('Nutrição'), 'especialidade sem vaga não é oferecida')

// ----------------------------------------------------------------------------
console.log('\n6. ambíguo vira pergunta, nunca escolha nossa')

// 'psico' começa Psicologia, Psicologia ABA, Psicopedagogia e Psicomotricidade.
// Escolher a primeira seria decidir a terapia da criança pelo responsável.
const psico = resolverTerapia('psico', NA_GRADE)
checar(psico.tipo === 'ambigua', "'psico' é ambíguo, não resolvido", psico)
if (psico.tipo === 'ambigua') {
  checar(psico.candidatas.length >= 4,
    'devolve os candidatos para o modelo poder perguntar', psico.candidatas)
}

// 'fisio' casa Fisioterapia e Fisioterapia Aquática — piscina não é a mesma
// coisa que sala.
const fisio = resolverTerapia('fisio', NA_GRADE)
checar(fisio.tipo === 'ambigua', "'fisio' é ambíguo (Fisioterapia vs Aquática)", fisio)

// ----------------------------------------------------------------------------
console.log('\n7. nome parcial e sinônimo — como o responsável fala')

const CASOS: [string, string][] = [
  ['fono',                  'Fonoaudiologia'],
  ['Fonoaudiologia',        'Fonoaudiologia'],
  ['FONOAUDIOLOGIA',        'Fonoaudiologia'],
  ['  fonoaudiologia  ',    'Fonoaudiologia'],
  ['terapia ocupacional',   'Terapia Ocupacional'],
  ['ocupacional',           'Terapia Ocupacional'],
  ['to',                    'Terapia Ocupacional'],
  ['psicopedagogia',        'Psicopedagogia'],
  ['psicomotricidade',      'Psicomotricidade'],
  ['musicoterapia',         'Musicoterapia'],
  ['equoterapia',           'Equoterapia'],
  ['hidroterapia',          'Fisioterapia Aquática'],
  ['triagem',               'Triagem'],
  ['primeira consulta',     'Triagem'],
  ['visita',                'Visita Guiada'],
  // Sem acento, que é como se digita no WhatsApp.
  ['avaliacao neuropsicologica', 'Avaliação Neuropsicológica'],
  ['fisioterapia aquatica',      'Fisioterapia Aquática'],
  // Sinônimos do ABA.
  ['aba',                        'Psicologia ABA'],
  ['psicologia comportamental',  'Psicologia ABA'],
]

for (const [entrada, esperado] of CASOS) {
  const r = resolverTerapia(entrada, NA_GRADE)
  checar(r.tipo === 'encontrada' && r.nome === esperado,
    `'${entrada}' → ${esperado}`, r)
}

// ----------------------------------------------------------------------------
console.log('\n8. não encontrado é DIFERENTE de não ter vaga')

// Quem chama transforma isto em `erro_interno`, não em `sem_vaga`. A distinção é
// o dano que se quer impedir: "não reconheci o nome" não é "a agenda está
// vazia", e tratá-los igual foi o que fez a IA negar uma vaga real.
checar(resolverTerapia('quiropraxia', NA_GRADE).tipo === 'nao_encontrada', "'quiropraxia' → nao_encontrada")
checar(resolverTerapia('', NA_GRADE).tipo === 'nao_encontrada',            "'' → nao_encontrada")
checar(resolverTerapia('   ', NA_GRADE).tipo === 'nao_encontrada',         'só espaço → nao_encontrada')
checar(resolverTerapia(null, NA_GRADE).tipo === 'nao_encontrada',          'null → nao_encontrada')
checar(resolverTerapia('psicologia', []).tipo === 'nao_encontrada',        'nada disponível → nao_encontrada')

// O número que o modelo mandava antes tem que recusar limpo.
checar(resolverTerapia('1', NA_GRADE).tipo === 'nao_encontrada',
  "'1' (o chute antigo) → nao_encontrada, não casa por acaso")
checar(resolverTerapia('2259', NA_GRADE).tipo === 'nao_encontrada',
  "'2259' (um id real) → nao_encontrada: id não é nome")

// ----------------------------------------------------------------------------
console.log('\n9. nomesOfertaveis — a lista que faz o modelo se corrigir')

const nomes = nomesOfertaveis(NA_GRADE)
checar(nomes.includes('Psicologia') && nomes.includes('Psicologia ABA'),
  'a lista distingue as duas psicologias', nomes)
checar(!nomes.some(n => n.includes('Aplicador')),
  'a lista não expõe nome de escala ao responsável', nomes)
checar(!nomes.some(n => NAO_OFERTAVEIS.includes(n)),
  'a lista não expõe cargo interno', nomes)
checar(nomes.length === new Set(nomes).size, 'sem repetição', nomes)
checar(nomesOfertaveis(NA_GRADE, 3).length === 3, 'respeita o máximo')

// Todo nome sugerido precisa ser resolvível: sugerir um nome que a própria
// função não aceita seria mandar o modelo para um beco.
for (const nome of nomes) {
  const r = resolverTerapia(nome, NA_GRADE)
  checar(r.tipo === 'encontrada' && r.nome === nome,
    `o nome sugerido '${nome}' resolve para si mesmo`, r)
}

// ----------------------------------------------------------------------------
console.log('\n10. coerência interna do catálogo')

// Nenhum nome duplicado — dois itens com o mesmo nome fariam toda busca exata
// virar ambígua.
const todosNomes = ESPECIALIDADES.map(e => e.nome)
checar(todosNomes.length === new Set(todosNomes).size, 'nomes do catálogo são únicos', todosNomes)

// Nenhum `casaCom` compartilhado entre especialidades: um texto da grade não
// pode significar duas terapias.
const donoDe = new Map<string, string>()
for (const e of ESPECIALIDADES) {
  for (const c of e.casaCom) {
    const chave = chaveTerapia(c)
    checar(!donoDe.has(chave),
      `'${c}' pertence a uma só especialidade (${e.nome})`, donoDe.get(chave))
    donoDe.set(chave, e.nome)
  }
}

// Toda especialidade tem ao menos um texto de casamento, senão nunca casaria
// vaga nenhuma e seria oferta fantasma.
for (const e of ESPECIALIDADES) {
  checar(e.casaCom.length > 0, `'${e.nome}' tem ao menos um texto de casamento`)
}

// partesDoNome, as bordas.
checar(partesDoNome(null).length === 0, 'null → nenhuma parte')
checar(partesDoNome('').length === 0, "'' → nenhuma parte")
checar(partesDoNome('Psicologia,').length === 1, 'vírgula solta não gera parte vazia')
checar(partesDoNome('Aplicador ABA (PS), Psicologia ABA').length === 2, 'nome-lista vira duas partes')

// chaveTerapia preserva o parêntese — é o que distingue as variantes de
// aplicador entre si.
checar(chaveTerapia('Aplicador ABA (PS)') === 'aplicador aba (ps)',
  'o parêntese é preservado na normalização', chaveTerapia('Aplicador ABA (PS)'))
checar(chaveTerapia('Avaliação Neuropsicológica') === 'avaliacao neuropsicologica',
  'acento é removido', chaveTerapia('Avaliação Neuropsicológica'))

// ----------------------------------------------------------------------------
console.log(falhas === 0 ? '\nTodos os checks passaram.\n' : `\n${falhas} check(s) falharam.\n`)
process.exit(falhas === 0 ? 0 : 1)
