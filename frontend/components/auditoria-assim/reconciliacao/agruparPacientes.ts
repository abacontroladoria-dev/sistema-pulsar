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
    // A CARTEIRINHA PRIMEIRO — ver `guiaDoPaciente` para a medição. O
    // `paciente_id` da guia é carimbado pelo Pulsar e mistura pessoas (nove ids
    // com até 5 matrículas cada); a matrícula vem da ASSIM e não mistura. Com o
    // id na frente, a guia da Laura encontrava a linha do Emanuel e parava ali,
    // sem nunca consultar a carteirinha que a desmentiria.
    const alvo =
      (matricula ? porCarteirinha.get(matricula) : undefined) ??
      (pacienteId ? porPacienteId.get(pacienteId) : undefined)

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
    //
    // O id só entra no índice quando foi ELE que achou a linha (guia sem
    // matrícula). Quando a matrícula decidiu, aprender o id junto propagaria a
    // sujeira: a guia da Laura, agrupada corretamente por carteirinha, ensinaria
    // o índice que o id 14447 também é dela — e a guia seguinte, essa sem
    // matrícula, herdaria o engano.
    if (pacienteId && !matricula && !porPacienteId.has(pacienteId)) {
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

/**
 * Esta sessão é do paciente aberto no modal?
 *
 * Mesma regra de identidade de `agruparPacientes`, aplicada ao recorte de UMA
 * pessoa: `paciente_id` quando os dois lados o têm, nome só quando não há id.
 *
 * Mora aqui, e não dentro do hook, porque foi exatamente esta comparação que
 * quebrou a grade em 2026-09-16: filtrar as sessões por `paciente_nome` fazia o
 * modal abrir VAZIO de sessões sempre que a linha tivesse sido rotulada pelo
 * nome truncado da ASSIM — e aí todas as guias apareciam "Liberada além do
 * agendado", por não haver sessão com que parear.
 */
export function ehDoPacienteSelecionado(
  sessao: Pick<AuditoriaAssimItem, 'paciente_id' | 'paciente_nome'>,
  alvo: { nome: string; ids: string[] } | null
): boolean {
  if (!alvo) return false
  if (alvo.ids.length > 0 && sessao.paciente_id) return alvo.ids.includes(sessao.paciente_id)
  return sessao.paciente_nome === alvo.nome
}

/**
 * Esta GUIA é do paciente aberto? A matrícula decide; o id só quando não há.
 *
 * A ordem é a regra, não uma preferência, e é o que separa esta função da irmã
 * acima. `ehDoPacienteSelecionado` trata de SESSÕES, cujo `paciente_id` vem de
 * `agenda_tita` e é confiável. Aqui são GUIAS, e `autorizacoes_assim.paciente_id`
 * é carimbado do lado do Pulsar: medido em 2026-09-17, nove ids carregavam de 2
 * a 5 matrículas distintas — 375 guias desde 30/07 atribuídas ao paciente
 * errado. `matricula`, essa sim, vem da ASSIM e identifica sem ambiguidade
 * (empresa.matricula.dep, com o `dep` separando irmãos da mesma apólice).
 *
 * O defeito em tela (Emanuel Abreu De Andrade, 07 a 11/09): o modal mostrava 15
 * cartões para uma semana de 7 sessões — 8 "Liberada além do agendado" que eram
 * da Laura, do Guilherme e do Rodolfo, todas gravadas com o `paciente_id` 14447,
 * que é o do Emanuel na agenda. Enquanto o filtro olhava só a matrícula a
 * sujeira ficava invisível; aceitar o id como chave ALTERNATIVA a trouxe à tela,
 * porque um `||` faz a chave errada vencer sempre que a certa diz não.
 *
 * O id continua servindo ao caso que o introduziu — a guia que chega sem
 * matrícula —, mas como último recurso.
 *
 * Corrigir a origem é trabalho do robô da ASSIM, que vive em outro repositório e
 * ficou fora por decisão do usuário. Esta é a defesa do lado da leitura, e
 * continua correta mesmo depois que a origem for consertada.
 */
export function guiaDoPaciente(
  guia: { matricula?: string | null; paciente_id?: string | number | null },
  carteirinhas: ReadonlySet<string>,
  ids: ReadonlySet<string>
): boolean {
  if (guia.matricula) return carteirinhas.has(guia.matricula)
  return guia.paciente_id != null && ids.has(String(guia.paciente_id))
}
