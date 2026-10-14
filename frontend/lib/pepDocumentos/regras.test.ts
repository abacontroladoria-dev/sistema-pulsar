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

// Calibração com os documentos reais (14/10/2026): padrões que davam alarme falso.
describe('conferirTexto — calibração com documentos reais', () => {
  const pic: ContextoDocumento = { ...ctxOE, sigla: 'PIC', competencia: '2026-10' }
  const PIC = `PLANO INDIVIDUALIZADO COMPORTAMENTAL\nPaciente: João Pedro Silva\n${'Objetivo terapêutico descrito com critério mensurável e prazo definido para o semestre. '.repeat(6)}`

  test('mês e ano em campo de data é válido; data quebrada é errada; só o ano é atenção', () => {
    const t = `${PIC}\nData de fechamento: Abril/2026\nData prevista para revisão: 10/2024\nData de Validade: Novembro 2026\nData do documento: Março de 2026`
    expect(conferirTexto(t, pic).filter(a => a.codigo.startsWith('data_'))).toEqual([])
    expect(codigos(`${PIC}\nData de nascimento: 10/07/20219`, pic)).toContain('errado:data_invalida')
    expect(codigos(`${PIC}\nData: 2026`, pic)).toContain('atencao:data_incompleta')
  })

  test('linha de assinatura em branco não é lacuna; nome e data do coordenador vazios são', () => {
    const r = codigos(`${PIC}\nAssinatura do coordenador: ________________\nNome do coordenador: ________________`, pic)
    expect(r.filter(x => x === 'errado:lacuna_do_modelo').length).toBe(1)
  })

  test('"Equipe responsável:" é título de bloco: no máximo atenção', () => {
    const r = codigos(`${PIC}\nEquipe responsável:\nCoordenação: Maria Souza Lima\nSupervisão técnica: Ana Paula Costa`, pic)
    expect(r.some(x => x.startsWith('errado:'))).toBe(false)
  })

  test('TAP (manual para o aplicador): instruções, roteiros e folha em branco não são "errado"', () => {
    const tap: ContextoDocumento = { ...ctxOE, sigla: 'TAP' }
    const t = `📘 Manual de Treinamento e Aplicação · ABA\nPaciente: João Pedro Silva\nData:_____________ Terapeuta: _____________\nIdentificação: em todas as sessões, preencha a Data e o nome do Terapeuta/AT.\nEstabeleça a regra de turnos: "Agora é a vez do [Colega], depois é a sua".\n${'Registre a resposta do paciente em cada tentativa e o tipo de ajuda usada. '.repeat(5)}`
    const r = conferirTexto(t, tap)
    expect(r.filter(a => a.nivel === 'errado')).toEqual([])
    expect(r.map(a => a.codigo)).not.toContain('titulo_nao_identificado')
  })
})

describe('conferirTexto — calibração 2 (frases normais não são modelo)', () => {
  const pic: ContextoDocumento = { ...ctxOE, sigla: 'PIC', competencia: '2026-10' }
  const base = `PLANO INDIVIDUALIZADO COMPORTAMENTAL\nPaciente: João Pedro Silva\n${'Objetivo terapêutico descrito com critério mensurável e prazo definido para o semestre. '.repeat(6)}`
  const errados = (t: string) => conferirTexto(t, pic).filter(a => a.nivel === 'errado').map(a => a.codigo)

  test('linguagem natural não é instrução do modelo', () => {
    expect(errados(`${base}\nEle ainda precisa de ajuda para colocar a roupa e escovar os dentes.`)).toEqual([])
    expect(errados(`${base}\nA equipe deverá registrar os episódios, procurando preencher as três etapas da ficha.`)).toEqual([])
    expect(errados(`${base}\nPontuação 2: Comenta sobre o que ela ou outros estão fazendo (ex.: “Estou [ação]”).`)).toEqual([])
  })
  test('o que é modelo continua errado', () => {
    expect(errados(`${base}\nPaciente: [nome do paciente]`)).toContain('texto_do_modelo')
    expect(errados(`${base}\nColocar o nome do paciente e a idade.`)).toContain('texto_do_modelo')
    expect(errados(`${base}\nInserir aqui o resumo da avaliação.`)).toContain('texto_do_modelo')
  })
  test('assinatura com o nome na mesma linha; nome do responsável legal em branco é atenção', () => {
    expect(errados(`${base}\n______________________ Maria Souza Lima`)).toEqual([])
    const r = conferirTexto(`${base}\nNome do Responsável Legal: ________________`, pic)
    expect(r.find(a => a.codigo === 'lacuna_do_modelo')?.nivel).toBe('atencao')
  })
})
