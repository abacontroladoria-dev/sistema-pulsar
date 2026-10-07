// Agrupamento e vigência dos laudos do Órbita.
//
// Cada caso aqui é um jeito de a tela mentir SEM ERRO VISÍVEL — o mesmo critério
// dos testes de services/laudos/relatorio.ts. Nenhum deles aparece se a gente só
// "agrupar por ID Laudo e comparar datas".
//
// Roda com `npm test` (vitest), a partir de `frontend/`:
//   npx vitest run lib/laudos/acompanhamento.test.ts
//
// Módulo puro: nenhum mock, nenhuma rede, nenhum relógio — `hojeISO` é parâmetro.

import { test } from "vitest"
import assert from "node:assert/strict"
import {
  agruparLaudos,
  brParaIso,
  hojeBrasiliaISO,
  isoParaBr,
  juntarComAcompanhamento,
  situacaoPorValidade,
  type PacienteParaAcompanhamento,
  type RegistroAcompanhamentoBruto,
} from "./acompanhamento"
import type { LaudoRow } from "@/types/cronograma"

const HOJE = "2026-08-28"

/** Uma linha do relatório, com os 8 campos que a tela lê. */
function linha(over: Partial<Record<string, string>> = {}): LaudoRow {
  return {
    "ID Laudo": "477",
    "ID Favorecido": "11511",
    Paciente: "Adrian Araújo Nery",
    "Data laudo": "01/07/2026",
    Validade: "01/01/2027",
    Situação: "Vigente",
    "Autorizado em": "08/07/2026",
    Especialidade: "Arteterapia",
    ...over,
  } as unknown as LaudoRow
}

// ─── 1. O agrupamento ───────────────────────────────────────────────────────

test("1 · onze linhas de especialidade viram UM laudo", () => {
  // Caso real, medido: o laudo 499 tem 11 linhas — uma por especialidade. Sem
  // agrupar, a recepção veria 11 cartões do mesmo paciente e cobraria 11 vezes.
  const especialidades = [
    "Arteterapia", "Fisioterapia Aquática", "Fisioterapia Motora", "Fonoaudiologia",
    "Habilidades Sociais", "Musicoterapia", "Psicologia ABA", "Psicomotricidade",
    "Psicopedagogia", "Terapia Alimentar", "Terapia Ocupacional",
  ]
  const rows = especialidades.map((e) =>
    linha({ "ID Laudo": "499", Paciente: "Miguel Rodrigues De Queiroz", Especialidade: e }),
  )

  const { laudos } = agruparLaudos(rows, HOJE)

  assert.strictEqual(laudos.length, 1)
  assert.strictEqual(laudos[0].linhas, 11)
  assert.strictEqual(laudos[0].especialidades.length, 11)
  // Ordenadas em pt-BR, para o modal não listar em ordem de linha do Excel.
  assert.deepStrictEqual(laudos[0].especialidades, [...especialidades].sort((a, b) => a.localeCompare(b, "pt-BR")))
})

test("2 · dois ID Laudo distintos continuam dois laudos", () => {
  const { laudos } = agruparLaudos([linha({ "ID Laudo": "477" }), linha({ "ID Laudo": "499" })], HOJE)
  assert.strictEqual(laudos.length, 2)
})

test("3 · linha sem ID Laudo é descartada e CONTADA, não engolida", () => {
  // Sem a chave estável não há onde pendurar o acompanhamento. Inventar uma
  // chave (nome, posição da linha) faria o registro migrar de laudo na próxima
  // importação do robô — pior que perder a linha.
  const { laudos, descartadas } = agruparLaudos(
    [linha(), linha({ "ID Laudo": "" }), linha({ "ID Laudo": "  " })],
    HOJE,
  )
  assert.strictEqual(laudos.length, 1)
  assert.strictEqual(descartadas, 2)
})

test("4 · campo divergente entre linhas do mesmo laudo é DETECTADO", () => {
  // Medido em 28/08/2026: 0 casos em 343 laudos. O teste existe para o dia em
  // que houver — sem ele, a primeira linha do grupo viraria a verdade em
  // silêncio e a validade mostrada poderia não ser a do laudo.
  const { laudos } = agruparLaudos(
    [linha(), linha({ Especialidade: "Fonoaudiologia", Validade: "01/02/2027" })],
    HOJE,
  )
  assert.deepStrictEqual(laudos[0].camposDivergentes, ["Validade"])
})

test("5 · caso normal não acusa divergência nenhuma", () => {
  const { laudos } = agruparLaudos([linha(), linha({ Especialidade: "Fonoaudiologia" })], HOJE)
  assert.deepStrictEqual(laudos[0].camposDivergentes, [])
  assert.strictEqual(laudos[0].situacaoDivergente, false)
})

// ─── 2. Vigente × vencido ───────────────────────────────────────────────────

test("6 · vence NO dia da validade: validade == hoje é VIGENTE", () => {
  // É o que o Órbita faz — medido, 0 divergências em 343 laudos. Errar por um
  // dia colocaria na fila de cobrança quem ainda está coberto.
  assert.strictEqual(situacaoPorValidade("2026-08-28", HOJE), "vigente")
  assert.strictEqual(situacaoPorValidade("2026-08-27", HOJE), "vencido")
  assert.strictEqual(situacaoPorValidade("2026-08-29", HOJE), "vigente")
})

test("7 · sem validade não é vencido — é sem validade", () => {
  assert.strictEqual(situacaoPorValidade(null, HOJE), "sem_validade")
  const { laudos } = agruparLaudos([linha({ Validade: "" })], HOJE)
  assert.strictEqual(laudos[0].situacao, "sem_validade")
  // E não pode acusar divergência: não há o que comparar.
  assert.strictEqual(laudos[0].situacaoDivergente, false)
})

test("8 · Órbita discordando da validade vira aviso, não silêncio", () => {
  const { laudos } = agruparLaudos([linha({ Validade: "01/01/2020", Situação: "Vigente" })], HOJE)
  assert.strictEqual(laudos[0].situacao, "vencido")
  assert.strictEqual(laudos[0].situacaoOrbita, "Vigente")
  assert.strictEqual(laudos[0].situacaoDivergente, true)
})

test("9 · rótulo desconhecido do Órbita não inventa divergência", () => {
  // Mesma postura do rótulo "Não realizado" do TiTa: rótulo novo não reprova o
  // dado. O cálculo por validade continua valendo e a tela não grita à toa.
  const { laudos } = agruparLaudos([linha({ Situação: "Em análise" })], HOJE)
  assert.strictEqual(laudos[0].situacao, "vigente")
  assert.strictEqual(laudos[0].situacaoDivergente, false)
})

// ─── 3. Datas ───────────────────────────────────────────────────────────────

test("10 · DD/MM/AAAA vira ISO, e o inverso volta", () => {
  assert.strictEqual(brParaIso("01/07/2026"), "2026-07-01")
  assert.strictEqual(isoParaBr("2026-07-01"), "01/07/2026")
  assert.strictEqual(isoParaBr(null), "—")
})

test("11 · a conversão de data existe porque string BR ordena errado", () => {
  // "28/08/2026" < "01/01/2027" é FALSO como string ("2" > "0"). É por isso que
  // a fila é ordenada em ISO: em BR, o laudo mais vencido não fica no topo.
  assert.ok(!("28/08/2026" < "01/01/2027"))
  assert.ok(brParaIso("28/08/2026")! < brParaIso("01/01/2027")!)
})

test("12 · data ilegível ou impossível vira null, não lixo", () => {
  for (const ruim of ["", "  ", "2026-07-01", "1/7/2026", "31/13/2026", "00/07/2026", "texto"]) {
    assert.strictEqual(brParaIso(ruim), null, `deveria rejeitar: ${ruim}`)
  }
  // Propagar "2026-13-45" faria o filtro de período mentir sem erro nenhum.
  assert.strictEqual(brParaIso(undefined), null)
})

test("13 · hoje é o de BRASÍLIA, não o do servidor em UTC", () => {
  // O servidor do Next roda em UTC. Às 23h de 28/08 em Brasília já é 29/08 em
  // UTC — sem o fuso, a tela marcaria como vencido, por três horas todo dia, um
  // laudo que vence hoje.
  const noiteDeBrasilia = new Date("2026-08-29T02:30:00Z") // 23:30 de 28/08 em -03
  assert.strictEqual(hojeBrasiliaISO(noiteDeBrasilia), "2026-08-28")
  assert.strictEqual(hojeBrasiliaISO(new Date("2026-08-28T12:00:00Z")), "2026-08-28")
})

// ─── 4. Identidade ──────────────────────────────────────────────────────────

test("14 · ID Favorecido não numérico vira null em vez de NaN", () => {
  // `NaN` como chave de cruzamento casaria com nada e, pior, seria comparado
  // sem erro — o paciente simplesmente perderia foto e situação sem explicação.
  const { laudos } = agruparLaudos([linha({ "ID Favorecido": "n/d" })], HOJE)
  assert.strictEqual(laudos[0].idFavorecido, null)
  const ok = agruparLaudos([linha({ "ID Favorecido": "11511" })], HOJE)
  assert.strictEqual(ok.laudos[0].idFavorecido, 11511)
})

test("15 · variantes de grafia do cabeçalho continuam sendo lidas", () => {
  // As chaves vêm do `<th>` do Órbita e já mudaram de grafia ao longo do tempo
  // (é o motivo dos `??` espalhados pelos consumidores de LaudoRow).
  const { laudos } = agruparLaudos(
    [
      {
        "Id Laudo": "477",
        "Id Favorecido": "11511",
        Paciente: "Teste",
        Validade: "01/01/2027",
        "autorizado em": "08/07/2026",
      } as unknown as LaudoRow,
    ],
    HOJE,
  )
  assert.strictEqual(laudos[0].idLaudo, "477")
  assert.strictEqual(laudos[0].idFavorecido, 11511)
  assert.strictEqual(laudos[0].autorizadoEm, "2026-07-08")
})

test("16 · nome ausente não deixa o cartão sem identificação", () => {
  const { laudos } = agruparLaudos([linha({ Paciente: "" })], HOJE)
  assert.ok(laudos[0].pacienteNome.length > 0)
})

// ─── 5. A propriedade que sustenta a tabela do banco ────────────────────────

test("17 · o mesmo laudo em duas importações produz a MESMA chave", () => {
  // É a premissa de public.laudos_acompanhamento (id_laudo como PK). O robô
  // pode substituir o relatório inteiro; o que não pode é o registro da recepção
  // trocar de laudo. Aqui a "importação de amanhã" muda tudo o que é mutável —
  // ordem das linhas, especialidades, validade renovada, situação — e a chave
  // continua a mesma.
  const hoje = agruparLaudos(
    [linha({ Especialidade: "Arteterapia" }), linha({ Especialidade: "Fonoaudiologia" })],
    HOJE,
  )
  const amanha = agruparLaudos(
    [
      linha({ Especialidade: "Musicoterapia", Validade: "01/06/2027", Situação: "Vigente" }),
      linha({ Especialidade: "Arteterapia", Validade: "01/06/2027", Situação: "Vigente" }),
    ],
    "2026-08-29",
  )

  assert.strictEqual(hoje.laudos[0].idLaudo, amanha.laudos[0].idLaudo)
  // E o dado do laudo ACOMPANHA a nova importação: a chave é estável, o
  // conteúdo não é — é por isso que o snapshot é regravado a cada save.
  assert.notStrictEqual(hoje.laudos[0].validade, amanha.laudos[0].validade)
})

test("18 · a forma medida do relatório: 3 laudos, 1 por paciente", () => {
  // Espelha o que a sondagem de 28/08/2026 encontrou (343 laudos ↔ 343
  // favorecidos). Se um dia um favorecido aparecer com dois laudos, a tela
  // continua correta — mas a frase "o laudo do paciente X" deixa de valer, e
  // este teste é onde isso aparece.
  const rows = [
    linha({ "ID Laudo": "1", "ID Favorecido": "10", Especialidade: "A" }),
    linha({ "ID Laudo": "1", "ID Favorecido": "10", Especialidade: "B" }),
    linha({ "ID Laudo": "2", "ID Favorecido": "20" }),
    linha({ "ID Laudo": "3", "ID Favorecido": "30", Validade: "01/01/2020", Situação: "Vencido" }),
  ]
  const { laudos } = agruparLaudos(rows, HOJE)

  assert.strictEqual(laudos.length, 3)
  assert.strictEqual(new Set(laudos.map((l) => l.idFavorecido)).size, 3)
  assert.strictEqual(laudos.filter((l) => l.situacao === "vencido").length, 1)
})

// ─── 6. juntarComAcompanhamento — "avisado" pertence ao LAUDO ──────────────
//
// Cenário exato do usuário (28/08/2026): paciente 123 (ID Favorecido), laudo
// 111 avisado. Quando o paciente passa a ter um laudo DIFERENTE (222), o aviso
// do 111 não pode "seguir" o paciente — o 222 tem que nascer sem aviso.

function laudoAgrupado(over: Partial<LaudoAgrupadoTeste> = {}): LaudoAgrupadoTeste {
  return {
    idLaudo: "111",
    idFavorecido: 123,
    pacienteNome: "Paciente Teste",
    plano: "ASSIM Saúde",
    dataLaudo: "2026-07-01",
    validade: "2027-01-01",
    autorizadoEm: "2026-07-08",
    situacao: "vigente",
    situacaoOrbita: "Vigente",
    situacaoDivergente: false,
    especialidades: ["Psicologia ABA"],
    especialidadesQtd: [{ especialidade: "Psicologia ABA", qtdLaudo: "10", qtdAutorizada: "10" }],
    linhas: 1,
    camposDivergentes: [],
    ...over,
  }
}
// Só para o factory acima não precisar repetir o import de tipo por extenso.
type LaudoAgrupadoTeste = Parameters<typeof juntarComAcompanhamento>[0][number]

function paciente(over: Partial<PacienteParaAcompanhamento> = {}): PacienteParaAcompanhamento {
  return {
    id_paciente: 999,
    tita_paciente_id: 123,
    nome: "Paciente Teste",
    ativo: true,
    ficticio: false,
    foto_path: null,
    ...over,
  }
}

function registro(over: Partial<RegistroAcompanhamentoBruto> = {}): RegistroAcompanhamentoBruto {
  return {
    id_laudo: "111",
    mensagem_enviada_em: "2026-08-20",
    observacao: null,
    atualizado_por_nome: "Sanderson Rodrigues",
    atualizado_em_brasilia: "20/08/2026 10:00",
    ...over,
  }
}

test("32 · laudo 111 avisado, paciente 123 continua no 111: o aviso aparece", () => {
  const itens = juntarComAcompanhamento(
    [laudoAgrupado({ idLaudo: "111", idFavorecido: 123 })],
    [paciente({ tita_paciente_id: 123 })],
    [registro({ id_laudo: "111" })],
  )
  assert.strictEqual(itens.length, 1)
  assert.strictEqual(itens[0].idLaudo, "111")
  assert.strictEqual(itens[0].mensagemEnviadaEm, "2026-08-20")
})

test("33 · REGRA DO USUÁRIO: paciente 123 muda para o laudo 222 — volta a precisar de aviso", () => {
  // A LISTA agora traz "222" (é o que o Órbita exporta hoje para o paciente
  // 123); "111" não é mais um laudo ativo dele. O registro de acompanhamento
  // do "111" continua no banco (histórico), mas não casa com nada na lista.
  const itens = juntarComAcompanhamento(
    [laudoAgrupado({ idLaudo: "222", idFavorecido: 123 })],
    [paciente({ tita_paciente_id: 123 })],
    [registro({ id_laudo: "111" })], // aviso é do 111, não do 222
  )
  assert.strictEqual(itens.length, 1)
  assert.strictEqual(itens[0].idLaudo, "222")
  // A parte que não pode falhar: NÃO herda o aviso do 111.
  assert.strictEqual(itens[0].mensagemEnviadaEm, null)
  assert.strictEqual(itens[0].registradoPorNome, null)
})

test("34 · o mesmo paciente com DOIS laudos simultâneos (hipotético) não cruza um com o outro", () => {
  // Medido hoje: 0 casos de favorecido com 2 laudos (ver teste 18). Mas a
  // junção não pode depender dessa premissa para estar certa — o teste 33 já
  // prova que ela casa por id_laudo; este prova que, mesmo com dois laudos do
  // MESMO paciente ao mesmo tempo, cada um só recebe SEU PRÓPRIO registro.
  const itens = juntarComAcompanhamento(
    [
      laudoAgrupado({ idLaudo: "111", idFavorecido: 123 }),
      laudoAgrupado({ idLaudo: "222", idFavorecido: 123 }),
    ],
    [paciente({ tita_paciente_id: 123 })],
    [registro({ id_laudo: "111", mensagem_enviada_em: "2026-08-20" })],
  )
  const porId = new Map(itens.map((i) => [i.idLaudo, i]))
  assert.strictEqual(porId.get("111")?.mensagemEnviadaEm, "2026-08-20")
  assert.strictEqual(porId.get("222")?.mensagemEnviadaEm, null)
})

test("35 · sem cadastro no Pulsar, o laudo continua na lista — só sem enriquecimento", () => {
  const itens = juntarComAcompanhamento(
    [laudoAgrupado({ idLaudo: "111", idFavorecido: 999999 })],
    [], // nenhum paciente casa
    [registro({ id_laudo: "111" })],
  )
  assert.strictEqual(itens.length, 1)
  assert.strictEqual(itens[0].situacaoPaciente, "sem_cadastro")
  assert.strictEqual(itens[0].pacienteId, null)
  // O aviso é do LAUDO, não do cadastro — continua valendo mesmo sem paciente.
  assert.strictEqual(itens[0].mensagemEnviadaEm, "2026-08-20")
})

test("36 · fictício vem antes de ativo/inativo", () => {
  const itens = juntarComAcompanhamento(
    [laudoAgrupado({ idFavorecido: 123 })],
    [paciente({ tita_paciente_id: 123, ativo: true, ficticio: true })],
    [],
  )
  assert.strictEqual(itens[0].situacaoPaciente, "ficticio")
})

test("37 · nome do cadastro tem precedência; sem cadastro, cai no nome do Órbita", () => {
  const comCadastro = juntarComAcompanhamento(
    [laudoAgrupado({ idFavorecido: 123, pacienteNome: "Como Está No Órbita" })],
    [paciente({ tita_paciente_id: 123, nome: "Nome De Tratamento" })],
    [],
  )
  assert.strictEqual(comCadastro[0].nome, "Nome De Tratamento")

  const semCadastro = juntarComAcompanhamento(
    [laudoAgrupado({ idFavorecido: 123, pacienteNome: "Como Está No Órbita" })],
    [],
    [],
  )
  assert.strictEqual(semCadastro[0].nome, "Como Está No Órbita")
})

// ─── 7. Plano (convênio) e senhas ───────────────────────────────────────────

test("7 · o plano do Órbita chega ao item, e as senhas nascem nulas", () => {
  // O plano decide "Sem senha" (ASSIM) × "Outro convênio" no cartão; as senhas
  // só entram depois, por juntarComSenhas, quando há relatório importado.
  const { laudos } = agruparLaudos([linha({ Plano: "LEVE SAUDE" })], HOJE)
  assert.strictEqual(laudos[0].plano, "LEVE SAUDE")

  const [item] = juntarComAcompanhamento(laudos, [], [])
  assert.strictEqual(item.plano, "LEVE SAUDE")
  assert.strictEqual(item.senhas, null)
})

test("7 · laudo sem coluna Plano fica com plano vazio (vira Outro convênio, nunca Sem senha)", () => {
  const { laudos } = agruparLaudos([linha()], HOJE)
  assert.strictEqual(laudos[0].plano, "")
})

// ─── 8. Quantidades por especialidade (tabela do detalhe) ────────────────────

test("8 · cada especialidade leva Qtd laudo e Qtd autorizada, em ordem alfabética", () => {
  const rows = [
    linha({ Especialidade: "Terapia Ocupacional", "Qtd laudo": "4", "Qtd autorizada": "4" }),
    linha({ Especialidade: "Fisioterapia Aquática", "Qtd laudo": "3", "Qtd autorizada": "" }),
    linha({ Especialidade: "Fonoaudiologia", "Qtd laudo": "4", "Qtd autorizada": "3" }),
  ]
  const { laudos } = agruparLaudos(rows, HOJE)
  assert.deepStrictEqual(laudos[0].especialidadesQtd, [
    { especialidade: "Fisioterapia Aquática", qtdLaudo: "3", qtdAutorizada: "" },
    { especialidade: "Fonoaudiologia", qtdLaudo: "4", qtdAutorizada: "3" },
    { especialidade: "Terapia Ocupacional", qtdLaudo: "4", qtdAutorizada: "4" },
  ])

  const [item] = juntarComAcompanhamento(laudos, [], [])
  assert.strictEqual(item.especialidadesQtd.length, 3)
})

test("8 · especialidade repetida no laudo aparece uma vez só (vale a primeira linha)", () => {
  const rows = [
    linha({ Especialidade: "Musicoterapia", "Qtd laudo": "3", "Qtd autorizada": "3" }),
    linha({ Especialidade: "Musicoterapia", "Qtd laudo": "9", "Qtd autorizada": "9" }),
  ]
  const { laudos } = agruparLaudos(rows, HOJE)
  assert.deepStrictEqual(laudos[0].especialidadesQtd, [
    { especialidade: "Musicoterapia", qtdLaudo: "3", qtdAutorizada: "3" },
  ])
})
