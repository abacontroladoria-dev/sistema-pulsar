"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertCircle, BadgeCheck, CalendarDays, CalendarRange, Check, CircleSlash, Contact, Database, History,
  Loader2, Palette, Pencil, RotateCcw, Sparkles, X,
} from "lucide-react"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { SecaoPastel, avisoFeito, tom, type Tom } from "@/components/ui/pastel/pecas"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { refetchProfissionais } from "@/hooks/useProfissionais"
import { useDisponibilidadeProfissional } from "@/hooks/useDisponibilidadeProfissional"
import { CAMPOS_EDITAVEIS, useProfissionalDetalhe } from "@/hooks/useProfissionalDetalhe"
import { corFocal, formatarCelular, registroCompleto, terapiasDoProfissional } from "@/lib/cadastros/profissionais"
import { idExibicaoProfissional } from "@/types/profissional"
import { AbaCadastro } from "./AbaCadastro"
import { AbaTerapias } from "./AbaTerapias"
import { SecaoImagens, TrocarFotoAvatar } from "./imagens"
import { AvatarProfissional, estiloCor } from "./pecas"
import { AbaDisponibilidade } from "./disponibilidade/AbaDisponibilidade"
import { AbaHistorico } from "./disponibilidade/AbaHistorico"
import { SeloGrade } from "./disponibilidade/pecasDisponibilidade"

// Ficha do profissional — linguagem visual pastel da tela Entregas PEP
// (components/ui/pastel/pecas.tsx, tokens .pp-* em globals.css): hero com o
// tom da terapia focal, números grandes e abas em cartão.

export type AbaProfissional = "cadastro" | "terapias" | "disponibilidade" | "historico"

type DefAba = {
  id: AbaProfissional
  titulo: string
  meta: string
  t: Tom
  Icone: typeof Contact
  numero: ReactNode
}

export function ProfissionalDetalhe({ id, abaInicial }: { id: number; abaInicial?: AbaProfissional }) {
  const d = useProfissionalDetalhe(id)
  const { confirmar, dialogo } = useConfirmacao()
  const disp = useDisponibilidadeProfissional(id)
  const { terapias: catalogo, indice } = useCadastroTerapias()
  const [aba, setAba] = useState<AbaProfissional>(abaInicial ?? "cadastro")
  const [editando, setEditando] = useState(false)
  const [verHistorico, setVerHistorico] = useState(false)
  const [versaoFoco, setVersaoFoco] = useState<string | null>(null)
  const [alternandoAtivo, setAlternandoAtivo] = useState(false)

  const { registerGuard } = useUnsavedChangesGuard()
  const { camposSujos, salvar } = d
  useEffect(() => {
    registerGuard({ isDirty: camposSujos.length > 0, save: salvar })
    return () => registerGuard(null)
  }, [camposSujos.length, salvar, registerGuard])

  const catalogoPorId = useMemo(() => new Map(catalogo.map(t => [t.id, t])), [catalogo])
  const terapias = useMemo(
    () => (d.prof ? terapiasDoProfissional(d.prof, d.habilitadas, d.grade, catalogoPorId, indice) : []),
    [d.prof, d.habilitadas, d.grade, catalogoPorId, indice]
  )
  const { cor, terapia: focal } = d.prof ? corFocal(d.prof, terapias) : { cor: "#CBD5E1", terapia: null }

  if (d.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm font-semibold text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Carregando…
      </div>
    )
  }
  if (d.migrationPendente) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <InlineNotice tone="amber" icon={<Database className="h-4 w-4" />}>
          O Cadastro de Profissionais ainda não existe neste banco (migration pendente).
        </InlineNotice>
      </div>
    )
  }
  if (d.naoEncontrado || !d.prof || !d.form) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {d.erro ?? "Profissional não encontrado — ou você não tem permissão para ver este cadastro."}
        </div>
      </div>
    )
  }

  const prof = d.prof
  const camposPreenchidos = CAMPOS_EDITAVEIS.filter(c => c !== "observacoes" && c !== "complemento" && (prof[c] ?? "") !== "").length
  const camposTotal = CAMPOS_EDITAVEIS.length - 2
  const horariosTita = d.grade.reduce((s, g) => s + g.horarios, 0)
  const multiplasTerapias = terapias.filter(t => t.terapiaId !== null).length > 1

  const abas: DefAba[] = [
    { id: "cadastro", titulo: "Cadastro", meta: "Preenchido", t: "aco", Icone: Contact,
      numero: <>{Math.round((camposPreenchidos / camposTotal) * 100)}<span className="text-[22px]">%</span></> },
    { id: "terapias", titulo: "Terapias", meta: "O que presta", t: "rosa", Icone: Sparkles, numero: d.habilitadas.length },
    { id: "disponibilidade", titulo: "Disponibilidade", meta: "Sessões/semana", t: "teal", Icone: CalendarDays, numero: disp.sessoesSemana ?? "—" },
    { id: "historico", titulo: "Histórico", meta: "Versões guardadas", t: "azul", Icone: History, numero: disp.versoes.length },
  ]

  const cancelar = async () => {
    if (camposSujos.length && !(await confirmar({
      titulo: "Descartar as alterações?",
      texto: `${camposSujos.length} campo${camposSujos.length === 1 ? "" : "s"} alterado${camposSujos.length === 1 ? "" : "s"} ainda não ${camposSujos.length === 1 ? "foi salvo" : "foram salvos"}.`,
      confirmar: "Descartar",
      cancelar: "Continuar editando",
      t: "vermelho",
      Icone: X,
    }))) return
    d.descartar()
    setEditando(false)
  }
  const salvarEdicao = async () => {
    if (await d.salvar()) setEditando(false)
  }
  const alternarAtivo = async () => {
    const ok = await confirmar(prof.ativo
      ? {
          titulo: `Inativar ${prof.nome}?`,
          texto: "O cadastro, a disponibilidade e o histórico continuam guardados; o profissional só sai da lista padrão.",
          confirmar: "Inativar",
          t: "vermelho",
          Icone: CircleSlash,
        }
      : {
          titulo: `Reativar ${prof.nome}?`,
          texto: "O profissional volta para a lista de ativos.",
          confirmar: "Reativar",
          t: "verde",
          Icone: RotateCcw,
        })
    if (!ok) return
    setAlternandoAtivo(true)
    if (await d.gravarDireto({ ativo: !prof.ativo })) avisoFeito(prof.ativo ? "Profissional inativado" : "Profissional reativado")
    setAlternandoAtivo(false)
  }

  const teclaNaAba = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = abas.findIndex(a => a.id === aba)
    const destino =
      e.key === "ArrowRight" ? abas[(i + 1) % abas.length]
        : e.key === "ArrowLeft" ? abas[(i - 1 + abas.length) % abas.length]
          : e.key === "Home" ? abas[0]
            : e.key === "End" ? abas[abas.length - 1] : null
    if (!destino) return
    e.preventDefault()
    setAba(destino.id)
    document.getElementById(`prof-aba-${destino.id}`)?.focus()
  }

  return (
    <div className="pp @container mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <SecaoPastel titulo="prof-nome" className="relative overflow-hidden">
        {/* Tarja na cor da terapia focal, na borda de cima — a única cor do hero
            além do avatar. A linha interna escurece as cores muito claras
            (Psicopedagogia #FFFB73) para a tarja não sumir no branco. */}
        <span
          aria-hidden
          style={{ backgroundColor: cor }}
          className="pointer-events-none absolute inset-x-0 top-0 h-1.5 shadow-[inset_0_-1px_0_rgba(15,23,42,0.08)]"
        />
        <div className="relative flex flex-col gap-5 @2xl:flex-row @2xl:items-center">
          <TrocarFotoAvatar prof={prof} gravar={d.gravarDireto} confirmar={confirmar}>
            <AvatarProfissional icone={focal?.icone ?? null} fotoPath={prof.foto_path} cor={focal?.terapiaId != null ? cor : null} tamanho="xl" inativo={!prof.ativo} />
          </TrocarFotoAvatar>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-bold text-[var(--pp-ink-muted)]">
              <span>ID {idExibicaoProfissional(prof)}</span>
            </p>
            <h2 id="prof-nome" className="mt-0.5 text-[28px] font-extrabold leading-8 tracking-[-0.02em]">{prof.nome}</h2>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[14px] font-semibold text-[var(--pp-ink-muted)]">
              <span>{registroCompleto(prof) ?? "Sem registro profissional"}</span>
              {prof.cbo && <span>CBO {prof.cbo}</span>}
              {prof.celular && <span>{formatarCelular(prof.celular)}</span>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {prof.ativo ? (
                <span className={`${tom("verde")} pp-pilula h-8 pl-1.5 text-[12px]`}>
                  <span className="pp-pilula-bola size-5"><Check className="h-3 w-3" aria-hidden /></span> Ativo
                </span>
              ) : (
                <span className={`${tom("vermelho")} pp-pilula h-8 pl-1.5 text-[12px]`}>
                  <span className="pp-pilula-bola size-5"><CircleSlash className="h-3 w-3" aria-hidden /></span> Inativo
                </span>
              )}
              {!disp.loading && !disp.migrationPendente && (
                <SeloGrade
                  situacao={disp.vigente ? "vigente" : disp.proxima ? "agendada" : disp.ultimaEncerrada ? "inativa" : "sem_grade"}
                  vigenteDesde={disp.vigente?.vigente_de}
                  proximaDe={disp.proxima?.vigente_de}
                  encerradaEm={disp.ultimaEncerrada?.vigente_ate}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 @2xl:self-start">
            <button type="button" onClick={alternarAtivo} disabled={alternandoAtivo || editando}
              className={`${tom(prof.ativo ? "vermelho" : "verde")} pp-btn pp-btn-suave`}>
              {prof.ativo ? <CircleSlash className="h-4 w-4" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {prof.ativo ? "Inativar" : "Reativar"}
            </button>
            <button type="button" onClick={() => setVerHistorico(true)} className="pp-iconbtn h-[42px] w-[42px]" title="Alterações no cadastro" aria-label="Alterações no cadastro">
              <History className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {multiplasTerapias && (
          <CorDoCard
            terapias={terapias}
            focalId={focal?.terapiaId ?? null}
            onEscolher={async terapiaId => {
              const t = terapias.find(x => x.terapiaId === terapiaId)
              if (await d.gravarDireto({ terapia_focal_id: terapiaId })) avisoFeito(`Card agora em ${t?.nome ?? "outra cor"}`)
            }}
          />
        )}

        {/* Resumo em faixa neutra: sem cor nem cartão próprio, para não competir
            com as abas coloridas logo abaixo (que são o que se clica). */}
        <dl className="relative mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[18px] bg-[var(--pp-border)] shadow-[inset_0_0_0_1px_var(--pp-border)] @4xl:grid-cols-4">
          <Resumo Icone={Sparkles} valor={d.habilitadas.length} rotulo="Terapias habilitadas"
            apoio={`${terapias.filter(t => t.horariosGrade > 0).length} na grade TiTa`} />
          <Resumo Icone={CalendarRange} valor={horariosTita.toLocaleString("pt-BR")} rotulo="Horários na grade TiTa"
            apoio="90 dias para trás em diante" />
          <Resumo Icone={CalendarDays} valor={disp.sessoesSemana ?? "—"} rotulo="Sessões por semana"
            apoio={disp.vigente ? `Versão nº ${disp.vigente.numero} vigente` : "Nenhuma versão valendo hoje"} />
          <Resumo Icone={BadgeCheck} valor={`${camposPreenchidos}/${camposTotal}`} rotulo="Campos do cadastro"
            apoio={prof.sincronizado_tita_em ? `TiTa conferida em ${new Date(prof.sincronizado_tita_em).toLocaleDateString("pt-BR")}` : "Sem importação da TiTa"} />
        </dl>
      </SecaoPastel>

      {/* ── Abas em cartão ───────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Seções da ficha" className="grid grid-cols-2 gap-3 @xl:gap-4 @5xl:grid-cols-4">
        {abas.map(a => (
          <button
            key={a.id}
            type="button"
            role="tab"
            id={`prof-aba-${a.id}`}
            aria-selected={aba === a.id}
            aria-controls={`prof-painel-${a.id}`}
            tabIndex={aba === a.id ? 0 : -1}
            onClick={() => { setVersaoFoco(null); setAba(a.id) }}
            onKeyDown={teclaNaAba}
            className={`${tom(a.t)} pp-aba after:!top-full after:!bottom-auto after:!h-[10px] after:!w-[20px] after:!ml-[-10px] after:![transform:none] after:!rounded-none after:![clip-path:polygon(0_0,100%_0,50%_100%)] !min-h-[64px] !gap-2.5 !rounded-[20px] !p-3 @xl:!min-h-[88px] @xl:!gap-2.5 @xl:!rounded-[24px] @xl:!px-4 @xl:!py-4`}
          >
            <span className="pp-aba-marca" aria-hidden><a.Icone /></span>
            <span className="pp-aba-icone !h-10 !w-10 !rounded-[14px] @xl:!h-11 @xl:!w-11 @5xl:!hidden" aria-hidden><a.Icone className="h-5 w-5" /></span>
            <span className="relative min-w-0 flex-1">
              <span className="block truncate text-[14px] font-extrabold leading-tight @xl:text-[15px]">{a.titulo}</span>
              <span className="pp-aba-meta !hidden @xl:!flex"><span className="truncate">{a.meta}</span></span>
            </span>
            <span className="pp-aba-num !hidden @xl:!block !text-[26px] !leading-[26px]">{a.numero}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`prof-painel-${aba}`} aria-labelledby={`prof-aba-${aba}`} className="pt-2">
        {aba === "cadastro" && (
          <>
          {/* Editar só existe aqui: é a única aba cujos campos dependem dele. */}
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            {editando ? (
              <>
                <span className="mr-auto text-[13px] font-semibold text-[var(--pp-ink-muted)]">
                  {camposSujos.length ? `${camposSujos.length} campo${camposSujos.length === 1 ? "" : "s"} alterado${camposSujos.length === 1 ? "" : "s"} — fica no histórico ao salvar` : "Editando o cadastro"}
                </span>
                <button type="button" onClick={cancelar} className={`${tom("cinza")} pp-btn pp-btn-suave`} disabled={d.salvando}>
                  <X className="h-4 w-4" aria-hidden /> Cancelar
                </button>
                <button type="button" onClick={salvarEdicao} className={`${tom("verde")} pp-btn`} disabled={d.salvando || !camposSujos.length}>
                  {d.salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                  Salvar{camposSujos.length ? ` (${camposSujos.length})` : ""}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setEditando(true)} className={`${tom("cinza")} pp-btn`}>
                <Pencil className="h-4 w-4" aria-hidden /> Editar
              </button>
            )}
          </div>
          <AbaCadastro
            prof={prof}
            form={d.form}
            set={d.set}
            editando={editando}
            imagens={<SecaoImagens prof={prof} gravar={d.gravarDireto} confirmar={confirmar} />}
          />
          </>
        )}
        {aba === "terapias" && (
          <AbaTerapias
            prof={prof}
            terapias={terapias}
            habilitadas={d.habilitadas}
            catalogo={catalogo}
            onSalvarHabilitadas={ids => d.gravarHabilitadas(ids, new Map(catalogo.map(t => [t.id, t.nome])))}
            onDefinirFocal={terapiaId => d.gravarDireto({ terapia_focal_id: terapiaId })}
          />
        )}
        {aba === "disponibilidade" && (
          <AbaDisponibilidade
            prof={prof}
            versoes={disp.versoes}
            habilitadas={d.habilitadas}
            catalogo={catalogo}
            carregando={disp.loading}
            erro={disp.erro}
            migrationPendente={disp.migrationPendente}
            versaoInicialId={versaoFoco}
            onMudou={async () => { await disp.recarregar(); void refetchProfissionais() }}
          />
        )}
        {aba === "historico" && (
          <AbaHistorico
            versoes={disp.versoes}
            eventos={disp.eventos}
            catalogo={catalogo}
            onAbrirVersao={versaoId => { setVersaoFoco(versaoId); setAba("disponibilidade") }}
            onVerAlteracoesCadastro={() => setVerHistorico(true)}
          />
        )}
      </div>

      {dialogo}

      {verHistorico && (
        <HistoricoCadastrosModal
          titulo={`Alterações — ${prof.nome}`}
          subtitulo="Cadastro, terapias habilitadas e cor do card."
          entidades={["profissional"]}
          registroId={prof.id}
          onClose={() => setVerHistorico(false)}
        />
      )}
    </div>
  )
}

/** Um número da faixa-resumo do hero: neutro, sem tom. */
function Resumo({ Icone, valor, rotulo, apoio }: { Icone: typeof Contact; valor: ReactNode; rotulo: string; apoio: string }) {
  return (
    <div className="min-w-0 bg-[var(--pp-surface)] px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs font-bold text-[var(--pp-ink-muted)]">
        <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{rotulo}</span>
      </dt>
      <dd className="mt-1 text-[22px] font-extrabold leading-7 tabular-nums">{valor}</dd>
      <dd className="truncate text-xs font-semibold text-[var(--pp-ink-muted)]" title={apoio}>{apoio}</dd>
    </div>
  )
}

/** "Cor do card": uma bolinha por terapia do catálogo; a marcada é a focal. */
function CorDoCard({
  terapias,
  focalId,
  onEscolher,
}: {
  terapias: { nome: string; cor: string; terapiaId: number | null }[]
  focalId: number | null
  onEscolher: (terapiaId: number) => void
}) {
  const opcoes = terapias.filter(t => t.terapiaId !== null)
  return (
    <div className="relative mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] bg-[var(--pp-muted)] px-4 py-3">
      <span className="inline-flex items-center gap-1.5 text-[13px] font-extrabold">
        <Palette className="h-4 w-4 text-[var(--pp-ink-muted)]" aria-hidden /> Cor do card
      </span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Terapia que dá a cor do card">
        {opcoes.map(t => {
          const marcada = t.terapiaId === focalId
          return (
            <button
              key={t.nome}
              type="button"
              role="radio"
              aria-checked={marcada}
              onClick={() => !marcada && onEscolher(t.terapiaId as number)}
              style={estiloCor(t.cor)}
              title={t.nome}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full pl-1 pr-3 text-[12px] font-bold transition-shadow ${
                marcada
                  ? "bg-[var(--pp-surface)] shadow-[inset_0_0_0_2px_var(--t-linha),var(--pp-sombra)]"
                  : "text-[var(--pp-ink-muted)] hover:bg-[var(--pp-surface)]"
              }`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--t-cor)] ring-1 ring-black/10">
                {marcada && <Check className="h-3.5 w-3.5 text-white mix-blend-difference" aria-hidden />}
              </span>
              <span className="max-w-[12rem] truncate">{t.nome}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
