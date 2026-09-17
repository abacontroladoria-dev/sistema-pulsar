'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChartColumn, RefreshCw, Search, X } from 'lucide-react'
import { useModalDialog } from '@/hooks/useModalDialog'
import {
  normalizarNome,
  useResumoGerencial,
  type FatiaKpis,
  type MetricaFoco,
  type PacienteSugerido,
} from '@/hooks/useResumoGerencial'
import { KPI_VISUAL, ORDEM_KPIS, type MetricaKpi } from './kpisVisual'
import { useGlosaCodigos } from '@/hooks/useGlosaCodigos'
import { useFeriados } from '@/hooks/useFeriados'
import type { FeriadoInfo } from '@/types/feriados'
import { feriadosDoPeriodo } from './feriadosDoPeriodo'

type Props = {
  aberto: boolean
  onClose: () => void
}

/** "2026-08-10" → "10/08". Por fatia de string: `new Date('2026-08-10')` é lido
 *  como UTC e devolve o dia anterior em São Paulo. */
function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

function porExtenso(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}


export default function ModalVisaoGerencial({ aberto, onClose }: Props) {
  const { refDialogo, propsDialogo } = useModalDialog(aberto, onClose, 'titulo-visao-gerencial')
  const r = useResumoGerencial(aberto)
  const glosaCodigos = useGlosaCodigos()
  const uid = useId()

  const { metrica: metricaAtual, setMetrica } = r

  /**
   * Navegação por setas na fileira de tabs — requisito do padrão, não extra.
   *
   * Com tabindex rotativo (só a selecionada é tabulável), Tab entra e sai da
   * fileira inteira de uma vez e as setas andam DENTRO dela. Sem isto, chegar
   * ao gráfico pelo teclado custaria nove Tabs.
   *
   * Aceita ←→ e ↑↓ porque a grade quebra em três linhas no celular e em cinco
   * no tablet: qual seta é "a próxima" muda com a largura, e exigir a certa
   * seria exigir que a pessoa soubesse o breakpoint. Home/End vão às pontas.
   * A seleção segue o foco — trocar de métrica é recálculo em memória, não
   * custa uma ida ao banco que justificasse exigir Enter.
   *
   * Com NENHUMA selecionada (o estado inicial), a primeira seta entra na fileira
   * pela ponta correspondente: → começa no primeiro card, ← no último. Recusar a
   * tecla nesse estado deixaria o teclado sem caminho para escolher o foco.
   */
  const aoTeclarNasTabs = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const atual = metricaAtual ? ORDEM_KPIS.indexOf(metricaAtual as MetricaKpi) : -1

      let alvo: number
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown':
          alvo = atual < 0 ? 0 : (atual + 1) % ORDEM_KPIS.length
          break
        case 'ArrowLeft': case 'ArrowUp':
          alvo = atual < 0 ? ORDEM_KPIS.length - 1 : (atual - 1 + ORDEM_KPIS.length) % ORDEM_KPIS.length
          break
        case 'Home': alvo = 0; break
        case 'End': alvo = ORDEM_KPIS.length - 1; break
        default: return
      }

      e.preventDefault()
      const proxima = ORDEM_KPIS[alvo]
      if (!proxima) return
      setMetrica(proxima)
      // O foco tem de acompanhar a seleção, senão o tabindex rotativo deixa o
      // foco numa tab que passou a ser `tabIndex={-1}` e o próximo Tab recomeça
      // do topo do diálogo. `getElementById` e não `querySelector`: o `useId`
      // devolve identificadores com dois-pontos, que quebram um seletor CSS.
      document.getElementById(`${uid}-tab-${proxima}`)?.focus()
    },
    [metricaAtual, setMetrica, uid]
  )

  /**
   * Os feriados DENTRO do intervalo escolhido. A regra mora em
   * `feriadosDoPeriodo`, com os porquês do recorte por calendário.
   *
   * Fica ACIMA do early return de `!aberto` porque é hook: depois dele, a ordem
   * de chamada mudaria entre o modal fechado e aberto.
   */
  const { feriados } = useFeriados()
  const feriadosNoPeriodo = useMemo(
    () => feriadosDoPeriodo(feriados, r.de, r.ate),
    [feriados, r.de, r.ate]
  )

  // `createPortal` precisa de um `document`, que no servidor não existe. Era um
  // `useState(false)` virado por efeito — o único erro de lint do arquivo
  // (setState em cascata) e, no fim, um estado a mais para responder uma
  // pergunta que a própria plataforma responde. Não há risco de divergência de
  // hidratação: `aberto` nasce de `useState(false)` no FiltrosAuditoria e só
  // vira true por clique, ou seja, sempre depois da hidratação.
  if (!aberto || typeof document === 'undefined') return null

  // Numa const local, e não lido de `r.metrica` em cada uso: é o que permite ao
  // TypeScript estreitar `MetricaFoco | null` para `MetricaFoco` dentro dos
  // ramos guardados, sem `!` espalhado pelo JSX.
  const metrica = r.metrica
  const visual = metrica ? KPI_VISUAL[metrica as MetricaKpi] : null
  const totalSessoes =
    r.totais.total + r.totais.faltas + r.totais.faltas_terapeuta + r.totais.unidade_fechada

  /**
   * A mesma informação do `title` da contagem, para quem não tem ponteiro.
   *
   * `title` nativo não é anunciado de forma confiável por leitor de tela e não
   * existe no toque — o arquivo já tinha aprendido isso ao tirar os tooltips do
   * gráfico. Aqui ele fica como atalho de mouse, e a lista dos dias entra por
   * este resumo, que é região viva e já narra o período.
   */
  const resumoFeriados =
    feriadosNoPeriodo.length === 0
      ? ''
      : ` ${feriadosNoPeriodo.length} dia(s) do intervalo são feriado: ${feriadosNoPeriodo
          .map(([data, f]) => `${porExtenso(data)} ${f.nome}`)
          .join('; ')}. As sessões desses dias continuam contadas.`

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 flex h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Carga, erro e contagem por aria-live: os números trocam em silêncio
            quando se muda o intervalo ou a métrica. O PRODUCT.md exige. */}
        <p className="sr-only" role="status" aria-live="polite">
          {r.carregando
            ? 'Calculando o resumo do período.'
            : r.erro
              ? r.erro
              : metrica && visual
                ? `${r.totais[metrica]} em ${visual.title.replace('\n', ' ')} entre ${porExtenso(r.de)} e ${porExtenso(r.ate)}, sobre ${totalSessoes} sessões em ${r.diasComDados} dia(s).${resumoFeriados}`
                : `${totalSessoes} sessões entre ${porExtenso(r.de)} e ${porExtenso(r.ate)}, em ${r.diasComDados} dia(s).${resumoFeriados} Escolha um indicador para ver a evolução.`}
        </p>

        {/* ── Cabeçalho ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-4 pt-5 pb-4 sm:px-8 sm:pt-6 sm:pb-5">
          <div>
            <h2
              id="titulo-visao-gerencial"
              className="flex items-center gap-2 text-lg font-semibold text-slate-900"
            >
              <ChartColumn size={19} className="text-brand" />
              Visão gerencial do período
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Os mesmos indicadores do dia, somados no intervalo que você escolher.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Intervalo + frescor ──────────────────────────────────────── */}
        <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-end sm:gap-5 sm:px-8 sm:py-4">
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-500">De</span>
              <input
                type="date"
                value={r.de}
                max={r.ate}
                onChange={(e) => r.setDe(e.target.value)}
                className="h-11 rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:border-transparent focus:ring-2 focus:ring-brand focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Até</span>
              <input
                type="date"
                value={r.ate}
                min={r.de}
                onChange={(e) => r.setAte(e.target.value)}
                className="h-11 rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:border-transparent focus:ring-2 focus:ring-brand focus:outline-none"
              />
            </label>
          </div>

          {/* A busca fica na mesma faixa do intervalo porque é do mesmo tipo:
              recorta O QUE está sendo somado. Ela filtra em memória, sobre as
              linhas do período já carregadas — então responde a cada tecla sem
              ida ao banco, e todo o resto do modal (totais e gráfico) passa a
              falar do paciente buscado. É também o que ABRE as quatro quebras
              do rodapé, que não existem enquanto o foco é o período inteiro. */}
          <BuscaPaciente
            valor={r.busca}
            pacientes={r.pacientesDoPeriodo}
            ancorado={r.pacienteId !== null}
            metrica={metrica}
            aoDigitar={r.definirBusca}
            aoEscolher={r.escolherPaciente}
          />

          <div className="flex flex-1 items-center justify-between gap-3 sm:justify-end">
            <p className="text-xs text-slate-500">
              {r.carregando
                ? 'calculando…'
                : `${totalSessoes} sessões · ${r.diasComDados} dia${r.diasComDados === 1 ? '' : 's'} com movimento`}
              {!r.carregando && r.busca.trim() && (
                <> · {r.pacientesEncontrados} paciente{r.pacientesEncontrados === 1 ? '' : 's'}</>
              )}
              {!r.carregando && feriadosNoPeriodo.length > 0 && (
                <>
                  {' · '}
                  <span
                    className="text-amber-800"
                    title={feriadosNoPeriodo.map(([data, f]) => `${diaMes(data)} ${f.nome}`).join(' · ')}
                  >
                    {feriadosNoPeriodo.length} feriado{feriadosNoPeriodo.length === 1 ? '' : 's'}
                  </span>
                </>
              )}
              {r.atualizadoEm && !r.carregando && (
                <>
                  {' · '}
                  <span title="Os números são pré-calculados a cada 15 minutos, para a tela abrir sem pesar no banco.">
                    atualizado {new Date(r.atualizadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </>
              )}
            </p>
            <button
              onClick={r.recarregar}
              disabled={r.carregando}
              // h-11, como todo controle desta tela: o DESIGN.md põe 44px como
              // piso de alvo de toque "sem exceções", e este botão era a única
              // exceção do modal.
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-50"
            >
              <RefreshCw size={14} className={r.carregando ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        </div>

        {/* ── Os nove indicadores, que também escolhem o foco ───────────────

            São TABS, e nenhuma vem selecionada. Este é o placar: o primeiro
            passo da tela é ver os nove números do período, e só depois escolher
            um para abrir a evolução e o detalhamento abaixo — a mesma escada que
            a busca já faz com as quebras.

            Nascer com uma acesa era o bug de leitura reportado da tela ("ao
            abrir, o KPI já está vindo selecionado"): com o tingimento da tela
            diária, onde card aceso significa "filtro aplicado à tabela", o modal
            prometia um filtro que ninguém tinha ligado e que clique nenhum
            desligava. Sem seleção inicial não há o que desfazer, e o que a
            pessoa vê na abertura é o período inteiro.

            Tablist sem tab selecionada é estado previsto no padrão: o `tabIndex`
            rotativo passa para a PRIMEIRA, para o teclado ter por onde entrar na
            fileira. */}
        <div
          role="tablist"
          aria-label="Indicador em foco"
          onKeyDown={aoTeclarNasTabs}
          className="border-t border-slate-100 px-4 py-3 sm:px-8"
        >
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            {ORDEM_KPIS.map((kpi, i) => (
              <CardMetrica
                key={kpi}
                id={`${uid}-tab-${kpi}`}
                painelId={`${uid}-painel`}
                metrica={kpi}
                valor={r.totais[kpi]}
                total={totalSessoes}
                carregando={r.carregando}
                ativo={metrica === kpi}
                // Sem seleção, a primeira carrega o tabindex da fileira.
                tabulavel={metrica ? metrica === kpi : i === 0}
                onSelecionar={() => r.setMetrica(kpi)}
              />
            ))}
          </div>
        </div>

        {/* ── Evolução + quebras ───────────────────────────────────────── */}
        {/* `bg-slate-50` sem modificador de opacidade, de propósito: o shim do
            tema escuro casa com `.dark .bg-slate-50`, e esse seletor NÃO pega a
            classe gerada por `bg-slate-50/60` — a faixa inteira ficava clara no
            escuro, calada. Mesma classe que o ModalTokenMensal usa. */}
        {/* O painel das tabs. `tabIndex={0}` não é só requisito do padrão: esta
            é a região que rola, e região rolável precisa ser alcançável pelo
            teclado para poder ser rolada. */}
        <div
          id={`${uid}-painel`}
          role="tabpanel"
          // Sem tab selecionada não há quem rotule o painel: apontar para uma
          // tab que não está selecionada faria o leitor de tela anunciar um foco
          // que a tela não tem.
          aria-labelledby={metrica ? `${uid}-tab-${metrica}` : undefined}
          tabIndex={0}
          // Anel para dentro, não `outline-none` seco: o painel é focável (é ele
          // que rola), e elemento focável sem indicador visível é armadilha de
          // teclado — a pessoa perde de vista onde está.
          className="flex-1 overflow-y-auto border-t border-slate-100 bg-slate-50 px-4 py-4 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset focus-visible:outline-none sm:px-8"
        >
          {r.erro ? (
            <EstadoVazio
              titulo="Não foi possível carregar o resumo"
              detalhe={r.erro}
            />
          ) : r.carregando ? (
            <EstadoVazio titulo="Calculando…" detalhe="Somando os dias do intervalo." />
          ) : r.linhas.length === 0 ? (
            // Busca vazia e intervalo vazio são coisas diferentes, e dizer a
            // frase errada manda a pessoa procurar o problema no lugar errado.
            r.busca.trim() ? (
              <EstadoVazio
                titulo={`Nenhum paciente com "${r.busca.trim()}" no intervalo`}
                detalhe="A busca é pelo nome como ele aparece na agenda. Limpe o campo para ver o período inteiro."
              />
            ) : (
              <EstadoVazio
                titulo="Nenhuma sessão no intervalo"
                detalhe="Não há movimento registrado entre estas datas. Se o período for muito antigo, ele pode ainda não ter sido pré-calculado."
              />
            )
          ) : !metrica || !visual ? (
            // O estado de abertura. Não é uma tela vazia por falta de dado — os
            // nove números estão logo acima, cheios; o que falta é a escolha que
            // diz o que desenhar aqui. Por isso a frase nomeia a ação e diz onde
            // ela está, em vez de anunciar ausência.
            <EstadoVazio
              titulo="Escolha um indicador acima"
              detalhe="A evolução no período e o detalhamento por terapia, motivo e unidade seguem o indicador em foco. Os totais de cada um já estão nos cards."
            />
          ) : (
            <div className="flex flex-col gap-4">
              <Evolucao
                serie={r.serie}
                metrica={metrica}
                diaria={r.serieDiaria}
                tone={visual.tone}
                titulo={visual.title.replace('\n', ' ')}
                feriados={feriados}
              />

              {/* "Por paciente" NÃO fica atrás da busca — as outras três, sim.

                  O gate existia por espaço: as quatro quebras juntas enchiam a
                  dobra de baixo e empurravam o gráfico, que é o passo um, para
                  fora da tela. Mas ele cobrava caro justamente desta: com o
                  indicador em foco, "quem são os maiores" é a pergunta seguinte
                  imediata, e exigir que se buscasse UM paciente para ver a
                  lista de pacientes era circular — a lista respondia quem
                  buscar, e só aparecia depois de já se ter buscado.

                  Sozinha ela não reproduz o problema original: é uma seção, não
                  quatro, e as vinte linhas vão em até três colunas. Terapia,
                  motivo e unidade continuam depois da busca, onde de fato
                  respondem algo específico — o que está acontecendo com ELE. */}
              <Quebra
                titulo="Por paciente"
                fatias={r.porPaciente}
                metrica={metrica}
                barTone={visual.barTone}
                vazio="Nenhum paciente com este indicador no período."
                teto={TETO_FATIAS_PACIENTE}
                colunas={3}
                chaveAtiva={r.pacienteId}
                // Clicar num nome ancora o modal naquela pessoa — o mesmo efeito
                // de escolhê-la na lista de sugestões da busca, e pelo mesmo
                // caminho preciso: por `paciente_id`, que separa homônimo. É o
                // que faz a lista responder "quem?" e também ser o atalho para
                // "e o que está acontecendo com ele?".
                //
                // Clicar de novo no mesmo nome DESFAZ. Sem isso, a única saída
                // de um recorte aberto por clique seria apagar o campo de busca
                // do outro lado da tela — pedir uma ação num lugar para desfazer
                // o efeito de outro.
                aoEscolher={(fatia) =>
                  fatia.chave === r.pacienteId
                    ? r.definirBusca('')
                    : r.escolherPaciente({
                        id: fatia.chave,
                        nome: fatia.rotulo,
                        normalizado: normalizarNome(fatia.rotulo),
                        valor: fatia.kpis[metrica],
                      })
                }
              />

              {r.busca.trim() ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <Quebra
                    titulo="Por terapia"
                    fatias={r.porTerapia}
                    metrica={metrica}
                    barTone={visual.barTone}
                    vazio="Nenhuma terapia com este indicador no período."
                  />
                  <Quebra
                    titulo="Por motivo de glosa"
                    fatias={r.porMotivo.map((f) => ({
                      ...f,
                      // O código sozinho ("1013") não diz nada a quem contesta,
                      // e o texto sozinho não é o que se cita na contestação —
                      // os dois juntos, então. O extenso vem do de-para que o
                      // sistema aprende sozinho; enquanto ele não conhece o
                      // código, mostra o código puro em vez de inventar rótulo.
                      rotulo:
                        f.chave === '—'
                          ? 'Sem código'
                          : glosaCodigos.get(f.chave)
                            ? `${f.chave} · ${glosaCodigos.get(f.chave)}`
                            : f.chave,
                    }))}
                    metrica={metrica}
                    barTone={visual.barTone}
                    vazio="Nenhuma recusa com código no período."
                  />
                  <Quebra
                    titulo="Por unidade"
                    fatias={r.porUnidade}
                    metrica={metrica}
                    barTone={visual.barTone}
                    vazio="Sem unidade identificada no período."
                  />
                </div>
              ) : (
                // Área que some sem explicação lê-se como tela quebrada. A frase
                // fica no lugar exato onde as quebras vão aparecer e nomeia a
                // ação que as traz. Agora ela aponta para a lista logo ACIMA,
                // não só para o campo de busca: com os nomes na tela, escolher
                // um deles é o caminho curto — e é o preciso, porque fixa o
                // `paciente_id` e não o texto, o que separa homônimo.
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-center text-xs text-slate-500">
                  Escolha um paciente acima — ou busque pelo nome — para ver o detalhamento por
                  terapia, motivo de glosa e unidade.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Quantos pacientes a lista de sugestões oferece de uma vez. */
const TETO_SUGESTOES = 8

/**
 * A busca por paciente, com sugestões.
 *
 * Era um `<input type="search">` puro, e digitar às cegas custava caro: errar
 * uma letra devolvia "Nenhum paciente com X no intervalo" sem pista da grafia
 * certa, dois homônimos viravam um número somado sem oferecer escolha, e — desde
 * que as quebras passaram a depender da busca — não havia mais como descobrir
 * QUEM buscar. As sugestões resolvem os três de uma vez.
 *
 * **Texto livre continua valendo.** É a diferença para o `SearchCombobox` do
 * cronograma, que é seleção estrita e marca texto fora da lista como erro: aqui
 * "silva" achar quinze pessoas é uso legítimo, e o campo não pode chamar isso de
 * inválido. Escolher na lista é o caminho PRECISO (fixa o `paciente_id`, imune a
 * homônimo), não o único caminho.
 *
 * A gramática de teclado e mouse é a mesma daquele componente, de propósito —
 * ↓↑ navegam, Enter escolhe, Escape fecha a lista, `onMouseDown` + `preventDefault`
 * evita o blur comer o clique. O que muda é o vocabulário visual (slate/brand
 * desta tela, não os tokens do cronograma) e o que faltava lá: `role="combobox"`
 * e `aria-activedescendant`, sem os quais o leitor de tela não acompanha a
 * navegação por setas.
 *
 * Com o campo vazio a lista mostra os maiores da métrica em foco — ou, na
 * abertura, quem teve mais sessões no período. Não é enfeite: é o ranking que a
 * tela perdeu quando as quebras foram para trás da busca.
 */
function BuscaPaciente({
  valor, pacientes, ancorado, metrica, aoDigitar, aoEscolher,
}: {
  valor: string
  pacientes: PacienteSugerido[]
  /** A busca está presa a um paciente exato (escolhido na lista). */
  ancorado: boolean
  /** `null` enquanto nenhum indicador está em foco — a lista então ordena por
   *  sessões no período, e a frase de "nada encontrado" não cita indicador. */
  metrica: MetricaFoco | null
  aoDigitar: (texto: string) => void
  aoEscolher: (paciente: PacienteSugerido) => void
}) {
  const id = useId()
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(-1)
  const refLista = useRef<HTMLUListElement>(null)
  // O fechamento adiado do blur, guardado para ser cancelado no desmonte: o
  // modal pode fechar com o campo em foco, e um timer solto acordaria depois
  // para mexer em componente que não existe mais.
  const refFechamento = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (refFechamento.current) clearTimeout(refFechamento.current) }, [])

  const sugestoes = useMemo(() => {
    const alvo = normalizarNome(valor)
    const base = alvo ? pacientes.filter((p) => p.normalizado.includes(alvo)) : pacientes
    return base.slice(0, TETO_SUGESTOES)
  }, [valor, pacientes])

  const rotuloMetrica = metrica ? KPI_VISUAL[metrica as MetricaKpi]?.title.replace('\n', ' ') : null
  const lista = aberto && sugestoes.length > 0

  function escolher(paciente: PacienteSugerido) {
    aoEscolher(paciente)
    setAberto(false)
    setAtivo(-1)
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      // Só fecha a lista. O `useModalDialog` já sabe não fechar o modal
      // enquanto este campo estiver com `aria-expanded="true"`.
      if (aberto) { setAberto(false); setAtivo(-1) }
      return
    }
    if (e.key === 'ArrowDown' && !aberto) {
      e.preventDefault()
      setAberto(true)
      setAtivo(0)
      return
    }
    if (!lista) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const proximo = Math.min(ativo + 1, sugestoes.length - 1)
      setAtivo(proximo)
      refLista.current?.children[proximo]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const anterior = Math.max(ativo - 1, 0)
      setAtivo(anterior)
      refLista.current?.children[anterior]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      // Com uma sugestão só, Enter escolhe ela mesmo sem navegar — é o atalho
      // que quem digita o nome inteiro espera.
      const alvo = ativo >= 0 ? ativo : sugestoes.length === 1 ? 0 : -1
      if (alvo >= 0 && sugestoes[alvo]) {
        e.preventDefault()
        escolher(sugestoes[alvo])
      }
    }
  }

  return (
    <div className="relative flex-1 sm:max-w-72">
      <label htmlFor={id} className="sr-only">
        Buscar paciente pelo nome
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500"
      />
      <input
        id={id}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={lista}
        aria-controls={lista ? `${id}-lista` : undefined}
        aria-activedescendant={lista && ativo >= 0 ? `${id}-opcao-${ativo}` : undefined}
        aria-describedby={`${id}-dica`}
        value={valor}
        onChange={(e) => { aoDigitar(e.target.value); setAberto(true); setAtivo(-1) }}
        onFocus={() => setAberto(true)}
        // O atraso deixa o `onMouseDown` da opção chegar antes do fechamento.
        onBlur={() => {
          if (refFechamento.current) clearTimeout(refFechamento.current)
          refFechamento.current = setTimeout(() => { setAberto(false); setAtivo(-1) }, 150)
        }}
        onKeyDown={aoTeclar}
        placeholder="Buscar paciente"
        className={`h-11 w-full rounded-xl border pr-3 pl-10 text-sm text-slate-800 focus:border-transparent focus:ring-2 focus:ring-brand focus:outline-none ${
          // Âncora em esmeralda: o campo diz que está preso a UMA pessoa, e não
          // filtrando por um pedaço de texto que pode casar com várias.
          ancorado ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'
        }`}
      />
      <span id={`${id}-dica`} className="sr-only">
        Digite para filtrar, ou use as setas para escolher um paciente da lista.
        Escolher da lista recorta por pessoa e não por nome, o que separa homônimos.
      </span>

      {lista && (
        <ul
          ref={refLista}
          id={`${id}-lista`}
          role="listbox"
          aria-label="Pacientes do período"
          // z-20 porque os cards de KPI vêm DEPOIS no DOM e, sem isso, pintam
          // por cima da lista. `max-h` + rolagem própria para a lista nunca
          // esbarrar no `overflow-hidden` do modal.
          className="absolute top-[calc(100%+4px)] right-0 left-0 z-20 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {sugestoes.map((paciente, i) => (
            <li key={paciente.id}>
              <button
                type="button"
                role="option"
                id={`${id}-opcao-${i}`}
                aria-selected={i === ativo}
                onMouseDown={(e) => { e.preventDefault(); escolher(paciente) }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                  i === ativo ? 'bg-brand-surface text-brand-fg' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="truncate">{paciente.nome}</span>
                {/* O número da métrica em foco: ordena a lista, explica a ordem
                    e é o que separa dois homônimos que, só pelo nome, seriam a
                    mesma linha duas vezes. */}
                <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                  {paciente.valor}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberto && sugestoes.length === 0 && valor.trim() && (
        <p
          role="status"
          className="absolute top-[calc(100%+4px)] right-0 left-0 z-20 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-lg"
        >
          Nenhum paciente com esse nome {rotuloMetrica ? `em ${rotuloMetrica.toLowerCase()} ` : ''}no período.
        </p>
      )}
    </div>
  )
}

/**
 * O card de um indicador no modal — uma TAB que troca o que o painel abaixo
 * mostra.
 *
 * O conteúdo vem inteiro de `KPI_VISUAL`, o mesmo mapa da tela diária: quem
 * reconhece o violeta de Glosas no dia reconhece no mês. **O que NÃO se repete é
 * o estado ativo**, e essa é a correção. Lá, card aceso significa "filtro
 * aplicado à tabela", pintado no matiz do próprio status. Repetir esse desenho
 * aqui — onde aceso significa "é isto que o gráfico está mostrando" — era fazer
 * o mesmo desenho dizer duas coisas, e foi lido como filtro esquecido.
 *
 * A seleção veste o STEEL DA MARCA: borda steel, barra steel no topo e a
 * elevação. É a Decoration-Free Semantics Rule do DESIGN.md (§242) aplicada ao
 * pé da letra — matiz que já carrega um status está gasto e não decora, e
 * indicador de navegação é papel do steel. Sem tingir a superfície, que a One
 * Steel Rule (§238) reserva: steel é acento, não cor de fundo.
 *
 * O matiz da métrica não se perde na ligação card→gráfico: ele continua no
 * ícone, no número, na pílula e no traço da linha logo abaixo.
 */
function CardMetrica({
  id, painelId, metrica, valor, total, carregando, ativo, tabulavel, onSelecionar,
}: {
  id: string
  painelId: string
  metrica: MetricaKpi
  valor: number
  total: number
  carregando: boolean
  ativo: boolean
  /** Quem carrega o `tabIndex={0}` da fileira. Igual a `ativo`, exceto quando
   *  nenhuma está selecionada — aí é a primeira. */
  tabulavel: boolean
  onSelecionar: () => void
}) {
  const visual = KPI_VISUAL[metrica]
  const Icon = visual.icon
  const percent = total > 0 ? Math.round((valor / total) * 100) : 0

  return (
    <button
      id={id}
      role="tab"
      aria-selected={ativo}
      aria-controls={painelId}
      // Tabindex rotativo: só uma da fileira é tabulável, e as setas andam
      // dentro dela. Ver `aoTeclarNasTabs`.
      tabIndex={tabulavel ? 0 : -1}
      onClick={onSelecionar}
      className={`
        relative flex w-full flex-col items-center rounded-xl border-2 p-1.5 text-left transition-colors
        hover:shadow-md motion-safe:transition motion-safe:hover:-translate-y-px
        focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:outline-none
        ${ativo ? 'border-brand bg-white shadow-md' : `border-slate-200/80 bg-white shadow-sm ${visual.hoverBorder}`}
      `}
    >
      {/* A barra que liga a tab ao painel. Steel, e a única coisa nova no card:
          a cor sozinha nunca é o sinal — a borda, a elevação e o `aria-selected`
          dizem o mesmo. */}
      {ativo && (
        <span
          aria-hidden
          className="absolute inset-x-4 top-0 h-0.75 rounded-b-full bg-brand"
        />
      )}
      <div className={`flex h-7 w-7 items-center justify-center rounded-full ${visual.iconTone}`}>
        <Icon size={13} />
      </div>
      <p
        className={`mt-1.5 text-center text-[11px] leading-snug font-semibold whitespace-pre-line ${
          ativo ? 'text-slate-900' : 'text-slate-600'
        }`}
      >
        {visual.title}
      </p>
      <span className={`mt-1 text-2xl leading-none font-bold ${visual.tone}`}>
        {carregando ? '—' : valor}
      </span>
      <div className="mt-1.5 w-full px-1">
        {/* A mesma pílula da tela diária (`KpiCards.tsx`): o percentual sobre o
            total de sessões do recorte, no matiz do próprio indicador. Repetir
            a forma é o ponto — quem lê "18%" em violeta no dia lê o mesmo no
            período, e a barra logo abaixo deixa de ser a única portadora de uma
            proporção que ninguém conseguia citar. */}
        <div className="mb-1.5 flex justify-center">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${visual.iconTone}`}
          >
            {carregando ? '' : `${percent}%`}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-slate-100">
          {/* `transition-[width]`, não `transition-all`: só a largura muda, e
              `all` põe o navegador para vigiar toda propriedade animável do
              elemento. Sob `prefers-reduced-motion` a barra salta para o valor
              em vez de correr. */}
          <div
            className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 ${visual.barTone}`}
            style={{ width: `${carregando ? 0 : percent}%` }}
          />
        </div>
      </div>
    </button>
  )
}

/**
 * A evolução do indicador em foco — uma LINHA, não colunas.
 *
 * Por que linha: o eixo é o tempo, e o que se lê num período é a FORMA — em que
 * dias a coisa sobe, se vem caindo, se o pico foi um episódio ou um patamar.
 * Coluna afirma que cada dia é uma categoria independente, que é a leitura certa
 * para "por paciente" (as quebras abaixo, que seguem em barra) e a errada para
 * uma série temporal. E colunas somem: num intervalo de 30 ou 60 dias cada barra
 * ficava com poucos pixels e o gráfico precisava rolar de lado. A linha comporta
 * o período inteiro na largura que existe.
 *
 * Continua SEM Recharts, e a razão de antes não mudou: o shim global de tema
 * escuro remapeia `bg-`, `text-`, `border-` e `ring-`, mas NÃO `fill-` nem
 * `stroke-` — uma série pintada por classe utilitária de SVG continuaria clara
 * no escuro, calada. A saída é o SVG não pintar nada por classe própria: traço e
 * área saem em `currentColor`, herdado do `text-*` que a métrica já usa nos
 * cards (`visual.tone`), e o ponto usa `bg-current`. A cor entra pelo único
 * canal que o shim cobre.
 *
 * `preserveAspectRatio="none"` estica um viewBox de 0–100 para a caixa real, o
 * que dispensa medir o contêiner; `vector-effect="non-scaling-stroke"` é o que
 * impede esse esticamento de deformar a espessura do traço.
 *
 * Uma série só, então não há legenda: o título nomeia o que está desenhado. O
 * pico fica marcado o tempo todo, porque é o número que o cabeçalho cita e ele
 * precisa ter uma data.
 *
 * **Ler um ponto não depende de mouse.** A versão anterior punha o valor num
 * `title` nativo sobre faixas não-focáveis, e isso significava três coisas
 * ruins: em toque não havia hover, então a série inteira era ilegível num
 * aparelho — e o PRODUCT.md diz que a ferramenta roda como PWA no celular e
 * proíbe interação só-por-hover; no teclado não havia como chegar aos pontos; e
 * `title` não é anunciado de forma confiável por leitor de tela, então o dado
 * simplesmente não existia para quem usa um.
 *
 * A correção é uma superfície ÚNICA de leitura sobre o gráfico, em vez de uma
 * faixa por ponto. Ela resolve o alvo de toque de raiz: com sessenta faixas cada
 * uma teria ~10px e nenhuma chegaria perto dos 44px, enquanto uma superfície só
 * cobre a caixa inteira e o ponto sai da posição do dedo. Teclado entra por ela
 * (←→, Home/End) e o valor é anunciado por uma região viva no cabeçalho.
 *
 * O valor lido mora no CABEÇALHO, não flutuando sobre o ponto. Foi o que
 * resolveu de vez o rótulo batendo no título do gráfico: no cabeçalho ele tem
 * lugar fixo, largura previsível e nada para atropelar.
 */
function Evolucao({
  serie, metrica, diaria, tone, titulo, feriados,
}: {
  serie: FatiaKpis[]
  metrica: MetricaFoco
  diaria: boolean
  /** Classe `text-*` da métrica. É dela que saem traço, área e ponto. */
  tone: string
  titulo: string
  /**
   * Feriados por data ISO. Entra como prop em vez de virar campo de
   * `FatiaKpis`: aquele tipo é compartilhado pelas quatro quebras (por terapia,
   * motivo, unidade e paciente), onde "feriado" não significaria nada.
   */
  feriados: Record<string, FeriadoInfo>
}) {
  const maximo = Math.max(1, ...serie.map((f) => f.kpis[metrica]))
  const n = serie.length

  const rotuloDe = (chave: string) => (diaria ? diaMes(chave) : `sem. ${diaMes(chave)}`)

  /**
   * O feriado de um ponto — só na série DIÁRIA.
   *
   * Acima de 45 dias a `chave` deixa de ser um dia e passa a ser a segunda-feira
   * da semana; marcar a semana inteira como feriado seria afirmação falsa, então
   * a marcação simplesmente não existe nesse recorte.
   */
  const feriadoDe = (chave: string) => (diaria ? feriados[chave] : undefined)

  // Quantos rótulos de data cabem, medido — não chutado.
  //
  // Antes era um a cada `ceil(n/12)`, a 9px e em slate-400: as datas estavam
  // tecnicamente no eixo e não se liam, que é o mesmo que não estarem. Com a
  // largura real em mãos dá para mostrar TODAS quando cabem e só ralear quando
  // não cabem, em 11px (o piso do DESIGN.md §3). O rótulo semanal ("sem. 10/08")
  // é quase o dobro do diário, e por isso a folga é diferente para cada um.
  const refPlot = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  useEffect(() => {
    const el = refPlot.current
    if (!el) return
    const observador = new ResizeObserver(([entrada]) => setLargura(entrada.contentRect.width))
    observador.observe(el)
    return () => observador.disconnect()
  }, [])
  const folgaRotulo = diaria ? 44 : 70
  const cabem = largura > 0 ? Math.max(2, Math.floor(largura / folgaRotulo)) : 12
  const passo = Math.max(1, Math.ceil(n / cabem))

  /**
   * A primeira e a última data aparecem sempre — são elas que dizem qual
   * período está desenhado. As do meio raleiam. O `>= passo / 2` evita o rótulo
   * espremido contra o último, que é o que acontece quando `n - 1` não é
   * múltiplo do passo.
   */
  const mostrarRotulo = (i: number) =>
    i === 0 || i === n - 1 || (i % passo === 0 && n - 1 - i >= passo / 2)

  /**
   * Teto do traçado, em % da caixa. Uma folga pequena, só para o círculo do pico
   * não ser cortado pela borda de cima. Era 80 quando o valor era escrito acima
   * do ponto e precisava de espaço; agora que ele mora no cabeçalho, o traçado
   * recupera a altura e a variação da série volta a se ler.
   */
  const TETO = 92

  // Um único ponto não tem "entre": ele fica no meio, sem linha para desenhar.
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)
  const altura = (valor: number) => (valor / maximo) * TETO

  const pontos = serie.map((fatia, i) => `${x(i)},${100 - altura(fatia.kpis[metrica])}`).join(' ')
  // A área fecha descendo até a base nas duas pontas. Só existe com 2+ pontos.
  const area = n > 1 ? `${x(0)},100 ${pontos} ${x(n - 1)},100` : ''

  const iPico = serie.reduce(
    (melhor, fatia, i) => (fatia.kpis[metrica] > serie[melhor].kpis[metrica] ? i : melhor),
    0
  )

  /** O ponto sendo lido — por dedo, por mouse ou por seta. */
  const [ativo, setAtivo] = useState<number | null>(null)
  const refCaixa = useRef<HTMLDivElement>(null)
  const fatiaAtiva = ativo !== null ? serie[ativo] : undefined

  /** O ponto mais próximo do X do ponteiro. Nada de faixa por ponto. */
  function indiceDoPonteiro(clientX: number): number | null {
    const caixa = refCaixa.current
    if (!caixa || n === 0) return null
    const { left, width } = caixa.getBoundingClientRect()
    if (width === 0) return null
    const razao = (clientX - left) / width
    return Math.min(n - 1, Math.max(0, Math.round(razao * (n - 1))))
  }

  function aoTeclarNoGrafico(e: React.KeyboardEvent<HTMLDivElement>) {
    // Escape de propósito NÃO entra aqui: o `useModalDialog` escuta em captura
    // no document e fecharia o diálogo antes de qualquer coisa. Sair da leitura
    // é sair do elemento — o blur já limpa.
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setAtivo((i) => Math.min((i ?? iPico - 1) + 1, n - 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setAtivo((i) => Math.max((i ?? iPico + 1) - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setAtivo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setAtivo(n - 1)
    }
  }

  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${tone}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {titulo} {diaria ? 'por dia' : 'por semana'}
        </h3>
        {/* O mostrador. Região viva porque é ela que anuncia a leitura de cada
            ponto para quem navega por seta — sem isso, andar pela série com o
            teclado seria mover um círculo em silêncio. `tabular-nums` para o
            número não empurrar o texto ao trocar de casa decimal. */}
        <span
          role="status"
          aria-live="polite"
          className="shrink-0 text-xs tabular-nums text-slate-500"
        >
          {fatiaAtiva
            ? `${rotuloDe(fatiaAtiva.chave)} · ${fatiaAtiva.kpis[metrica]}${
                feriadoDe(fatiaAtiva.chave) ? ` · feriado (${feriadoDe(fatiaAtiva.chave)!.nome})` : ''
              }`
            : `pico de ${maximo}`}
        </span>
      </div>

      {n === 0 ? (
        // slate-500, não slate-400: a 400 dá 2,6:1 sobre branco e reprova nos
        // 4,5:1 da AA. É texto de estado vazio — justamente o que alguém lê
        // quando está perdido, e o pior lugar para economizar contraste.
        <p className="py-8 text-center text-xs text-slate-500">Sem dias com movimento no intervalo.</p>
      ) : (
        // A folga lateral existe para o primeiro e o último ponto, que caem
        // exatamente na borda do traçado: sem ela metade do círculo e metade do
        // rótulo de data ficariam fora da caixa.
        <div ref={refPlot} className="px-4">
          <div className="relative h-32">
            {/* A base do zero. Sem ela um vale não se distingue de "acabou o
                gráfico" — a linha some no branco. */}
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-slate-200" />

            <svg
              aria-hidden
              className="absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {area && <polygon points={area} fill="currentColor" fillOpacity={0.1} />}
              <polyline
                points={pontos}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {/* Os feriados do intervalo, marcados por régua vertical.
                Vem ANTES do pico e do ponto ativo de propósito: é pano de
                fundo, e os dois marcadores redondos têm de ficar por cima.

                Régua, e não um destaque no rótulo do eixo: `mostrarRotulo`
                ralea as datas quando o período é longo e poderia esconder
                justamente o feriado — a marcação sumiria no recorte em que ela
                mais importa. Âmbar sólido, sem opacidade, pelo shim de tema. */}
            {serie.map((fatia, i) =>
              feriadoDe(fatia.chave) ? (
                <span
                  key={`feriado-${fatia.chave}`}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-amber-300"
                  style={{ left: `${x(i)}%` }}
                />
              ) : null
            )}

            {/* O pico, marcado o tempo todo: é o número que o cabeçalho cita
                quando nada está sendo lido, e ele precisa ter uma data. */}
            <span
              aria-hidden
              className="absolute h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-current"
              style={{ left: `${x(iPico)}%`, bottom: `${altura(serie[iPico]?.kpis[metrica] ?? 0)}%` }}
            />

            {/* O ponto em leitura: anel branco por dentro para se destacar sobre
                a própria linha, que passa por baixo dele. */}
            {ativo !== null && fatiaAtiva && (
              <>
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-slate-200"
                  style={{ left: `${x(ativo)}%` }}
                />
                <span
                  aria-hidden
                  className="absolute h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-current ring-2 ring-white"
                  style={{ left: `${x(ativo)}%`, bottom: `${altura(fatiaAtiva.kpis[metrica])}%` }}
                />
              </>
            )}

            {/* A superfície de leitura — uma só, cobrindo a caixa inteira.
                `touch-none` impede o navegador de tratar o arrasto como rolagem
                enquanto se percorre a série com o dedo. */}
            <div
              ref={refCaixa}
              role="group"
              tabIndex={0}
              aria-label={`${titulo} ${diaria ? 'por dia' : 'por semana'}. Use as setas para percorrer ${n} ponto${n === 1 ? '' : 's'}.`}
              onPointerDown={(e) => setAtivo(indiceDoPonteiro(e.clientX))}
              onPointerMove={(e) => {
                if (e.pointerType === 'mouse' || e.buttons > 0) setAtivo(indiceDoPonteiro(e.clientX))
              }}
              // Só o mouse limpa ao sair. Em toque o `pointerleave` dispara
              // quando o dedo levanta, e limpar ali apagaria a leitura no
              // instante em que ela acabou de ser pedida.
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAtivo(null) }}
              onFocus={() => setAtivo((i) => i ?? iPico)}
              onBlur={() => setAtivo(null)}
              onKeyDown={aoTeclarNoGrafico}
              className="absolute inset-0 touch-none rounded focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            />
          </div>

          {/* O eixo das datas. As das pontas se alinham PELA BORDA (a primeira
              pela esquerda, a última pela direita) em vez de centradas no
              ponto: centradas, metade de cada uma cairia fora da caixa. */}
          <div className="relative mt-2 h-4">
            {serie.map((fatia, i) =>
              mostrarRotulo(i) ? (
                <span
                  key={fatia.chave}
                  className={`absolute text-[11px] whitespace-nowrap tabular-nums text-slate-500 ${
                    i === 0 && n > 1
                      ? ''
                      : i === n - 1 && n > 1
                        ? '-translate-x-full'
                        : '-translate-x-1/2'
                  }`}
                  style={{ left: `${x(i)}%` }}
                >
                  {rotuloDe(fatia.chave)}
                </span>
              ) : null
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Quantas fatias uma quebra mostra. O corte existe para as quatro quebras
 * caberem lado a lado sem virar quatro listas rolando; o rodapé abaixo é o que
 * impede o corte de ser silencioso.
 */
const TETO_FATIAS = 8

/**
 * O teto de "Por paciente", que é maior que o das outras três.
 *
 * Ela não divide a largura com ninguém — ocupa a faixa inteira quando não há
 * busca —, então oito nomes deixavam a lista curta num espaço que comporta
 * bem mais. Vinte é o tamanho em que a pergunta "quem são os maiores" começa a
 * ter resposta útil: com oito, num mês de ~7.700 sessões, o corte caía dentro
 * do grupo que ainda importa.
 */
const TETO_FATIAS_PACIENTE = 20

/** Uma quebra do indicador em foco, do maior ofensor para o menor. */
function Quebra({
  titulo, fatias, metrica, barTone, vazio, teto = TETO_FATIAS, colunas = 1, aoEscolher,
  chaveAtiva = null,
}: {
  titulo: string
  fatias: FatiaKpis[]
  metrica: MetricaFoco
  barTone: string
  vazio: string
  /** Quantas fatias mostrar antes do corte. Ver `TETO_FATIAS_PACIENTE`. */
  teto?: number
  /** Em quantas colunas quebrar a lista. Só "Por paciente" usa mais de uma:
   *  vinte nomes numa coluna só empurrariam o gráfico para fora da tela, que é
   *  justamente o que o gate da busca existia para impedir. */
  colunas?: number
  /**
   * Torna as fatias clicáveis, ancorando o modal naquela chave.
   *
   * Só "Por paciente" passa: a `chave` dela é o `paciente_id`, que é o que a
   * âncora precisa. Nas outras três a chave é TUSS, código de glosa ou nome de
   * unidade — clicar não teria para onde levar. Ausente, a lista continua sendo
   * texto, sem prometer interação que não existe.
   */
  aoEscolher?: (fatia: FatiaKpis) => void
  /** A chave ancorada, para a lista dizer em qual linha o modal está preso. */
  chaveAtiva?: string | null
}) {
  const maximo = Math.max(1, ...fatias.map((f) => f.kpis[metrica]))

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{titulo}</h3>
      {fatias.length === 0 ? (
        // slate-500 pelo mesmo motivo do estado vazio do gráfico: 400 sobre
        // branco é 2,6:1 e reprova na AA.
        <p className="text-xs text-slate-500">{vazio}</p>
      ) : (
        <ul
          className={
            colunas > 1
              ? 'grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3'
              : 'flex flex-col gap-2'
          }
        >
          {fatias.slice(0, teto).map((fatia) => {
            const valor = fatia.kpis[metrica]
            const ativa = chaveAtiva !== null && fatia.chave === chaveAtiva
            const conteudo = (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-xs ${ativa ? 'font-semibold text-brand-fg' : 'text-slate-700'}`}
                    title={fatia.rotulo}
                  >
                    {fatia.rotulo}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-slate-900">{valor}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${barTone}`}
                    style={{ width: `${(valor / maximo) * 100}%` }}
                  />
                </div>
              </>
            )

            return (
              <li key={fatia.chave} className="flex flex-col">
                {aoEscolher ? (
                  // Botão de verdade, e não um `div` com onClick: é o que dá
                  // teclado e leitor de tela de graça. O alvo cobre a linha
                  // inteira (nome + número + barra), então não exige mira.
                  <button
                    type="button"
                    onClick={() => aoEscolher(fatia)}
                    // `aria-pressed` é o que diz a um leitor de tela que a linha
                    // é um alternador e qual está ligada — a cor do nome sozinha
                    // não diria nada ali, e nem para quem não distingue matiz.
                    aria-pressed={ativa}
                    className={`flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                      ativa ? 'bg-brand-surface' : 'hover:bg-slate-50'
                    }`}
                  >
                    {conteudo}
                  </button>
                ) : (
                  <div className="flex flex-col gap-1">{conteudo}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {/* O corte, dito em voz alta. Uma lista que para na oitava linha sem
          avisar deixa quem lê concluir que são oito e pronto — e aqui isso é
          uma conclusão sobre dinheiro. "Maiores" é literal: `ordenarPorFoco`
          já entrega a lista em ordem decrescente da métrica em foco. */}
      {fatias.length > teto && (
        <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] tabular-nums text-slate-500">
          Mostrando {teto} de {fatias.length} — as maiores primeiro.
        </p>
      )}
    </section>
  )
}

function EstadoVazio({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 py-16 text-center">
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
      <p className="max-w-md text-xs text-slate-500">{detalhe}</p>
    </div>
  )
}
