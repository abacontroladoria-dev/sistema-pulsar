import { describe, expect, it } from "vitest"
import {
  FILTRO_INICIAL,
  alertasDeRegistro,
  concluidosEEncerrados,
  filtrarPacientes,
  fmtDataHora,
  fmtDiaMes,
  linksDoPaciente,
  opcoesFiltro,
  porSetor,
  raias,
  type EtapaAtual,
  type PacienteEntrada,
} from "./entradaConvenio"
import { extrairJson, validarDados } from "../../../supabase/functions/painel-entrada-convenio/forma"

// Dados SINTÉTICOS. O painel.json do pacote de implantação não entra no
// repositório (público): mesmo com iniciais, ele traz alertas operacionais reais.

function paciente(nome: string, extra: Partial<PacienteEntrada> = {}, atual?: Partial<EtapaAtual>): PacienteEntrada {
  return {
    paciente: nome,
    convenio: "Leve",
    tipo: "ABA",
    rota: "Família",
    entrada: "2026-10-01",
    aberto: "2026-10-01",
    links: null,
    alertas: [],
    encerrado: null,
    inicio: null,
    inicio_previsto: null,
    apresentacao: null,
    situacao: "em andamento",
    atual: { etapa: "E1", nome: "Elegibilidade", setor: "Autorização", prazo: 1, dias: 0, status: "no prazo", ...atual },
    historico: [],
    total_uteis: null,
    dias_desde_entrada: 3,
    ...extra,
  }
}

const PACS: PacienteEntrada[] = [
  paciente("Ana Teste Um", {}, { dias: 1, status: "vence hoje" }),
  paciente("Bruno Teste Dois", { convenio: "FUSEx" }, { etapa: "E2", nome: "Agendar entrevista", setor: "Comercial", dias: 4, status: "atrasado" }),
  paciente("Carla Teste Três", {}, { etapa: "E2", nome: "Agendar entrevista", setor: "Comercial", dias: 2, status: "atrasado" }),
  paciente("Davi Teste Quatro", {}, { etapa: "E5", nome: "Apresentar e aprovar", setor: "Cronograma", prazo: 1, dias: 0 }),
  paciente("Eva Teste Cinco", { situacao: "concluído", atual: null, inicio: "2026-10-05", total_uteis: 12, alertas: ["sem data de aprovação"] }),
  paciente("Fábio Teste Seis", { situacao: "concluído", atual: null, inicio: "2026-10-08", entrada: "2026-09-20" }),
  paciente("Gil Teste Sete", { situacao: "encerrado", atual: null, encerrado: { data: "2026-10-02", motivo: "desistência" }, alertas: ["ignorar"] }),
]

describe("recortes do painel", () => {
  it("lista só em andamento, atrasados primeiro e quem mais passou do prazo antes", () => {
    const nomes = filtrarPacientes(PACS, FILTRO_INICIAL).map(p => p.paciente)
    expect(nomes).toEqual(["Bruno Teste Dois", "Carla Teste Três", "Ana Teste Um", "Davi Teste Quatro"])
  })

  it("filtra por setor, situação e convênio", () => {
    expect(filtrarPacientes(PACS, { ...FILTRO_INICIAL, setor: "Comercial" })).toHaveLength(2)
    expect(filtrarPacientes(PACS, { ...FILTRO_INICIAL, status: "vence hoje" }).map(p => p.paciente)).toEqual(["Ana Teste Um"])
    expect(filtrarPacientes(PACS, { ...FILTRO_INICIAL, convenio: "FUSEx" }).map(p => p.paciente)).toEqual(["Bruno Teste Dois"])
  })

  it("opções de filtro vêm dos pacientes em andamento", () => {
    expect(opcoesFiltro(PACS)).toEqual({ setores: ["Autorização", "Comercial", "Cronograma"], convenios: ["FUSEx", "Leve"] })
  })

  it("agrupa por setor com mais atrasados primeiro", () => {
    const grupos = porSetor(PACS)
    expect(grupos[0].setor).toBe("Comercial")
    expect(grupos[0].atrasados.map(p => p.paciente)).toEqual(["Bruno Teste Dois", "Carla Teste Três"])
  })

  it("raias: etapa 5, etapa 7 e iniciados do mais recente", () => {
    const r = raias(PACS)
    expect(r.paraApresentar.map(p => p.paciente)).toEqual(["Davi Teste Quatro"])
    expect(r.aguardandoInicio).toEqual([])
    expect(r.iniciados.map(p => p.paciente)).toEqual(["Fábio Teste Seis", "Eva Teste Cinco"])
  })

  it("registro a corrigir ignora encerrados", () => {
    expect(alertasDeRegistro(PACS)).toEqual([{ paciente: "Eva Teste Cinco", alerta: "sem data de aprovação" }])
  })

  it("concluídos e encerrados, entrada mais recente primeiro", () => {
    expect(concluidosEEncerrados(PACS).map(p => p.paciente)).toEqual(["Eva Teste Cinco", "Gil Teste Sete", "Fábio Teste Seis"])
  })
})

describe("formatação", () => {
  it("data curta e '?' sem data", () => {
    expect(fmtDiaMes("2026-10-08")).toBe("08/10")
    expect(fmtDiaMes("?")).toBe("sem data")
    expect(fmtDiaMes(null)).toBe("sem data")
  })

  it("data e hora em Brasília", () => {
    expect(fmtDataHora("2026-10-09T10:52:00Z")).toBe("09/10 às 07:52")
  })

  it("links do ClickUp descartam o placeholder do exemplo", () => {
    const p = paciente("X", { links: { aut: "86abc", crm: "TASK_ID" } })
    expect(linksDoPaciente(p)).toEqual([{ chave: "aut", rotulo: "Autorização", url: "https://app.clickup.com/t/86abc" }])
  })
})

// ─── Forma aceita pela Edge Function ─────────────────────────────────────────

const ETAPAS = ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"].map((etapa, i) => ({
  etapa, nome: `Etapa ${i}`, setor: "x", prazo: i === 0 ? 0 : 1, n: 0, mediana: null, pct_no_prazo: null, em_aberto: 0,
}))
const DADOS = {
  gerado_em: "2026-10-09",
  versao_fluxo: 4,
  resumo: { em_andamento: 1 },
  setores: {},
  etapas: ETAPAS,
  pacientes: [paciente("Ana Teste Um")],
}

describe("extrairJson / validarDados", () => {
  it("lê o bloco ```json da página e aceita {dados: …}", () => {
    const md = `Painel\n\n\`\`\`json\n${JSON.stringify({ dados: DADOS })}\n\`\`\`\n`
    expect(validarDados(extrairJson(md)).gerado_em).toBe("2026-10-09")
  })

  it("aceita a página sendo só o JSON e desfaz escape de _ do Markdown", () => {
    const escapado = JSON.stringify(DADOS).replace(/_/g, "\\_")
    expect(validarDados(extrairJson(escapado)).versao_fluxo).toBe(4)
  })

  it("recusa versão de fluxo diferente", () => {
    expect(() => validarDados({ ...DADOS, versao_fluxo: 5 })).toThrow(/versao_fluxo/)
  })

  it("recusa etapas faltando ou fora de ordem", () => {
    expect(() => validarDados({ ...DADOS, etapas: ETAPAS.slice(1) })).toThrow(/8 itens/)
    expect(() => validarDados({ ...DADOS, etapas: [...ETAPAS].reverse() })).toThrow(/esperado E0/)
  })

  it("recusa paciente em andamento sem etapa atual", () => {
    expect(() => validarDados({ ...DADOS, pacientes: [paciente("Y", { atual: null })] })).toThrow(/sem etapa atual/)
  })

  it("página sem JSON vira erro legível", () => {
    expect(() => extrairJson("só texto")).toThrow(/bloco JSON/)
  })
})
