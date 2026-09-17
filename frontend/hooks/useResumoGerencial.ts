'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listarResumoAuditoriaPeriodo } from '@/services/auditoria-assim.service'
import { acumularKpis, kpisVazios } from '@/components/auditoria-assim/kpisAuditoria'
import { mapearUnidade, UNIDADE_CONSERTAR } from '@/lib/cronograma/comparativoSessoes'
import type { KpisAuditoriaAssim, ResumoDiarioLinha } from '@/components/auditoria-assim/types'

/**
 * A métrica que dirige o gráfico e as quebras.
 *
 * `null` é um estado legítimo, e é como o modal ABRE: nenhum indicador em foco.
 * O painel de baixo é o segundo passo desta tela — o primeiro é o placar dos
 * nove números. Enquanto o foco era obrigatório, algum card tinha de estar aceso
 * na abertura, e isso foi lido da tela como "veio filtrado".
 */
export type MetricaFoco = keyof KpisAuditoriaAssim

/** Um ponto da série temporal, ou uma fatia de uma quebra. */
export type FatiaKpis = {
  chave: string
  rotulo: string
  kpis: KpisAuditoriaAssim
}

/**
 * Acima deste tamanho a série passa a ser semanal.
 *
 * Não é gosto: um eixo com 90 colunas de um dia cada vira serragem — nenhuma
 * barra é legível e a tendência, que é a pergunta real de quem olha um
 * trimestre, fica escondida no ruído do dia a dia.
 */
const DIAS_ATE_SERIE_DIARIA = 45

/**
 * Sem acento e sem caixa, para a busca por nome ser tolerante.
 *
 * Exportada porque o combobox de sugestões precisa normalizar o que foi
 * DIGITADO com exatamente a mesma regra que normalizou os nomes — duas cópias
 * divergiriam no primeiro caractere que só uma delas tratasse, e o sintoma
 * seria "a sugestão aparece mas a busca não acha".
 */
export function normalizarNome(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Primeiro dia do mês corrente, o recorte com que a tela nasce. */
function inicioDoMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * A segunda-feira da semana de uma data ISO, por aritmética de string + Date
 * local. Nunca `new Date('2026-08-10')` cru, que o JS lê como UTC e devolve o
 * dia anterior em São Paulo.
 */
function segundaDaSemana(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number)
  const d = new Date(ano, (mes ?? 1) - 1, dia ?? 1)
  const diaDaSemana = (d.getDay() + 6) % 7 // 0 = segunda
  d.setDate(d.getDate() - diaDaSemana)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.slice(0, 10).split('-').map(Number)
  const [a2, m2, d2] = ate.slice(0, 10).split('-').map(Number)
  const inicio = new Date(a1!, (m1 ?? 1) - 1, d1 ?? 1)
  const fim = new Date(a2!, (m2 ?? 1) - 1, d2 ?? 1)
  return Math.round((fim.getTime() - inicio.getTime()) / 86_400_000)
}

/**
 * Agrupa as linhas do resumo por uma chave e soma cada grupo com a MESMA regra
 * dos cards da tela diária.
 *
 * `peso = linha.sessoes` é o que faz o resumo pré-agregado dar o mesmo número
 * que somar sessão a sessão — a propriedade que o teste de `kpisAuditoria`
 * fixa.
 */
function agruparPorChave(
  linhas: readonly ResumoDiarioLinha[],
  chaveDe: (linha: ResumoDiarioLinha) => { chave: string; rotulo: string }
): FatiaKpis[] {
  const mapa = new Map<string, FatiaKpis>()

  for (const linha of linhas) {
    const { chave, rotulo } = chaveDe(linha)
    let fatia = mapa.get(chave)
    if (!fatia) {
      fatia = { chave, rotulo, kpis: kpisVazios() }
      mapa.set(chave, fatia)
    }
    acumularKpis(fatia.kpis, linha, linha.sessoes)
  }

  return [...mapa.values()]
}

/**
 * Todas as sessões de uma fatia — a mesma soma do cabeçalho do modal.
 *
 * É o denominador do percentual dos cards e, sem métrica em foco, também o que
 * ordena as sugestões de paciente: "quem teve mais movimento no período" é a
 * única resposta honesta quando ninguém escolheu um indicador ainda.
 */
function sessoesDe(kpis: KpisAuditoriaAssim): number {
  return kpis.total + kpis.faltas + kpis.faltas_terapeuta + kpis.unidade_fechada
}

/** Um paciente do período, como a lista de sugestões precisa dele. */
export type PacienteSugerido = {
  id: string
  nome: string
  /** Pré-calculado: é o que o combobox compara a cada tecla. */
  normalizado: string
  /** Quanto ele tem da métrica em foco. Ordena a lista e desempata homônimos. */
  valor: number
}

export function useResumoGerencial(aberto: boolean) {
  const [de, setDe] = useState(inicioDoMes)
  const [ate, setAte] = useState(hojeLocal)
  const [linhas, setLinhas] = useState<ResumoDiarioLinha[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Nasce sem foco. Ver `MetricaFoco`.
  const [metrica, setMetrica] = useState<MetricaFoco | null>(null)
  const [busca, setBusca] = useState('')
  /**
   * A âncora exata, quando a pessoa escolheu alguém na lista de sugestões.
   *
   * Existe por causa de homônimo, que esta base tem: buscar por NOME soma dois
   * "João Silva" num número só, sem oferecer escolha. Com o id fixado, o
   * recorte é de uma pessoa. Nulo enquanto a busca for texto livre — que
   * continua valendo, porque "silva" achar quinze pessoas é uso legítimo.
   */
  const [pacienteId, setPacienteId] = useState<string | null>(null)

  // Cada carga recebe um número; só a última pode escrever no estado. Sem isso,
  // trocar a data duas vezes rápido deixa a resposta mais LENTA sobrescrever a
  // mais nova — a tela se corrige sozinha na frente do operador, que é o
  // sintoma que já mordeu esta base antes.
  const cargaRef = useRef(0)

  const carregar = useCallback(async (dataDe: string, dataAte: string) => {
    if (!dataDe || !dataAte || dataDe > dataAte) return
    const carga = ++cargaRef.current
    setCarregando(true)
    setErro(null)
    try {
      const resultado = await listarResumoAuditoriaPeriodo(dataDe, dataAte)
      if (carga !== cargaRef.current) return
      setLinhas(resultado)
    } catch (e) {
      if (carga !== cargaRef.current) return
      // Lista vazia depois de uma falha desenharia "zero glosas no período",
      // que é uma resposta — e errada. O erro tem de aparecer.
      setLinhas([])
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o resumo do período.')
    } finally {
      if (carga === cargaRef.current) setCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (!aberto) return
    carregar(de, ate)
  }, [aberto, de, ate, carregar])

  /**
   * Nome normalizado por paciente, calculado UMA vez por carga.
   *
   * A versão anterior chamava `normalizarNome` dentro do filtro, ou seja um
   * `NFD` + regex Unicode por LINHA a cada TECLA digitada — e um mês de
   * movimento são milhares de linhas. O trabalho é o mesmo para todas as linhas
   * do mesmo paciente, então ele cabe num mapa e o filtro vira uma consulta.
   */
  const nomeNormalizado = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const linha of linhas) {
      if (!mapa.has(linha.paciente_id)) {
        mapa.set(linha.paciente_id, normalizarNome(linha.paciente_nome))
      }
    }
    return mapa
  }, [linhas])

  /**
   * A busca filtra as linhas ANTES de qualquer soma — por isso os totais, o
   * gráfico e as quatro quebras passam a falar do paciente buscado sem nenhum
   * código a mais. É o mesmo motivo de ela ser client-side: as linhas do
   * período já estão em memória, então filtrar não custa requisição nenhuma e
   * responde a cada tecla.
   *
   * Dois modos, nesta ordem. Com `pacienteId` fixado (a pessoa escolheu na
   * lista), o recorte é por id — exato, imune a homônimo. Sem ele, é por texto,
   * sem acento e sem caixa: quem digita "jose" tem de achar "JOSÉ".
   */
  const linhasVisiveis = useMemo(() => {
    if (pacienteId) return linhas.filter((l) => l.paciente_id === pacienteId)
    const alvo = normalizarNome(busca)
    if (!alvo) return linhas
    return linhas.filter((l) => nomeNormalizado.get(l.paciente_id)?.includes(alvo))
  }, [linhas, busca, pacienteId, nomeNormalizado])

  /**
   * Todos os pacientes do período — a fonte das sugestões.
   *
   * Deriva de `linhas` CRU, e é essa a diferença que faz a coisa funcionar.
   * `porPaciente` parece a fonte natural e é uma armadilha: ele já vem filtrado
   * pela própria busca (circular — a lista se esvaziaria conforme se digita,
   * justo quando ela mais precisa mostrar a grafia certa) e ainda descarta quem
   * tem zero na métrica.
   *
   * `valor` é a métrica em foco — ou, enquanto não há foco, o total de sessões
   * da pessoa. Ordena a lista, o que devolve à tela a pergunta "quem são os
   * maiores?" — e é o que separa dois homônimos.
   */
  const pacientesDoPeriodo = useMemo<PacienteSugerido[]>(() => {
    const fatias = agruparPorChave(linhas, (l) => ({
      chave: l.paciente_id,
      rotulo: l.paciente_nome,
    }))
    return fatias
      .map((f) => ({
        id: f.chave,
        nome: f.rotulo,
        normalizado: nomeNormalizado.get(f.chave) ?? normalizarNome(f.rotulo),
        valor: metrica ? f.kpis[metrica] : sessoesDe(f.kpis),
      }))
      .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [linhas, metrica, nomeNormalizado])

  /**
   * Digitar solta a âncora. Quem edita o texto está procurando outra coisa, e
   * manter o id fixado faria a tela ignorar o que está escrito nela — o tipo de
   * discordância entre campo e resultado que ninguém consegue diagnosticar.
   */
  const definirBusca = useCallback((texto: string) => {
    setBusca(texto)
    setPacienteId(null)
  }, [])

  /** Escolher na lista fixa o id e escreve o nome no campo. */
  const escolherPaciente = useCallback((paciente: PacienteSugerido) => {
    setBusca(paciente.nome)
    setPacienteId(paciente.id)
  }, [])

  const totais = useMemo(() => {
    const acc = kpisVazios()
    for (const linha of linhasVisiveis) acumularKpis(acc, linha, linha.sessoes)
    return acc
  }, [linhasVisiveis])

  /** Quantos pacientes distintos a busca alcançou — some quando não há busca. */
  const pacientesEncontrados = useMemo(() => {
    if (!busca.trim()) return 0
    return new Set(linhasVisiveis.map((l) => l.paciente_id)).size
  }, [linhasVisiveis, busca])

  const serieDiaria = diasEntre(de, ate) <= DIAS_ATE_SERIE_DIARIA

  const serie = useMemo(() => {
    const fatias = agruparPorChave(linhasVisiveis, (linha) =>
      serieDiaria
        ? { chave: linha.data, rotulo: linha.data }
        : { chave: segundaDaSemana(linha.data), rotulo: segundaDaSemana(linha.data) }
    )
    return fatias.sort((a, b) => a.chave.localeCompare(b.chave))
  }, [linhasVisiveis, serieDiaria])

  /**
   * Ordena a quebra pela métrica em foco — o maior ofensor primeiro.
   *
   * Sem foco não há quebra: uma lista ordenada por nada não responde pergunta
   * nenhuma. O painel que as desenha nem existe nesse estado, mas o corte fica
   * aqui para o dado nunca sair daqui sem significado.
   */
  const ordenarPorFoco = useCallback(
    (fatias: FatiaKpis[]) =>
      metrica
        ? fatias
            .filter((f) => f.kpis[metrica] > 0)
            .sort(
              (a, b) => b.kpis[metrica] - a.kpis[metrica] || a.rotulo.localeCompare(b.rotulo, 'pt-BR')
            )
        : [],
    [metrica]
  )

  const porTerapia = useMemo(
    () => ordenarPorFoco(agruparPorChave(linhasVisiveis, (l) => ({ chave: l.codigo_tuss, rotulo: l.terapia }))),
    [linhasVisiveis, ordenarPorFoco]
  )

  const porMotivo = useMemo(
    () =>
      ordenarPorFoco(
        agruparPorChave(linhasVisiveis, (l) => ({ chave: l.codigo_glosa, rotulo: l.codigo_glosa }))
      ),
    [linhasVisiveis, ordenarPorFoco]
  )

  const porUnidade = useMemo(
    () =>
      ordenarPorFoco(
        agruparPorChave(linhasVisiveis, (l) => {
          // A sala chega crua de propósito: o de-para mora aqui, no mesmo
          // helper que o resto do sistema usa. `'—'` é o sentinela que o
          // resumo grava no lugar de NULL, e `mapearUnidade` já devolve
          // "Consertar Unidade no Sistema" para sala vazia ou desconhecida.
          const unidade = l.sala_nome === '—' ? UNIDADE_CONSERTAR : mapearUnidade(l.sala_nome)
          return { chave: unidade, rotulo: unidade }
        })
      ),
    [linhasVisiveis, ordenarPorFoco]
  )

  /**
   * Quem mais gera o indicador em foco — o ranking do período.
   *
   * Deriva de `linhas` CRU, e não de `linhasVisiveis`, pelo mesmo motivo que
   * `pacientesDoPeriodo`: ela é a lista de ONDE se escolhe um paciente, então
   * filtrá-la pela escolha é circular. Ancorada, ela colapsaria para uma única
   * linha — a pessoa perderia de vista o ranking no exato momento em que
   * navega por ele, e sem lista não haveria como trocar de paciente nem
   * enxergar o caminho de volta.
   *
   * As outras três quebras seguem `linhasVisiveis` de propósito: elas existem
   * para descrever o paciente ancorado, e é o filtro que lhes dá sentido.
   */
  const porPaciente = useMemo(
    () =>
      ordenarPorFoco(
        agruparPorChave(linhas, (l) => ({ chave: l.paciente_id, rotulo: l.paciente_nome }))
      ),
    [linhas, ordenarPorFoco]
  )

  /** O instante em que o cron recalculou o dia mais recentemente tocado. */
  const atualizadoEm = useMemo(() => {
    let maior: string | null = null
    for (const linha of linhasVisiveis) {
      if (!maior || linha.atualizado_em > maior) maior = linha.atualizado_em
    }
    return maior
  }, [linhasVisiveis])

  const diasComDados = useMemo(
    () => new Set(linhasVisiveis.map((l) => l.data)).size,
    [linhasVisiveis]
  )

  return {
    de, ate, setDe, setAte,
    metrica, setMetrica,
    busca, definirBusca, escolherPaciente, pacienteId,
    pacientesDoPeriodo, pacientesEncontrados,
    linhas: linhasVisiveis, carregando, erro,
    totais, serie, serieDiaria,
    porTerapia, porMotivo, porUnidade, porPaciente,
    atualizadoEm, diasComDados,
    recarregar: () => carregar(de, ate),
  }
}
