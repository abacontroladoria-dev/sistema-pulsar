// Rótulos de execução do TiTa: as duas gerações de Justificativa têm de dar a
// MESMA resposta, e uma terceira geração desconhecida tem de AVISAR em vez de
// ser adivinhada.
//
// Até 21/08/2026 uma sessão que não aconteceu chegava como Status 'Cancelado'
// + Justificativa 'Falta do Paciente' / 'Falta do Profissional' / 'Falta de
// Ambos'. De 24/08/2026 em diante o TiTa passou a usar 'Não realizado —
// paciente' / '— prestador' / '— clínica' NA MESMA COLUNA — confirmado pelo
// usuário em 25/08/2026 contra captura de tela da própria TiTa: `Status`
// PERMANECE 'Cancelado' para sempre, quem muda é só `Justificativa`. (Uma
// primeira versão desta correção, mais cedo no mesmo dia, havia suposto o
// contrário — que o rótulo novo apareceria em `Status` — e foi corrigida
// aqui.) A base histórica não foi reescrita, então as duas gerações de
// Justificativa convivem para sempre — e o teste guarda justamente isso.
//
// O que está em jogo em `Status`/`isCancelado` é dinheiro: é o que impede
// diária, ETA e PA de sessão que não ocorreu (ver calculo.ts) — mas como
// `Status` nunca varia, esse risco é hipotético, mantido por tolerância. O que
// está em jogo em `Justificativa`/`motivoNaoRealizado` é só a coluna de
// exibição "Presença TiTa" — sem dinheiro envolvido, mas errar quem faltou é
// grave do mesmo jeito.
//
// Roda no `npm test` (vitest), a partir de `frontend/`:
//
//   npx vitest run lib/remuneracao/rotulosExecucao.test.ts
//
// vitest, e não o runner nativo do Node de composicaoRP.test.ts: é o que o
// `npm test` do package.json executa, e teste que não entra na suíte padrão é
// teste que ninguém roda.

import { test } from "vitest"
import assert from "node:assert/strict"

import {
  classificarStatusExecucao, isCancelado, isFaltaDoPaciente,
  motivoNaoRealizado, rotulosDeExecucaoDesconhecidos, veredictoRotuloDesconhecido,
  justificativaDesconhecida, avisoJustificativaDesconhecida,
} from "./rotulosExecucao"
import { normalizarGradeParaSessao, type CsvGradeRow } from "./relatorio"

// Este arquivo importa só módulos PUROS (rotulosExecucao.ts, relatorio.ts) — de
// propósito, e não por acaso. gradeRemuneracao.ts (onde `avaliarCoberturaGrade`
// de fato mora) importa @/lib/grade/fonte para falar com o Supabase, e este
// projeto não tem um vitest.config.ts que resolva o alias "@/…" para os
// testes. As guardas de vocabulário foram por isso desenhadas para viver aqui
// como funções puras (`veredictoRotuloDesconhecido`,
// `avisoJustificativaDesconhecida`) — gradeRemuneracao.ts só as chama; é delas
// que este arquivo testa a decisão.

// ─── Vocabulário de `Status` ─────────────────────────────────────────────────

// O vocabulário de `Status` medido na tabela em 24/08/2026 (187.079 linhas):
// só 4 rótulos mais vazio, e nenhuma variação além deles até hoje. As linhas
// com 'Não realizado' NÃO são um caso real confirmado em `Status` — são
// tolerância: `classificarStatusExecucao` aceita essa variação onde quer que
// apareça, mesmo sem precedente ali, porque não custa nada aceitar.
const VOCABULARIO: Array<[string, ReturnType<typeof classificarStatusExecucao>]> = [
  ["Realizado", "realizado"],
  ["Cancelado", "nao_realizado"],
  ["Em Conflito", "conflito"],
  ["Planejado/Pendente", "pendente"],
  ["", "ausente"],
  // Hipotético — ver o comentário acima.
  ["Não realizado — paciente", "nao_realizado"],
  ["Não realizado — prestador", "nao_realizado"],
  ["Não realizado — clínica", "nao_realizado"],
  // Travessão trocado por hífen e acento perdido: variações plausíveis de
  // digitação/codificação que não mudam o significado.
  ["Nao realizado - paciente", "nao_realizado"],
  ["NÃO REALIZADO — CLÍNICA", "nao_realizado"],
]

test("classificarStatusExecucao cobre todo o vocabulário conhecido", () => {
  for (const [rotulo, esperado] of VOCABULARIO) {
    assert.equal(classificarStatusExecucao(rotulo), esperado, `rótulo: ${rotulo || "(vazio)"}`)
  }
  assert.equal(classificarStatusExecucao(null), "ausente")
  assert.equal(classificarStatusExecucao(undefined), "ausente")
})

test("'Não realizado' nunca é lido como 'Realizado'", () => {
  // A regressão mais cara possível neste arquivo: "realizado" é substring de
  // "não realizado", e trocar a ordem dos testes pagaria toda sessão que não
  // aconteceu.
  for (const rotulo of ["Não realizado — paciente", "Não realizado — prestador", "Não realizado — clínica"]) {
    assert.equal(classificarStatusExecucao(rotulo), "nao_realizado", rotulo)
    assert.equal(isCancelado(rotulo), true, rotulo)
  }
  assert.equal(isCancelado("Realizado"), false)
})

test("isCancelado só é verdadeiro para sessão que não aconteceu", () => {
  for (const [rotulo, esperado] of VOCABULARIO) {
    assert.equal(isCancelado(rotulo), esperado === "nao_realizado", `rótulo: ${rotulo || "(vazio)"}`)
  }
})

test("motivoNaoRealizado traduz as duas gerações para o mesmo motivo", () => {
  // Antigo: motivo na justificativa, status em 'Cancelado'.
  assert.equal(motivoNaoRealizado("Falta do Paciente", "Cancelado"), "paciente")
  assert.equal(motivoNaoRealizado("Falta do Profissional", "Cancelado"), "prestador")
  assert.equal(motivoNaoRealizado("Falta de Ambos", "Cancelado"), "ambos")

  // Novo: motivo no próprio status — e aceito também se vier na justificativa,
  // porque quem consome não sabe onde o TiTa vai colocá-lo.
  assert.equal(motivoNaoRealizado(null, "Não realizado — paciente"), "paciente")
  assert.equal(motivoNaoRealizado("Não realizado — paciente", null), "paciente")
  assert.equal(motivoNaoRealizado(null, "Não realizado — prestador"), "prestador")
  assert.equal(motivoNaoRealizado(null, "Não realizado — clínica"), "clinica")

  // Sessão que aconteceu não tem motivo; sessão que não aconteceu com motivo
  // ilegível é "outro" — e não null, que significaria "aconteceu".
  assert.equal(motivoNaoRealizado(null, "Realizado"), null)
  assert.equal(motivoNaoRealizado(null, null), null)
  assert.equal(motivoNaoRealizado("Motivo que ninguém previu", "Cancelado"), "outro")
})

test("isFaltaDoPaciente separa a falta do paciente das outras", () => {
  assert.equal(isFaltaDoPaciente("Falta do Paciente", "Cancelado"), true)
  assert.equal(isFaltaDoPaciente(null, "Não realizado — paciente"), true)

  assert.equal(isFaltaDoPaciente("Falta do Profissional", "Cancelado"), false)
  assert.equal(isFaltaDoPaciente("Falta de Ambos", "Cancelado"), false)
  assert.equal(isFaltaDoPaciente(null, "Não realizado — prestador"), false)
  assert.equal(isFaltaDoPaciente(null, "Não realizado — clínica"), false)
  assert.equal(isFaltaDoPaciente(null, null), false)
})

// ─── A rede para a PRÓXIMA mudança ───────────────────────────────────────────

test("rotulosDeExecucaoDesconhecidos acusa só o que é ilegível", () => {
  const conhecidos = VOCABULARIO.map(([rotulo]) => rotulo)
  assert.deepEqual(rotulosDeExecucaoDesconhecidos([...conhecidos, null, undefined]), [])

  // Texto original preservado (é o que se procura no TiTa) e sem repetição.
  assert.deepEqual(
    rotulosDeExecucaoDesconhecidos(["Realizado", "Sessão Suspensa", "Sessão Suspensa", "Reagendado"]),
    ["Sessão Suspensa", "Reagendado"],
  )
})

test("veredictoRotuloDesconhecido reprova só quando há rótulo ilegível", () => {
  assert.equal(veredictoRotuloDesconhecido({ rotulosDesconhecidos: [], linhasRotuloDesconhecido: 0 }), null)

  const veredicto = veredictoRotuloDesconhecido({
    rotulosDesconhecidos: ["Sessão Suspensa"],
    linhasRotuloDesconhecido: 7,
  })
  assert.ok(veredicto)
  assert.equal(veredicto.ok, false)
  assert.equal(veredicto.quantidade, 7)
  // O rótulo real aparece na mensagem: sem ele, quem lê não tem o que procurar
  // no TiTa nem o que informar ao time técnico.
  assert.ok(veredicto.erro.includes("Sessão Suspensa"), veredicto.erro)
  // E a mensagem não pode oferecer o CSV como saída — ele traz o mesmo rótulo.
  assert.ok(veredicto.dica.includes("o CSV"), veredicto.dica)
})

test("veredictoRotuloDesconhecido troca o texto por contexto, não a decisão", () => {
  const grade = { rotulosDesconhecidos: ["Sessão Suspensa"], linhasRotuloDesconhecido: 1 }
  const pagamento = veredictoRotuloDesconhecido(grade, "pagamento")
  const tratativas = veredictoRotuloDesconhecido(grade, "tratativas")
  assert.ok(pagamento && tratativas)
  assert.equal(pagamento.ok, false)
  assert.equal(tratativas.ok, false)
  assert.ok(pagamento.erro.includes("PA indevidos"), pagamento.erro)
  assert.ok(tratativas.erro.includes("adesão"), tratativas.erro)
})

// ─── A rede real: `Justificativa` desconhecida numa linha `Cancelado` ────────
//
// Esta é a mudança que de fato aconteceu em 24/08/2026. Diferente da rede
// acima (sobre `Status`), esta NUNCA reprova — vira aviso, porque
// `Justificativa` não decide pagamento (ver o cabeçalho do arquivo).

test("justificativaDesconhecida só se qualifica numa linha Cancelado com texto ilegível", () => {
  // Reconhecido — nas duas gerações — não conta como desconhecido.
  assert.equal(justificativaDesconhecida("Falta do Paciente", "Cancelado"), null)
  assert.equal(justificativaDesconhecida("Não realizado — prestador", "Cancelado"), null)

  // Sessão que aconteceu: texto solto em Justificativa não é sintoma de nada.
  assert.equal(justificativaDesconhecida("Qualquer coisa", "Realizado"), null)
  assert.equal(justificativaDesconhecida("Qualquer coisa", "Planejado/Pendente"), null)

  // Cancelado sem justificativa: vazio não é "desconhecido", é "não informado".
  assert.equal(justificativaDesconhecida("", "Cancelado"), null)
  assert.equal(justificativaDesconhecida(null, "Cancelado"), null)

  // O caso real: Cancelado + texto que não bate com nenhum dos 6 motivos.
  assert.equal(justificativaDesconhecida("Sessão remarcada por engano", "Cancelado"), "Sessão remarcada por engano")
})

test("avisoJustificativaDesconhecida nunca reprova — é só aviso", () => {
  assert.equal(avisoJustificativaDesconhecida(0, []), null)

  const aviso = avisoJustificativaDesconhecida(3, ["Sessão remarcada por engano"])
  assert.ok(aviso)
  assert.ok(aviso.includes("Sessão remarcada por engano"), aviso)
  // Precisa deixar claro que pagamento não é afetado — é a diferença de
  // severidade que justifica não bloquear o fechamento por causa disto.
  assert.ok(aviso.includes("não afeta o pagamento"), aviso)
})

// ─── Ponta a ponta, pela normalização da grade ───────────────────────────────

function linha(status: string, justificativa: string | null): CsvGradeRow {
  return {
    "ID Agendamento": "9001",
    "Status do Agendamento": "Agendado",
    "Data": "24/08/2026",
    "Hora Inicial": "08:00",
    "Profissional": "Fulano de Tal",
    "Nome Profissional Tratativa": "",
    "Nome Favorecido": "Paciente Teste Um",
    "Terapia": "Psicologia",
    "Possui Tratativa": "Não",
    "Status": status,
    "Justificativa": justificativa ?? "",
  }
}

test("sessão não realizada classifica como Cancelado com qualquer Justificativa", () => {
  const casos: [string, string | null][] = [
    // Real: Status sempre 'Cancelado', Justificativa carrega o motivo.
    ["Cancelado", "Falta do Paciente"],
    ["Cancelado", "Falta do Profissional"],
    ["Cancelado", "Falta de Ambos"],
    ["Cancelado", "Não realizado — paciente"],
    ["Cancelado", "Não realizado — prestador"],
    ["Cancelado", "Não realizado — clínica"],
    // Hipotético (Status variando) — mantido por tolerância, ver VOCABULARIO.
    ["Não realizado — paciente", null],
  ]
  for (const [status, just] of casos) {
    const [s] = normalizarGradeParaSessao([linha(status, just)])
    assert.equal(s.classificacao, "Cancelado", `${status} / ${just}`)
  }
})

test("sessão não realizada COM evolução vira inconsistência, não pagamento", () => {
  // "Cancelado evoluído" é o que segura a sessão para conferência manual. Se
  // 'Cancelado' fosse lido como "realizado" por algum motivo, ela cairia em
  // "Evolução normal" e seria paga direto — o caminho exato pelo qual o
  // dinheiro escaparia.
  const r = { ...linha("Cancelado", "Não realizado — clínica"), "Possui Tratativa": "Sim", "Nome Profissional Tratativa": "Fulano de Tal" }
  const [s] = normalizarGradeParaSessao([r])
  assert.equal(s.classificacao, "Cancelado evoluído")
})

test("presencaTita = Não só quando o paciente é quem faltou", () => {
  const naoCompareceu: [string, string | null][] = [
    ["Cancelado", "Falta do Paciente"],
    ["Cancelado", "Não realizado — paciente"],
  ]
  for (const [status, just] of naoCompareceu) {
    const [s] = normalizarGradeParaSessao([linha(status, just)])
    assert.equal(s.presencaTita, "Não", `${status} / ${just}`)
  }

  // Falta de prestador/clínica/ambos: o comportamento histórico é "Sim", e ele
  // é preservado de propósito — mexer nisso mudaria o que 593 linhas antigas
  // exibem, e é decisão de produto, não desta correção.
  const compareceu: [string, string | null][] = [
    ["Cancelado", "Falta do Profissional"],
    ["Cancelado", "Falta de Ambos"],
    ["Cancelado", "Não realizado — prestador"],
    ["Cancelado", "Não realizado — clínica"],
    ["Realizado", null],
  ]
  for (const [status, just] of compareceu) {
    const [s] = normalizarGradeParaSessao([linha(status, just)])
    assert.equal(s.presencaTita, "Sim", `${status} / ${just}`)
  }

  // Não aconteceu, motivo ilegível: "" (não sei), nunca "Sim". Dizer "Sim"
  // seria afirmar que o paciente compareceu a uma sessão sobre a qual a grade
  // não diz nada. Estado inexistente nas 187.079 linhas de hoje.
  const [indefinida] = normalizarGradeParaSessao([linha("Cancelado", "Motivo que ninguém previu")])
  assert.equal(indefinida.presencaTita, "")

  // Sem ID Agendamento não há sessão real: segue "" como sempre.
  const semId = { ...linha("Realizado", null), "ID Agendamento": "" }
  const [sem] = normalizarGradeParaSessao([semId])
  assert.equal(sem.presencaTita, "")
})
