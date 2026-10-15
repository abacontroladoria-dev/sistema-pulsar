import { describe, expect, it } from "vitest"
import {
  casarLocal, classificarDisponibilidade, herdarCapacidade, janelaGradeTita, montarDaGradeTita, type LinhaGradeTita,
} from "./disponibilidadeDaGradeTita"
import { faixasParaRpc, novaFaixa } from "./disponibilidadeProfissional"
import type { FaixaGravada, LocalDisponivel, VersaoDisponibilidade } from "@/types/disponibilidadeProfissional"

const local = (id: string, numero: string): LocalDisponivel => ({
  id, nome_exibicao: `Sala ${numero}`, unidade_nome: "Realengo", numero_sala: numero, capacidade: "unico",
  status: null, sala_nome_referencia: null, exclusividades: [],
})
const LOCAIS = [local("s19", "19"), local("s24", "24")]
const CATALOGO = [{ id: 5, nome: "ABA", ativo: true }, { id: 7, nome: "Fonoaudiologia", ativo: true }, { id: 9, nome: "Antiga", ativo: false }]
const JANELA = { de: "2026-10-19", ate: "2026-10-31" }

/** Linhas do TiTa: data, início, terapia, sala (40 min cada). */
function linhas(data: string, inicios: string[], terapia = "ABA", sala = "Unid. Realengo - Sala 19"): LinhaGradeTita[] {
  return inicios.map(i => {
    const [h, m] = i.split(":").map(Number)
    const fim = h * 60 + m + 40
    return {
      data, hora_inicial: `${i}:00`,
      hora_final: `${String(Math.floor(fim / 60)).padStart(2, "0")}:${String(fim % 60).padStart(2, "0")}:00`,
      terapia_nome: terapia, sala_nome: sala,
    }
  })
}

function versao(over: Partial<VersaoDisponibilidade>, faixas: FaixaGravada[]): VersaoDisponibilidade {
  return {
    id: "v1", profissional_id: 1, numero: 1, vigente_de: "2026-09-01", vigente_ate: null, dias_ativos: [1],
    origem: "preenchido_tita", restaurada_de: null, motivo: null, criado_por_nome: null, criado_em: "2026-09-01T10:00:00Z",
    substituida_em: null, substituida_por: null, situacao: "vigente", faixas, ...over,
  }
}
const gravada = (inicio: string, fim: string, localId = "s19", terapia = 5, capacidade = 1): FaixaGravada => ({
  id: `f${inicio}`, dia_semana: 1, hora_inicio: `${inicio}:00`, hora_fim: `${fim}:00`, duracao_min: 40, capacidade,
  intervalo_ativo: false, intervalo_inicio: null, intervalo_fim: null, local_id: localId, local_nome: "Sala", unidade_nome: "Realengo",
  ordem: 0, terapias: [{ terapia_id: terapia, terapia_nome: "ABA" }],
})

const classificar = (over: Partial<Parameters<typeof classificarDisponibilidade>[0]>) => classificarDisponibilidade({
  profissionalId: 1, nome: "Pauline", linhas: [], versoes: [], vigenteDe: "2026-10-16", janela: JANELA,
  habilitadas: new Set([5]), catalogo: CATALOGO, locais: LOCAIS, ...over,
})

describe("janelaGradeTita", () => {
  it("semana que vem e a seguinte, de segunda a sábado", () => {
    expect(janelaGradeTita("2026-10-15")).toEqual({ de: "2026-10-19", ate: "2026-10-31" }) // quinta
    expect(janelaGradeTita("2026-10-19")).toEqual({ de: "2026-10-26", ate: "2026-11-07" }) // segunda: a próxima
  })
})

describe("casarLocal", () => {
  it("unidade + número; sem casamento = null", () => {
    expect(casarLocal("Unid. Realengo - Sala 019", LOCAIS)).toBe("s19")
    expect(casarLocal("AT Externo Escola", LOCAIS)).toBeNull()
  })
})

describe("montarDaGradeTita", () => {
  it("soma as duas semanas: horário que só aparece numa semana não some", () => {
    const m = montarDaGradeTita([
      ...linhas("2026-10-19", ["08:00", "08:40"]), // seg, semana 1 (o 09:20 caiu num feriado)
      ...linhas("2026-10-26", ["08:00", "08:40", "09:20"]), // seg, semana 2
    ], CATALOGO, LOCAIS)
    expect(m.rascunho.diasAtivos).toEqual([1])
    expect(m.rascunho.faixas.map(f => [f.inicio, f.fim, f.localId, f.terapias])).toEqual([["08:00", "10:00", "s19", [5]]])
  })
  it("terapia inativa ou fora do catálogo não entra e é listada", () => {
    const m = montarDaGradeTita(linhas("2026-10-19", ["08:00"], "ABA, Antiga, Musicoterapia"), CATALOGO, LOCAIS)
    expect(m.rascunho.faixas[0].terapias).toEqual([5])
    expect(m.foraDoCatalogo.sort()).toEqual(["Antiga", "Musicoterapia"])
  })
})

describe("herdarCapacidade", () => {
  it("faixa em grupo da versão atual mantém os pacientes por horário", () => {
    const novo = { diasAtivos: [1], faixas: [novaFaixa(1, { inicio: "08:00", fim: "10:00", intervaloAtivo: false, localId: "s19", terapias: [5] })] }
    const atual = { diasAtivos: [1], faixas: [novaFaixa(1, { inicio: "08:00", fim: "12:00", capacidade: 3, intervaloAtivo: false, localId: "s19" })] }
    expect(herdarCapacidade(novo, atual).faixas[0].capacidade).toBe(3)
    expect(herdarCapacidade(novo, null).faixas[0].capacidade).toBe(1)
  })
})

describe("classificarDisponibilidade", () => {
  const manha = linhas("2026-10-19", ["08:00", "08:40", "09:20"]) // 08:00–10:00

  it("sem horários no TiTa: não mexe", () => {
    expect(classificar({}).tipo).toBe("sem_grade")
  })

  it("novo: sem versão; payload pronto para a RPC e terapia a habilitar", () => {
    const i = classificar({ linhas: linhas("2026-10-19", ["08:00"], "Fonoaudiologia"), habilitadas: new Set() })
    expect(i.tipo).toBe("novo")
    expect(i.payload?.habilitar).toEqual([7])
    expect(i.payload?.dias).toEqual([1])
    expect(i.etiquetas).toContain("Habilita Fonoaudiologia")
    expect(i.mudancas?.[0].campo).toBe("Seg")
  })

  it("igual: a versão vigente já bate com o TiTa", () => {
    const v = versao({}, [gravada("08:00", "10:00")])
    const i = classificar({ linhas: manha, versoes: [v] })
    expect(i.tipo).toBe("igual")
    expect(i.payload).toBeUndefined()
  })

  it("alterado: TiTa prevalece sobre a versão editada no Pulsar, com de→para por dia", () => {
    const v = versao({ origem: "manual" }, [gravada("08:00", "12:00")])
    const i = classificar({ linhas: manha, versoes: [v] })
    expect(i.tipo).toBe("alterado")
    expect(i.etiquetas?.[0]).toMatch(/editada no Pulsar/)
    expect(i.mudancas?.[0]).toMatchObject({ campo: "Seg" })
    expect(i.mudancas?.[0].de).toMatch(/^08:00–12:00/)
    expect(i.mudancas?.[0].para).toMatch(/^08:00–10:00/)
  })

  it("alterado quando há versão agendada mais à frente (ela seria substituída)", () => {
    const v = versao({}, [gravada("08:00", "10:00")])
    const futura = versao({ id: "v2", numero: 2, vigente_de: "2026-11-01", situacao: "agendada" }, [gravada("08:00", "09:20")])
    const i = classificar({ linhas: manha, versoes: [{ ...v, vigente_ate: "2026-10-31" }, futura] })
    expect(i.tipo).toBe("alterado")
    expect(i.etiquetas).toContain("Substitui a versão agendada para 01/11/2026")
  })

  it("versão substituída não conta", () => {
    const v = versao({ situacao: "substituida" }, [gravada("08:00", "10:00")])
    expect(classificar({ linhas: manha, versoes: [v] }).tipo).toBe("novo")
  })

  it("pendência: sala sem correspondência em Ocupação de Salas", () => {
    const i = classificar({ linhas: linhas("2026-10-19", ["08:00"], "ABA", "AT Externo Escola") })
    expect(i.tipo).toBe("pendencia")
    expect(i.mudancas?.[0].para).toMatch(/AT Externo Escola/)
    expect(i.payload).toBeUndefined()
  })

  it("pendência: horário só com terapia fora do catálogo", () => {
    const i = classificar({ linhas: linhas("2026-10-19", ["08:00"], "Musicoterapia") })
    expect(i.tipo).toBe("pendencia")
    expect(i.mudancas?.[0].para).toMatch(/Musicoterapia/)
  })

  it("o payload é o mesmo que o editor mandaria", () => {
    const i = classificar({ linhas: manha })
    const m = montarDaGradeTita(manha, CATALOGO, LOCAIS)
    expect(i.payload?.faixas).toEqual(faixasParaRpc(m.rascunho))
  })
})
