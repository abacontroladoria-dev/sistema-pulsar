// CSV das evoluções selecionadas. Puro (o download fica na tela).
//
// Formato pensado para o Excel em português: UTF-8 com BOM, separador `;`,
// todo campo entre aspas (a descrição tem quebra de linha) e `"` dobrado.
// Sem coluna de origem e sem a palavra TiTa (regra R7 do plano).

import type { EvolucaoConteudo } from "@/types/exportarEvolucoes"
import { formatarCpf, formatarData, normalizarDescricao, registroDoProfissional } from "./formato"

const BOM = "﻿"

const COLUNAS: [string, (e: EvolucaoConteudo) => string][] = [
  ["Data", e => formatarData(e.data)],
  ["Horário início", e => e.hora_inicio ?? ""],
  ["Horário fim", e => e.hora_fim ?? ""],
  ["Paciente", e => e.paciente_nome],
  ["CPF", e => formatarCpf(e.paciente_cpf)],
  ["Data de nascimento", e => formatarData(e.paciente_nascimento)],
  ["Convênio", e => e.convenio ?? ""],
  ["Terapia", e => e.terapia],
  ["Profissional", e => e.profissional_nome],
  ["Registro", e => registroDoProfissional(e)],
  ["Descrição", e => normalizarDescricao(e.descricao)],
]

/**
 * Célula que começa com `=`, `+`, `-`, `@`, tab ou CR seria lida como fórmula pelo
 * Excel (injeção de fórmula): ganha um `'` na frente.
 */
export function protegerFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
}

function celula(valor: string): string {
  return `"${protegerFormula(valor).replace(/"/g, '""')}"`
}

export function gerarCsv(itens: EvolucaoConteudo[]): string {
  const linhas = [COLUNAS.map(([titulo]) => celula(titulo)).join(";")]
  for (const e of itens) linhas.push(COLUNAS.map(([, valor]) => celula(valor(e))).join(";"))
  return BOM + linhas.join("\r\n") + "\r\n"
}
