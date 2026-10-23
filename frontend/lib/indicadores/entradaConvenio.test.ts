import { describe, expect, it } from "vitest"
import {
  CANAL_CHAT_AUTORIZACAO,
  FILTRO_INICIAL,
  PRAZOS_PADRAO,
  aplicarPrazos,
  avisosPorPaciente,
  blocosPorSetor,
  caminhoDoPaciente,
  concluidosEEncerrados,
  conveniosEmAndamento,
  diasProjetadosE3,
  dispPedeAcao,
  emAndamento,
  envioDoLinkDisponibilidade,
  impactoDaAlteracao,
  mapaDePrazos,
  statusPorPrazo,
  fmtDataHora,
  fmtDiaMes,
  frescor,
  hojeBrasilia,
  idFormulario,
  jaIniciaram,
  linkDaEtapa,
  linksDoPaciente,
  manchete,
  proximaAcao,
  slugSetor,
  textoPrazo,
  textosDosAlertas,
  type DadosPainel,
  type DisponibilidadePainel,
  type EtapaAtual,
  type EtapaHistorico,
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
  paciente("Hugo Teste Oito", {}, {
    etapa: "E3", nome: "Entrevista / avaliação", setor: "Terapêutico", prazo: 5, dias: 1, status: "atrasado",
    obs: "Entrevista marcada para 19/10 (6 d.u. após agendar)",
  }),
  paciente("Íris Teste Nove", { alertas: ["CRM desatualizado", { texto: "já resolvido", resolvido: true }] }, {
    etapa: "E2", nome: "Agendar entrevista", setor: "Família", dias: 3, status: "atrasado", pendencia: "Família recusa a unidade",
  }),
]

describe("prazo e ação em linguagem de gente", () => {
  it("atrasado diz quantos dias além do prazo", () => {
    expect(textoPrazo({ status: "atrasado", dias: 6, prazo: 1 }).texto).toBe("5 dias além do prazo")
    expect(textoPrazo({ status: "atrasado", dias: 2, prazo: 1 }).texto).toBe("1 dia além do prazo")
    expect(textoPrazo({ status: "atrasado", dias: 6, prazo: 1 }).tom).toBe("red")
  })

  it("atrasado dentro do prazo (data já marcada depois) vira 'Vai passar do prazo'", () => {
    const t = textoPrazo({ status: "atrasado", dias: 1, prazo: 5 })
    expect(t.texto).toBe("Vai passar do prazo")
    expect(t.dica).toMatch(/data já marcada/)
  })

  it("vence hoje, faltam N dias, sem dado e fora de ordem", () => {
    expect(textoPrazo({ status: "vence hoje", dias: 1, prazo: 1 }).texto).toBe("Vence hoje")
    expect(textoPrazo({ status: "no prazo", dias: 3, prazo: 5 }).texto).toBe("Faltam 2 dias")
    expect(textoPrazo({ status: "no prazo", dias: 4, prazo: 5 }).texto).toBe("Falta 1 dia")
    expect(textoPrazo({ status: "no prazo", dias: null, prazo: 5 }).texto).toBe("No prazo")
    expect(textoPrazo({ status: "sem dado", dias: null, prazo: 1 }).texto).toBe("Sem data no ClickUp")
    expect(textoPrazo({ status: "fora de ordem", dias: 2, prazo: 1 }).tom).toBe("purple")
  })

  it("próxima ação com verbo; pendência vira 'travado'; Neuro faz avaliação", () => {
    const [bruno] = emAndamento([PACS[1]])
    expect(proximaAcao(bruno)).toEqual({ texto: "Agendar a entrevista com a família", travado: false })
    const [iris] = emAndamento([PACS[8]])
    expect(proximaAcao(iris)).toEqual({ texto: "Família recusa a unidade", travado: true })
    const [neuro] = emAndamento([paciente("N", { tipo: "Neuro" }, { etapa: "E3", setor: "Terapêutico" })])
    expect(proximaAcao(neuro).texto).toBe("Fazer a avaliação")
    const [estranho] = emAndamento([paciente("X", {}, { etapa: "E9", nome: "Etapa nova" })])
    expect(proximaAcao(estranho).texto).toBe("Etapa nova")
  })

  it("link da etapa abre a tarefa certa, cai no primeiro link válido ou no chat de autorização", () => {
    const links = { aut: "a1", crm: "c1", crono: "k1" }
    expect(linkDaEtapa(paciente("X", { links }, { etapa: "E2" })).id).toBe("c1")
    expect(linkDaEtapa(paciente("X", { links }, { etapa: "E7" })).id).toBe("k1")
    expect(linkDaEtapa(paciente("X", { links: { aut: "a1" } }, { etapa: "E4" })).id).toBe("a1")
    expect(linkDaEtapa(paciente("X", { links: null }))).toEqual(CANAL_CHAT_AUTORIZACAO)
    expect(linkDaEtapa(paciente("X", { links: {}, aberto: null }, { etapa: "E0", setor: "Gestão" }))).toEqual(CANAL_CHAT_AUTORIZACAO)
  })

  it("avisos de registro aceitam texto e objeto, sem os resolvidos", () => {
    expect(textosDosAlertas(PACS[8])).toEqual(["CRM desatualizado"])
  })

  it("link da disponibilidade só sai com cadastro único e CPF válido", () => {
    const d = (estado: DisponibilidadePainel["estado"]): DisponibilidadePainel =>
      ({ nome: "X", paciente_id: 1, estado, preenchida_em: null })
    expect(envioDoLinkDisponibilidade(d("nao_preenchida"))).toEqual({ pode: true, bloqueio: false, motivo: null })
    for (const estado of ["sem_cadastro", "sem_cpf", "nome_ambiguo"] as const) {
      expect(envioDoLinkDisponibilidade(d(estado))).toMatchObject({ pode: false, bloqueio: true })
    }
    expect(envioDoLinkDisponibilidade(d("sem_cpf")).motivo).toMatch(/CPF/)
    expect(envioDoLinkDisponibilidade(d("preenchida_familia"))).toMatchObject({ pode: false, bloqueio: false })
    expect(envioDoLinkDisponibilidade(undefined)).toMatchObject({ pode: false, bloqueio: true })
  })

  it("disponibilidade só pede ação nas etapas 2 a 4 e quando não foi preenchida", () => {
    const d = (estado: DisponibilidadePainel["estado"], casamento?: "inicio_do_nome"): DisponibilidadePainel =>
      ({ nome: "X", paciente_id: 1, estado, casamento, preenchida_em: null })
    expect(dispPedeAcao(d("nao_preenchida"), "E2")).toBe(true)
    expect(dispPedeAcao(d("nao_preenchida"), "E6")).toBe(false)
    expect(dispPedeAcao(d("preenchida_familia"), "E3")).toBe(false)
    expect(dispPedeAcao(d("preenchida_familia", "inicio_do_nome"), "E3")).toBe(true)
    expect(dispPedeAcao(undefined, "E2")).toBe(false)
  })
})

describe("blocos por setor e manchete", () => {
  it("um bloco por setor, mais atrasados primeiro, Família por último", () => {
    const blocos = blocosPorSetor(PACS)
    expect(blocos.map(b => b.setor)).toEqual(["Comercial", "Terapêutico", "Autorização", "Cronograma", "Família"])
    expect(blocos[0].atrasados.map(p => p.paciente)).toEqual(["Bruno Teste Dois", "Carla Teste Três"])
    expect(blocos[0].responsavel.pessoas).toBe("Jennifer G. e Aída R.")
    expect(blocos.at(-1)?.familia).toBe(true)
  })

  it("a soma dos blocos é o total em andamento", () => {
    const blocos = blocosPorSetor(PACS)
    const soma = blocos.reduce((s, b) => s + b.atrasados.length + b.venceHoje.length + b.demais.length, 0)
    expect(soma).toBe(emAndamento(PACS).length)
    expect(blocos.every(b => b.total === b.atrasados.length + b.venceHoje.length + b.demais.length)).toBe(true)
  })

  it("filtra por status e convênio", () => {
    expect(blocosPorSetor(PACS, { ...FILTRO_INICIAL, status: "vence hoje" }).map(b => b.setor)).toEqual(["Autorização"])
    const fusex = blocosPorSetor(PACS, { ...FILTRO_INICIAL, convenio: "FUSEx" })
    expect(fusex.flatMap(b => b.atrasados).map(p => p.paciente)).toEqual(["Bruno Teste Dois"])
    expect(conveniosEmAndamento(PACS)).toEqual(["FUSEx", "Leve"])
  })

  it("âncora do setor sem acento", () => {
    expect(slugSetor("Terapêutico")).toBe("terapeutico")
    expect(slugSetor("Autorização ou Comercial")).toBe("autorizacao-ou-comercial")
  })

  it("manchete cita no máximo 2 setores e não cobra a família", () => {
    const m = manchete(PACS)
    expect(m.titulo).toBe("4 de 6 pacientes estão fora do prazo.")
    expect(m.apoio).toBe("Mais atrasos em Comercial (2) e Terapêutico (1). 1 aguarda retorno da família.")
  })

  it("manchete sem atraso aponta o que vence hoje", () => {
    const m = manchete([PACS[0], PACS[3]])
    expect(m.titulo).toBe("Nenhum paciente fora do prazo.")
    expect(m.apoio).toBe("1 vence hoje: Autorização (1).")
    expect(manchete([PACS[4]]).titulo).toBe("Nenhum paciente em andamento.")
  })
})

describe("outros recortes", () => {
  it("avisos agrupados por paciente, atrasados primeiro, sem encerrados", () => {
    expect(avisosPorPaciente(PACS).map(x => x.paciente.paciente)).toEqual(["Íris Teste Nove", "Eva Teste Cinco"])
  })

  it("já iniciaram, do mais recente", () => {
    expect(jaIniciaram(PACS).map(p => p.paciente)).toEqual(["Fábio Teste Seis", "Eva Teste Cinco"])
  })

  it("concluídos e encerrados, entrada mais recente primeiro", () => {
    expect(concluidosEEncerrados(PACS).map(p => p.paciente)).toEqual(["Eva Teste Cinco", "Gil Teste Sete", "Fábio Teste Seis"])
  })
})

describe("caminho do paciente", () => {
  const ETAPAS_FLUXO = ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"].map((etapa, i) => ({ etapa, nome: `Etapa ${i}`, prazo: 1 }))
  const h = (etapa: string, status: EtapaAtual["status"], combinado = false) =>
    ({ etapa, nome: etapa, setor: "x", prazo: 1, dias: 1, status, fim: "2026-10-01", combinado })

  it("marca feito, feito fora do prazo, fechadas juntas, sem data, atual e a fazer", () => {
    const p = paciente("X", {
      historico: [h("E0", "vence hoje"), h("E1", "atrasado"), h("E2–E3", "no prazo", true)],
    }, { etapa: "E5", nome: "Apresentar", setor: "Cronograma" })
    const estados = caminhoDoPaciente(p, ETAPAS_FLUXO).map(s => s.estado)
    expect(estados).toEqual(["feito", "feito_atrasado", "feito", "feito", "feito_sem_data", "atual", "a_fazer", "a_fazer"])
    const passos = caminhoDoPaciente(p, ETAPAS_FLUXO)
    expect(passos[2].nota).toMatch(/fechada junto/)
    expect(passos[2].dias).toBeNull()
    expect(passos[3].dias).toBe(1)
  })

  it("concluído: tudo feito, mesmo sem histórico", () => {
    const estados = caminhoDoPaciente(PACS[4], ETAPAS_FLUXO).map(s => s.estado)
    expect(new Set(estados)).toEqual(new Set(["feito_sem_data"]))
  })
})

describe("id do formulário e frescor", () => {
  it("id do formulário vem de links.aut e ignora o placeholder", () => {
    expect(idFormulario(paciente("X", { links: { aut: " 868mepdn1 ", crm: "abc123" } }))).toBe("868mepdn1")
    expect(idFormulario(paciente("X", { links: { aut: "TASK_ID" } }))).toBeNull()
    expect(idFormulario(paciente("X", { links: { crm: "abc123" } }))).toBeNull()
    expect(idFormulario(paciente("X", { links: null }))).toBeNull()
  })

  it("selo do topo: 'Dados de hoje, hh:mm' e o detalhe técnico à parte", () => {
    const s = { gerado_em: "2026-10-15", publicado_em: "2026-10-15T12:03:11Z" }
    expect(frescor(s, "2026-10-15")).toEqual({ texto: "Dados de hoje, 09:03", detalhe: "Rodada de 15/10 · Doc gravado em 15/10 às 09:03" })
    expect(frescor(s, "2026-10-16").texto).toBe("Dados de 15/10, 09:03")
    // Doc regravado depois com uma rodada antiga: não mistura a hora de outro dia.
    expect(frescor({ gerado_em: "2026-10-09", publicado_em: "2026-10-15T12:03:11Z" }, "2026-10-15").texto).toBe("Dados de 09/10")
    expect(frescor({ gerado_em: "2026-10-09", publicado_em: null }, "2026-10-09").detalhe).toBe("Rodada de 09/10")
  })

  it("hoje no horário de Brasília", () => {
    expect(hojeBrasilia(new Date("2026-10-16T02:00:00Z"))).toBe("2026-10-15")
  })
})

describe("prazos do Pulsar sobre a rodada do calc", () => {
  const hist = (etapa: string, dias: number | null, status: EtapaAtual["status"], prazo = 1): EtapaHistorico =>
    ({ etapa, nome: etapa, setor: "x", prazo, dias, status, fim: "2026-10-01", combinado: etapa.includes("–") })
  const ETAPAS_RESUMO = Object.entries(PRAZOS_PADRAO).map(([etapa, prazo]) => ({
    etapa, nome: etapa, setor: "x", prazo, n: 0, mediana: null, pct_no_prazo: null, em_aberto: 0,
  }))
  const painel = (pacientes: PacienteEntrada[]): DadosPainel => ({
    gerado_em: "2026-10-09",
    versao_fluxo: 4,
    resumo: {
      em_andamento: 0, atrasados: 0, vence_hoje: 0, no_prazo: 0, novas_5du: 0, para_apresentar: 0, para_iniciar: 0,
      iniciados: 0, avaliacoes_feitas: 0, encerrados: 0, sem_formulario: 0, meta_total_uteis: 19, mediana_total_uteis: 13,
    },
    setores: {},
    etapas: ETAPAS_RESUMO,
    pacientes,
  })

  it("status_de do calc", () => {
    expect(statusPorPrazo(null, 1)).toBe("sem dado")
    expect(statusPorPrazo(2, 1)).toBe("atrasado")
    expect(statusPorPrazo(1, 1)).toBe("vence hoje")
    expect(statusPorPrazo(0, 1)).toBe("no prazo")
  })

  it("lê os dias projetados da entrevista marcada", () => {
    expect(diasProjetadosE3("Entrevista marcada para 19/10 (6 d.u. após agendar)")).toBe(6)
    expect(diasProjetadosE3("outra coisa")).toBeNull()
    expect(diasProjetadosE3(undefined)).toBeNull()
  })

  it("prazo novo muda o status da etapa atual e a meta", () => {
    const d = painel([paciente("A", {}, { etapa: "E1", dias: 2, status: "atrasado" })])
    const x = aplicarPrazos(d, { ...PRAZOS_PADRAO, E1: 2 })
    expect(x.pacientes[0].atual).toMatchObject({ prazo: 2, status: "vence hoje" })
    expect(x.resumo).toMatchObject({ atrasados: 0, vence_hoje: 1, meta_total_uteis: 20 })
    expect(x.setores).toEqual({ "Autorização": { total: 1, atrasados: 0 } })
  })

  it("etapas fechadas juntas somam os prazos do grupo", () => {
    const d = painel([paciente("A", { historico: [hist("E4–E5", 7, "atrasado", 6)] }, { etapa: "E6" })])
    const x = aplicarPrazos(d, { ...PRAZOS_PADRAO, E5: 2 })
    expect(x.pacientes[0].historico[0]).toMatchObject({ prazo: 7, status: "vence hoje" })
  })

  it("fora de ordem e a E6 da Leve com início previsto não dependem do prazo", () => {
    const d = painel([
      paciente("A", { historico: [hist("E2", -1, "fora de ordem")] }, { etapa: "E3", setor: "Terapêutico", dias: 0, prazo: 5 }),
      paciente("B", { convenio: "Leve", inicio_previsto: "2026-10-20", historico: [hist("E6", 3, "no prazo")] }, {
        etapa: "E6", dias: 4, status: "no prazo", obs: "Leve: pedir até 17/10 (início previsto 20/10)",
      }),
    ])
    const x = aplicarPrazos(d, { ...PRAZOS_PADRAO, E2: 0, E6: 0 })
    expect(x.pacientes[0].historico[0]).toMatchObject({ prazo: 0, status: "fora de ordem" })
    expect(x.pacientes[1].historico[0].status).toBe("no prazo")
    expect(x.pacientes[1].atual?.status).toBe("no prazo")
  })

  it("entrevista futura usa os dias projetados contra o prazo novo", () => {
    const d = painel([paciente("A", {}, {
      etapa: "E3", setor: "Terapêutico", prazo: 5, dias: 1, status: "atrasado",
      obs: "Entrevista marcada para 19/10 (6 d.u. após agendar)",
    })])
    expect(aplicarPrazos(d, { ...PRAZOS_PADRAO, E3: 6 }).pacientes[0].atual?.status).toBe("no prazo")
    expect(aplicarPrazos(d, PRAZOS_PADRAO).pacientes[0].atual?.status).toBe("atrasado")
  })

  it("régua: % no prazo recalculado com o arredondamento do Python", () => {
    const pacs = Array.from({ length: 8 }, (_, i) => paciente(`P${i}`, { historico: [hist("E1", i === 0 ? 1 : 2, "atrasado")] }))
    const x = aplicarPrazos(painel(pacs), PRAZOS_PADRAO)
    // 1 de 8 = 12,5% → 12 (round do Python), não 13.
    expect(x.etapas.find(e => e.etapa === "E1")).toMatchObject({ n: 8, pct_no_prazo: 12 })
  })

  it("prazos padrão não mudam nada e aplicar duas vezes dá o mesmo", () => {
    const d = painel([
      paciente("A", { historico: [hist("E0", 0, "vence hoje", 0)] }, { etapa: "E1", dias: 2, status: "atrasado" }),
    ])
    d.etapas = aplicarPrazos(d, PRAZOS_PADRAO).etapas
    d.resumo = { ...d.resumo, em_andamento: 1, atrasados: 1 }
    d.setores = { "Autorização": { total: 1, atrasados: 1 } }
    expect(aplicarPrazos(d, PRAZOS_PADRAO)).toEqual(d)
    expect(aplicarPrazos(aplicarPrazos(d, { ...PRAZOS_PADRAO, E1: 9 }), PRAZOS_PADRAO)).toEqual(d)
    expect(mapaDePrazos([{ etapa: "E1", prazo: 3 }])).toEqual({ E1: 3 })
  })

  it("impacto: contagens, % e quem mudou de situação", () => {
    const d = painel([
      paciente("A", { historico: [hist("E1", 2, "atrasado")] }, { etapa: "E2", setor: "Comercial", dias: 0 }),
      paciente("B", {}, { etapa: "E1", dias: 2, status: "atrasado" }),
    ])
    const imp = impactoDaAlteracao(d, PRAZOS_PADRAO, "E1", 2)
    expect(imp).toMatchObject({
      etapa: "E1", meta_antes: 19, meta_depois: 20, pct_no_prazo_antes: 0, pct_no_prazo_depois: 100,
      agora_antes: { atrasados: 1 }, agora_depois: { atrasados: 0, vence_hoje: 1 },
    })
    expect(imp.mudancas).toEqual([
      { paciente: "A", onde: "histórico", etapa: "E1", de: "atrasado", para: "vence hoje" },
      { paciente: "B", onde: "atual", etapa: "E1", de: "atrasado", para: "vence hoje" },
    ])
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

  it("links do ClickUp descartam o placeholder do exemplo e montam link de chat ou task", () => {
    const p = paciente("X", { links: { aut: "86abc", crm: "TASK_ID", chat: "8cj47gd-16071" } })
    expect(linksDoPaciente(p)).toEqual([
      { chave: "aut", rotulo: "Autorização", id: "86abc", url: "https://app.clickup.com/t/86abc" },
      { chave: "chat", rotulo: "Chat", id: "8cj47gd-16071", url: "https://app.clickup.com/9011600909/chat/r/8cj47gd-16071" },
    ])
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
