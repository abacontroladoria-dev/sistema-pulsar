"use client"

import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import {
  AlertTriangle, CalendarRange, Check, ChevronDown, CloudDownload, Info, Loader2, MapPin, Plus, Replace, Trash2, Users, X,
} from "lucide-react"
import { CampoSelect, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { CabecalhoPastel, SecaoPastel, avisoFeito, tom } from "@/components/ui/pastel/pecas"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { DatePicker } from "@/components/ui/date-picker"
import { normTxt } from "@/lib/cronograma/constants"
import { normalizarUnidadeOcupacao } from "@/lib/cronograma/ocupacaoProf"
import { normNumeroSala, parseSalaAgenda } from "@/lib/cronograma/salas"
import { separarTerapias } from "@/lib/cadastros/terapias"
import {
  DIAS_SEMANA, DURACOES, conflitosDeLocal, copiarDia, dataBR, faixasDaGrade, faixasParaRpc, foraDaExclusividade,
  hojeBrasilia, mesmoConteudo, novaFaixa, opcoesHorario, paraMin, periodoBR, sessoesDaFaixa, somarDias, totaisDaSemana, validarRascunho,
  type HorarioGrade,
} from "@/lib/disponibilidadeProfissional"
import { criarVersao, lerSemanaTita } from "@/services/profissionalDisponibilidade.service"
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

/** Casa o sala_nome da TiTa com um local de Ocupação de Salas (unidade + número, ou nome). */
function casarLocal(salaNome: string | null, locais: LocalDisponivel[]): string | null {
  if (!salaNome) return null
  const p = parseSalaAgenda(salaNome)
  if (p) {
    const daUnidade = locais.filter(l => normalizarUnidadeOcupacao(l.unidade_nome) === p.unidade)
    const achado = p.numeroSala
      ? daUnidade.find(l => normNumeroSala(l.numero_sala) === p.numeroSala)
      : daUnidade.length === 1 ? daUnidade[0] : undefined
    if (achado) return achado.id
  }
  const n = normTxt(salaNome)
  return locais.find(l => normTxt(l.nome_exibicao) === n || normTxt(l.sala_nome_referencia) === n)?.id ?? null
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
  const [origem, setOrigem] = useState<OrigemVersao>(origemInicial)
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
  const [lendoTita, setLendoTita] = useState(false)
  const [avisoTita, setAvisoTita] = useState<string | null>(null)
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

  const corDaTerapia = (id: number) => catalogoPorId.get(id)?.cor_hex ?? "#CBD5E1"
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

  const preencherDaTita = async () => {
    if (!profissional.tita_profissional_id) return
    if (r.faixas.length && !(await confirmar({
      titulo: "Substituir pelos horários da TiTa?",
      texto: "As faixas que estão no editor serão trocadas pelas da grade TiTa da semana. Nada é salvo antes de você revisar.",
      confirmar: "Substituir",
      t: "aco",
      Icone: CloudDownload,
    }))) return
    setLendoTita(true)
    setAvisoTita(null)
    try {
      // Semana que vem (seg–sáb): a grade da TiTa vai até o fim do mês seguinte.
      const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay()
      const segunda = somarDias(hoje, ((8 - dow) % 7) || 7)
      let linhas = await lerSemanaTita(profissional.tita_profissional_id, segunda, somarDias(segunda, 5))
      let semana = segunda
      if (!linhas.length) {
        semana = somarDias(segunda, -7)
        linhas = await lerSemanaTita(profissional.tita_profissional_id, semana, somarDias(semana, 5))
      }
      if (!linhas.length) {
        setAvisoTita("A grade TiTa não tem horários deste profissional nesta semana nem na próxima.")
        return
      }
      const porNome = new Map(catalogo.map(t => [normTxt(t.nome), t.id]))
      const foraDoCatalogo = new Set<string>()
      const horarios: HorarioGrade[] = linhas.map(l => {
        const dia = new Date(`${l.data.slice(0, 10)}T12:00:00Z`).getUTCDay()
        const terapias = separarTerapias(l.terapia_nome).map(n => {
          const id = porNome.get(normTxt(n))
          if (id === undefined) foraDoCatalogo.add(n)
          return id
        }).filter((x): x is number => x !== undefined)
        return { dia, inicio: l.hora_inicial.slice(0, 5), fim: l.hora_final.slice(0, 5), terapias, localId: casarLocal(l.sala_nome, locais), salaTita: l.sala_nome }
      }).filter(h => h.dia >= 1 && h.dia <= 6)
      const { faixas, salasSemCasamento } = faixasDaGrade(horarios)
      setR({ diasAtivos: [...new Set(faixas.map(f => f.dia))].sort(), faixas })
      setAbertas(new Set())
      setOrigem("preenchido_tita")
      const partes = [`Montado com a semana de ${dataBR(semana)} (${linhas.length} horários). Confira antes de salvar.`]
      if (salasSemCasamento.length) partes.push(`Locais sem correspondência em Ocupação de Salas: ${salasSemCasamento.join(", ")} — escolha à mão.`)
      if (foraDoCatalogo.size) partes.push(`Terapias fora do Cadastro de Terapias: ${[...foraDoCatalogo].join(", ")}.`)
      setAvisoTita(partes.join(" "))
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
    } finally {
      setLendoTita(false)
    }
  }

  const salvar = async () => {
    if (semMudanca) {
      avisoFeito("Nada mudou nos horários — nenhuma versão nova")
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
      avisoFeito(editandoExistente ? "Disponibilidade salva — a anterior ficou no histórico" : "Disponibilidade salva")
      onSalvo()
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e), { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Vigência ─────────────────────────────────────────────────── */}
      <SecaoPastel titulo="disp-vigencia">
        <CabecalhoPastel
          id="disp-vigencia"
          titulo={restauradaDe ? `Restaurar a versão nº ${restauradaDe.numero}` : editandoExistente ? "Editar disponibilidade" : "Cadastrar disponibilidade"}
          t="teal"
          Icone={CalendarRange}
          apoio={editandoExistente
            ? "Se algo mudar, o sistema cria uma versão nova e guarda a atual no histórico"
            : "Nada é apagado: toda mudança futura fica guardada no histórico"}
          direita={profissional.tita_profissional_id ? (
            <button type="button" onClick={preencherDaTita} disabled={lendoTita} className={`${tom("aco")} pp-btn pp-btn-suave`}>
              {lendoTita ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudDownload className="h-4 w-4" aria-hidden />}
              Preencher a partir da grade TiTa
            </button>
          ) : undefined}
        />
        <div className="grid gap-4 @2xl:grid-cols-[repeat(2,minmax(0,13rem))_minmax(0,1fr)] @2xl:items-start">
          <div>
            <span className={rotulo}>Vale a partir de</span>
            <div className="mt-1"><DatePicker value={vigenteDe} onChange={setVigenteDe} /></div>
          </div>
          <div>
            <span className={rotulo}>Até</span>
            <div className="mt-1 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={indeterminado} onChange={e => setIndeterminado(e.target.checked)} className="h-4 w-4 accent-[var(--pp-foco)]" />
                Prazo indeterminado
              </label>
              {!indeterminado && <DatePicker value={vigenteAte} onChange={setVigenteAte} />}
            </div>
          </div>
          <div>
            <label htmlFor="disp-motivo" className={rotulo}>Motivo (fica no histórico)</label>
            <input id="disp-motivo" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500}
              placeholder="Ex.: passou a atender às sextas"
              className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {efeitoVigencia.bloqueio ? (
            <p className={`${tom("vermelho")} flex items-start gap-2 rounded-[14px] bg-[var(--c-suave)] px-3 py-2 text-[13px] font-bold text-[var(--c-tinta)]`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {efeitoVigencia.bloqueio}
            </p>
          ) : !semMudanca && (efeitoVigencia.encerra || efeitoVigencia.substitui.length > 0 || (ate && ate < hoje)) ? (
            <p className={`${tom("teal")} flex items-start gap-2 rounded-[14px] bg-[var(--c-suave)] px-3 py-2 text-[13px] font-bold text-[var(--c-tinta)]`}>
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {efeitoVigencia.encerra && `Ao salvar, a versão nº ${efeitoVigencia.encerra.numero} passa a terminar em ${dataBR(somarDias(vigenteDe, -1))}.`}
                {efeitoVigencia.substitui.length > 0 && ` Ao salvar, ${efeitoVigencia.substitui.map(textoSubstitui).join(" e ")} fica substituída por esta (continua no histórico).`}
                {ate && ate < hoje && " Como o fim já passou, esta já nasce como grade inativa."}
              </span>
            </p>
          ) : null}
          {avisoTita && (
            <p className={`${tom("amber")} flex items-start gap-2 rounded-[14px] bg-[var(--c-suave)] px-3 py-2 text-[13px] font-bold text-[var(--c-tinta)]`}>
              <CloudDownload className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {avisoTita}
            </p>
          )}
          {validacao.gerais.map(g => (
            <p key={g} className="text-[13px] font-bold text-rose-600 dark:text-rose-400">{g}</p>
          ))}
          {opcoesTerapia.length === 0 && (
            <p className={`${tom("amber")} rounded-[14px] bg-[var(--c-suave)] px-3 py-2 text-[13px] font-bold text-[var(--c-tinta)]`}>
              Nenhuma terapia habilitada — habilite na aba Terapias antes de montar a disponibilidade.
            </p>
          )}
        </div>
      </SecaoPastel>

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
            avisoFeito(`${d.nome} replicada em ${nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0]}`)
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
        <div className="flex flex-col gap-3 rounded-[20px] bg-[var(--pp-surface)] p-4 shadow-[var(--pp-sombra-alta),inset_0_0_0_1px_var(--pp-border)] @2xl:flex-row @2xl:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-bold">
            <span><span className="text-[20px] font-extrabold tabular-nums">{totais.sessoes}</span> sessões/semana</span>
            <span className="text-[var(--pp-ink-muted)]">{Math.floor(totais.minutos / 60)}h{String(totais.minutos % 60).padStart(2, "0")} de atendimento</span>
            {[...totais.porTerapia].map(([id, n]) => (
              <span key={id} className="inline-flex items-center gap-1 text-xs text-[var(--pp-ink-muted)]">
                <span className="h-2 w-2 rounded-full" style={{ background: corDaTerapia(id) }} aria-hidden />
                {catalogoPorId.get(id)?.nome ?? `#${id}`} {n}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancelar} className={`${tom("cinza")} pp-btn pp-btn-suave`} disabled={salvando}>
              <X className="h-4 w-4" aria-hidden /> Cancelar
            </button>
            <button type="button" onClick={salvar} className={`${tom("verde")} pp-btn`}
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
    <SecaoPastel titulo={`dia-${p.dia}`} className={p.ligado ? "" : "!bg-[var(--pp-muted)] !shadow-none"}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={p.ligado}
          aria-label={`${p.nome}: ${p.ligado ? "atende" : "não atende"}`}
          onClick={p.onAlternarDia}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${p.ligado ? "bg-[oklch(0.62_0.11_190)]" : "bg-[var(--pp-border-strong)]"}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${p.ligado ? "translate-x-6" : "translate-x-1"}`} />
        </button>
        <h3 id={`dia-${p.dia}`} className={`text-[17px] font-extrabold ${p.ligado ? "" : "text-[var(--pp-ink-muted)]"}`}>{p.nome}</h3>
        <span className="text-[13px] font-semibold text-[var(--pp-ink-muted)]">
          {p.ligado ? `${p.sessoes} sessões` : p.faixas.length ? "Desligado — as faixas ficam guardadas" : "Não atende"}
        </span>
        {p.ligado && p.faixas.length > 0 && (
          <button type="button" onClick={abrirReplicar} className={`${tom("teal")} pp-btn pp-btn-suave ml-auto !min-h-9 text-[13px]`}
            title={`Repetir os horários de ${p.nome.toLowerCase()} em outros dias`} aria-expanded={copiando}>
            Replicar
          </button>
        )}
      </div>

      {copiando && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[16px] bg-[var(--pp-muted)] p-3">
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
            className={`${tom("teal")} pp-btn`}>
            <Check className="h-4 w-4" aria-hidden /> Replicar
          </button>
          <p className="w-full text-xs font-semibold text-[var(--pp-ink-muted)]">As faixas dos dias escolhidos são substituídas.</p>
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
          <button type="button" onClick={p.onAdicionar} className={`${tom("teal")} pp-btn pp-btn-suave !min-h-9 text-[13px]`}>
            <Plus className="h-4 w-4" aria-hidden /> Adicionar horário
          </button>
        </div>
      )}
    </SecaoPastel>
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
    <div className={`rounded-[18px] bg-[var(--pp-surface)] ${temErro ? "shadow-[inset_0_0_0_2px_theme(colors.rose.400)]" : "shadow-[inset_0_0_0_1px_var(--pp-border)]"}`}>
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={onAlternar} aria-expanded={aberta} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--pp-ink-muted)] transition-transform ${aberta ? "" : "-rotate-90"}`} aria-hidden />
          <span className="flex -space-x-1" aria-hidden>
            {(f.terapias.length ? f.terapias : [0]).slice(0, 4).map(t => (
              <span key={t} className="h-3.5 w-3.5 rounded-full ring-2 ring-[var(--pp-surface)]" style={{ background: t ? corDaTerapia(t) : "var(--pp-border-strong)" }} />
            ))}
          </span>
          <span className="shrink-0 whitespace-nowrap font-extrabold tabular-nums">{f.inicio}–{f.fim}</span>
          <span className="truncate text-xs font-semibold text-[var(--pp-ink-muted)]">
            · {f.duracao} min · {sessoes.length} {sessoes.length === 1 ? "sessão" : "sessões"}
            {local ? ` · ${local.nome_exibicao}` : f.localNome ? ` · ${f.localNome}` : " · sem local"}
            {!aberta && f.terapias.length > 0 && ` · ${f.terapias.map(nomeTerapia).join(", ")}`}
          </span>
        </button>
        {temErro && <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" aria-label="Há pendências nesta faixa" />}
        <button type="button" onClick={onRemover} className="pp-iconbtn h-8 w-8" title="Remover faixa" aria-label={`Remover faixa ${f.inicio}–${f.fim}`}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {aberta && (
        <div className="space-y-4 border-t border-[var(--pp-border)] p-4">
          <div className="grid gap-3 @lg:grid-cols-3">
            <CampoSelect label="Início" value={f.inicio} onChange={v => v && onMudar({ inicio: v })} disabled={false} opcoes={HORAS} vazio="—" />
            <CampoSelect label="Fim" value={f.fim} onChange={v => v && onMudar({ fim: v })} disabled={false} opcoes={HORAS} vazio="—" />
            <CampoSelect label="Tempo entre horários" value={String(f.duracao)} onChange={v => v && onMudar({ duracao: Number(v) })} disabled={false} opcoes={OPCOES_DURACAO} vazio="—" />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-sm font-bold">
              <input type="checkbox" checked={f.intervaloAtivo} onChange={e => onMudar({ intervaloAtivo: e.target.checked })} className="h-4 w-4 accent-[var(--pp-foco)]" />
              Intervalo
            </label>
            {f.intervaloAtivo && (
              <>
                <div className="w-32"><CampoSelect label="Das" value={f.intervaloInicio} onChange={v => v && onMudar({ intervaloInicio: v })} disabled={false} opcoes={HORAS} vazio="—" /></div>
                <div className="w-32"><CampoSelect label="Às" value={f.intervaloFim} onChange={v => v && onMudar({ intervaloFim: v })} disabled={false} opcoes={HORAS} vazio="—" /></div>
              </>
            )}
          </div>

          <div className="grid gap-3 @2xl:grid-cols-2">
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
                <p className="mt-1 text-xs font-semibold text-[var(--pp-ink-muted)]">Pode prestar qualquer uma delas neste horário.</p>
              )}
            </div>
            <div>
              <CampoSelect label="Local" value={f.localId} onChange={v => onMudar({ localId: v })} disabled={false} opcoes={opcoesLocal} vazio="Escolha o local" />
              {localSumiu && <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">O local gravado ({f.localNome}) não existe mais em Ocupação de Salas.</p>}
            </div>
          </div>

          {/* Prévia: é ela que diz se a configuração está certa */}
          <div>
            <span className={rotulo}>Sessões geradas</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sessoes.length ? sessoes.map(s => (
                <span key={s} className="rounded-lg bg-[var(--pp-muted)] px-2 py-1 text-xs font-bold tabular-nums">{s}</span>
              )) : <span className="text-xs font-semibold text-[var(--pp-ink-muted)]">Nenhuma</span>}
            </div>
          </div>
        </div>
      )}

      {(erros.length > 0 || avisos.length > 0 || conflito || exclusiva) && (
        <ul className="space-y-1 px-4 pb-3 text-[12px] font-bold">
          {erros.map(e => <li key={e} className="flex items-start gap-1.5 text-rose-600 dark:text-rose-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{e}</li>)}
          {avisos.map(a => <li key={a} className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{a}</li>)}
          {conflito && (
            <li className={`flex items-start gap-1.5 ${conflito.excedeu ? "text-rose-600 dark:text-rose-400" : "text-[var(--pp-ink-muted)]"}`}>
              {conflito.excedeu ? <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <Users className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
              {conflito.excedeu
                ? `${conflito.local.nome_exibicao} já está ocupada nesse horário: ${conflito.outros.join(", ")}.`
                : `Local compartilhado com ${conflito.outros.length} profissional${conflito.outros.length === 1 ? "" : "is"} neste horário.`}
            </li>
          )}
          {exclusiva && (
            <li className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {local?.nome_exibicao} é exclusiva de {exclusiva.join(", ")} (Ocupação de Salas).
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
