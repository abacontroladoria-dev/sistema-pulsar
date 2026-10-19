// Formatos comuns do PDF, do CSV e da tela de Exportar Evoluções. Puro.

import { registroCompleto } from "@/lib/cadastros/profissionais"
import { formatarCpf } from "@/lib/contratos/documento/montarDados"
import type { EvolucaoConteudo } from "@/types/exportarEvolucoes"

export { formatarCpf }

/** "2026-10-05" → "05/10/2026". */
export function formatarData(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "")
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
}

/** "07:30 às 08:00" (ou só o início, se faltar o fim). */
export function formatarHorario(inicio: string | null, fim: string | null): string {
  if (inicio && fim) return `${inicio} às ${fim}`
  return inicio ?? ""
}

/** "CRP 06/12345 · SP" — o mesmo texto do Cadastro de Profissionais. */
export function registroDoProfissional(
  e: Pick<EvolucaoConteudo, "tipo_registro" | "uf_registro" | "codigo_registro">,
): string {
  return registroCompleto(e) ?? ""
}

/** Texto da evolução com quebras de linha normalizadas e sem sobras nas pontas. */
export function normalizarDescricao(texto: string): string {
  return texto.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/^\s*\n+|\s+$/g, "")
}

/** Trecho seguro para nome de arquivo: sem acento, minúsculo, com hífen. */
function slug(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "paciente"
}

/**
 * `evolucoes_<paciente>_<de>_<ate>.pdf` para um paciente;
 * `evolucoes_<n>-pacientes_<de>_<ate>.pdf` para vários.
 */
export function nomeDoArquivo(
  pacientes: { id: string; nome: string }[],
  de: string,
  ate: string,
  extensao: "pdf" | "csv",
): string {
  const unicos = new Map(pacientes.map(p => [p.id, p.nome]))
  const quem = unicos.size === 1 ? slug([...unicos.values()][0]) : `${unicos.size}-pacientes`
  return `evolucoes_${quem}_${de}_${ate}.${extensao}`
}
