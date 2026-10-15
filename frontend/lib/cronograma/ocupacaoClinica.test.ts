// Testes do motor da Ocupação Clínica (ocupacaoClinica.ts).
//
// O que estes testes travam:
//  • as cinco situações sempre somam o total de horários de cadeira;
//  • "com paciente" é exatamente o `blocosPreenchidos` do motor antigo
//    (calcularResumoUnidades) — a tela nova não pode divergir da Ocupação real;
//  • cada situação nasce da fonte certa ('Livre' na unidade, bloqueio
//    administrativo, nada no TiTa, cadeira sem alocação);
//  • sessão de quem não está no mapa de salas vira "fora do mapa";
//  • unidade terceirizada fica fora do total da rede.

import { describe, expect, it } from "vitest"
import { calcularOcupacaoClinica, comProfissional, fechamentosDaSemana, feriadoDoTurno, pctAproveitamento, pessoasParaAjustarNoMapa, totalDaRede, SITUACOES_CADEIRA } from "./ocupacaoClinica"
import { calcularOcupacaoDaSala, calcularResumoUnidades } from "./salas"
import type { AgendaSalaRow, AlocacaoSala, Sala } from "./salasTypes"

function sala(over: Partial<Sala> = {}): Sala {
  return {
    id: "s8",
    unidade_nome: "Realengo",
    nucleo: null,
    andar: null,
    numero_sala: "8",
    nome_exibicao: "Sala 8",
    capacidade: "duplo",
    status: "operacional",
    sala_nome_referencia: null,
    observacoes: null,
    dias_disponiveis: [{ dow: 1, turnos: ["Manhã"] }],
    horarios_customizados: {},
    created_at: "",
    updated_at: "",
    ...over,
  }
}

function alocacao(over: Partial<AlocacaoSala> = {}): AlocacaoSala {
  return {
    id: "a1",
    sala_id: "s8",
    dow: 1,
    turno: "Manhã",
    profissional_nome: "Ana Lima",
    profissional_id: 10,
    terapia_nome: "Fonoaudiologia",
    terapia_id: 1,
    created_at: "",
    updated_at: "",
    ...over,
  }
}

function linha(over: Partial<AgendaSalaRow> = {}): AgendaSalaRow {
  return {
    tita_agendamento_id: 1,
    paciente_id: 100,
    paciente_nome: "Paciente",
    convenio_nome: null,
    unidade_nome: null,
    sala_nome: "Unid. Realengo - Sala 8",
    profissional_nome: "Ana Lima",
    profissional_id: 10,
    terapia_id: 1,
    terapia_nome: "Fonoaudiologia",
    terapia_exibicao_id: null,
    terapia_exibicao_nome: null,
    dia_semana: "Segunda-feira",
    hora_inicial: "08:00",
    hora_final: "08:40",
    status_agendamento: "Agendado",
    data: "2026-11-02",
    ...over,
  }
}

// Sala Dupla, só segunda de manhã: 6 horários × 2 cadeiras = 12 horários de
// cadeira. Ana ocupa a cadeira 1; a cadeira 2 fica vazia.
const SALAS = [sala()]
const ALOCACOES = [alocacao()]
const LINHAS: AgendaSalaRow[] = [
  linha(),                                                                                        // 08:00 paciente
  linha({ tita_agendamento_id: null, paciente_id: null, status_agendamento: "Livre", hora_inicial: "08:40", hora_final: "09:20" }), // 08:40 aberta
  linha({ tita_agendamento_id: 2, paciente_id: 101, profissional_nome: "Bia Souza", profissional_id: 20, hora_inicial: "10:00" }),   // Bia sem sala → fora do mapa
]
const ADMIN: AgendaSalaRow[] = [
  linha({ tita_agendamento_id: 3, paciente_nome: "Horário Administrativo", hora_inicial: "09:20", hora_final: "10:00" }),           // 09:20 administrativo
]

function calcular(salas = SALAS, alocacoes = ALOCACOES, linhas = LINHAS, admin = ADMIN, fechamentos: Parameters<typeof calcularOcupacaoClinica>[3] = []) {
  const itens = salas.map(s => calcularOcupacaoDaSala(s, alocacoes, linhas))
  return calcularOcupacaoClinica(itens, linhas, admin, fechamentos)
}

describe("calcularOcupacaoClinica", () => {
  it("classifica cada horário de cadeira em uma situação só", () => {
    const [u] = calcular()
    expect(u.unidade).toBe("Realengo")
    expect(u.contagem).toEqual({ total: 12, paciente: 1, aberta: 1, administrativo: 1, regularizar: 3, vazia: 6 })
    expect(comProfissional(u.contagem)).toBe(6)
    expect(pctAproveitamento(u.contagem)).toBeCloseTo(1 / 6)
  })

  it("as cinco situações somam o total em todo recorte", () => {
    const [u] = calcular()
    const recortes = [u.contagem, ...Object.values(u.porTurno), ...Object.values(u.porDiaTurno), ...u.porSala.map(s => s.contagem)]
    recortes.forEach(c => {
      expect(SITUACOES_CADEIRA.reduce((s, k) => s + c[k], 0)).toBe(c.total)
    })
    expect(u.porTurno["Tarde"].total).toBe(0)
    expect(u.porDiaTurno["1|Manhã"].total).toBe(12)
    expect(u.dias).toEqual([1])
  })

  it("'com paciente' é o mesmo número da Ocupação real (blocosPreenchidos)", () => {
    const [u] = calcular()
    const [antigo] = calcularResumoUnidades(SALAS, ALOCACOES, LINHAS)
    expect(u.contagem.paciente).toBe(antigo.blocosPreenchidos)
    expect(u.contagem.total).toBe(antigo.blocosTotal)
  })

  it("lista quem está em cada pendência, com terapia e sala", () => {
    const [u] = calcular()
    expect(u.pendencias.aberta).toEqual([{ profissional: "Ana Lima", terapia: "Fonoaudiologia", horarios: 1, salas: ["Sala 8"], turnos: ["Seg · Manhã"] }])
    expect(u.pendencias.administrativo[0].horarios).toBe(1)
    // Ana atende no turno (paciente às 08:00): as 3 vagas sem nada são "parte do turno", não reserva parada.
    expect(u.pendencias.regularizar.foraDoHorario[0].horarios).toBe(3)
    expect(u.regularizarPorMotivo).toEqual({ semAgendaNoTurno: 0, foraDoHorario: 3 })
  })

  it("sessão de profissional sem reserva vira 'sem sala definida'", () => {
    const [u] = calcular()
    expect(u.semSalaDefinida.sessoes).toBe(1)
    expect(u.semSalaDefinida.profissionais[0].profissional).toBe("Bia Souza")
    expect(pessoasParaAjustarNoMapa(u)).toEqual({ semAgendaNoTurno: 0, semSalaDefinida: 1, total: 1 })
    expect(u.pacientes).toBe(2)
  })

  it("'Livre' em outra unidade não abre a cadeira desta", () => {
    const linhas = [linha({ status_agendamento: "Livre", sala_nome: "Unid. Padre Miguel - Sala 1", hora_inicial: "08:00", hora_final: "12:00" })]
    const [u] = calcular(SALAS, ALOCACOES, linhas, [])
    expect(u.contagem.aberta).toBe(0)
    expect(u.contagem.regularizar).toBe(6)
    // Nada no turno inteiro (o Livre é de outra unidade): reserva parada.
    expect(u.regularizarPorMotivo).toEqual({ semAgendaNoTurno: 6, foraDoHorario: 0 })
    expect(u.pendencias.regularizar.semAgendaNoTurno[0].turnos).toEqual(["Seg · Manhã"])
  })

  it("casa a agenda pelo nome quando a alocação não tem profissional_id", () => {
    const alocacoes = [alocacao({ profissional_id: null, profissional_nome: "ana  lima" })]
    const [u] = calcular(SALAS, alocacoes)
    expect(u.contagem.paciente).toBe(1)
    expect(u.contagem.aberta).toBe(1)
  })

  it("sala fora de operação não entra na conta, mas é contada por status", () => {
    const salas = [sala(), sala({ id: "s9", numero_sala: "9", nome_exibicao: "Sala 9", status: "adm" })]
    const [u] = calcular(salas)
    expect(u.contagem.total).toBe(12)
    expect(u.salasTotal).toBe(2)
    expect(u.salasOperacionais).toBe(1)
    expect(u.porStatus).toEqual({ adm: 1 })
    expect(u.atendimentosSimultaneos).toBe(2)
  })

  it("unidade terceirizada vai para o fim e fica fora do total da rede", () => {
    const salas = [sala(), sala({ id: "cg", unidade_nome: "Unidade Terceirizada - Campo Grande", numero_sala: "1", nome_exibicao: "Equoterapia", capacidade: "unico" })]
    const unidades = calcular(salas)
    expect(unidades.map(u => u.unidade)).toEqual(["Realengo", "Unidade Terceirizada - Campo Grande"])
    expect(unidades[1].terceirizada).toBe(true)
    const rede = totalDaRede(unidades)
    expect(rede.contagem.total).toBe(12)
    expect(rede.unidades).toBe(1)
  })

  it("feriado sai da conta: nem a vaga nem a sessão recorrente do dia contam", () => {
    const fech = fechamentosDaSemana([{ data: "2026-11-02", nome: "Finados", tipo: "integral", horario_inicio: "08:00", horario_fim: "17:40" }], "2026-11-02")
    expect(fech).toEqual([{ dow: 1, inicio: 0, fim: 1440, nome: "Finados" }])
    const [u] = calcular(SALAS, ALOCACOES, LINHAS, ADMIN, fech)
    expect(u.contagem.total).toBe(0)
    expect(u.semSalaDefinida.sessoes).toBe(0)
    expect(u.pacientes).toBe(0)
    expect(u.dias).toEqual([1])
    expect(feriadoDoTurno(fech, 1, "Manhã")).toBe("Finados")
    expect(feriadoDoTurno(fech, 2, "Manhã")).toBeNull()
  })

  it("feriado parcial fecha só a janela informada", () => {
    const fech = fechamentosDaSemana([{ data: "2026-11-02", nome: "Ponto facultativo", tipo: "parcial", horario_inicio: "10:00", horario_fim: "17:40" }], "2026-11-02")
    const [u] = calcular(SALAS, ALOCACOES, LINHAS, ADMIN, fech)
    // Manhã: 08:00, 08:40, 09:20 abertos (3 horários × 2 vagas); 10:00 em diante fechado — e a sessão da Bia (10:00) também.
    expect(u.contagem.total).toBe(6)
    expect(u.contagem.paciente).toBe(1)
    expect(u.semSalaDefinida.sessoes).toBe(0)
    expect(feriadoDoTurno(fech, 1, "Manhã")).toBeNull()
    expect(feriadoDoTurno(fech, 1, "Tarde")).toBe("Ponto facultativo")
  })

  it("feriado fora da semana (domingo ou outra semana) é ignorado", () => {
    const fech = fechamentosDaSemana([
      { data: "2026-11-08", nome: "Domingo", tipo: "integral", horario_inicio: "08:00", horario_fim: "17:40" },
      { data: "2026-11-20", nome: "Consciência Negra", tipo: "integral", horario_inicio: "08:00", horario_fim: "17:40" },
    ], "2026-11-02")
    expect(fech).toEqual([])
  })
})
