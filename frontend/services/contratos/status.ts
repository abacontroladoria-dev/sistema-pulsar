import "server-only"

import { supabaseService } from "@/lib/supabase/service"
import {
  contratoAtualPorTipo,
  hojeBrasilia,
  statusEfetivo,
  vigencia,
  type StatusContrato,
  type TipoContrato,
} from "@/lib/contratos/status"
import type { ItemStatusContratos, MetaStatusContratos } from "@/types/contratosPaciente"

// A lista da tela Status Contratos: uma linha por PACIENTE, com o contrato
// atual de cada tipo já resolvido (status efetivo + vigência). Molde:
// services/laudos/acompanhamento.ts.
//
// Três fontes:
//   1. `pacientes` — quem aparece: todo paciente ativo ou com algum contrato
//      (inativo sem contrato não tem o que acompanhar). Os FICTÍCIOS vêm junto,
//      marcados: o filtro "Cadastro" da tela os esconde por padrão.
//   2. `pacientes_contratos` — os contratos (ativo = true).
//   3. `grade_convenio_por_paciente()` — quem está na grade do TiTa (unidade
//      280) e o convênio de lá. Pode FALHAR sem derrubar a tela: aí o "possui agendamentos"
//      some, o convênio fica o do cadastro e `meta.gradeErro` avisa.
//   4. `grade_pacientes_com_terapia_real()` — quem, na grade, já teve sessão
//      NÃO-Triagem (decisão do usuário, 08/10/2026: Triagem é avaliação de
//      entrada, ainda não é tratamento, e "Sem contrato" não cobra por ela).
//      Também pode FALHAR sem derrubar: `meta.terapiaRealErro` avisa, e o
//      cálculo assume que TODOS precisam de contrato (mais seguro que deixar
//      passar um paciente em tratamento de verdade sem cobrar).
//
// `server-only` e service_role: a grade só a service_role lê, e quem tem só
// `status_contratos` não lê `pacientes` pela RLS. A checagem de acesso é a da
// rota (services/contratos/acesso.ts).
//
// TUDO PAGINADO: o PostgREST corta em 1.000 linhas com HTTP 200 e sem erro
// (medido em orbita_laudos_*). Sem o laço, a tela perderia pacientes em
// silêncio quando a base passasse do teto.

const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

type Erro = { code?: string; message?: string }

class ErroLeitura extends Error {
  constructor(
    mensagem: string,
    readonly code: string | undefined,
  ) {
    super(mensagem)
  }
}

async function lerPaginado<T>(
  consulta: (from: number, to: number) => PromiseLike<{ data: unknown; error: Erro | null }>,
  rotulo: string,
): Promise<T[]> {
  const todas: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await consulta(from, from + PAGE - 1)
    if (error) throw new ErroLeitura(`falha ao ler ${rotulo}: ${error.message ?? error.code}`, error.code)
    const pagina = (data ?? []) as T[]
    todas.push(...pagina)
    if (pagina.length < PAGE) break
  }
  return todas
}

type PacienteBruto = {
  id_paciente: number
  tita_paciente_id: number | null
  origem_cadastro: "tita" | "pulsar"
  nome: string
  ativo: boolean
  ficticio: boolean
  foto_path: string | null
  convenio_nome: string | null
}

type ContratoBruto = {
  id: number
  paciente_id: number
  tipo: TipoContrato
  data_inicio: string
  data_vencimento: string
  status: StatusContrato
  assinado_em: string | null
  link_expira_em: string | null
}

type GradeBruta = { paciente_id: number | string; convenio_nome: string }
type TerapiaRealBruta = { paciente_id: number | string }

const MIGRACAO_PENDENTE = ["42P01", "PGRST205", "42883", "PGRST202"]

export async function buscarStatusContratos(
  cliente?: ClienteSupabase,
  agora: Date = new Date(),
): Promise<{ itens: ItemStatusContratos[]; meta: MetaStatusContratos }> {
  const sb: ClienteSupabase = cliente ?? supabaseService
  const hoje = hojeBrasilia(agora)

  // A grade nunca rejeita: o erro vira valor, para não derrubar as outras leituras.
  const gradePromessa = lerPaginado<GradeBruta>(
    (from, to) => sb.rpc("grade_convenio_por_paciente").order("paciente_id", { ascending: true }).range(from, to),
    "grade_convenio_por_paciente",
  ).then(
    (r) => ({ ok: true as const, r }),
    (e: unknown) => ({ ok: false as const, erro: e instanceof Error ? e.message : String(e) }),
  )
  // Migration ainda não aplicada (o localhost usa o banco de produção): a tela
  // abre com a lista de pacientes e o aviso, em vez de um erro 500.
  const contratosPromessa = lerPaginado<ContratoBruto>(
    (from, to) =>
      sb
        .from("pacientes_contratos")
        .select("id, paciente_id, tipo, data_inicio, data_vencimento, status, assinado_em, link_expira_em")
        .eq("ativo", true)
        .order("id", { ascending: true })
        .range(from, to),
    "pacientes_contratos",
  ).then(
    (r) => ({ pendente: false, r }),
    (e: unknown) => {
      if (e instanceof ErroLeitura && MIGRACAO_PENDENTE.includes(e.code ?? "")) return { pendente: true, r: [] as ContratoBruto[] }
      throw e
    },
  )

  const terapiaRealPromessa = lerPaginado<TerapiaRealBruta>(
    (from, to) => sb.rpc("grade_pacientes_com_terapia_real").order("paciente_id", { ascending: true }).range(from, to),
    "grade_pacientes_com_terapia_real",
  ).then(
    (r) => ({ ok: true as const, r }),
    (e: unknown) => ({ ok: false as const, erro: e instanceof Error ? e.message : String(e) }),
  )

  const [pacientes, contratosLidos, gradeLida, terapiaRealLida] = await Promise.all([
    lerPaginado<PacienteBruto>(
      (from, to) =>
        sb
          .from("pacientes")
          .select("id_paciente, tita_paciente_id, origem_cadastro, nome, ativo, ficticio, foto_path, convenio_nome")
          .order("id_paciente", { ascending: true })
          .range(from, to),
      "pacientes",
    ),
    contratosPromessa,
    gradePromessa,
    terapiaRealPromessa,
  ])

  if (!gradeLida.ok) console.error(`[contratos:status] grade não carregada: ${gradeLida.erro}`)
  if (!terapiaRealLida.ok) console.error(`[contratos:status] terapia real não carregada: ${terapiaRealLida.erro}`)

  // A grade fala em `tita_paciente_id` (ID Favorecido), não em id_paciente.
  const convenioDaGrade = new Map<number, string>()
  if (gradeLida.ok) {
    for (const g of gradeLida.r) {
      const id = Number(g.paciente_id)
      if (Number.isFinite(id) && g.convenio_nome) convenioDaGrade.set(id, g.convenio_nome)
    }
  }

  const comTerapiaReal = new Set<number>()
  if (terapiaRealLida.ok) {
    for (const t of terapiaRealLida.r) {
      const id = Number(t.paciente_id)
      if (Number.isFinite(id)) comTerapiaReal.add(id)
    }
  }

  const porPaciente = new Map<number, ContratoBruto[]>()
  for (const c of contratosLidos.r) {
    const lista = porPaciente.get(c.paciente_id) ?? []
    lista.push(c)
    porPaciente.set(c.paciente_id, lista)
  }

  const itens: ItemStatusContratos[] = []
  for (const p of pacientes) {
    const doPaciente = porPaciente.get(p.id_paciente) ?? []
    if (!p.ativo && doPaciente.length === 0) continue

    const atual = contratoAtualPorTipo(doPaciente)
    const daGrade = p.tita_paciente_id !== null ? convenioDaGrade.get(Number(p.tita_paciente_id)) : undefined
    // Leitura falhou: assume que precisa de contrato, em vez de dispensar à toa
    // (ver comentário da fonte 4, acima).
    const temTerapiaReal = !terapiaRealLida.ok || (p.tita_paciente_id !== null && comTerapiaReal.has(Number(p.tita_paciente_id)))

    itens.push({
      pacienteId: p.id_paciente,
      origemCadastro: p.origem_cadastro,
      titaPacienteId: p.tita_paciente_id,
      nome: p.nome,
      ativo: p.ativo,
      ficticio: !!p.ficticio,
      fotoPath: p.foto_path,
      naGrade: daGrade !== undefined,
      temTerapiaReal,
      convenio: daGrade ?? p.convenio_nome ?? null,
      contratos: [...atual.values()].map((c) => ({
        id: c.id,
        tipo: c.tipo,
        dataInicio: c.data_inicio,
        dataVencimento: c.data_vencimento,
        status: statusEfetivo(c, agora),
        vigencia: vigencia(c.data_inicio, c.data_vencimento, hoje),
        assinadoEm: c.assinado_em,
      })),
      totalContratos: doPaciente.filter((c) => c.status !== "cancelado").length,
    })
  }

  return {
    itens,
    meta: {
      hoje,
      pacientes: itens.length,
      contratos: contratosLidos.r.length,
      gradeErro: gradeLida.ok ? null : gradeLida.erro,
      terapiaRealErro: terapiaRealLida.ok ? null : terapiaRealLida.erro,
      migracaoPendente: contratosLidos.pendente,
    },
  }
}
