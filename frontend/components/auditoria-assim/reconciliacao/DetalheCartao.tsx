'use client'

import type { ReactNode } from 'react'
import { Ban, ExternalLink, KeySquare, Link2, ShieldAlert, X } from 'lucide-react'
import { autorizacaoCancelada, autorizacaoLiberada } from '@/hooks/useAnaliseReincidencia'
import { completarMotivoGlosa, lerMotivoGlosa } from '@/lib/glosa'
import { rotuloOrigemGuia, rotuloSolicitadoPor } from '@/lib/guiaOrigem'
import SituacaoBadge from '../SituacaoBadge'
import type { NotaManual, TokenConferencia } from '@/services/auditoria-assim.service'
import type { CartaoGrade, ReclassificacaoSituacao } from '../types'
import { dataHoraCurta, dataHoraDeTimestamptz, formatarDiaComNome } from './datas'
import { sessaoDoBloco } from './vinculo'
import { rotuloForma } from '../formaValidacao'

/**
 * Tudo o que se sabe sobre um atendimento — sem sair da semana.
 *
 * Substituiu a seção "histórico de autorizações" que vivia no pé do modal
 * (2026-08-24). O histórico repetia, em lista cronológica, guias que a grade já
 * mostrava; a única coisa que ele acrescentava era o motivo da recusa por
 * extenso, e custava uma seção inteira mais um botão no rodapé para isso.
 *
 * Nada aqui é buscado. A semana inteira da clínica já está em memória e o cartão
 * carrega a linha de origem (`origem`), então todo campo abaixo é leitura de
 * objeto — nenhuma requisição, nem ao abrir a gaveta nem ao trocar de cartão.
 *
 * ── Gaveta, e não um quarto modal ─────────────────────────────────────────
 *
 * É um painel DENTRO do modal da semana, não um `createPortal` com foco próprio.
 * Dois `useModalDialog` ativos brigam pelo Tab e fazem o Escape fechar os dois —
 * é o motivo de os três diálogos desta aba nunca empilharem. Quem fecha esta
 * gaveta no Escape é o `fechar` do modal da semana, que a consulta antes de
 * fechar a si mesmo.
 *
 * A grade continua visível ao lado de propósito: a pergunta que traz alguém aqui
 * ("esta guia cobre o quê?") se responde comparando com os vizinhos da semana, e
 * uma gaveta que tapa a evidência obriga a fechar e reabrir para conferir.
 * Abaixo de `sm` ela ocupa a largura toda, porque ali não há espaço para os dois.
 */

/** Um par rótulo/valor. Valor ausente vira travessão — a linha nunca some. */
function Campo({ rotulo, children }: { rotulo: string; children?: ReactNode }) {
  const vazio = children === null || children === undefined || children === ''
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[11px] text-slate-500">{rotulo}</dt>
      <dd className="min-w-0 text-right text-[12px] font-medium text-slate-800">
        {vazio ? <span className="font-normal text-slate-400">—</span> : children}
      </dd>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-4 py-2 sm:px-5">
      <h4 className="pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-brand-fg uppercase">
        {titulo}
      </h4>
      <dl className="divide-y divide-slate-50">{children}</dl>
    </section>
  )
}

/** Só imprime a seção quando algum campo existe — evita um bloco de travessões. */
function temAlgum(...valores: unknown[]): boolean {
  return valores.some((v) => v !== null && v !== undefined && v !== '')
}

export default function DetalheCartao({
  cartao,
  codigosGlosa,
  conferencia,
  nota,
  reclassificacao,
  podeVincular,
  podeReclassificar,
  onVincular,
  onReclassificar,
  onFechar,
}: {
  cartao: CartaoGrade
  codigosGlosa: Map<string, string>
  /**
   * A conferência da filipeta deste bloco.
   *
   * Vem de fora e NÃO de `cartao.origem`: `get_auditoria_assim` não devolve
   * `token_conferido` embora `AuditoriaAssimItem` o declare — o serviço faz um
   * cast do retorno da RPC, e o campo chega `undefined`. Ler dali dizia "ainda
   * não" numa filipeta conferida. A fonte é `auditoria_token_conferencias`,
   * juntada no cliente (ver `buscarNotasEConferencias`).
   */
  conferencia?: TokenConferencia
  /** A anotação manual deste bloco, de `auditoria_atendimento_notas`. Mesma razão. */
  nota?: NotaManual
  /**
   * A reclassificação ATIVA desta sessão, quando há uma.
   *
   * Vem de fora pelo mesmo motivo da nota e da conferência — a RPC não a devolve
   * como objeto. Mas a diferença em relação às duas é importante: a `situacao`
   * que o cartão já mostra JÁ está reclassificada. Esta prop não corrige o
   * estado; ela diz QUEM o mudou. Sem ela o cartão apareceria "Falta" sobre uma
   * sessão que a ASSIM glosou, sem nada explicando a discrepância.
   */
  reclassificacao?: ReclassificacaoSituacao
  podeVincular: boolean
  /** `admin`/`autorizacao`. Mais estreito que `podeVincular` — ver a RPC. */
  podeReclassificar: boolean
  onVincular: (guia: string) => void
  onReclassificar: (cartao: CartaoGrade) => void
  onFechar: () => void
}) {
  // Estreitar pelo discriminante em duas variáveis, e não por um booleano: um
  // `const ehSessao = ...` não estreita `cartao` dentro do JSX, e a alternativa
  // seria repetir `cartao.tipo === 'sessao'` em cada bloco.
  const daSessao = cartao.tipo === 'sessao' ? cartao : null
  const daGuia = cartao.tipo === 'autorizacao' ? cartao : null

  // Mesmo parser que a Conferência e a Central usam: numa recusa o texto vem
  // "1601-REINCIDENCIA NO ATEN", cortado em 25 caracteres, e o de-para completa
  // o que a ASSIM truncou. Aqui ele cabe inteiro — era a única coisa que o
  // histórico do rodapé mostrava e o cartão não.
  //
  // Só `descricao_erro`, e não mais `descricao_erro ?? motivo_glosa`: os dois
  // são vozes diferentes sobre o mesmo bloco — um é o que a ASSIM respondeu, o
  // outro é o que alguém escreveu à mão na aba Auditoria — e o `??` fazia o
  // texto manual sumir sempre que houvesse resposta da ASSIM, isto é, quase
  // sempre. As duas abas leem o MESMO bloco e têm de dizer as mesmas coisas
  // sobre ele; ver a seção "Motivo da glosa" abaixo.
  const motivoBruto = daSessao
    ? daSessao.origem.descricao_erro
    : autorizacaoLiberada(daGuia?.status ?? null) || autorizacaoCancelada(daGuia?.status ?? null)
      ? null
      : (daGuia?.descricao_erro ?? daGuia?.status ?? null)
  const motivo = completarMotivoGlosa(lerMotivoGlosa(motivoBruto), codigosGlosa)

  /**
   * O motivo escrito à mão na aba Auditoria (`auditoria_glosa_motivos`).
   *
   * É o mesmo campo que o `ModalDetalhamentoAtendimento` lê e edita, e ele
   * sobrevive à resolução de propósito: o vínculo não apaga a recusa. Aqui é
   * somente leitura — quem escreve é a aba que tem o formulário.
   */
  const motivoManual = daSessao?.origem.motivo_glosa ?? null

  // A triagem chega pelo cartão nas duas espécies (ver `CartaoGrade`), então a
  // gaveta não precisa saber de qual lado do par ela veio para exibi-la.
  const vinculo = cartao.vinculo
  const blocoVinculado = sessaoDoBloco(vinculo?.bloco_id ?? null)

  // Procedência da guia da sessão: capturada pelo robô, ou tirada direto no portal.
  // `null` no cartão de guia (não há linha de fila para consultar) e no histórico
  // anterior ao registro — nos dois casos a gaveta não mostra o campo.
  const origemGuia = daSessao
    ? rotuloOrigemGuia(daSessao.origem.guia_origem, daSessao.origem.guia)
    : null

  const origem = cartao.origem
  const titulo = daSessao
    ? `${
        daSessao.origem.data_atendimento
          ? formatarDiaComNome(daSessao.origem.data_atendimento)
          : 'sem data'
      } · ${cartao.hora}`
    : `Guia ${cartao.guia}`

  return (
    <aside
      aria-label="Detalhe do atendimento"
      className="absolute inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-slate-900">{titulo}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {cartao.terapia ?? 'terapia não informada'}
            {cartao.codigo_tuss && (
              <span className="tabular-nums"> · TUSS {cartao.codigo_tuss}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar o detalhe"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
        >
          <X size={17} />
        </button>
      </header>

      {/* O estado, na mesma pílula que a Conferência usa. As marcas ao lado são
          o que esta tela acrescenta ao vocabulário — e vêm escritas, nunca só
          coloridas. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
        {daSessao ? (
          <SituacaoBadge situacao={daSessao.situacao} />
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-300">
            {autorizacaoCancelada(daGuia?.status ?? null)
              ? 'Autorização desfeita'
              : autorizacaoLiberada(daGuia?.status ?? null)
                ? 'Liberada'
                : 'Recusada'}
          </span>
        )}
        {daSessao?.semCobertura && (
          <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
            Sem cobertura
          </span>
        )}
        {daSessao && !daSessao.decorrida && (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
            Ainda não aconteceu
          </span>
        )}
        {daGuia?.estado === 'sem-vinculo' && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300">
            Sem vínculo
          </span>
        )}
        {/* Os dois desfechos da triagem também são estado, e por isso ficam na
            mesma fileira de pílulas: quem abre a gaveta de uma guia decidida
            precisa ler o veredito antes de qualquer campo. */}
        {/* Violeta, como a barra e o selo do cartão na grade: a pílula diz que
            houve SUBSTITUIÇÃO, não que a guia é uma liberação de rotina. Ver
            `cobertaPorAvulsa`. */}
        {daGuia?.estado === 'vinculada' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
            <Link2 size={11} aria-hidden />
            Vinculada
          </span>
        )}
        {daGuia?.estado === 'sem-sessao' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-300">
            <Ban size={11} aria-hidden />
            Autorização extra
          </span>
        )}
        {/* Mesma razão, do outro lado do par: a pílula de estado acima já diz
            "Glosa Resolvida"/"Liberada" em esmeralda, e esta acrescenta de onde a
            cobertura veio. Duas esmeraldas em fila diriam a mesma coisa duas
            vezes e perderiam exatamente o que distingue avulsa de rotina. */}
        {daSessao?.vinculo && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
            <Link2 size={11} aria-hidden />
            Coberta por avulsa
          </span>
        )}
        {daGuia?.excedente && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300">
            Além do agendado
          </span>
        )}
        {/* A pílula de estado acima já mostra a situação NOVA — a RPC a devolve
            reclassificada. Esta diz que aquele estado foi decidido por uma
            pessoa, e não derivado da resposta da ASSIM. Sem ela a linha
            afirmaria "Falta" sobre uma sessão glosada sem nada explicando a
            diferença, que é a única leitura que esta feature não pode produzir. */}
        {reclassificacao && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300">
            <ShieldAlert size={11} aria-hidden />
            Reclassificada
          </span>
        )}
      </div>

      {daSessao && (
        <Secao titulo="Atendimento">
          <Campo rotulo="Data">
            {daSessao.origem.data_atendimento
              ? formatarDiaComNome(daSessao.origem.data_atendimento)
              : null}
          </Campo>
          <Campo rotulo="Horário">
            <span className="tabular-nums">{cartao.hora}</span>
          </Campo>
          <Campo rotulo="Terapia">{cartao.terapia}</Campo>
          <Campo rotulo="Profissional">{daSessao.origem.profissionais}</Campo>
          <Campo rotulo="Convênio">{daSessao.origem.convenio_nome}</Campo>
          <Campo rotulo="Sessões no bloco">{daSessao.origem.quantidade_sessoes}</Campo>
        </Secao>
      )}

      <Secao titulo="Autorização">
        <Campo rotulo="Guia">
          {cartao.guia ? <span className="font-mono tabular-nums">{cartao.guia}</span> : null}
        </Campo>
        <Campo rotulo="TUSS">
          {cartao.codigo_tuss ? (
            <span className="font-mono tabular-nums">{cartao.codigo_tuss}</span>
          ) : null}
        </Campo>
        {/* O rótulo diz "no portal" porque `data_execucao` é o instante em que a
            ASSIM registrou, e NÃO a data do atendimento. Confundir os dois é o
            erro que este módulo inteiro existe para caçar.

            Dois formatadores para o MESMO nome de campo, porque as duas espécies
            de cartão o recebem em tipos SQL diferentes:

            - a SESSÃO vem de `get_auditoria_assim_periodo`, que declara
              `data_execucao timestamp with time zone` e já a converte
              (`AT TIME ZONE 'America/Sao_Paulo'`) — o PostgREST devolve
              "2026-09-02T18:38:00+00:00", com sufixo de fuso. Fatiar essa string
              mostra UTC: a guia das 15:38 aparecia como 18:38;
            - a GUIA órfã vem de `get_guias_orfas`, que devolve
              `timestamp without time zone` guardando hora de São Paulo — chega
              "2026-09-02T11:04:00", sem sufixo, e aí é `new Date()` que erraria.

            É a mesma armadilha de `vinculado_em` documentada em
            `dataHoraDeTimestamptz`: duas colunas, dois tipos, duas funções. */}
        <Campo rotulo="Autorizada em (no portal)">
          {origem.data_execucao
            ? daSessao
              ? dataHoraDeTimestamptz(origem.data_execucao)
              : dataHoraCurta(origem.data_execucao)
            : null}
        </Campo>
        {daSessao ? (
          <>
            <Campo rotulo="Status na ASSIM">{daSessao.origem.status_assim}</Campo>
            <Campo rotulo="Forma de autorização">{rotuloForma(daSessao.origem.forma_autorizacao)}</Campo>
            <Campo rotulo="Horário da autorização">{daSessao.origem.horario_autorizacao}</Campo>
            {/* Só no ramo da sessão: aqui a procedência vem da RPC, medida na linha da
                fila. No cartão de guia órfã ela seria dedução de outro mecanismo (o
                anti-join de `get_guias_orfas`), e afirmar por inferência num campo cuja
                função é dizer o que foi apurado seria trocar de assunto. */}
            {origemGuia && (
              <Campo rotulo="Origem da guia">
                <span className={origemGuia.chip} title={origemGuia.detalhe}>
                  {origemGuia.foraDoPulsar && <ExternalLink size={11} className="shrink-0" />}
                  {origemGuia.texto}
                </span>
              </Campo>
            )}
            <Campo
              rotulo={rotuloSolicitadoPor(
                daSessao.origem.guia_origem,
                daSessao.origem.guia
              )}
            >
              {daSessao.origem.criado_por}
            </Campo>
          </>
        ) : (
          <Campo rotulo="Status na ASSIM">{daGuia?.status}</Campo>
        )}
      </Secao>

      {/* ── A triagem, quando houve ────────────────────────────────────────
          Vem logo depois da autorização e ANTES do motivo da recusa, porque é
          ela que explica por que a recusa deixou de pedir tratativa. O
          histórico não se apaga: a glosa continua abaixo, por extenso.

          A seção é a mesma para as duas pontas do par — o cartão da guia e o da
          sessão vinculada —, e o que muda é qual dos dois lados já está na tela.
          Na guia falta dizer a SESSÃO; na sessão falta dizer a GUIA. */}
      {vinculo && (
        <Secao titulo={vinculo.tipo === 'vinculo' ? 'Vínculo' : 'Triagem'}>
          {daSessao ? (
            <Campo rotulo="Coberta pela guia">
              <span className="font-mono tabular-nums">{vinculo.guia}</span>
            </Campo>
          ) : vinculo.tipo === 'vinculo' ? (
            <Campo rotulo="Cobre a sessão de">
              {/* Do próprio `bloco_id`, e não de uma busca: a sessão coberta
                  pode estar noutra semana ou noutro mês — a janela é de 7 dias
                  retroativos —, e nesse caso ela não está carregada. */}
              {blocoVinculado ? (
                <span className="tabular-nums">
                  {formatarDiaComNome(blocoVinculado.dia)} {blocoVinculado.hora}
                </span>
              ) : null}
            </Campo>
          ) : (
            <Campo rotulo="Sessão correspondente">
              <span className="font-normal text-slate-500">nenhuma — autorização extra</span>
            </Campo>
          )}
          {/* A guia glosada que esta substituiu, congelada no momento do vínculo
              — é o que dá sentido ao vínculo, e `fila_autorizacoes` pode
              sobrescrever a sua depois.

              Só do lado da GUIA: na sessão ela seria a terceira vez que o mesmo
              número aparece na gaveta (o campo "Guia" acima já é ele, porque o
              vínculo não reescreve a autorização que a RPC pareou). */}
          {!daSessao && (
            <Campo rotulo="Substitui a guia">
              {vinculo.guia_original ? (
                <span className="font-mono tabular-nums">{vinculo.guia_original}</span>
              ) : null}
            </Campo>
          )}
          <Campo rotulo="Decidido por">{vinculo.vinculado_por}</Campo>
          <Campo rotulo="Decidido em">
            {/* `vinculado_em` é timestamptz de verdade, ao contrário de
                `data_execucao` — daí a outra função de data. */}
            {vinculo.vinculado_em ? dataHoraDeTimestamptz(vinculo.vinculado_em) : null}
          </Campo>
          {vinculo.observacao && (
            <div className="py-1.5">
              <p className="text-[11px] text-slate-500">Observação da triagem</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">
                {vinculo.observacao}
              </p>
            </div>
          )}
        </Secao>
      )}

      {/* ── A reclassificação, quando houve ────────────────────────────────
          No mesmo lugar do vínculo e pela mesma razão: é ela que explica por
          que a situação da linha não é a que a ASSIM respondeu. Vem ANTES do
          motivo da recusa, que continua logo abaixo por extenso — a
          reclassificação não apaga a glosa, e a gaveta é onde isso fica
          provado. */}
      {reclassificacao && (
        <Secao titulo="Reclassificação">
          <Campo rotulo="Era">
            <SituacaoBadge situacao={reclassificacao.situacao_anterior} />
          </Campo>
          <Campo rotulo="Passou a ser">
            <SituacaoBadge situacao={reclassificacao.situacao_nova} />
          </Campo>
          <Campo rotulo="Decidido por">{reclassificacao.reclassificado_por}</Campo>
          <Campo rotulo="Decidido em">
            {/* `reclassificado_em` é timestamptz de verdade — a conversão do
                navegador é a certa aqui, ao contrário de `data_execucao`. */}
            {reclassificacao.reclassificado_em
              ? dataHoraDeTimestamptz(reclassificacao.reclassificado_em)
              : null}
          </Campo>
          <div className="py-1.5">
            <p className="text-[11px] text-slate-500">Justificativa</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">
              {reclassificacao.justificativa}
            </p>
          </div>
        </Secao>
      )}

      {motivo && (
        <Secao titulo="Motivo da recusa">
          <div className="py-1.5">
            {motivo.codigo && (
              <p className="font-mono text-[12px] font-semibold tabular-nums text-violet-700">
                {motivo.codigo}
              </p>
            )}
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">{motivo.descricao}</p>
          </div>
        </Secao>
      )}

      {/* A voz da CLÍNICA sobre a recusa, ao lado da voz da ASSIM acima. Mesmo
          texto que a aba Auditoria mostra e edita — as duas abas trabalham o
          mesmo bloco, e quem resolve a inconsistência aqui precisa ler o que
          quem auditou anotou lá. Violeta porque é assunto de glosa, o mesmo
          matiz que o painel da outra aba usa. */}
      {motivoManual && (
        <Secao titulo="Motivo da glosa">
          <div className="py-1.5">
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-violet-900">
              {motivoManual}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              anotado na aba Auditoria — é lá que se edita
            </p>
          </div>
        </Secao>
      )}

      {cartao.teve_token && (
        <Secao titulo="Filipeta">
          <Campo rotulo="Token">
            <span className="inline-flex items-center gap-1.5">
              <KeySquare size={12} className="text-amber-600" aria-hidden />
              <span className="font-mono tabular-nums">{cartao.token ?? 'sem número'}</span>
            </span>
          </Campo>
          {daSessao && (
            <>
              <Campo rotulo="Conferida">
                {conferencia?.conferido ? (
                  'sim'
                ) : (
                  <span className="font-normal text-amber-700">ainda não</span>
                )}
              </Campo>
              <Campo rotulo="Conferida por">{conferencia?.conferido_por_nome}</Campo>
              <Campo rotulo="Conferida em">
                {conferencia?.conferido_em ? dataHoraCurta(conferencia.conferido_em) : null}
              </Campo>
            </>
          )}
        </Secao>
      )}

      {/* A nota manual vem de `nota`, não de `origem.observacao_manual`, pela
          mesma razão da conferência: a RPC não a devolve.

          `origem.observacao` NÃO é da agenda — o rótulo dizia isso e estava
          errado. É a narrativa que a RPC monta sobre o que aconteceu com o
          bloco ("Glosa: 1403 - …", "Autorização confirmada pela ASSIM",
          "TOKEN - 318580"), a mesma que a aba Auditoria imprime no rodapé do
          painel "Autorização ASSIM". E é justamente nela que o vínculo se
          escreve quando a migration 20260821030000 está aplicada — "· Coberta
          pela guia N de … — vínculo por …" —, então chamá-la de "da agenda"
          escondia a prova de que a reconciliação chegou ao outro lado. */}
      {daSessao && temAlgum(daSessao.origem.observacao, nota?.texto) && (
        <Secao titulo="Observações">
          {daSessao.origem.observacao && (
            <div className="py-1.5">
              <p className="text-[11px] text-slate-500">Resposta da ASSIM</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">
                {daSessao.origem.observacao}
              </p>
            </div>
          )}
          {nota?.texto && (
            <div className="py-1.5">
              <p className="text-[11px] text-slate-500">Anotada na Conferência</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">{nota.texto}</p>
              {nota.atualizado_por_nome && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {nota.atualizado_por_nome}
                  {nota.atualizado_em && <> · {dataHoraCurta(nota.atualizado_em)}</>}
                </p>
              )}
            </div>
          )}
        </Secao>
      )}

      {/* A ação mora onde está a evidência. Só a guia que a fila de órfãs
          reconhece a oferece — um controle que não leva a lugar nenhum ensina a
          ignorar os que levam. */}
      {daGuia?.estado === 'sem-vinculo' && (
        <div className="mt-auto border-t border-slate-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => onVincular(daGuia.guia)}
            disabled={!podeVincular}
            title={podeVincular ? undefined : 'Seu perfil não permite vincular autorizações'}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-fg px-4 text-[12px] font-semibold text-white transition hover:bg-brand-dark focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Link2 size={14} aria-hidden />
            Ver as sessões que esta guia pode cobrir
          </button>
        </div>
      )}

      {/* A reclassificação é ação de SESSÃO, não de guia — uma guia não tem
          situação para sobrepor. Fica no rodapé, junto do outro gesto de
          escrita da gaveta, e é o botão mais fraco dos dois de propósito:
          vincular resolve com evidência, reclassificar resolve com julgamento.
          A ordem visual diz qual tentar primeiro. */}
      {daSessao && (
        <div className="mt-auto border-t border-slate-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => onReclassificar(cartao)}
            disabled={!podeReclassificar}
            title={
              podeReclassificar
                ? undefined
                : 'Seu perfil não permite reclassificar situações'
            }
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-[12px] font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldAlert size={14} aria-hidden />
            {reclassificacao ? 'Desfazer a reclassificação' : 'Reclassificar a situação'}
          </button>
        </div>
      )}

      {daGuia?.estado === 'fora-da-semana' && !daGuia.excedente && (
        <p className="px-4 py-3 text-[11px] leading-relaxed text-slate-500 sm:px-5">
          Esta guia não casa com nenhuma sessão desta semana e também não está na
          fila de reconciliação — pode estar pareada a uma sessão da semana
          vizinha, já ter sido triada, ou ser guia do próprio Pulsar.
        </p>
      )}
    </aside>
  )
}
