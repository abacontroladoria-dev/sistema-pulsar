// Verifica o agrupamento das sessões do TiTa que `consultar_sessoes_do_paciente`
// devolve ao modelo (15/10/2026). Não toca banco:
//
//   npx tsx --conditions react-server modules/atendimento/agente/sessoes-paciente.test.mts
//
// O que se prova: a unidade sai do prefixo da sala (é o que faltou no rascunho
// que mandou a mãe da Pérola para Padre Miguel), o mesmo horário com dois
// profissionais é UMA sessão, e cancelada não passa por marcada.

import { agruparSessoes } from './ferramentas.js'
import type { SessaoTita } from '../repositories/sessoes-tita.repository.js'

let falhas = 0
function ok(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}`)
  if (extra !== undefined) console.error('        ', extra)
}

function linha(over: Partial<SessaoTita>): SessaoTita {
  return {
    paciente_id: 22429, paciente_nome: 'Pérola do Nascimento Rosa',
    data: '2026-10-15', dia_semana: 'Quinta-feira', hora_inicial: '11:20:00', hora_final: '12:00:00',
    terapia_nome: 'Psicologia', terapia_exibicao_nome: 'Psicologia',
    profissional_nome: 'Joseane Bezerra Dos Santos De Castro', sala_nome: 'Unid. Fazendinha - Sala 12',
    status_execucao: 'Planejado/Pendente', justificativa: null,
    ...over,
  }
}

{
  const [s] = agruparSessoes([linha({})], false)
  ok(s.unidade === 'Fazendinha' && s.inicio === '11:20' && s.fim === '12:00', 'Pérola: Fazendinha, 11:20–12:00', s)
  ok(s.situacao === 'marcada' && !('crianca' in s), 'uma criança: marcada, sem repetir o nome', s)
}

{
  const r = agruparSessoes([
    linha({ terapia_exibicao_nome: 'Aplicador ABA', profissional_nome: 'Ana' }),
    linha({ terapia_exibicao_nome: 'Coordenador de Caso', profissional_nome: 'Bia', status_execucao: 'Em Conflito' }),
  ], false)
  ok(r.length === 1 && r[0].profissional === 'Ana, Bia' && r[0].terapia === 'Aplicador ABA, Coordenador de Caso',
    'mesmo horário com dois profissionais vira uma sessão', r)
}

{
  const r = agruparSessoes([
    linha({ status_execucao: 'Cancelado', justificativa: 'Falta do Profissional' }),
    linha({ data: '2026-10-22', sala_nome: 'AT Externo Escola' }),
    linha({ paciente_id: 1, paciente_nome: 'Irmão', data: '2026-10-22' }),
  ], true)
  ok(r[0].situacao === 'cancelada' && r[0].motivoCancelamento === 'Falta do Profissional', 'cancelada com o motivo', r[0])
  ok(r[1].unidade === null && r[1].local === 'AT Externo Escola', 'sala fora da clínica: unidade null e o local', r[1])
  ok(r.length === 3 && r[2].crianca === 'Irmão', 'irmãos: cada sessão diz de qual criança é', r)
}

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
