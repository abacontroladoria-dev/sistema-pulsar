"use client"

import { useId, useMemo, useState } from "react"
import toast from "react-hot-toast"
import {
  AlertTriangle, CalendarRange, Check, ChevronDown, Info, Loader2, MapPin, Minus, Plus, Replace, Trash2, Users, X,
} from "lucide-react"
import { CampoSelect, campo, foco, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { aviso, btnIcone, btnPrimario, btnSecundario } from "@/components/cronograma/grade/estilo"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { CabecalhoSecao } from "@/components/ui/padrao"
import { COR_NEUTRA } from "@/lib/cadastros/terapias"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { DatePicker } from "@/components/ui/date-picker"
import {
  CAPACIDADE_MAX, CAPACIDADE_MIN, DIAS_SEMANA, DURACOES, conflitosDeLocal, copiarDia, dataBR, faixasParaRpc, foraDaExclusividade,
  hojeBrasilia, mesmoConteudo, novaFaixa, opcoesHorario, paraMin, periodoBR, sessoesDaFaixa, somarDias, totaisDaSemana, validarRascunho,
} from "@/lib/disponibilidadeProfissional"
import { criarVersao } from "@/services/profissionalDisponibilidade.service"
import type {
  FaixaRascunho, LocalDisponivel, OcupacaoLocal, OrigemVersao, RascunhoDisponibilidade, VersaoDisponibilidade,
} from "@/types/disponibilidadeProfissional"
import type { CadastroTerapia } from "@/types/terapia"
import { LinhaDoTempo } from "./pecasDisponibilidade"

const HORAS = opcoesHorario().map(h => ({ valor: h, rotulo: h }))
const OPCOES_DURACAO = DURACOES.map(d => ({ valor: String(d), rotulo: `${d} min` }))

function rotuloLocal(l: LocalDisponivel): string {
  const extra = l.capacidade === "multiplo" ? " · compartilhado" : l.capacidade === "duplo" ? " · até 2 pessoas" : ""
  return `${l.unidade_nome} · ${l.nome_exibicao}${extra}`
}

export function EditorDisponibilidade({
  profissional,
  base,
  origemInicial,
  restauradaDe,
  versoes,
  habilitadas,
  catalogo,
  locais,
  ocupacoes,
  nomeProfissional,
  onSalvo,
  onCancelar,
  onSemMudanca,
}: {
  profissional: { id: number; nome: string; tita_profissional_id: number | null }
  /** Rascunho de partida (cópia da vigente, de uma antiga a restaurar, ou vazio). */
  base: RascunhoDisponibilidade
  origemInicial: OrigemVersao
  restauradaDe: VersaoDisponibilidade | null
  versoes: VersaoDisponibilidade[]
  habilitadas: number[]
  catalogo: CadastroTerapia[]
  locais: LocalDisponivel[]
  ocupacoes: OcupacaoLocal[]
  nomeProfissional: (id: number) => string
  onSalvo: () => void
  onCancelar: () => void
  /** Fechar sem gravar: nada mudou em relação à versão de partida. */
  onSemMudanca: () => void
}) {
  const hoje = hojeBrasilia()
  const { confirmar, dialogo } = useConfirmacao()
  // Substituídas saíram da linha do tempo: não contam para nada aqui.
  const ativas = useMemo(() => versoes.filter(v => v.situacao !== "substituida"), [versoes])
  // Vale a partir de hoje. Se a vigente também começou hoje, ela fica
  // substituída por esta (a RPC faz isso; o aviso abaixo mostra antes).
  const dePadrao = hoje

  const [r, setR] = useState<RascunhoDisponibilidade>(base)
  // O que vem do TiTa entra pela carga (Administração → Carregar do TiTa); aqui é só edição à mão.
  const [origem] = useState<OrigemVersao>(origemInicial)
  const [vigenteDe, setVigenteDe] = useState(dePadrao)
  // Já existe versão agendada mais à frente: a nova termina na véspera dela, em
  // vez de nascer cruzando o período (o que a RPC recusaria).
  const proximaFutura = ativas
    .filter(v => v.vigente_de > dePadrao)
    .sort((a, b) => a.vigente_de.localeCompare(b.vigente_de))[0] ?? null
  const [indeterminado, setIndeterminado] = useState(!proximaFutura)
  const [vigenteAte, setVigenteAte] = useState(proximaFutura ? somarDias(proximaFutura.vigente_de, -1) : "")
  const [motivo, setMotivo] = useState(restauradaDe ? `Restaurada da versão nº ${restauradaDe.numero}` : "")
  const [salvando, setSalvando] = useState(false)
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set(base.faixas.length <= 2 ? base.faixas.map(f => f.chave) : []))

  const catalogoPorId = useMemo(() => new Map(catalogo.map(t => [t.id, t])), [catalogo])
  const locaisPorId = useMemo(() => new Map(locais.map(l => [l.id, l])), [locais])
  const habSet = useMemo(() => new Set(habilitadas), [habilitadas])
  const opcoesTerapia = useMemo(
    () => habilitadas.map(id => catalogoPorId.get(id)).filter(Boolean).map(t => ({ id: t!.id, nome: t!.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [habilitadas, catalogoPorId]
  )
  const opcoesLocal = useMemo(() => {
    const ordem = (l: LocalDisponivel) => (l.capacidade === "multiplo" ? 1 : 0)
    return [...locais]
      .sort((a, b) => ordem(a) - ordem(b) || a.unidade_nome.localeCompare(b.unidade_nome, "pt-BR") || a.nome_exibicao.localeCompare(b.nome_exibicao, "pt-BR", { numeric: true }))
      .map(l => ({ valor: l.id, rotulo: rotuloLocal(l) }))
  }, [locais])

  const corDaTerapia = (id: number) => catalogoPorId.get(id)?.cor_hex ?? COR_NEUTRA
  const ate = indeterminado ? null : vigenteAte || null

  const validacao = useMemo(() => validarRascunho(r, habSet), [r, habSet])
  // Editando uma versão que já existe: igual a ela = não há versão nova a criar.
  const editandoExistente = versoes.length > 0 && !restauradaDe
  const semMudanca = editandoExistente && mesmoConteudo(base, r)
  const totais = useMemo(() => totaisDaSemana(r), [r])
  const conflitos = useMemo(
    () => conflitosDeLocal(r, { de: vigenteDe, ate }, ocupacoes, locaisPorId, nomeProfissional),
    [r, vigenteDe, ate, ocupacoes, locaisPorId, nomeProfissional]
  )

  // O que acontece com as outras versões ao salvar (espelho da RPC):
  // a que valia antes termina na véspera; as que começam na mesma data ou
  // depois e ainda não valeram ficam substituídas; as que já valeram bloqueiam.
  const efeitoVigencia = useMemo(() => {
    const nada = { encerra: null as VersaoDisponibilidade | null, substitui: [] as VersaoDisponibilidade[] }
    if (!vigenteDe) return { ...nada, bloqueio: "Informe a data de início." as string | null }
    if (ate && ate < vigenteDe) return { ...nada, bloqueio: "O fim é anterior ao início." }
    const cruza = (v: VersaoDisponibilidade) => v.vigente_de <= (ate ?? "9999-12-31") && vigenteDe <= (v.vigente_ate ?? "9999-12-31")
    const jaValeu = ativas.find(v => v.vigente_de >= vigenteDe && v.vigente_de < hoje && cruza(v))
    if (jaValeu) {
      return {
        ...nada,
        bloqueio: `A versão nº ${jaValeu.numero} (${periodoBR(jaValeu.vigente_de, jaValeu.vigente_ate)}) já valeu e cruza este período. Escolha uma data de início depois dela.`,
      }
    }
    return {
      bloqueio: null,
      encerra: ativas.find(v => v.vigente_de < vigenteDe && (v.vigente_ate === null || v.vigente_ate >= vigenteDe)) ?? null,
      substitui: ativas.filter(v => v.vigente_de >= vigenteDe && cruza(v)).sort((a, b) => a.numero - b.numero),
    }
  }, [vigenteDe, ate, ativas, hoje])
  const textoSubstitui = (v: VersaoDisponibilidade) =>
    `a versão nº ${v.numero} (${v.vigente_de === hoje ? "começou hoje" : `começaria em ${dataBR(v.vigente_de)}`})`

  const mudar = (chave: string, patch: Partial<FaixaRascunho>) =>
    setR(prev => ({ ...prev, faixas: prev.faixas.map(f => (f.chave === chave ? { ...f, ...patch } : f)) }))
  const remover = (chave: string) => setR(prev => ({ ...prev, faixas: prev.faixas.filter(f => f.chave !== chave) }))
  const adicionar = (dia: number) => {
    const doDia = r.faixas.filter(f => f.dia === dia)
    const ultima = doDia.sort((a, b) => paraMin(b.fim) - paraMin(a.fim))[0]
    // Segunda faixa do dia começa onde a anterior termina, com a mesma sala e terapias.
    const nova = ultima
      ? novaFaixa(dia, { inicio: ultima.fim, fim: ultima.fim < "17:40" ? "17:40" : ultima.fim, intervaloAtivo: false, localId: ultima.localId, terapias: [...ultima.terapias] })
      : novaFaixa(dia, { terapias: opcoesTerapia.length === 1 ? [opcoesTerapia[0].id] : [] })
    setR(prev => ({ diasAtivos: [...new Set([...prev.diasAtivos, dia])].sort(), faixas: [...prev.faixas, nova] }))
    setAbertas(prev => new Set([...prev, nova.chave]))
  }
  const alternarDia = (dia: number) => {
    const liga = !r.diasAtivos.includes(dia)
    // Ligar um dia vazio já abre uma faixa no padrão da clínica.
    if (liga && !r.faixas.some(f => f.dia === dia)) {
      const nova = novaFaixa(dia, { terapias: opcoesTerapia.length === 1 ? [opcoesTerapia[0].id] : [] })
      setR(prev => ({ diasAtivos: [...prev.diasAtivos, dia].sort(), faixas: [...prev.faixas, nova] }))
      setAbertas(a => new Set([...a, nova.chave]))
      return
    }
    setR(prev => ({
      ...prev,
      diasAtivos: liga ? [...prev.diasAtivos, dia].sort() : prev.diasAtivos.filter(d => d !== dia),
    }))
  }


  const salvar = async () => {
    if (semMudanca) {
      toast.success("Nada mudou nos horários — nenhuma versão nova")
      onSemMudanca()
      return
    }
    if (validacao.bloqueia || efeitoVigencia.bloqueio) {
      toast.error(efeitoVigencia.bloqueio ?? "Corrija os pontos marcados em vermelho.")
      return
    }
    if (efeitoVigencia.substitui.length && !(await confirmar({
      titulo: efeitoVigencia.substitui.length === 1 ? `Substituir a versão nº ${efeitoVigencia.substitui[0].numero}?` : "Substituir versões?",
      texto: `Ao salvar, ${efeitoVigencia.substitui.map(textoSubstitui).join(" e ")} fica substituída por esta e deixa de valer. Ela continua no histórico e pode ser restaurada.`,
      confirmar: "Salvar e substituir",
      cancelar: "Revisar",
      t: "aco",
      Icone: Replace,
    }))) return
    const estouro = [...conflitos.values()].filter(c => c.excedeu)
    if (estouro.length) {
      const lista = estouro.map(c => `• ${c.local.nome_exibicao}: ${c.outros.join(", ")}`).join("\n")
      if (!(await confirmar({
        titulo: "Locais já ocupados nesse horário",
        texto: `${lista}\n\nSalvar a versão mesmo assim?`,
        confirmar: "Salvar mesmo assim",
        cancelar: "Revisar",
        t: "aco",
        Icone: MapPin,
      }))) return
    }
    setSalvando(true)
    try {
      await criarVersao({
        profissionalId: profissional.id,
        vigenteDe,
        vigenteAte: ate,
        dias: r.diasAtivos,
        faixas: faixasParaRpc(r),
        motivo: motivo.trim() || null,
        origem: restauradaDe ? "restaurada" : origem,
        restauradaDe: restauradaDe?.id ?? null,
      })
      toast.success(editandoExistente ? "Disponibilidade salva — a anterior ficou no histórico" : "Disponibilidade salva")
      onSalvo()
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e), { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Vigência ─────────────────────────────────────────────────── */}
      <section aria-labelledby="disp-vigencia" className="rounded-lg border border-border bg-card px-4 py-4">
        <CabecalhoSecao
          id="disp-vigencia"
          titulo={restauradaDe ? `Restaurar a versão nº ${restauradaDe.numero}` : editandoExistente ? "Editar disponibilidade" : "Cadastrar disponibilidade"}
          Icone={CalendarRange}
          apoio={editandoExistente
            ? "Se algo mudar, o sistema cria uma versão nova e guarda a atual no histórico"
            : "Nada é apagado: toda mudança futura fica guardada no histórico"}
        />
        <div className="grid gap-4 md:grid-cols-[repeat(2,minmax(0,13rem))_minmax(0,1fr)] md:items-start">
          <div>
            <span className={rotulo}>Vale a partir de</span>
            <div className="mt-1"><DatePicker value={vigenteDe} onChange={setVigenteDe} /></div>
          </div>
          <div>
            <span className={rotulo}>Até</span>
            <div className="mt-1 space-y-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-0">
                <input type="checkbox" checked={indeterminado} onChange={e => setIndeterminado(e.target.checked)} className={`h-4 w-4 rounded border-border accent-primary ${foco}`} />
                Prazo indeterminado
              </label>
              {!indeterminado && <DatePicker value={vigenteAte} onChange={setVigenteAte} />}
            </div>
          </div>
          <div>
            <label htmlFor="disp-motivo" className={rotulo}>Motivo (fica no histórico)</label>
            <input id="disp-motivo" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500}
              placeholder="Ex.: passou a atender às sextas"
              className={`mt-1 ${campo}`} />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {efeitoVigencia.bloqueio ? (
            <p className={`${aviso("red")} font-semibold`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {efeitoVigencia.bloqueio}
            </p>
          ) : !semMudanca && (efeitoVigencia.encerra || efeitoVigencia.substitui.length > 0 || (ate && ate < hoje)) ? (
            <p className={aviso("blue")}>
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {efeitoVigencia.encerra && `Ao salvar, a versão nº ${efeitoVigencia.encerra.numero} passa a terminar em ${dataBR(somarDias(vigenteDe, -1))}.`}
                {efeitoVigencia.substitui.length > 0 && ` Ao salvar, ${efeitoVigencia.substitui.map(textoSubstitui).join(" e ")} fica substituída por esta (continua no histórico).`}
                {ate && ate < hoje && " Como o fim já passou, esta já nasce como grade inativa."}
              </span>
            </p>
          ) : null}
          {validacao.gerais.map(g => (
            <p key={g} className="text-sm font-semibold text-rose-700 dark:text-rose-400">{g}</p>
          ))}
          {opcoesTerapia.length === 0 && (
            <p className={aviso("amber")}>
              Nenhuma terapia habilitada — habilite na aba Terapias antes de montar a disponibilidade.
            </p>
          )}
        </div>
      </section>

      {/* ── Dias ─────────────────────────────────────────────────────── */}
      {DIAS_SEMANA.map(d => (
        <CartaoDia
          key={d.n}
          dia={d.n}
          nome={d.nome}
          ligado={r.diasAtivos.includes(d.n)}
          faixas={r.faixas.filter(f => f.dia === d.n).sort((a, b) => paraMin(a.inicio) - paraMin(b.inicio))}
          sessoes={totais.porDia.get(d.n) ?? 0}
          abertas={abertas}
          onAlternarAberta={chave => setAbertas(prev => { const n = new Set(prev); if (n.has(chave)) n.delete(chave); else n.add(chave); return n })}
          onAlternarDia={() => alternarDia(d.n)}
          onAdicionar={() => adicionar(d.n)}
          onCopiar={para => {
            setR(prev => copiarDia(prev, d.n, para))
            const nomes = DIAS_SEMANA.filter(x => para.includes(x.n)).map(x => x.nome.replace("-feira", "").toLowerCase())
            toast.success(`${d.nome} replicada em ${nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0]}`)
          }}
          onMudar={mudar}
          onRemover={remover}
          erros={validacao.erros}
          avisos={validacao.avisos}
          conflitos={conflitos}
          corDaTerapia={corDaTerapia}
          opcoesTerapia={opcoesTerapia}
          opcoesLocal={opcoesLocal}
          locaisPorId={locaisPorId}
          titaIdDe={id => catalogoPorId.get(id)?.tita_terapia_id ?? null}
        />
      ))}

      {dialogo}

      {/* ── Rodapé fixo ──────────────────────────────────────────────── */}
      <div className="sticky bottom-3 z-20">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground">
            <span><span className="text-xl font-semibold tabular-nums">{totais.sessoes}</span> sessões/semana</span>
            <span className="text-muted-foreground">{Math.floor(totais.minutos / 60)}h{String(totais.minutos % 60).padStart(2, "0")} de atendimento</span>
            {[...totais.porTerapia].map(([id, n]) => (
              <span key={id} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: corDaTerapia(id) }} aria-hidden />
                {catalogoPorId.get(id)?.nome ?? `#${id}`} {n}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancelar} className={btnSecundario} disabled={salvando}>
              <X className="h-4 w-4" aria-hidden /> Cancelar
            </button>
            <button type="button" onClick={salvar} className={btnPrimario}
              disabled={salvando || (!semMudanca && (validacao.bloqueia || !!efeitoVigencia.bloqueio))}
              title={semMudanca ? "Nada mudou ainda — salvar só fecha o editor" : undefined}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Cartão de um dia ──────────────────────────────────────────────────────────

function CartaoDia(p: {
  dia: number
  nome: string
  ligado: boolean
  faixas: FaixaRascunho[]
  sessoes: number
  abertas: Set<string>
  onAlternarAberta: (chave: string) => void
  onAlternarDia: () => void
  onAdicionar: () => void
  onCopiar: (para: number[]) => void
  onMudar: (chave: string, patch: Partial<FaixaRascunho>) => void
  onRemover: (chave: string) => void
  erros: Map<string, string[]>
  avisos: Map<string, string[]>
  conflitos: ReturnType<typeof conflitosDeLocal>
  corDaTerapia: (id: number) => string
  opcoesTerapia: { id: number; nome: string }[]
  opcoesLocal: { valor: string; rotulo: string }[]
  locaisPorId: Map<string, LocalDisponivel>
  titaIdDe: (id: number) => number | null
}) {
  const [copiando, setCopiando] = useState(false)
  const [destinos, setDestinos] = useState<Set<number>>(new Set())
  const abrirReplicar = () => {
    // Sugestão: os outros dias úteis (seg–sex). O sábado só se marcar.
    if (!copiando) setDestinos(new Set([1, 2, 3, 4, 5].filter(d => d !== p.dia)))
    setCopiando(c => !c)
  }
  const conflitantes = new Set(p.faixas.filter(f => p.erros.get(f.chave)?.some(e => e.startsWith("Cruza"))).map(f => f.chave))

  return (
    <section aria-labelledby={`dia-${p.dia}`} className={`rounded-lg border border-border px-4 py-4 ${p.ligado ? "bg-card" : "bg-muted/40"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={p.ligado}
          aria-label={`${p.nome}: ${p.ligado ? "atende" : "não atende"}`}
          onClick={p.onAlternarDia}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${foco} ${p.ligado ? "bg-primary" : "bg-muted-foreground/30"}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none ${p.ligado ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
        <h3 id={`dia-${p.dia}`} className={`text-base font-semibold ${p.ligado ? "text-foreground" : "text-muted-foreground"}`}>{p.nome}</h3>
        <span className="text-sm text-muted-foreground">
          {p.ligado ? `${p.sessoes} sessões` : p.faixas.length ? "Desligado — as faixas ficam guardadas" : "Não atende"}
        </span>
        {p.ligado && p.faixas.length > 0 && (
          <button type="button" onClick={abrirReplicar} className={`${btnSecundario} ml-auto`}
            title={`Repetir os horários de ${p.nome.toLowerCase()} em outros dias`} aria-expanded={copiando}>
            Replicar
          </button>
        )}
      </div>

      {copiando && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-muted/60 p-3">
          <div className="min-w-[14rem] flex-1">
            <span className={rotulo}>Replicar {p.nome.toLowerCase()} em</span>
            <div className="mt-1">
              <MultiSearchCombobox
                opcoes={DIAS_SEMANA.filter(d => d.n !== p.dia).map(d => ({ id: d.n, nome: d.nome }))}
                selecionados={destinos}
                onToggle={id => setDestinos(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })}
                onMarcarTodos={ids => setDestinos(new Set(ids))}
                onDesmarcarTodos={() => setDestinos(new Set())}
                ariaLabel="Dias de destino"
                nomePlural="dias"
                adjetivoResumo="selecionados"
                placeholder="Escolha os dias"
                resumoCompleto
              />
            </div>
          </div>
          <button type="button" disabled={!destinos.size}
            onClick={() => { p.onCopiar([...destinos]); setCopiando(false); setDestinos(new Set()) }}
            className={btnPrimario}>
            <Check className="h-4 w-4" aria-hidden /> Replicar
          </button>
          <p className="w-full text-xs text-muted-foreground">As faixas dos dias escolhidos são substituídas.</p>
        </div>
      )}

      {p.ligado && (
        <div className="mt-4 space-y-3">
          <LinhaDoTempo faixas={p.faixas} corDaTerapia={p.corDaTerapia} conflitantes={conflitantes} />
          {p.faixas.map(f => (
            <CartaoFaixa
              key={f.chave}
              f={f}
              aberta={p.abertas.has(f.chave)}
              onAlternar={() => p.onAlternarAberta(f.chave)}
              onMudar={patch => p.onMudar(f.chave, patch)}
              onRemover={() => p.onRemover(f.chave)}
              erros={p.erros.get(f.chave) ?? []}
              avisos={p.avisos.get(f.chave) ?? []}
              conflito={p.conflitos.get(f.chave) ?? null}
              corDaTerapia={p.corDaTerapia}
              opcoesTerapia={p.opcoesTerapia}
              opcoesLocal={p.opcoesLocal}
              local={f.localId ? p.locaisPorId.get(f.localId) ?? null : null}
              titaIdDe={p.titaIdDe}
            />
          ))}
          <button type="button" onClick={p.onAdicionar} className={btnSecundario}>
            <Plus className="h-4 w-4" aria-hidden /> Adicionar horário
          </button>
        </div>
      )}
    </section>
  )
}

// ── Pacientes por horário (capacidade da faixa) ──────────────────────────────

function PacientesPorHorario({ valor, onMudar }: { valor: number; onMudar: (v: number) => void }) {
  const idRotulo = useId()
  const mudar = (v: number) => onMudar(Math.min(CAPACIDADE_MAX, Math.max(CAPACIDADE_MIN, v)))
  return (
    <div>
      <span className={rotulo} id={idRotulo}>Pacientes por horário</span>
      <div className="mt-1 flex items-center gap-1.5" role="group" aria-labelledby={idRotulo}>
        <button type="button" onClick={() => mudar(valor - 1)} disabled={valor <= CAPACIDADE_MIN}
          className={btnIcone} aria-label="Um paciente a menos por horário">
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <output aria-live="polite" className="min-w-8 text-center text-base font-semibold tabular-nums">{valor}</output>
        <button type="button" onClick={() => mudar(valor + 1)} disabled={valor >= CAPACIDADE_MAX}
          className={btnIcone} aria-label="Um paciente a mais por horário">
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <span className="text-xs text-muted-foreground">{valor === 1 ? "individual" : "em grupo"}</span>
      </div>
    </div>
  )
}

// ── Cartão de uma faixa ───────────────────────────────────────────────────────

function CartaoFaixa({
  f, aberta, onAlternar, onMudar, onRemover, erros, avisos, conflito, corDaTerapia, opcoesTerapia, opcoesLocal, local, titaIdDe,
}: {
  f: FaixaRascunho
  aberta: boolean
  onAlternar: () => void
  onMudar: (patch: Partial<FaixaRascunho>) => void
  onRemover: () => void
  erros: string[]
  avisos: string[]
  conflito: { local: LocalDisponivel; outros: string[]; excedeu: boolean } | null
  corDaTerapia: (id: number) => string
  opcoesTerapia: { id: number; nome: string }[]
  opcoesLocal: { valor: string; rotulo: string }[]
  local: LocalDisponivel | null
  titaIdDe: (id: number) => number | null
}) {
  const sessoes = sessoesDaFaixa(f)
  const nomeTerapia = (id: number) => opcoesTerapia.find(o => o.id === id)?.nome ?? `#${id}`
  const exclusiva = local ? foraDaExclusividade(local, f.terapias.map(titaIdDe)) : null
  const temErro = erros.length > 0
  const localSumiu = f.localId && !local

  return (
    <div className={`rounded-md border bg-card ${temErro ? "border-rose-400 dark:border-rose-700" : "border-border"}`}>
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={onAlternar} aria-expanded={aberta} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded text-left sm:min-h-0 ${foco}`}>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${aberta ? "" : "-rotate-90"}`} aria-hidden />
          <span className="flex -space-x-1" aria-hidden>
            {(f.terapias.length ? f.terapias : [0]).slice(0, 4).map(t => (
              <span key={t} className="h-3.5 w-3.5 rounded-full ring-2 ring-card" style={{ background: t ? corDaTerapia(t) : COR_NEUTRA }} />
            ))}
          </span>
          <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{f.inicio}–{f.fim}</span>
          <span className="min-w-0 text-xs text-muted-foreground">
            · {f.duracao} min · {sessoes.length} {sessoes.length === 1 ? "sessão" : "sessões"}
            {f.capacidade > 1 && ` · ${f.capacidade} pacientes por horário`}
            {local ? ` · ${local.nome_exibicao}` : f.localNome ? ` · ${f.localNome}` : " · sem local"}
            {!aberta && f.terapias.length > 0 && ` · ${f.terapias.map(nomeTerapia).join(", ")}`}
          </span>
        </button>
        {temErro && <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" aria-label="Há pendências nesta faixa" />}
        <button type="button" onClick={onRemover} className={btnIcone} title="Remover faixa" aria-label={`Remover faixa ${f.inicio}–${f.fim}`}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {aberta && (
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <CampoSelect label="Início" value={f.inicio} onChange={v => v && onMudar({ inicio: v })} disabled={false} opcoes={HORAS} vazio="—" />
            <CampoSelect label="Fim" value={f.fim} onChange={v => v && onMudar({ fim: v })} disabled={false} opcoes={HORAS} vazio="—" />
            <CampoSelect label="Tempo entre horários" value={String(f.duracao)} onChange={v => v && onMudar({ duracao: Number(v) })} disabled={false} opcoes={OPCOES_DURACAO} vazio="—" />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 pb-1.5 text-sm text-foreground sm:min-h-0">
              <input type="checkbox" checked={f.intervaloAtivo} onChange={e => onMudar({ intervaloAtivo: e.target.checked })} className={`h-4 w-4 rounded border-border accent-primary ${foco}`} />
              Intervalo
            </label>
            {f.intervaloAtivo && (
              <>
                <div className="w-32"><CampoSelect label="Das" value={f.intervaloInicio} onChange={v => v && onMudar({ intervaloInicio: v })} disabled={false} opcoes={HORAS} vazio="—" /></div>
                <div className="w-32"><CampoSelect label="Às" value={f.intervaloFim} onChange={v => v && onMudar({ intervaloFim: v })} disabled={false} opcoes={HORAS} vazio="—" /></div>
              </>
            )}
            <PacientesPorHorario valor={f.capacidade} onMudar={capacidade => onMudar({ capacidade })} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <span className={rotulo}>Terapias neste horário</span>
              <div className="mt-1">
                <MultiSearchCombobox
                  opcoes={opcoesTerapia}
                  selecionados={new Set(f.terapias)}
                  onToggle={id => onMudar({ terapias: f.terapias.includes(id) ? f.terapias.filter(t => t !== id) : [...f.terapias, id].sort((a, b) => a - b) })}
                  ariaLabel="Terapias da faixa"
                  nomePlural="terapias"
                  placeholder="Escolha a(s) terapia(s)"
                  resumoCompleto
                />
              </div>
              {f.terapias.length > 1 && (
                <p className="mt-1 text-xs text-muted-foreground">Pode prestar qualquer uma delas neste horário.</p>
              )}
            </div>
            <div>
              <CampoSelect label="Local" value={f.localId} onChange={v => onMudar({ localId: v })} disabled={false} opcoes={opcoesLocal} vazio="Escolha o local" />
              {localSumiu && <p className="mt-1 text-xs text-[var(--status-atencao)]">O local gravado ({f.localNome}) não existe mais em Ocupação de Salas.</p>}
            </div>
          </div>

          {/* Prévia: é ela que diz se a configuração está certa */}
          <div>
            <span className={rotulo}>Sessões geradas</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sessoes.length ? sessoes.map(s => (
                <span key={s} className="rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums text-foreground">{s}</span>
              )) : <span className="text-xs text-muted-foreground">Nenhuma</span>}
            </div>
          </div>
        </div>
      )}

      {(erros.length > 0 || avisos.length > 0 || conflito || exclusiva) && (
        <ul className="space-y-1 px-4 pb-3 text-sm font-semibold">
          {erros.map(e => <li key={e} className="flex items-start gap-1.5 text-rose-700 dark:text-rose-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{e}</li>)}
          {avisos.map(a => <li key={a} className="flex items-start gap-1.5 text-[var(--status-atencao)]"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{a}</li>)}
          {conflito && (
            <li className={`flex items-start gap-1.5 ${conflito.excedeu ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>
              {conflito.excedeu ? <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <Users className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
              {conflito.excedeu
                ? `${conflito.local.nome_exibicao} já está ocupada nesse horário: ${conflito.outros.join(", ")}.`
                : `Local compartilhado com ${conflito.outros.length} profissional${conflito.outros.length === 1 ? "" : "is"} neste horário.`}
            </li>
          )}
          {exclusiva && (
            <li className="flex items-start gap-1.5 text-[var(--status-atencao)]">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {local?.nome_exibicao} é exclusiva de {exclusiva.join(", ")} (Ocupação de Salas).
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
