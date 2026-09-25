'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Ban, Link2, Loader2, X } from 'lucide-react'
import { useModalDialog } from '@/hooks/useModalDialog'
import SituacaoBadge from './SituacaoBadge'
import type { CandidataVinculo, GuiaOrfa } from './types'

type Props = {
  open: boolean
  onClose: () => void
  guia: GuiaOrfa | null
  /** Nula = o modal está confirmando o descarte ("sem sessão correspondente"). */
  candidata: CandidataVinculo | null
  salvando: boolean
  /**
   * `houveSubstituto` só vai preenchido quando a candidata é uma falta — é a
   * resposta do rádio que decide entre os dois desfechos possíveis dela. Nas
   * sessões e no descarte vai `undefined`, porque ali a pergunta não existe.
   */
  onConfirmar: (observacao: string, houveSubstituto?: boolean) => Promise<void>
}

function dataHora(valor: string | null) {
  if (!valor) return '—'
  const [data, hora] = valor.split('T')
  const [a, m, d] = data.split('-')
  return `${d}/${m}/${a} ${(hora ?? '').slice(0, 5)}`
}

function dia(valor: string | null) {
  if (!valor) return '—'
  const [a, m, d] = valor.split('-')
  return `${d}/${m}/${a}`
}

function distancia(horas: number | null) {
  if (horas == null) return null
  const abs = Math.abs(horas)
  const texto = abs < 24
    ? `${abs.toFixed(1)} h`
    : `${Math.floor(abs / 24)} d ${Math.round(abs % 24)} h`
  return horas < 0 ? `${texto} ANTES da sessão` : `${texto} depois da sessão`
}

/** Um lado do "de → para". Dois painéis idênticos em forma, diferentes em conteúdo. */
function Painel({
  titulo,
  tom,
  children,
}: {
  titulo: string
  tom: 'origem' | 'destino'
  children: React.ReactNode
}) {
  // Degraus -200/-50/-700 de propósito: são os que o shim de tema escuro de
  // globals.css remapeia. -400/-800 atravessariam inteiros para o escuro.
  const cor = tom === 'origem'
    ? 'border-emerald-200 bg-emerald-50/60'
    : 'border-slate-200 bg-slate-50'
  return (
    <div className={`flex-1 rounded-xl border p-4 ${cor}`}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
      </p>
      <dl className="space-y-1.5 text-[13px]">{children}</dl>
    </div>
  )
}

function Campo({ rotulo, valor, forte }: { rotulo: string; valor: React.ReactNode; forte?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-500">{rotulo}</dt>
      <dd className={`min-w-0 flex-1 ${forte ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        {valor ?? '—'}
      </dd>
    </div>
  )
}

/**
 * Confirmação do vínculo (ou do descarte), no formato largo com linhas
 * horizontais — o mesmo da Conferência de Filipetas.
 *
 * O modal existe porque o vínculo muda o que o faturamento considera coberto e
 * não há desfazer implícito: precisa de um passo onde a pessoa LÊ as duas
 * pontas juntas. Daí os dois painéis lado a lado em vez de um resumo em texto —
 * a comparação beneficiário/TUSS/data é justamente o que evita vincular na
 * sessão errada, e ela é visual.
 */
export default function ModalConfirmarVinculo({
  open,
  onClose,
  guia,
  candidata,
  salvando,
  onConfirmar,
}: Props) {
  const idTitulo = 'titulo-confirmar-vinculo'
  const { refDialogo, propsDialogo } = useModalDialog(open, onClose, idTitulo)
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  /**
   * Houve substituto naquele horário? — a pergunta que decide o desfecho.
   *
   * SEM PADRÃO (`null`), de propósito, e é a decisão de desenho que mais importa
   * nesta tela. Qualquer um dos dois lados pré-marcado vira a resposta de quem
   * clicar direto em "Registrar", e as duas são afirmações fortes e opostas
   * sobre a assiduidade do paciente: "não houve" apaga uma sessão que
   * aconteceu, "houve" credita uma que não aconteceu. A que a pessoa não leu não
   * pode ser a que o sistema grava.
   */
  const [houveSubstituto, setHouveSubstituto] = useState<boolean | null>(null)

  // Reabrir para outra guia não deve herdar o texto (nem o erro, nem a resposta)
  // da anterior. A resposta é a mais importante das três: herdá-la marcaria uma
  // falta com o que alguém respondeu sobre outra.
  useEffect(() => {
    if (open) { setObservacao(''); setErro(null); setHouveSubstituto(null) }
  }, [open, guia?.guia, candidata?.bloco_id])

  if (!open || !guia) return null

  const ehDescarte = candidata === null
  /**
   * O destino é uma FALTA DE TERAPEUTA, e não uma sessão.
   *
   * Muda o vocabulário inteiro deste modal, porque "cobertura" é a palavra
   * errada ali: não houve atendimento a cobrir. O que se registra é de onde veio
   * a autorização — a falta continua falta.
   */
  const ehFalta = !ehDescarte && candidata.situacao === 'FALTA_TERAPEUTA'
  /**
   * A guia é de outro TUSS que a sessão (aceito desde 20260925130000). Caso real:
   * refação de uma glosa por reincidência pedida com o TUSS de outra terapia.
   * O vínculo passa, mas não em silêncio: a observação vira obrigatória — é o
   * único lugar onde fica escrito POR QUE uma TO cobre uma Psicologia. O banco
   * exige o mesmo; aqui só evita o clique que ele recusaria.
   */
  const tussDiverge =
    !ehDescarte &&
    !!guia.codigo_tuss &&
    !!candidata.codigo_tuss &&
    guia.codigo_tuss !== candidata.codigo_tuss
  /**
   * A sessão é DEPOIS da guia — remanejamento dentro da semana (20260925140100):
   * a guia de segunda que passa a cobrir a quinta. Mesma regra: só com observação.
   */
  // Por DIA, como o banco (`v_efetiva > date(data_execucao)`): guia tirada minutos
  // antes da sessão no mesmo dia é rotina do robô, não remanejamento.
  const sessaoDepoisDaGuia =
    !ehDescarte &&
    !ehFalta &&
    !!guia.data_execucao &&
    (candidata.data_atendimento ?? '') > guia.data_execucao.slice(0, 10)
  const exigeObservacao = tussDiverge || sessaoDepoisDaGuia
  const faltaObservacao = exigeObservacao && observacao.trim() === ''

  async function confirmar() {
    setErro(null)
    try {
      await onConfirmar(observacao.trim(), ehFalta ? houveSubstituto ?? undefined : undefined)
    } catch (e) {
      // O erro vem das validações da RPC, com mensagem escrita para ser lida por
      // uma pessoa ("TUSS divergente: guia X é ..., bloco é ..."). Mostrar aqui
      // dentro, e não num toast, porque é aqui que a decisão está sendo tomada.
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        onClick={(e) => e.stopPropagation()}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={idTitulo} className="flex items-center gap-2 text-base font-semibold text-slate-900">
              {ehDescarte
                ? <><Ban size={17} className="text-slate-500" aria-hidden /> Marcar como sem sessão correspondente</>
                : ehFalta
                  ? <><Link2 size={17} className="text-amber-600" aria-hidden /> Registrar a autorização desta falta</>
                  : <><Link2 size={17} className="text-emerald-600" aria-hidden /> Confirmar cobertura da sessão</>}
            </h2>
            {/* A subtítulo de uma falta não pode prometer desfecho: qual dos
                dois vai acontecer só se sabe depois do rádio lá embaixo. */}
            <p className="mt-0.5 text-[12px] text-slate-500">
              {ehDescarte
                ? 'A guia sai da fila de trabalho sem afirmar que cobre alguma sessão.'
                : ehFalta
                  ? 'O que este registro faz depende de ter havido substituto — a pergunta está abaixo.'
                  : 'A glosa continua registrada. O que passa a existir é a relação entre as duas.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Painel titulo="Autorização externa" tom="origem">
              <Campo rotulo="Guia" valor={guia.guia} forte />
              <Campo rotulo="Autorizada em" valor={dataHora(guia.data_execucao)} />
              <Campo rotulo="TUSS" valor={guia.codigo_tuss} />
              <Campo rotulo="Carteirinha" valor={guia.carteirinha} />
              <Campo rotulo="Paciente" valor={guia.paciente_nome} />
            </Painel>

            {!ehDescarte && (
              <>
                <ArrowRight size={20} className="mx-auto shrink-0 rotate-90 text-slate-400 sm:rotate-0" aria-hidden />
                <Painel titulo={ehFalta ? 'Falta autorizada' : 'Sessão coberta'} tom="destino">
                  <Campo rotulo="Data" valor={dia(candidata.data_atendimento)} forte />
                  <Campo rotulo="Horário" valor={(candidata.hora_inicial ?? '').slice(0, 5) || '—'} forte />
                  <Campo rotulo="TUSS" valor={candidata.codigo_tuss} />
                  <Campo rotulo="Terapia" valor={candidata.terapias} />
                  <Campo rotulo="Profissional" valor={candidata.profissionais} />
                  <Campo rotulo="Situação" valor={<SituacaoBadge situacao={candidata.situacao} />} />
                  {/* Uma falta não tem guia anterior a substituir: ela nunca foi
                      autorizada, é isso que a torna falta. Imprimir o campo ali
                      só pediria uma explicação que não existe. */}
                  {!ehFalta && (
                    <Campo
                      rotulo="Guia original"
                      valor={
                        candidata.guia_atual
                          ? <span className="tabular-nums">{candidata.guia_atual}</span>
                          : <span className="text-slate-400">sem solicitação no Pulsar</span>
                      }
                    />
                  )}
                  {candidata.motivo_glosa_descricao && (
                    <Campo
                      rotulo="Motivo"
                      valor={
                        <span>
                          {candidata.motivo_glosa_codigo && (
                            <span className="mr-1 font-semibold tabular-nums">{candidata.motivo_glosa_codigo}</span>
                          )}
                          {candidata.motivo_glosa_descricao}
                        </span>
                      }
                    />
                  )}
                </Painel>
              </>
            )}
          </div>

          {!ehDescarte && candidata.distancia_horas != null && (
            <p className="mt-3 text-[12px] text-slate-500">
              A autorização saiu <strong className="font-semibold text-slate-700">{distancia(candidata.distancia_horas)}</strong>
              {!sessaoDepoisDaGuia && candidata.distancia_horas < 0 && (
                <> — confira se é mesmo esta a sessão, o normal é a autorização vir depois.</>
              )}
            </p>
          )}

          {/* Um aviso só, e ele começa pelo que a pessoa precisa FAZER. Na primeira
              versão o motivo vinha antes e o "precisa de comentário" ficava no fim
              da frase: a recepção clicou sem escrever e só descobriu pelo erro do
              banco (Miguel, 25/09). */}
          {exigeObservacao && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
              <p className="font-semibold">Comentário obrigatório para este vínculo.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-800">
                {sessaoDepoisDaGuia && (
                  <li>
                    A sessão é de um dia <strong className="font-semibold">posterior</strong> à guia —
                    é um remanejamento dentro da semana. Diga de onde a guia saiu.
                  </li>
                )}
                {tussDiverge && (
                  <li>
                    A guia é do TUSS <span className="font-semibold tabular-nums">{guia.codigo_tuss}</span> e
                    a sessão é do <span className="font-semibold tabular-nums">{candidata.codigo_tuss}</span>.
                    Diga por que ela foi pedida com outro código.
                  </li>
                )}
              </ul>
            </div>
          )}

          {!ehDescarte && !ehFalta && candidata.fila_id == null && (
            <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              Esta sessão não tem solicitação no Pulsar, então o vínculo fica sem rastro de
              solicitação original. A cobertura funciona igual.
            </p>
          )}

          {/* A PERGUNTA QUE O BANCO NÃO SABE RESPONDER (2026-09-22).

              A FALTA DO TITULAR É FATO NOS DOIS CASOS — e é isto que este bloco
              precisa deixar claro, porque a primeira redação errava aqui.

              O que o slot não diz é o que veio DEPOIS da falta: ou ninguém
              assumiu e a sessão não aconteceu, ou outro profissional assumiu e
              ela aconteceu. Os dois são registrados igual, e a recepção acertou
              nos dois — ela lançou a falta que de fato houve. Quem sabe do
              desfecho é quem está triando, então a tela pergunta.

              Antes daqui havia um bloco âmbar afirmando "a falta continua sendo
              falta" para os dois. Estava certo sobre a falta e errado sobre a
              sessão: no caso relatado (João Lucas, 21/09) o titular faltou, um
              substituto atendeu, e o vínculo deixava "1 Autorização a mais" de
              pé porque a falta não consumia cota.

              O que este rádio decide é grande e não parece: assiduidade do
              paciente, cota do TUSS e a pendência da listagem. Por isso ele vem
              ANTES da observação e sem opção pré-marcada — ver `houveSubstituto`. */}
          {ehFalta && (
            <fieldset className="mt-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <legend className="px-1 text-[12px] font-semibold text-slate-700">
                O profissional titular faltou. Outro assumiu o atendimento?
              </legend>
              <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
                A falta do titular está registrada e continua valendo nos dois casos. O que a
                resposta decide é se <strong className="font-semibold">a sessão aconteceu</strong> —
                e isso o sistema não tem como saber sozinho.
              </p>

              <div className="space-y-1.5">
                {/*
                  A ordem põe "não houve" primeiro porque é o caso que o rótulo
                  do slot já sugere — ele diz FALTA e para por aí. A segunda
                  opção não corrige a falta: acrescenta o que houve depois dela.
                */}
                <label className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2 text-[12px] leading-relaxed transition ${
                  houveSubstituto === false
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}>
                  <input
                    type="radio"
                    name="houve-substituto"
                    className="mt-0.5 shrink-0 accent-amber-600"
                    checked={houveSubstituto === false}
                    onChange={() => setHouveSubstituto(false)}
                  />
                  <span>
                    <strong className="font-semibold">Não — ninguém assumiu.</strong>{' '}
                    A sessão não aconteceu: nada é criado, e assiduidade, cota e glosa não mudam. O
                    registro só tira a guia da fila e mostra, no slot, de onde veio a autorização.
                  </span>
                </label>

                <label className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2 text-[12px] leading-relaxed transition ${
                  houveSubstituto === true
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}>
                  <input
                    type="radio"
                    name="houve-substituto"
                    className="mt-0.5 shrink-0 accent-emerald-600"
                    checked={houveSubstituto === true}
                    onChange={() => setHouveSubstituto(true)}
                  />
                  <span>
                    <strong className="font-semibold">Sim — outro profissional atendeu.</strong>{' '}
                    A sessão aconteceu e esta guia a cobre: ela passa a contar como realizada e sai
                    das pendências.{' '}
                    <strong className="font-semibold">A falta do titular continua registrada</strong>{' '}
                    — ela é fato, e nada aqui a desfaz.
                  </span>
                </label>
              </div>

              {/* O efeito colateral real, anunciado antes de acontecer. Vale para
                  os dois desfechos: os dois tiram a guia do pareamento. */}
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Nos dois casos esta guia deixa de disputar posição no pareamento automático de{' '}
                <span className="tabular-nums">{dia(guia.data_execucao?.slice(0, 10) ?? null)}</span>.
                Se ela estava casada com alguma sessão daquele dia por posição, essa sessão volta a
                aparecer sem cobertura.
              </p>
            </fieldset>
          )}

          <label className="mt-4 block">
            <span className="text-[12px] font-medium text-slate-600">
              Observação {ehDescarte ? '' : exigeObservacao ? '(obrigatória — veja o aviso acima)' : '(opcional)'}
            </span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value.slice(0, 500))}
              rows={2}
              placeholder={ehDescarte
                ? 'Por que esta guia não corresponde a nenhuma sessão'
                : ehFalta
                  ? 'Ex.: autorizada antes de o terapeuta avisar a falta'
                  : 'Ex.: reautorizada no portal pelo setor de autorização'}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            />
            <span className="text-[11px] text-slate-400">{observacao.length}/500</span>
          </label>

          {erro && (
            <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {erro}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            // Numa falta, sem resposta não há o que gravar: os dois desfechos
            // são afirmações opostas sobre a assiduidade, e nenhuma delas pode
            // sair de um clique que não passou pela pergunta. O `title` diz o
            // porquê — botão desabilitado e mudo é o que faz alguém achar que a
            // tela travou.
            disabled={salvando || (ehFalta && houveSubstituto === null) || faltaObservacao}
            title={ehFalta && houveSubstituto === null
              ? 'Responda se houve substituto para poder registrar'
              : faltaObservacao
                ? 'Comentário obrigatório: escreva a observação para poder registrar'
                : undefined}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60 ${
              ehDescarte
                ? 'bg-slate-700 hover:bg-slate-800'
                : ehFalta
                  ? // O matiz segue a RESPOSTA, porque é ela que diz o que vai
                    // acontecer: âmbar quando nada foi coberto (o verde desta
                    // tela significa "coberto"), esmeralda quando a sessão
                    // aconteceu e esta guia a cobre — ali o verde é literal.
                    // Sem resposta, âmbar: é o matiz do slot que está na tela.
                    houveSubstituto === true
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {salvando && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {ehDescarte
              ? 'Marcar sem sessão'
              : ehFalta
                ? houveSubstituto === true ? 'Registrar sessão realizada' : 'Registrar autorização'
                : 'Confirmar vínculo'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
