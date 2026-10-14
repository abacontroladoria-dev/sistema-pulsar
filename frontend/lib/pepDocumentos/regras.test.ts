import { describe, expect, test } from 'vitest'
import { conferirTexto } from './regras'
import type { ContextoDocumento } from './tipos'

// Textos fictícios no formato que o robô entrega (uma linha por parágrafo).

const OE_BOM = `ORIENTAÇÃO ESCOLAR
Identificação
Data do registro: 15/09/2026
Horário: 14h00 às 15h00
Participantes
Paciente: João Pedro Silva
Psicóloga responsável: Maria Souza Lima
Representante da escola: Ana Paula Costa
Cargo: Coordenadora pedagógica
Orientações realizadas
Foi apresentado à coordenação o plano de manejo de comportamentos de fuga durante a transição do recreio para a sala, com uso de antecipação visual e reforço diferencial. A escola relatou aumento de recusas às segundas-feiras; combinamos registro diário em folha de frequência e nova conversa em outubro.`

const ctxOE: ContextoDocumento = {
  sigla: 'OE', tipoRegistro: 'POR_PACIENTE', competencia: '2026-09',
  pacienteNome: 'João Pedro Silva', pastaPaciente: 'João Pedro', prestadorNome: 'Maria Souza Lima',
  outrosPacientes: ['Lucas Andrade Rocha'], hoje: '2026-10-14',
}

const codigos = (t: string, ctx: ContextoDocumento) => conferirTexto(t, ctx).map(a => `${a.nivel}:${a.codigo}`)

describe('conferirTexto — documento bem preenchido', () => {
  test('OE completo não tem achado nenhum', () => {
    expect(conferirTexto(OE_BOM, ctxOE)).toEqual([])
  })
})

describe('conferirTexto — resíduos do modelo e campos vazios (errado)', () => {
  test('lacunas, colchetes, instruções e campo vazio', () => {
    const t = OE_BOM
      .replace('Data do registro: 15/09/2026', 'Data do registro: //____')
      .replace('Horário: 14h00 às 15h00', 'Horário: ______ às ______')
      .replace('Cargo: Coordenadora pedagógica', 'Cargo:')
      .replace('Orientações realizadas', 'Orientações realizadas\n[descrever as orientações]\ncolocar o nome do paciente')
    const r = codigos(t, ctxOE)
    expect(r).toContain('errado:lacuna_do_modelo')
    expect(r).toContain('errado:campo_vazio')
    expect(r).toContain('errado:texto_do_modelo')
    expect(r).toContain('atencao:horario_nao_encontrado')
  })

  test('"Paciente: nome do paciente" é o modelo, não um paciente', () => {
    const r = conferirTexto(OE_BOM.replace('Paciente: João Pedro Silva', 'Paciente: nome do paciente'), ctxOE)
    expect(r.map(a => a.codigo)).toContain('texto_do_modelo')
    expect(r.map(a => a.codigo)).not.toContain('paciente_diferente')
  })

  test('"xx horas" e "Fulano"', () => {
    const r = codigos(`${OE_BOM}\nCarga horária: xx horas\nResponsável: Fulano`, ctxOE)
    expect(r.filter(x => x === 'errado:texto_do_modelo').length).toBe(2)
  })

  test('"por exemplo" no meio do texto não é resíduo', () => {
    expect(conferirTexto(`${OE_BOM}\nUsar reforço, por exemplo: elogio e adesivo.`, ctxOE)).toEqual([])
  })

  test('linha só de sublinhado é assinatura, não lacuna', () => {
    expect(conferirTexto(`${OE_BOM}\n______________________\nMaria Souza Lima`, ctxOE)).toEqual([])
  })
})

describe('conferirTexto — datas e horários', () => {
  test('data que não existe e horário invertido são errados', () => {
    const t = OE_BOM.replace('15/09/2026', '31/09/2026').replace('14h00 às 15h00', '15h00 às 14h00')
    const r = codigos(t, ctxOE)
    expect(r).toContain('errado:data_invalida')
    expect(r).toContain('errado:horario_incoerente')
  })
  test('data de outro mês é atenção; data de nascimento não conta', () => {
    const t = OE_BOM.replace('Data do registro: 15/09/2026', 'Data do registro: 15/08/2026\nData de nascimento: 03/02/2019')
    expect(codigos(t, ctxOE)).toEqual(['atencao:data_fora_do_mes'])
  })
  test('início e término em linhas separadas', () => {
    const t = OE_BOM.replace('Horário: 14h00 às 15h00', 'Horário de início: 15:00\nHorário de término: 14:30')
    expect(codigos(t, ctxOE)).toContain('errado:horario_incoerente')
  })
})

describe('conferirTexto — coerência com a pasta', () => {
  test('documento de outro paciente é errado', () => {
    const t = OE_BOM.replace('Paciente: João Pedro Silva', 'Paciente: Lucas Andrade Rocha')
    const r = conferirTexto(t, ctxOE)
    expect(r.find(a => a.codigo === 'paciente_diferente')).toMatchObject({ nivel: 'errado', trecho: 'Paciente: Lucas Andrade Rocha' })
  })
  test('nome abreviado na pasta continua batendo', () => {
    expect(conferirTexto(OE_BOM.replace('Paciente: João Pedro Silva', 'Paciente: João Pedro'), ctxOE)).toEqual([])
  })
  test('outro paciente do analista citado no texto é atenção', () => {
    const t = `${OE_BOM}\nCombinado igual ao caso de Lucas Andrade Rocha.`
    expect(codigos(t, ctxOE)).toContain('atencao:cita_outro_paciente')
  })
  test('PIC na pasta, mas o título é de Orientação Escolar', () => {
    const r = conferirTexto(OE_BOM, { ...ctxOE, sigla: 'PIC' })
    expect(r.find(a => a.codigo === 'documento_de_outro_tipo')).toMatchObject({ nivel: 'errado' })
  })
  test('reprogramação não confere o título', () => {
    const r = conferirTexto(OE_BOM, { ...ctxOE, sigla: 'PIC', reprogramacao: true })
    expect(r.map(a => a.codigo)).not.toContain('documento_de_outro_tipo')
  })
})

describe('conferirTexto — tamanho e seções', () => {
  test('quase vazio é errado', () => {
    expect(codigos('ORIENTAÇÃO ESCOLAR\nPaciente: João Pedro Silva', ctxOE)).toContain('errado:documento_quase_vazio')
  })
  test('seção numerada sem conteúdo é atenção', () => {
    const t = `${OE_BOM}\n1. Objetivos\n2. Resultados\nForam alcançados 3 dos 5 objetivos propostos para o semestre.`
    expect(codigos(t, ctxOE)).toContain('atencao:secao_vazia')
  })
})
