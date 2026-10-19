// Exportar Evoluções — chamadas do navegador às rotas /api/exportar-evolucoes/*.
// O banco nunca é lido direto daqui: as funções só têm EXECUTE para a
// service_role, e a rota confere a permissão `exportar_evolucoes`.

import type {
  AssinaturaProfissional,
  EvolucaoConteudo,
  EvolucaoItem,
  FinalidadeConteudo,
} from "@/types/exportarEvolucoes"

export class ErroExportacao extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: string,
  ) {
    super(mensagem)
    this.name = "ErroExportacao"
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  } catch {
    throw new ErroExportacao("Sem conexão com o servidor. Tente de novo.", 0)
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string; codigo?: string }
  if (!r.ok) throw new ErroExportacao(j.error ?? "Não foi possível ler as evoluções. Tente de novo.", r.status, j.codigo)
  return j as T
}

/** Cards do período (sem o texto). Filtro de paciente/terapia é feito na tela. */
export async function listarEvolucoes(de: string, ate: string): Promise<EvolucaoItem[]> {
  const { itens } = await postJson<{ itens: EvolucaoItem[] }>("/api/exportar-evolucoes/listar", { de, ate })
  return itens
}

const LOTE = 500

/**
 * Texto completo das evoluções, em lotes de 500 (limite da função do banco).
 * Cada lote fica registrado com a finalidade. Devolve na ordem das chaves.
 */
export async function lerConteudo(
  chaves: string[],
  finalidade: FinalidadeConteudo,
  aoProgredir?: (lidas: number, total: number) => void,
): Promise<EvolucaoConteudo[]> {
  const todos: EvolucaoConteudo[] = []
  for (let i = 0; i < chaves.length; i += LOTE) {
    const { itens } = await postJson<{ itens: EvolucaoConteudo[] }>("/api/exportar-evolucoes/conteudo", {
      chaves: chaves.slice(i, i + LOTE),
      finalidade,
    })
    todos.push(...itens)
    aoProgredir?.(Math.min(i + LOTE, chaves.length), chaves.length)
  }
  const ordem = new Map(chaves.map((c, i) => [c, i]))
  return todos.sort((a, b) => (ordem.get(a.chave) ?? 0) - (ordem.get(b.chave) ?? 0))
}

/**
 * Assinaturas de quem executou as evoluções do PDF. Vão as CHAVES das evoluções
 * (o servidor descobre os profissionais), em lotes de até 5.000.
 */
export async function lerAssinaturas(chaves: string[]): Promise<AssinaturaProfissional[]> {
  const porProfissional = new Map<number, AssinaturaProfissional>()
  for (let i = 0; i < chaves.length; i += 5000) {
    const { assinaturas } = await postJson<{ assinaturas: AssinaturaProfissional[] }>(
      "/api/exportar-evolucoes/assinaturas",
      { chaves: chaves.slice(i, i + 5000) },
    )
    for (const a of assinaturas) porProfissional.set(a.profissional_id, a)
  }
  return [...porProfissional.values()]
}
