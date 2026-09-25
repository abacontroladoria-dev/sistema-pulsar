'use client'

import { memo } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Loader2,
  Megaphone,
  KeySquare,
  MoreVertical,
  UserX,
  X,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { comoData, formatarDia, somarDias } from '@/components/auditoria-assim/reconciliacao/datas'
import {
  divergenciasEmAberto,
  estaComARecepcao,
  estadoEvolucao,
  filipetaDaSessao,
  guiaDaSessao,
  idDaSessao,
  pedeAvisoARecepcao,
  pedeConferencia,
  type Folha,
  type LinhaFolha,
  type SessaoConferencia,
  type StatusConferencia,
} from './folhas'
import { formatarCarimbo } from './vocabulario'

/*
  A folha como fila de conferência: o paciente num cartão (quem, que semana,
  quanto falta), e as sessões agrupadas por dia, uma por linha, com o status
  da assinatura em badge e a ação ao lado.

  A cor é dosada para dizer ONDE agir. O azul do menu (blue-600, o
  --sidebar-primary) cheio aparece uma vez: no "Conferido" da linha atual. As
  outras linhas têm o mesmo botão em contorno, que acende ao passar o mouse.
  Os status seguem o vocabulário do DESIGN.md em tinta + fio (-50/-200/-700):
  âmbar esperando alguém olhar, verde resolvido, rosa problema, céu com a
  recepção. O círculo do número da linha veste o mesmo estado, de modo que a
  coluna da esquerda é a folha em miniatura (o papel da antiga tirinha).

  Cores só nos degraus que o shim de tema escuro remapeia; azul-600 sólido sob
  texto branco vale nos dois temas.
*/

const DIA_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "Segunda-feira, 21 de setembro". */
function diaPorExtenso(iso: string) {
  const d = comoData(iso)
  return `${DIA_SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`
}
function horaDe(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Primeira e última palavra do nome: "Adrian Araújo Nery" → "AN". */
function iniciais(nome: string) {
  const partes = nome.replace(/\./g, '').split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p))
  const [a, b] = [partes[0], partes.length > 1 ? partes[partes.length - 1] : '']
  return `${a?.[0] ?? ''}${b?.[0] ?? ''}`.toUpperCase()
}

/** "7", "7 e 8", "7, 8 e 9" — os números das linhas como se fala. */
export function juntarLinhas(nums: number[]) {
  if (nums.length <= 1) return nums.join('')
  return `${nums.slice(0, -1).join(', ')} e ${nums[nums.length - 1]}`
}

export type AcoesFolha = {
  ocupados: Set<string>
  onAssinatura: (linha: LinhaFolha, status: StatusConferencia | null) => void
  /** Clique ou foco na linha: ela vira a linha atual. */
  onCursor: (linha: LinhaFolha) => void
  onAviso: (linha: LinhaFolha) => void
  /** Liga/desliga "filipeta conferida" (o mesmo registro da Conferência de Filipetas). */
  onFilipeta: (linha: LinhaFolha) => void
  onDetalhe: (linha: LinhaFolha) => void
  hrefEvolucoes: ((s: SessaoConferencia) => string) | null
  onAbrirReconciliacao: ((s: SessaoConferencia) => void) | null
}

type Props = AcoesFolha & {
  folha: Folha
  /** O paciente na semana, somando todas as folhas dele. */
  doPaciente: { pendentes: number; divergentes: number; filipetas: number; faltas: number }
  onMarcarFolha: (folha: Folha) => void
  /** A linha em que ela está — a primeira por marcar, ou a que escolheu no teclado. */
  atualId: string | null
  /** A próxima folha com linha por marcar, para seguir sem voltar à fila. */
  proxima: { id: string; rotulo: string } | null
  onProxima: (id: string) => void
  /** As folhas vizinhas do mesmo paciente na semana (mais de 10 sessões). */
  vizinhas: { anterior: string | null; seguinte: string | null }
  onTrocarFolha: (id: string) => void
}

/*
  A grade das linhas mede a LISTA, não a tela: com o menu e a fila ao lado, um
  notebook de 1366px deixa ~44rem para ela.
  - estreita: linha | horário+terapia (filipeta, guia e evolução embaixo),
    status e ação numa segunda fileira;
  - a partir de 32rem: linha | horário | terapia | assinatura | ações;
  - a partir de 42rem (1366 com a fila aberta): filipeta e guia ganham
    coluna; só a evolução fica embaixo da terapia;
  - a partir de 54rem: todas as colunas, na ordem em que ela bate o papel —
    horário, terapia, filipeta, guia, evolução, assinatura, ações. A filipeta
    tem coluna própria: dentro da coluna da guia o chip vazava para a do lado.
*/
const GRADE =
  'grid grid-cols-[1.75rem_3rem_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 @lg/lista:grid-cols-[1.75rem_3rem_minmax(0,1fr)_7rem_8rem] @min-[42rem]/lista:grid-cols-[1.75rem_2.75rem_minmax(6rem,1fr)_6.5rem_6.75rem_6.75rem_7.25rem] @min-[42rem]/lista:gap-x-2 @min-[54rem]/lista:grid-cols-[1.75rem_3rem_minmax(7rem,1fr)_7.25rem_7rem_7rem_7rem_8rem] @min-[54rem]/lista:gap-x-2.5 @6xl/lista:grid-cols-[2rem_3.5rem_minmax(9rem,1fr)_8.5rem_8rem_8rem_8rem_8.5rem] @6xl/lista:gap-x-4'

function FolhaPapelBase({
  folha,
  doPaciente,
  onMarcarFolha,
  atualId,
  proxima,
  onProxima,
  vizinhas,
  onTrocarFolha,
  ...acoes
}: Props) {
  const futuras = folha.linhas.filter((l) => l.futura && !l.falta).length
  const pct = folha.realizadas > 0 ? Math.round((folha.conferidas / folha.realizadas) * 100) : 0
  const numsPendentes = folha.linhas
    .filter((l) => pedeConferencia(l) && l.sessao.status_conferencia === null)
    .map((l) => l.linha)

  // As linhas agrupadas por dia, na ordem da folha (já cronológica).
  const dias: { data: string; linhas: LinhaFolha[] }[] = []
  for (const l of folha.linhas) {
    const ultimo = dias[dias.length - 1]
    if (ultimo && ultimo.data === l.sessao.data_atendimento) ultimo.linhas.push(l)
    else dias.push({ data: l.sessao.data_atendimento, linhas: [l] })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* ── O paciente ─────────────────────────────────────────────────── */}
      <header
        aria-labelledby="titulo-folha"
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(15,27,45,0.05)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6"
      >
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-base font-bold text-blue-700 sm:h-14 sm:w-14 sm:text-lg"
          >
            {iniciais(folha.paciente_nome)}
          </span>
          <div className="min-w-0">
            <h2
              id="titulo-folha"
              tabIndex={-1}
              className="text-xl font-bold tracking-tight text-slate-900 outline-none sm:text-2xl"
            >
              {folha.paciente_nome}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-slate-600">
              <span>
                Semana de {formatarDia(folha.semana)} a {formatarDia(somarDias(folha.semana, 4))}
              </span>
              <ResumoPaciente folha={folha} doPaciente={doPaciente} />
            </div>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-56 sm:items-end">
          {folha.totalFolhas > 1 && (
            // Mais de 10 sessões: a troca de folha fica aqui, e a fila mostra o
            // paciente uma vez só.
            <nav
              aria-label="Folhas deste paciente"
              className="inline-flex items-center self-start rounded-xl border border-slate-200 bg-white sm:self-end"
            >
              <BotaoFolha rotulo="Folha anterior" alvo={vizinhas.anterior} onTrocar={onTrocarFolha}>
                <ChevronLeft size={16} aria-hidden="true" />
              </BotaoFolha>
              <span aria-live="polite" className="px-2 text-sm font-semibold whitespace-nowrap text-slate-800 tabular-nums">
                Folha {folha.numero} de {folha.totalFolhas}
              </span>
              <BotaoFolha rotulo="Próxima folha deste paciente" alvo={vizinhas.seguinte} onTrocar={onTrocarFolha}>
                <ChevronRight size={16} aria-hidden="true" />
              </BotaoFolha>
            </nav>
          )}
          {folha.realizadas > 0 && (
            <div className="flex w-full flex-col gap-1.5 sm:w-56">
              <span className="text-xs text-slate-600">
                {folha.conferidas} de {folha.realizadas} linhas desta folha conferidas
              </span>
              <span className="flex items-center gap-2.5">
                <span
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label="Linhas desta folha conferidas"
                >
                  <span
                    className="block h-full rounded-full bg-blue-600 transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-9 text-right text-xs font-semibold text-slate-700 tabular-nums">{pct}%</span>
              </span>
            </div>
          )}
          {futuras > 0 && (
            <span className="text-xs text-slate-500">
              {futuras === 1 ? '1 sessão ainda vai acontecer' : `${futuras} sessões ainda vão acontecer`}
            </span>
          )}
        </div>
      </header>

      {/* ── As sessões ─────────────────────────────────────────────────── */}
      <section
        aria-label="Sessões da folha"
        className="@container/lista rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgba(15,27,45,0.06),0_8px_24px_-12px_rgba(15,27,45,0.12)] sm:p-3"
      >
        <div
          aria-hidden="true"
          className={`${GRADE} hidden rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-500 @lg/lista:grid`}
        >
          <span>Linha</span>
          <span>Horário</span>
          <span>Terapia</span>
          <span className="hidden @min-[42rem]/lista:block">Token/Filipeta</span>
          <span className="hidden @min-[42rem]/lista:block">Guia</span>
          <span className="hidden @min-[54rem]/lista:block">Evolução</span>
          <span>Assinatura</span>
          <span>Ações</span>
        </div>

        {dias.map((dia) => (
          <div key={dia.data}>
            <h3 className="px-3 pt-5 pb-2 text-sm font-bold text-slate-800">{diaPorExtenso(dia.data)}</h3>
            <ol className="flex flex-col border-t border-slate-100">
              {dia.linhas.map((l) => {
                const id = idDaSessao(l.sessao)
                return l.falta ? (
                  <LinhaFalta key={id} linha={l} onDetalhe={acoes.onDetalhe} />
                ) : (
                  <LinhaSessao key={id} linha={l} atual={id === atualId} {...acoes} />
                )
              })}
            </ol>
          </div>
        ))}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 pt-4 pb-2">
          <span className="text-[13px] text-slate-600">
            {folha.pendentes > 0
              ? folha.pendentes === 1
                ? 'Falta 1 linha nesta folha.'
                : `Faltam ${folha.pendentes} linhas nesta folha.`
              : folha.realizadas > 0
                ? proxima
                  ? 'Folha conferida.'
                  : 'Folha conferida. Não há outra folha por conferir neste período.'
                : futuras > 0
                  ? 'Nenhuma sessão desta folha aconteceu ainda.'
                  : 'Só faltas nesta folha: nada a conferir.'}
          </span>
          {folha.pendentes > 0 ? (
            // Secundário de propósito: um clique afirma que ela viu N linhas no
            // papel. O nome diz quais, e o toast oferece desfazer.
            <button
              type="button"
              onClick={() => onMarcarFolha(folha)}
              className="inline-flex min-h-11 items-center rounded-[10px] border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-10"
            >
              {numsPendentes.length === 1
                ? `Marcar a linha ${numsPendentes[0]} como assinada`
                : numsPendentes.length <= 4
                  ? `Marcar as linhas ${juntarLinhas(numsPendentes)} como assinadas`
                  : `Marcar as ${numsPendentes.length} linhas restantes como assinadas`}
            </button>
          ) : (
            proxima && (
              <button
                type="button"
                onClick={() => onProxima(proxima.id)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-blue-600 pr-3 pl-4 text-[13px] font-semibold text-white transition hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-10"
              >
                {proxima.rotulo}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            )
          )}
          {folha.pendentes > 0 && (
            <p className="hidden w-full items-center gap-1.5 text-xs text-slate-500 lg:flex">
              <Tecla>A</Tecla> assinada, <Tecla>N</Tecla> não assinou, <Tecla>↑</Tecla>
              <Tecla>↓</Tecla> muda de linha
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

export const FolhaPapel = memo(FolhaPapelBase)

/** "15 sessões a conferir" (o paciente todo, não só esta folha) e os problemas. */
function ResumoPaciente({ folha, doPaciente }: { folha: Folha; doPaciente: Props['doPaciente'] }) {
  const pilula = 'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold'
  if (folha.situacao === 'futura' && doPaciente.pendentes === 0) {
    return <span className={`${pilula} border-slate-200 bg-slate-50 text-slate-600`}>Ainda vai acontecer</span>
  }
  return (
    <>
      {doPaciente.pendentes > 0 ? (
        <span className={`${pilula} border-amber-200 bg-amber-50 text-amber-700`}>
          {doPaciente.pendentes === 1 ? '1 sessão a conferir' : `${doPaciente.pendentes} sessões a conferir`}
        </span>
      ) : (
        <span className={`${pilula} border-emerald-200 bg-emerald-50 text-emerald-700`}>
          <Check size={13} strokeWidth={2.75} aria-hidden="true" />
          Tudo conferido
        </span>
      )}
      {doPaciente.divergentes > 0 && (
        <span className={`${pilula} border-rose-200 bg-rose-50 text-rose-700`}>
          {doPaciente.divergentes === 1 ? '1 com problema' : `${doPaciente.divergentes} com problema`}
        </span>
      )}
      {doPaciente.faltas > 0 && (
        <span className={`${pilula} border-slate-200 bg-slate-50 text-slate-700`}>
          <UserX size={13} strokeWidth={2.25} aria-hidden="true" />
          {doPaciente.faltas === 1 ? '1 falta' : `${doPaciente.faltas} faltas`}
        </span>
      )}
      {/* Quantos papéis ela tem de achar junto da folha desta semana. */}
      {doPaciente.filipetas > 0 && (
        <span className={`${pilula} border-slate-200 bg-slate-50 text-slate-700`}>
          <KeySquare size={13} strokeWidth={2.25} aria-hidden="true" />
          {doPaciente.filipetas === 1 ? '1 filipeta' : `${doPaciente.filipetas} filipetas`}
        </span>
      )}
    </>
  )
}

function BotaoFolha({
  rotulo,
  alvo,
  onTrocar,
  children,
}: {
  rotulo: string
  alvo: string | null
  onTrocar: (id: string) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      disabled={!alvo}
      onClick={(e) => {
        if (!alvo) return
        const nav = e.currentTarget.parentElement
        onTrocar(alvo)
        // Na última (ou primeira) folha esta seta desabilita e o foco cairia no
        // body: passa para a seta que ainda anda.
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) nav?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
        })
      }}
      className="inline-flex h-11 w-10 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:text-slate-300 disabled:hover:bg-transparent sm:h-9 sm:w-9"
    >
      {children}
    </button>
  )
}

function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-slate-200 bg-white px-1 font-sans text-[11px] font-semibold text-slate-600">
      {children}
    </kbd>
  )
}

// ── Uma sessão ───────────────────────────────────────────────────────────────

function LinhaSessao({ linha, atual, ...acoes }: AcoesFolha & { linha: LinhaFolha; atual: boolean }) {
  const s = linha.sessao
  const id = idDaSessao(s)
  const ocupado = acoes.ocupados.has(id)
  const status = s.status_conferencia
  // Dez botões "Conferido" iguais não dizem nada a um leitor de tela.
  const contexto = `linha ${linha.linha}, ${diaPorExtenso(s.data_atendimento)} às ${s.hora_inicial.slice(0, 5)}, ${s.terapias ?? 'sessão'}`
  const recepcao = !linha.futura && pedeAvisoARecepcao(linha.divergencias)
  const filipeta = filipetaDaSessao(s)

  return (
    // Captura: vale para o clique em qualquer lugar da linha, inclusive nos
    // botões (e no menu, que o React propaga pelo portal), antes do handler deles.
    <li
      onClickCapture={() => acoes.onCursor(linha)}
      onFocusCapture={() => acoes.onCursor(linha)}
      data-linha-id={id}
      aria-current={atual ? 'step' : undefined}
      className={`group rounded-xl border-b border-slate-100 px-3 py-3 transition-colors last:border-b-0 @lg/lista:py-2 ${atual ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
    >
      <div className={`${GRADE} @lg/lista:min-h-11`}>
        {/* O número da linha no papel, vestido com o estado dela. */}
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${corDoNumero(linha, atual)}`}
        >
          {linha.linha}
        </span>
        <span className={`text-sm tabular-nums ${linha.futura ? 'text-slate-500' : 'text-slate-700'}`}>
          {s.hora_inicial.slice(0, 5)}
        </span>

        {/* A terapia abre o detalhe da sessão (observação, guia, profissional). */}
        <button
          type="button"
          onClick={() => acoes.onDetalhe(linha)}
          className="flex min-w-0 flex-col items-start gap-1 rounded text-left focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          title="Ver detalhes da sessão"
        >
          <span className={`max-w-full text-sm leading-snug font-medium ${linha.futura ? 'text-slate-500' : 'text-slate-800'}`}>
            {s.terapias ?? '—'}
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 @min-[54rem]/lista:hidden">
            {filipeta && (
              <span className="contents @min-[42rem]/lista:hidden">
                <IndicacaoFilipeta filipeta={filipeta} />
              </span>
            )}
            <span className="contents @min-[42rem]/lista:hidden">
              <AutorizacaoDaLinha sessao={s} futura={linha.futura} />
            </span>
            {!linha.futura && <EvolucaoDaLinha sessao={s} />}
          </span>
        </button>

        <div className="hidden @min-[42rem]/lista:block">
          {filipeta &&
            (linha.futura || !s.bloco_id ? (
              <IndicacaoFilipeta filipeta={filipeta} />
            ) : (
              <BotaoFilipeta
                filipeta={filipeta}
                ocupado={ocupado}
                contexto={contexto}
                onClick={() => acoes.onFilipeta(linha)}
              />
            ))}
        </div>
        <div className="hidden @min-[42rem]/lista:block">
          <AutorizacaoDaLinha sessao={s} futura={linha.futura} />
        </div>
        <div className="hidden @min-[54rem]/lista:block">{!linha.futura && <EvolucaoDaLinha sessao={s} />}</div>

        {/* Estreita, status e ação descem para uma fileira própria, alinhada com a terapia. */}
        <div className="col-span-3 col-start-1 flex items-center justify-between gap-2 pl-[2.375rem] @lg/lista:contents @lg/lista:pl-0">
          <div>
            <BadgeAssinatura linha={linha} />
          </div>
          <div className="flex items-center gap-1">
            {linha.futura ? null : status === null ? (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => acoes.onAssinatura(linha, 'assinada')}
                aria-label={`Marcar como conferido: ${contexto}`}
                className={`inline-flex h-11 min-w-[4.75rem] items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60 @lg/lista:h-9 ${
                  atual
                    ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                    : 'border-slate-200 bg-white text-blue-700 group-hover:border-blue-600 group-hover:bg-blue-600 group-hover:text-white'
                }`}
              >
                {ocupado && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                Conferido
              </button>
            ) : (
              <button
                type="button"
                onClick={() => acoes.onDetalhe(linha)}
                aria-label={`Ver: ${contexto}`}
                className="inline-flex h-11 min-w-[4.75rem] items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none @lg/lista:h-9"
              >
                {ocupado ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : 'Ver'}
              </button>
            )}
            <MenuDaLinha linha={linha} contexto={contexto} ocupado={ocupado} {...acoes} />
          </div>
        </div>
      </div>

      {recepcao && <AvisoRecepcao linha={linha} ocupado={ocupado} onAviso={acoes.onAviso} />}
    </li>
  )
}

/**
 * A linha em que a recepção escreveu "falta". Tem número (é uma linha do
 * papel) e nada a marcar: sem autorização, evolução nem assinatura. Toda em
 * cinza para a vista passar por ela, com o círculo tracejado de linha sem
 * assinatura. Se no papel houver assinatura nesta linha, alguém errou — é o
 * que ela procura aqui.
 */
function LinhaFalta({ linha, onDetalhe }: { linha: LinhaFolha; onDetalhe: (linha: LinhaFolha) => void }) {
  const s = linha.sessao
  const id = idDaSessao(s)
  const quem =
    linha.falta === 'terapeuta'
      ? `Falta do terapeuta${s.profissionais ? ` (${s.profissionais})` : ''}`
      : 'Falta do paciente'
  const porque = s.motivo_falta?.trim() || s.justificativa_falta?.trim() || null
  const contexto = `linha ${linha.linha}, ${diaPorExtenso(s.data_atendimento)} às ${s.hora_inicial.slice(0, 5)}, ${quem.toLowerCase()}`
  return (
    <li data-linha-id={id} className="rounded-xl border-b border-slate-100 px-3 py-3 last:border-b-0 @lg/lista:py-2">
      <div className={`${GRADE} @lg/lista:min-h-11`}>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-xs font-semibold text-slate-500 tabular-nums">
          {linha.linha}
        </span>
        <span className="text-sm text-slate-500 tabular-nums">{s.hora_inicial.slice(0, 5)}</span>
        <button
          type="button"
          onClick={() => onDetalhe(linha)}
          className="flex min-w-0 flex-col items-start gap-0.5 rounded text-left focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          title="Ver detalhes da falta"
        >
          <span className="max-w-full text-sm leading-snug font-medium text-slate-500">{s.terapias ?? '—'}</span>
          <span className="line-clamp-2 max-w-full text-xs text-slate-600">
            {quem}
            {porque ? `: ${porque}` : ''}
          </span>
        </button>

        {/* Falta não tem filipeta, guia nem evolução: as colunas ficam vazias. */}
        <span className="hidden @min-[42rem]/lista:block" />
        <span className="hidden @min-[42rem]/lista:block" />
        <span className="hidden @min-[54rem]/lista:block" />

        <div className="col-span-3 col-start-1 flex items-center justify-between gap-2 pl-[2.375rem] @lg/lista:contents @lg/lista:pl-0">
          <div>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 text-xs font-semibold whitespace-nowrap text-slate-700">
              <UserX size={14} strokeWidth={2.25} aria-hidden="true" />
              Falta
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onDetalhe(linha)}
              aria-label={`Ver: ${contexto}`}
              className="inline-flex h-11 min-w-[4.75rem] items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none @lg/lista:h-9"
            >
              Ver
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * O círculo do número conta o estado da linha sem abrir nada: problema em
 * aberto (rosa) pesa mais que "com a recepção" (céu), que pesa mais que
 * conferida (verde). A linha atual é sempre azul — é onde ela está.
 */
function corDoNumero(linha: LinhaFolha, atual: boolean): string {
  if (atual) return 'border-blue-600 bg-blue-600 text-white'
  if (linha.futura) return 'border-slate-200 bg-white text-slate-500'
  if (divergenciasEmAberto(linha).length > 0) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (estaComARecepcao(linha)) return 'border-transparent bg-sky-50 text-sky-700'
  if (linha.sessao.status_conferencia !== null) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

// ── O status da assinatura ───────────────────────────────────────────────────

function BadgeAssinatura({ linha }: { linha: LinhaFolha }) {
  const s = linha.sessao
  const base = 'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold'
  if (linha.futura) {
    return (
      <span className={`${base} border-transparent px-0 font-medium text-slate-500`}>
        <CircleDashed size={13} aria-hidden="true" />Agendada
      </span>
    )
  }
  const carimbo = formatarCarimbo(s.conferido_por_nome, s.conferido_em)
  if (s.status_conferencia === 'assinada') {
    return (
      <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700`} title={`Assinada — ${carimbo}`}>
        <CircleCheck size={14} strokeWidth={2.5} aria-hidden="true" />
        Assinada
      </span>
    )
  }
  if (s.status_conferencia === 'sem_assinatura') {
    return (
      <span className={`${base} border-rose-200 bg-rose-50 text-rose-700`} title={`Não assinou — ${carimbo}`}>
        <CircleX size={14} strokeWidth={2.5} aria-hidden="true" />
        Não assinou
      </span>
    )
  }
  return (
    <span className={`${base} border-amber-200 bg-amber-50 text-amber-700`}>
      <Clock size={14} strokeWidth={2.5} aria-hidden="true" />
      Pendente
    </span>
  )
}

// ── O menu ⋮: tudo o que a linha faz além da ação principal ─────────────────

function MenuDaLinha({
  linha,
  contexto,
  ocupado,
  onAssinatura,
  onAviso,
  onDetalhe,
  hrefEvolucoes,
  onAbrirReconciliacao,
}: AcoesFolha & { linha: LinhaFolha; contexto: string; ocupado: boolean }) {
  const s = linha.sessao
  const status = s.status_conferencia
  const d = linha.divergencias
  const recepcao = !linha.futura && pedeAvisoARecepcao(d)
  const reconciliar = d.includes('sem_autorizacao') && onAbrirReconciliacao
  const evolucoes = d.includes('sem_evolucao') && hrefEvolucoes
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Mais ações: ${contexto}`}
        className="inline-flex h-11 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none data-open:bg-slate-100 @lg/lista:h-9 @lg/lista:w-8"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        {!linha.futura && (
          <>
            {status !== 'assinada' && (
              <DropdownMenuItem disabled={ocupado} onSelect={() => onAssinatura(linha, 'assinada')}>
                <Check size={14} aria-hidden="true" />
                Marcar como assinada
              </DropdownMenuItem>
            )}
            {status !== 'sem_assinatura' && (
              <DropdownMenuItem disabled={ocupado} onSelect={() => onAssinatura(linha, 'sem_assinatura')}>
                <X size={14} aria-hidden="true" />
                Não assinou
              </DropdownMenuItem>
            )}
            {status !== null && (
              <DropdownMenuItem disabled={ocupado} onSelect={() => onAssinatura(linha, null)}>
                <CircleDashed size={14} aria-hidden="true" />
                Desfazer marcação
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => onDetalhe(linha)}>Ver detalhes da sessão</DropdownMenuItem>
        {recepcao && (
          <DropdownMenuItem disabled={ocupado} onSelect={() => onAviso(linha)}>
            {s.recepcao_avisada_em ? 'Desfazer aviso à recepção' : 'Avisei a recepção'}
          </DropdownMenuItem>
        )}
        {reconciliar && (
          <DropdownMenuItem onSelect={() => onAbrirReconciliacao(s)}>Abrir na Reconciliação</DropdownMenuItem>
        )}
        {evolucoes && (
          <DropdownMenuItem asChild>
            <a href={hrefEvolucoes(s)}>Ver evoluções da semana</a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── O aviso à recepção, sob a linha ──────────────────────────────────────────

/** Só nas linhas com problema da recepção; alinhado com a terapia. */
function AvisoRecepcao({
  linha,
  ocupado,
  onAviso,
}: {
  linha: LinhaFolha
  ocupado: boolean
  onAviso: (linha: LinhaFolha) => void
}) {
  const s = linha.sessao
  return (
    <div className="flex flex-wrap items-center gap-x-3 pt-1.5 pl-[2.375rem] @lg/lista:pl-[6rem] @6xl/lista:pl-[7.5rem]">
      {s.recepcao_avisada_em ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <Check size={13} strokeWidth={2.5} aria-hidden="true" />
          Recepção avisada às {horaDe(s.recepcao_avisada_em)}
          {s.recepcao_avisada_por_nome ? ` por ${s.recepcao_avisada_por_nome}` : ''}
          <button
            type="button"
            onClick={() => onAviso(linha)}
            disabled={ocupado}
            aria-label={`Desfazer o aviso à recepção da linha ${linha.linha}`}
            className="inline-flex min-h-11 items-center rounded px-1 font-semibold text-slate-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none @lg/lista:min-h-8"
          >
            Desfazer
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onAviso(linha)}
          disabled={ocupado}
          aria-label={`Avisei a recepção sobre a linha ${linha.linha}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-60 @lg/lista:min-h-8"
        >
          {ocupado ? (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          ) : (
            <Megaphone size={13} strokeWidth={2.25} aria-hidden="true" />
          )}
          Avisei a recepção
        </button>
      )}
    </div>
  )
}

// ── A evolução da sessão ─────────────────────────────────────────────────────

/** Em ordem = check verde e texto cinza; a cor forte fica para quando falta. */
const EVOLUCAO = {
  ok: { Icone: CircleCheck, icone: 'text-emerald-600', texto: 'text-slate-600' },
  parcial: { Icone: CircleAlert, icone: 'text-amber-600', texto: 'text-amber-700 font-semibold' },
  ausente: { Icone: CircleX, icone: 'text-rose-600', texto: 'text-rose-700 font-semibold' },
  sem_grade: { Icone: CircleDashed, icone: 'text-slate-500', texto: 'text-slate-500' },
} as const

function EvolucaoDaLinha({ sessao: s }: { sessao: SessaoConferencia }) {
  const estado = estadoEvolucao(s)
  const { Icone, icone, texto: cor } = EVOLUCAO[estado]
  // "Com evolução" faz par com "Sem evolução": as duas se comparam de relance.
  const texto =
    estado === 'ok'
      ? 'Com evolução'
      : estado === 'parcial'
        ? `${s.grade_com_evolucao} de ${s.grade_total} com evolução`
        : estado === 'ausente'
          ? 'Sem evolução'
          : 'Fora da grade'
  return (
    <span
      className="inline-flex flex-col gap-0.5"
      title={estado === 'sem_grade' ? 'A grade do TiTa não tem esta sessão — não há onde procurar a evolução' : undefined}
    >
      <span className={`inline-flex items-center gap-1.5 text-[13px] ${cor}`}>
        <Icone size={15} strokeWidth={2.25} aria-hidden="true" className={`shrink-0 ${icone}`} />
        {texto}
      </span>
      {s.risco_evolucao === 'risco_relevante' && (
        <span className="pl-[21px] text-xs text-amber-700">com risco de glosa</span>
      )}
    </span>
  )
}

// ── A autorização da sessão ──────────────────────────────────────────────────

type Tom = 'ok' | 'problema' | 'espera' | 'neutro'
const COR_TOM: Record<Tom, { icone: string; texto: string }> = {
  ok: { icone: 'text-emerald-600', texto: 'text-slate-600' },
  problema: { icone: 'text-rose-600', texto: 'text-rose-700 font-semibold' },
  espera: { icone: 'text-amber-600', texto: 'text-amber-700 font-semibold' },
  neutro: { icone: 'text-slate-500', texto: 'text-slate-500' },
}

/**
 * A mesma `situacao` da Conferência ASSIM, já com o vínculo da Reconciliação
 * aplicado. "Não solicitada" numa sessão que já passou é problema; na futura é
 * só o normal de ainda não ter chegado a hora.
 */
function autorizacaoEmPalavras(situacao: string | null, futura: boolean): { texto: string; tom: Tom } {
  switch (situacao) {
    case 'LIBERADA':
      return { texto: 'Liberada', tom: 'ok' }
    case 'GLOSA_RESOLVIDA':
      return { texto: 'Glosa resolvida', tom: 'ok' }
    case 'GLOSA':
      return { texto: 'Glosa', tom: 'problema' }
    case 'CANCELADA':
      return { texto: 'Cancelada pela ASSIM', tom: 'problema' }
    case 'NAO_SOLICITADA':
      return { texto: 'Não solicitada', tom: futura ? 'neutro' : 'problema' }
    case 'SOLICITACAO_CANCELADA':
      return { texto: 'Solicitação cancelada', tom: futura ? 'neutro' : 'problema' }
    case 'RETORNO_NAO_CONFIRMADO':
    case 'AGUARDANDO_RETORNO':
      return { texto: 'Aguardando a ASSIM', tom: 'espera' }
    case 'SINCRONIZANDO':
      return { texto: 'Sincronizando', tom: 'espera' }
    default:
      return { texto: 'Sem autorização', tom: futura ? 'neutro' : 'problema' }
  }
}

const ICONE_TOM = { ok: CircleCheck, problema: CircleX, espera: Clock, neutro: CircleDashed } as const

/**
 * Em ordem, a coluna mostra o NÚMERO da guia — é o que ela bate contra o papel.
 * Fora de ordem, o que está errado. A origem (vínculo, substituição, glosa
 * resolvida) vem em cinza embaixo.
 */
function AutorizacaoDaLinha({ sessao: s, futura }: { sessao: SessaoConferencia; futura: boolean }) {
  const { texto, tom } = autorizacaoEmPalavras(s.situacao, futura)
  const Icone = ICONE_TOM[tom]
  const guia = guiaDaSessao(s)
  const origem =
    s.tipo_vinculo === 'substituicao'
      ? 'substituição'
      : s.tipo_vinculo === 'vinculo'
        ? 'por vínculo'
        : s.situacao === 'GLOSA_RESOLVIDA'
          ? 'glosa resolvida'
          : null
  const cor = COR_TOM[tom]
  return (
    <span className="inline-flex flex-col gap-0.5" title={tom === 'ok' ? texto : undefined}>
      <span className={`inline-flex items-center gap-1.5 text-[13px] ${cor.texto}`}>
        <Icone size={15} strokeWidth={2.25} aria-hidden="true" className={`shrink-0 ${cor.icone}`} />
        {tom === 'ok' && guia ? <span className="tabular-nums">Guia {guia}</span> : texto}
      </span>
      {tom === 'ok' && origem && <span className="pl-[21px] text-xs text-slate-500">{origem}</span>}
    </span>
  )
}

/**
 * A sessão deixou papel: a Silvana procura a filipeta junto da folha. Chip
 * neutro com a chave (o ícone da Conferência de Filipetas na Auditoria) — é um
 * fato a bater, não um problema, e âmbar aqui já quer dizer "assinatura por
 * conferir". "Sem token" é o caso que mais escapa: dispositivo indisponível ou
 * erro no reconhecimento facial também pedem filipeta, só que sem número.
 */
/**
 * A filipeta como caixa de marcar: um clique diz "achei o papel e bate". Grava
 * no mesmo registro da Conferência de Filipetas, então o check dado lá aparece
 * aqui, e vice-versa. Verde só quando conferida.
 */
function BotaoFilipeta({
  filipeta,
  ocupado,
  contexto,
  onClick,
}: {
  filipeta: NonNullable<ReturnType<typeof filipetaDaSessao>>
  ocupado: boolean
  contexto: string
  onClick: () => void
}) {
  const nome = filipeta.numero ? `Token ${filipeta.numero}` : 'Filipeta sem token'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={filipeta.conferida}
      disabled={ocupado}
      onClick={onClick}
      aria-label={`${nome} conferida: ${contexto}`}
      title={filipeta.conferida ? `${nome}: conferida. Clique para desmarcar.` : `${nome}: clique quando conferir o papel.`}
      className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border pr-2.5 pl-1.5 text-xs font-medium whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-60 ${
        filipeta.conferida
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          : 'border-amber-200 bg-white text-amber-700 hover:border-amber-300 hover:bg-amber-50'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          filipeta.conferida ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-amber-400 bg-white'
        }`}
      >
        {ocupado ? (
          <Loader2 size={10} className="animate-spin text-slate-500" />
        ) : (
          filipeta.conferida && <Check size={11} strokeWidth={3} />
        )}
      </span>
      <KeySquare
        size={13}
        strokeWidth={2.25}
        aria-hidden="true"
        className={`shrink-0 ${filipeta.conferida ? 'text-emerald-700' : 'text-amber-500'}`}
      />
      <span className="truncate tabular-nums">{filipeta.numero ?? 'Sem token'}</span>
    </button>
  )
}

function IndicacaoFilipeta({ filipeta }: { filipeta: NonNullable<ReturnType<typeof filipetaDaSessao>> }) {
  const porque =
    filipeta.motivo === 'erro_facial'
      ? ' (erro no reconhecimento facial)'
      : filipeta.motivo === 'dispositivo_indisponivel'
        ? ' (dispositivo indisponível)'
        : ''
  return (
    <span
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium whitespace-nowrap text-slate-700"
      title={`${filipeta.numero ? `Token ${filipeta.numero}` : `Filipeta sem token${porque}`}. ${filipeta.conferida ? 'Já conferida' : 'Ainda não conferida'} na Conferência de Filipetas.`}
    >
      <KeySquare size={13} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-slate-600" />
      <span className="truncate tabular-nums">
        <span className="@min-[42rem]/lista:hidden">Filipeta </span>
        {filipeta.numero ?? (
          <>
            <span className="@min-[42rem]/lista:hidden">sem token</span>
            <span className="hidden @min-[42rem]/lista:inline">Sem token</span>
          </>
        )}
      </span>
      {filipeta.conferida && (
        <>
          <Check size={12} strokeWidth={2.75} aria-hidden="true" className="text-emerald-600" />
          <span className="sr-only">filipeta conferida</span>
        </>
      )}
    </span>
  )
}
