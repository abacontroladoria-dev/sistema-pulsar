// Filtros e indicadores da Status Contratos.
//
// O primeiro caso é o mais importante: o número do card e o tamanho da lista ao
// clicar nele têm de ser o mesmo, porque o card É o filtro.
//
//   npx vitest run lib/contratos/filtros.test.ts

import { test } from "vitest"
import assert from "node:assert/strict"
import {
  RECORTES,
  aplicar,
  contarKpis,
  filtrosIniciais,
  proximoVencimento,
  type FiltrosContratos,
} from "./filtros"
import type { ItemStatusContratos, ResumoContrato } from "@/types/contratosPaciente"

let seq = 0
const contrato = (p: Partial<ResumoContrato>): ResumoContrato => ({
  id: ++seq,
  tipo: "terapias",
  dataInicio: "2026-01-01",
  dataVencimento: "2026-12-31",
  status: "assinado",
  vigencia: "vigente",
  assinadoEm: null,
  ...p,
})
const paciente = (id: number, nome: string, p: Partial<ItemStatusContratos> = {}): ItemStatusContratos => ({
  pacienteId: id,
  nome,
  ativo: true,
  ficticio: false,
  fotoPath: null,
  naGrade: true,
  convenio: "ASSIM",
  contratos: [],
  totalContratos: 0,
  ...p,
})

const ITENS: ItemStatusContratos[] = [
  paciente(1, "Ana", { contratos: [contrato({})] }),
  paciente(2, "Bruno", { contratos: [] }),
  paciente(3, "Caio", { contratos: [contrato({ status: "rascunho" })] }),
  paciente(4, "Davi", { contratos: [contrato({ status: "aguardando_assinatura", vigencia: "a_vencer" })] }),
  paciente(5, "Eva", { contratos: [contrato({ vigencia: "vencido" })] }),
  paciente(6, "Fábio", { contratos: [contrato({ status: "expirado" })] }),
  paciente(7, "Gil", { naGrade: false, contratos: [] }),
  paciente(8, "Hugo", {
    contratos: [contrato({}), contrato({ tipo: "avaliacao_neuropsicologica", vigencia: "vencido" })],
  }),
  paciente(9, "Íris", { ativo: false, contratos: [] }),
  paciente(10, "Júlia", { convenio: "LEVE", contratos: [contrato({ vigencia: "a_vencer" })] }),
  paciente(11, "Horário Administrativo", { ficticio: true, contratos: [] }),
]

test("o número do card é o tamanho da lista ao clicar nele, em qualquer combinação", () => {
  const variacoes: Partial<FiltrosContratos>[] = [
    {},
    { tipos: new Set(["terapias"]) },
    { tipos: new Set(["avaliacao_neuropsicologica"]) },
    { convenios: new Set(["LEVE"]) },
    { agendamento: "sim" },
    { agendamento: "nao" },
    { situacoes: new Set(["ficticio"]) },
    { situacoes: new Set(["ativo", "inativo"]) },
    { busca: "a" },
  ]
  for (const v of variacoes) {
    const f = { ...filtrosIniciais(), ...v }
    const kpis = contarKpis(ITENS, f)
    for (const r of RECORTES) {
      assert.equal(aplicar(ITENS, { ...f, recorte: r }).length, kpis[r], `${r} em ${JSON.stringify(Object.keys(v))}`)
    }
  }
})

test("sem contrato: com agendamento e sem Terapias valendo hoje; expirado não conta como contrato", () => {
  const nomes = aplicar(ITENS, { ...filtrosIniciais(), recorte: "sem_contrato" }).map((i) => i.nome)
  // Bruno (nada), Eva (Terapias vencido), Fábio (link expirado). Gil fora da grade; Íris inativa.
  assert.deepEqual(nomes, ["Bruno", "Eva", "Fábio"])
})

test("recortes por status e vigência", () => {
  const nomes = (r: FiltrosContratos["recorte"], extra: Partial<FiltrosContratos> = {}) =>
    aplicar(ITENS, { ...filtrosIniciais(), recorte: r, ...extra }).map((i) => i.nome)
  assert.deepEqual(nomes("rascunho"), ["Caio"])
  assert.deepEqual(nomes("aguardando"), ["Davi"])
  assert.deepEqual(nomes("a_vencer"), ["Davi", "Júlia"])
  assert.deepEqual(nomes("assinado_vigente"), ["Ana", "Hugo", "Júlia"])
  assert.deepEqual(nomes("vencido"), ["Eva", "Hugo"])
  // Com tipo Terapias, a Avaliação vencida do Hugo deixa de contar.
  assert.deepEqual(nomes("vencido", { tipos: new Set(["terapias"]) }), ["Eva"])
  assert.deepEqual(nomes("recusado_expirado"), ["Fábio"])
})

test("cadastro e agendamento são filtros separados", () => {
  const nomes = (extra: Partial<FiltrosContratos>) => aplicar(ITENS, { ...filtrosIniciais(), ...extra }).map((i) => i.nome)
  // Fictício fica fora do padrão (só Ativo), mesmo estando ativo e com agendamento.
  assert.equal(nomes({}).includes("Horário Administrativo"), false)
  assert.deepEqual(nomes({ situacoes: new Set(["ficticio"]) }), ["Horário Administrativo"])
  assert.deepEqual(nomes({ situacoes: new Set(["inativo"]) }), ["Íris"])
  assert.deepEqual(nomes({ agendamento: "nao" }), ["Gil"])
  assert.equal(nomes({ agendamento: "sim" }).includes("Gil"), false)
})

test("busca ignora acento e caixa, e aceita o ID do paciente", () => {
  assert.deepEqual(aplicar(ITENS, { ...filtrosIniciais(), busca: "fabio" }).map((i) => i.nome), ["Fábio"])
  assert.deepEqual(aplicar(ITENS, { ...filtrosIniciais(), busca: "10" }).map((i) => i.nome), ["Júlia"])
})

test("próximo vencimento: o mais próximo que não passou; sem ele, o último que passou", () => {
  const a = contrato({ dataVencimento: "2027-01-01" })
  const b = contrato({ dataVencimento: "2026-11-01", vigencia: "a_vencer" })
  const c = contrato({ dataVencimento: "2026-01-01", vigencia: "vencido" })
  const d = contrato({ dataVencimento: "2025-01-01", vigencia: "vencido" })
  assert.equal(proximoVencimento([a, b, c])?.id, b.id)
  assert.equal(proximoVencimento([c, d])?.id, c.id)
  assert.equal(proximoVencimento([contrato({ status: "recusado" })]), null)
})
