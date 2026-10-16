// TIPO DE CONTATO "Trabalhe conosco" pelo sistema (agente/tipo-contato.ts). Sem banco.
//
//   npx tsx modules/atendimento/agente/tipo-contato.test.mts

import { pareceTrabalheConosco } from './tipo-contato.js'

let falhas = 0
function checar(condicao: boolean, descricao: string) {
  if (condicao) console.log(`  ok   ${descricao}`)
  else { falhas++; console.error(`  FALHA ${descricao}`) }
}

console.log('\n1. quem procura trabalho')
const SIM = [
  // O caso real de 16/10 (5521983978283).
  'Oi, boa tarde! Tudo bem?\nMe chamo Stéphanie. Sou Psicóloga ABA, possuo experiência na área, CRP ativo e conta PJ.\nGostaria de encaminhar meu currículo para análise e me colocar à disposição para futuras oportunidades!',
  'Onde posso deixar meu CV?',
  'Tem vaga de estágio em psicologia?',
  'Gostaria de trabalhar com vocês',
  'Vi o anúncio do processo seletivo',
  'Quero saber sobre o trabalhe conosco',
  'Oportunidades de emprego na clínica?',
]
for (const t of SIM) checar(pareceTrabalheConosco([t]), `sim: "${t.slice(0, 60)}"`)

console.log('\n2. família falando de terapia — não é')
const NAO = [
  'Tem vaga para terapia ABA de manhã?',
  'Vocês têm vaga na quinta?',
  'Vocês têm vaga para fonoaudióloga?',
  'tem vagas para AT?',
  'Gostaria de agendar uma avaliação',
  'A escola mandou o currículo escolar adaptado dele',
  'Qual o valor da sessão de fono?',
  'Meu filho está no estágio inicial do diagnóstico',
  '',
]
for (const t of NAO) checar(!pareceTrabalheConosco([t]), `não: "${t.slice(0, 60)}"`)

console.log('\n3. basta uma das mensagens do turno')
checar(pareceTrabalheConosco(['Oi', 'boa tarde', 'queria mandar meu currículo']), 'currículo na terceira mensagem')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok')
process.exit(falhas ? 1 : 0)
