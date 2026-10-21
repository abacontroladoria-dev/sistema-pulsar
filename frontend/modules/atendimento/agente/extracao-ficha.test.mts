// Ficha do paciente pela conversa (agente/extracao-ficha.ts). Provider e
// fichas dublês: não gasta token, não toca banco.
//
//   npx tsx modules/atendimento/agente/extracao-ficha.test.mts

import { extrairFicha, filtrarExtracao, patchDosArgumentos } from './extracao-ficha.js'
import { normalizarIdade, resolverCampos } from '../services/ficha.service.js'
import type { LLMProvider, LlmRequisicao, LlmResposta } from '../llm/tipos.js'
import type { CampoFicha, ContactIntake, FichaPaciente, OrigemCampo } from '../types/central.types.js'
import type { PatchFicha } from '../repositories/ficha.repository.js'

let falhas = 0
function checar(condicao: boolean, descricao: string, extra?: unknown) {
  if (condicao) console.log(`  ok   ${descricao}`)
  else { falhas++; console.error(`  FALHA ${descricao}`); if (extra !== undefined) console.error('        ', extra) }
}

function ficha(campos: Partial<Record<CampoFicha, { valor: string; origem: OrigemCampo }>> = {}): FichaPaciente {
  const vazio = { valor: null, origem: null }
  return {
    contact_id: 'c-1',
    vinculado:  false,
    campos: {
      patient_name: vazio, birth_date: vazio, age_years: vazio,
      guardian_name: vazio, shift: vazio, health_plan: vazio,
      ...campos,
    },
    idade: null,
    faltantes: [],
    sincronizado_em: null,
  }
}

console.log('\n1. idade como a família fala')
checar(normalizarIdade('5') === 5, '"5"')
checar(normalizarIdade('tem 5 anos e meio') === 5, '"tem 5 anos e meio"')
checar(normalizarIdade('8 meses') === 0, '"8 meses" vira 0')
checar(normalizarIdade('cinco') === null, 'por extenso não é reconhecido')
checar(normalizarIdade('300 anos') === null, 'acima do teto')

console.log('\n2. idade na leitura: com nascimento, vale a calculada')
{
  const coleta = { birth_date: '2019-03-12', age_years: 2, fontes: { birth_date: 'ia' } } as unknown as ContactIntake
  const c = resolverCampos(null, coleta)
  checar(c.age_years.valor !== null && c.age_years.valor !== '2', 'idade calculada vence a informada', c.age_years)
  checar(c.age_years.origem === 'ia', 'procedência da data')
  const soIdade = resolverCampos(null, { age_years: 4, fontes: { age_years: 'ia' } } as unknown as ContactIntake)
  checar(soIdade.age_years.valor === '4', 'sem nascimento, vale a informada', soIdade.age_years)
}

console.log('\n3. filtro: o que a extração pode gravar')
{
  const p = patchDosArgumentos({
    nomePaciente: 'Sofia', dataNascimento: null, idade: '5 anos', nomeResponsavel: 'null',
    turno: 'manha', planoSaude: 'ASSIM',
  })
  checar(JSON.stringify(p) === JSON.stringify({
    patient_name: 'Sofia', age_years: '5 anos', shift: 'manha', health_plan: 'ASSIM',
  }), 'null e "null" saem', p)

  const f = filtrarExtracao(p, ficha({
    patient_name: { valor: 'Sophia', origem: 'atendente' },
    age_years:    { valor: '5', origem: 'ia' },
    health_plan:  { valor: 'Amil', origem: 'ia' },
  }))
  checar(!('patient_name' in f), 'o que o atendente corrigiu fica', f)
  checar(!('age_years' in f), 'mesma idade não reescreve', f)
  checar(f.health_plan === 'ASSIM', 'a família corrigiu o que a Maia anotou', f)
  checar(f.shift === 'manha', 'campo vazio entra', f)
}

console.log('\n4. extrairFicha ponta a ponta')
function provider(args: Record<string, unknown> | null): LLMProvider & { pedidos: LlmRequisicao[] } {
  const pedidos: LlmRequisicao[] = []
  return {
    pedidos,
    async chat(req: LlmRequisicao): Promise<LlmResposta> {
      pedidos.push(req)
      return {
        texto: null,
        chamadas: args ? [{ id: 't1', nome: 'registrar_dados_do_paciente', argumentosJson: JSON.stringify(args) }] : [],
        motivoParada: args ? 'tool_calls' : 'stop',
      } as unknown as LlmResposta
    },
  } as unknown as LLMProvider & { pedidos: LlmRequisicao[] }
}
function fichas(coletar: boolean) {
  const gravacoes: PatchFicha[] = []
  return {
    gravacoes,
    async deveColetar() { return coletar },
    async montar() { return ficha() },
    async registrar(_o: string, _c: string, patch: PatchFicha) {
      gravacoes.push(patch)
      return { gravados: Object.keys(patch) as CampoFicha[], recusados: [] }
    },
  }
}
const FALAS = [
  { de: 'familia' as const, texto: 'Oi, sou a Maria, mãe do Pedro, ele tem 4 anos' },
  { de: 'clinica' as const, texto: 'Olá Maria! Qual o plano?' },
]
{
  const pv = provider({
    nomePaciente: 'Pedro', dataNascimento: null, idade: '4 anos', nomeResponsavel: 'Maria',
    turno: null, planoSaude: null,
  })
  const fx = fichas(true)
  const r = await extrairFicha('o-1', 'c-1', FALAS, { provider: pv, fichas: fx })
  checar(r.ok && r.gravados.length === 3, 'grava nome, idade e responsável', r)
  checar(pv.pedidos[0]?.escolhaFerramenta === 'registrar_dados_do_paciente', 'ferramenta forçada')
  checar(pv.pedidos[0]?.mensagens.every((m) => m.papel !== 'system' || !m.conteudo.includes('Pedro')),
    'conversa nunca no papel system')
}
{
  const pv = provider({ nomePaciente: 'Pedro' })
  const r = await extrairFicha('o-1', 'c-1', FALAS, { provider: pv, fichas: fichas(false) })
  checar(r.ok && r.gravados.length === 0 && pv.pedidos.length === 0, 'vinculado/concluída: nem chama o modelo', r)
}
{
  const r = await extrairFicha('o-1', 'c-1', FALAS, { provider: provider(null), fichas: fichas(true) })
  checar(!r.ok, 'modelo sem chamada: devolve motivo, não lança', r)
}

if (falhas > 0) { console.error(`\n${falhas} falha(s).`); process.exit(1) }
console.log('\nTodos os testes passaram.')
