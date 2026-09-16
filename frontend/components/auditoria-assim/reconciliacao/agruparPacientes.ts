import type { AuditoriaAssimItem, AutorizacaoAssimSemana } from '../types'

/**
 * Uma pessoa, com tudo que as duas origens disseram sobre ela no mês.
 *
 * `chave` é só a identidade que abriu a linha — serve de `key` de React e de
 * nada mais. Quem quiser identificar o paciente usa `pacienteIds`.
 */
export type PacienteAgrupado = {
  chave: string
  nome: string
  carteirinhas: Set<string>
  pacienteIds: Set<string>
  plano: string | null
  sessoes: AuditoriaAssimItem[]
  autorizacoes: AutorizacaoAssimSemana[]
}

/**
 * A carteirinha que serve como IDENTIDADE — ou nada.
 *
 * O agrupamento da listagem usa a carteirinha como chave de paciente, e o
 * cadastro do TiTa aceita o preenchimento vazio na forma `000000.0000000.00`.
 * Uma carteirinha assim é pior que carteirinha nenhuma: sendo igual entre
 * pacientes diferentes, ela os FUNDE numa linha só — o nome exibido vira o do
 * primeiro que o mês encontra e os demais somem da tela, e qualquer autorização
 * que chegue com essa matrícula cai no irmão errado. Visto em 2026-09 com
 * Benicio e Helena Asta Moraes: uma linha só, com o nome do Benicio e a
 * contagem somada dos dois — a Helena não existia na tela.
 *
 * Devolvendo `null`, a chave cai no fallback `nome:<nome>` — que separa os
 * homônimos-por-defeito sem custo, porque uma carteirinha zerada também não
 * casa autorização nenhuma (`autorizacoes_assim.matricula` nunca a traz).
 */
export function carteirinhaUtil(valor: string | null | undefined): string | null {
  if (!valor) return null
  return /[1-9]/.test(valor) ? valor : null
}

/**
 * Junta sessões (agenda TiTa) e autorizações (extrato da ASSIM) na pessoa a que
 * pertencem.
 *
 * **O problema que esta função existe para resolver.** Os dois lados falam de
 * gente em comum e não concordam sobre como nomeá-la:
 *
 * | | agenda TiTa | extrato da ASSIM |
 * |---|---|---|
 * | nome | `Davi Lucas Araújo Alves Moreira` | `DAVI LUCAS ARAUJO AL` (20 chars, sem acento) |
 * | carteirinha | `000000074749794400` | `000000.0747497.00` |
 * | paciente_id | `11578` | `11578` |
 *
 * O nome não casa nem normalizando (está truncado). A carteirinha não casa nem
 * tirando a pontuação (o sufixo difere). Só `paciente_id` atravessa — e é por
 * isso que ele é a chave de maior precedência aqui.
 *
 * Antes disso a lista mostrava cada paciente DUAS VEZES: uma linha com
 * carteirinha e todas as pendências, outra com o nome completo e "sem
 * pendências". A segunda era a mais perigosa, porque dizia que estava tudo
 * certo.
 *
 * **Precedência: id → carteirinha → nome.** Nunca o contrário. A carteirinha
 * continua valendo porque a linha de FALTA não traz `paciente_id` em toda
 * origem, e o nome continua como último recurso pelo mesmo motivo. Homônimos
 * seguem separados enquanto tiverem id ou carteirinha diferentes — juntá-los
 * faria alguém vincular a guia de um na sessão do outro.
 */
export function agruparPacientes(
  sessoes: AuditoriaAssimItem[],
  autorizacoes: AutorizacaoAssimSemana[]
): PacienteAgrupado[] {
  const mapa = new Map<string, PacienteAgrupado>()
  const abrir = (chave: string, nome: string): PacienteAgrupado => {
    let atual = mapa.get(chave)
    if (!atual) {
      atual = {
        chave,
        nome,
        carteirinhas: new Set(),
        pacienteIds: new Set(),
        plano: null,
        sessoes: [],
        autorizacoes: [],
      }
      mapa.set(chave, atual)
    }
    return atual
  }

  // A ponte por nome ENTRE SESSÕES: a linha de falta não traz carteirinha (a RPC
  // de faltas não a devolve), mas as outras sessões do mesmo paciente trazem, e
  // ali os dois nomes vêm da mesma origem — então casam por igualdade.
  const carteirinhaPorNome = new Map<string, string>()
  for (const s of sessoes) {
    const c = carteirinhaUtil(s.carteirinha)
    if (s.paciente_nome && c && !carteirinhaPorNome.has(s.paciente_nome)) {
      carteirinhaPorNome.set(s.paciente_nome, c)
    }
  }

  // As sessões primeiro, e isso importa: quem abre a linha decide o `nome` que
  // ela exibe, e o nome da agenda é o completo e acentuado. Invertesse a ordem e
  // a lista passaria a mostrar os rótulos truncados da ASSIM.
  for (const s of sessoes) {
    const nome = s.paciente_nome ?? '(sem nome)'
    const carteirinha = carteirinhaUtil(s.carteirinha) ?? carteirinhaPorNome.get(nome) ?? null
    const item = abrir(
      s.paciente_id ? `id:${s.paciente_id}` : (carteirinha ?? `nome:${nome}`),
      nome
    )
    if (carteirinha) item.carteirinhas.add(carteirinha)
    if (s.paciente_id) item.pacienteIds.add(s.paciente_id)
    item.plano ??= s.convenio_nome
    item.sessoes.push(s)
  }

  const porCarteirinha = new Map<string, PacienteAgrupado>()
  const porPacienteId = new Map<string, PacienteAgrupado>()
  for (const item of mapa.values()) {
    for (const c of item.carteirinhas) porCarteirinha.set(c, item)
    for (const id of item.pacienteIds) porPacienteId.set(id, item)
  }

  for (const a of autorizacoes) {
    // `String(...)`: a coluna é `number` na ASSIM e `string` nas sessões.
    const pacienteId = a.paciente_id != null ? String(a.paciente_id) : null
    const matricula = carteirinhaUtil(a.matricula)
    const alvo =
      (pacienteId ? porPacienteId.get(pacienteId) : undefined) ??
      (matricula ? porCarteirinha.get(matricula) : undefined)

    // Guia de paciente sem sessão nenhuma no mês abre linha própria: é
    // exatamente o caso de "autorização sobrando" que nenhuma tela mostrava.
    const item =
      alvo ??
      abrir(
        pacienteId ? `id:${pacienteId}` : (matricula ?? `nome:${a.paciente_nome ?? '(sem nome)'}`),
        a.paciente_nome ?? '(sem nome)'
      )

    // Cada identidade vista passa a indexar a linha, venha ela da sessão ou da
    // guia: é o que faz a SEGUNDA guia do mesmo paciente achar a linha que a
    // primeira abriu, mesmo quando só uma das duas traz carteirinha.
    if (pacienteId && !porPacienteId.has(pacienteId)) {
      item.pacienteIds.add(pacienteId)
      porPacienteId.set(pacienteId, item)
    }
    if (matricula && !porCarteirinha.has(matricula)) {
      item.carteirinhas.add(matricula)
      porCarteirinha.set(matricula, item)
    }
    item.autorizacoes.push(a)
  }

  return [...mapa.values()]
}
