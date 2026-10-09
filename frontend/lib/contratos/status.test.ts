// Regras puras dos contratos do paciente.
//
//   npx vitest run lib/contratos/status.test.ts

import { test } from "vitest"
import assert from "node:assert/strict"
import {
  STATUS_CONTRATO,
  TRANSICOES,
  contratoAtualPorTipo,
  statusEfetivo,
  textoPrazo,
  transicaoPermitida,
  vencimentoSugerido,
  vigencia,
  type ContratoBase,
} from "./status"

test("vigência: limites do início, do vencimento e dos 30 dias", () => {
  assert.equal(vigencia("2026-10-10", "2027-10-09", "2026-10-09"), "nao_iniciado")
  assert.equal(vigencia("2026-10-10", "2027-10-09", "2026-10-10"), "vigente")
  // 30 dias antes do vencimento já é "a vencer"; 31, ainda vigente.
  assert.equal(vigencia("2026-01-01", "2026-11-08", "2026-10-08"), "vigente")
  assert.equal(vigencia("2026-01-01", "2026-11-07", "2026-10-08"), "a_vencer")
  // O dia do vencimento ainda vale.
  assert.equal(vigencia("2026-01-01", "2026-10-08", "2026-10-08"), "a_vencer")
  assert.equal(vigencia("2026-01-01", "2026-10-07", "2026-10-08"), "vencido")
})

test("vigência atravessa a virada do horário de verão sem errar o dia", () => {
  // diasEntre usa Date.UTC: nenhuma data local entra na conta.
  assert.equal(vigencia("2026-01-01", "2026-11-07", "2026-10-08"), "a_vencer")
  assert.equal(textoPrazo("2026-01-01", "2026-11-07", "2026-10-08"), "vence em 30 dias")
})

test("transição: nunca volta a rascunho, e assinado só sai por cancelamento", () => {
  for (const de of STATUS_CONTRATO) assert.equal(transicaoPermitida(de, "rascunho"), false, `${de} → rascunho`)
  assert.deepEqual([...TRANSICOES.assinado], ["cancelado"])
  assert.deepEqual([...TRANSICOES.cancelado], [])
  assert.equal(transicaoPermitida("rascunho", "assinado"), true)
  assert.equal(transicaoPermitida("recusado", "assinado"), false)
})

test("status efetivo: link vencido aparece como expirado antes do job gravar", () => {
  const agora = new Date("2026-10-08T15:00:00Z")
  assert.equal(statusEfetivo({ status: "aguardando_assinatura", link_expira_em: "2026-10-08T14:59:59Z" }, agora), "expirado")
  assert.equal(statusEfetivo({ status: "aguardando_assinatura", link_expira_em: "2026-10-09T00:00:00Z" }, agora), "aguardando_assinatura")
  assert.equal(statusEfetivo({ status: "assinado", link_expira_em: "2026-01-01T00:00:00Z" }, agora), "assinado")
  assert.equal(statusEfetivo({ status: "enviado", link_expira_em: null }, agora), "enviado")
})

test("contrato atual: o mais recente não cancelado de cada tipo", () => {
  const c = (id: number, tipo: ContratoBase["tipo"], data_inicio: string, status: ContratoBase["status"]): ContratoBase => ({
    id, tipo, data_inicio, data_vencimento: "2030-01-01", status, link_expira_em: null,
  })
  const atual = contratoAtualPorTipo([
    c(1, "terapias", "2025-01-01", "assinado"),
    c(2, "terapias", "2026-01-01", "cancelado"),
    c(3, "terapias", "2025-06-01", "rascunho"),
    c(4, "avaliacao_neuropsicologica", "2026-01-01", "assinado"),
    c(5, "avaliacao_neuropsicologica", "2026-01-01", "rascunho"),
  ])
  assert.equal(atual.get("terapias")?.id, 3)
  assert.equal(atual.get("avaliacao_neuropsicologica")?.id, 5)
  assert.equal(atual.has("tecnico_terapeutico_particular"), false)
})

test("texto do prazo", () => {
  assert.equal(textoPrazo("2026-01-01", "2026-10-08", "2026-10-08"), "vence hoje")
  assert.equal(textoPrazo("2026-01-01", "2026-10-07", "2026-10-08"), "venceu ontem")
  assert.equal(textoPrazo("2026-10-13", "2027-10-08", "2026-10-08"), "começa em 5 dias")
})

test("vencimento sugerido: meses depois, menos um dia", () => {
  assert.equal(vencimentoSugerido("2026-10-08", 12), "2027-10-07")
  assert.equal(vencimentoSugerido("2026-10-01", 6), "2027-03-31")
  assert.equal(vencimentoSugerido("2026-01-31", 1), "2026-02-27")
  assert.equal(vencimentoSugerido("2028-01-01", 12), "2028-12-31")
})
