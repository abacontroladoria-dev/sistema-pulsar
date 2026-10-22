"use client"

import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { AlertCircle, BadgeCheck, Contact, Database, ImageIcon, MapPin, NotebookPen, RotateCcw, X } from "lucide-react"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { SubNavVertical } from "@/components/cadastros/pacientes/ui/SubNavVertical"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { refetchProfissionais } from "@/hooks/useProfissionais"
import { useDisponibilidadeProfissional } from "@/hooks/useDisponibilidadeProfissional"
import { CAMPOS_EDITAVEIS, useProfissionalDetalhe } from "@/hooks/useProfissionalDetalhe"
import { corFocal, terapiasDoProfissional } from "@/lib/cadastros/profissionais"
import { COR_NEUTRA } from "@/lib/cadastros/terapias"
import { AbaCadastro, CAMPOS_DA_SECAO, type SecaoCadastroProf } from "./AbaCadastro"
import { AbaTerapias } from "./AbaTerapias"
import { SecaoImagens } from "./imagens"
import { InativarProfissionalModal } from "./InativarProfissionalModal"
import { ProfissionalHeaderCard } from "./ProfissionalHeaderCard"
import { AbaDisponibilidade } from "./disponibilidade/AbaDisponibilidade"
import { AbaHistorico } from "./disponibilidade/AbaHistorico"
import { SeloGrade } from "./disponibilidade/pecasDisponibilidade"

// Ficha do profissional — design padrão do Pulsar, o mesmo da ficha do
// paciente (/cadastros/pacientes/[id]): cartão de identidade com Editar,
// abas em pílula (SegmentedTabs) e, no Cadastro, menu lateral de seções.

export type AbaProfissional = "cadastro" | "terapias" | "disponibilidade" | "historico"

const ICONE = "h-4 w-4"

export function ProfissionalDetalhe({ id, abaInicial }: { id: number; abaInicial?: AbaProfissional }) {
  const d = useProfissionalDetalhe(id)
  const { confirmar, dialogo } = useConfirmacao()
  const disp = useDisponibilidadeProfissional(id)
  const { terapias: catalogo, indice } = useCadastroTerapias()
  const [aba, setAba] = useState<AbaProfissional>(abaInicial ?? "cadastro")
  const [secao, setSecao] = useState<SecaoCadastroProf>("contato")
  const [editando, setEditando] = useState(false)
  const [verHistorico, setVerHistorico] = useState(false)
  const [versaoFoco, setVersaoFoco] = useState<string | null>(null)
  const [alternandoAtivo, setAlternandoAtivo] = useState(false)
  const [inativando, setInativando] = useState(false)

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
  const { cor, terapia: focal } = d.prof ? corFocal(d.prof, terapias) : { cor: COR_NEUTRA, terapia: null }

  if (d.loading) return <FichaEsqueleto />
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
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
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
  const sujos = new Set<string>(camposSujos)
  const secaoSuja = (s: keyof typeof CAMPOS_DA_SECAO) => CAMPOS_DA_SECAO[s].some(c => sujos.has(c))

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
    // Inativar pede data de saída e o destino dos agendamentos (Grade): modal próprio.
    if (prof.ativo) {
      setInativando(true)
      return
    }
    const ok = await confirmar({
      titulo: `Reativar ${prof.nome}?`,
      texto: "O profissional volta para a lista de ativos. Sessões excluídas na saída não voltam; a disponibilidade precisa de uma versão nova.",
      confirmar: "Reativar",
      t: "verde",
      Icone: RotateCcw,
    })
    if (!ok) return
    setAlternandoAtivo(true)
    if (await d.gravarDireto({ ativo: true })) toast.success("Profissional reativado")
    setAlternandoAtivo(false)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <ProfissionalHeaderCard
        prof={prof}
        focal={focal ? { icone: focal.icone ?? null, terapiaId: focal.terapiaId } : null}
        cor={cor}
        seloGrade={!disp.loading && !disp.migrationPendente ? (
          <SeloGrade
            situacao={disp.vigente ? "vigente" : disp.proxima ? "agendada" : disp.ultimaEncerrada ? "inativa" : "sem_grade"}
            vigenteDesde={disp.vigente?.vigente_de}
            proximaDe={disp.proxima?.vigente_de}
            encerradaEm={disp.ultimaEncerrada?.vigente_ate}
          />
        ) : null}
        resumo={[
          { rotulo: "Terapias habilitadas", valor: d.habilitadas.length, apoio: `${terapias.filter(t => t.horariosGrade > 0).length} na grade do TiTa` },
          { rotulo: "Horários no TiTa", valor: horariosTita.toLocaleString("pt-BR"), apoio: "90 dias para trás em diante" },
          { rotulo: "Sessões por semana", valor: disp.sessoesSemana ?? "—", apoio: disp.vigente ? `Versão nº ${disp.vigente.numero} vigente` : "Nenhuma versão valendo hoje" },
          { rotulo: "Cadastro", valor: `${camposPreenchidos}/${camposTotal}`, apoio: prof.sincronizado_tita_em ? `TiTa conferido em ${new Date(prof.sincronizado_tita_em).toLocaleDateString("pt-BR")}` : "Sem importação do TiTa" },
        ]}
        editando={editando}
        salvando={d.salvando}
        dirtyCount={camposSujos.length}
        alternandoAtivo={alternandoAtivo}
        // Editar só vale para os campos do Cadastro: leva para lá.
        onEditar={() => { setAba("cadastro"); setEditando(true) }}
        onCancelar={() => void cancelar()}
        onSalvar={() => void salvarEdicao()}
        onVerHistorico={() => setVerHistorico(true)}
        onAlterarSituacao={() => void alternarAtivo()}
        gravarFoto={d.gravarDireto}
        confirmar={confirmar}
      />

      <div className="mt-4">
        <SegmentedTabs<AbaProfissional>
          value={aba}
          onChange={a => { setVersaoFoco(null); setAba(a) }}
          size="lg"
          ariaLabel="Seções do profissional"
          tabs={[
            { value: "cadastro", label: "Cadastro" },
            { value: "terapias", label: "Terapias", count: d.habilitadas.length },
            { value: "disponibilidade", label: "Disponibilidade" },
            { value: "historico", label: "Histórico", count: disp.versoes.length },
          ]}
        />
      </div>

      <div className="mt-4">
        {aba === "cadastro" && (
          <div className="flex flex-col gap-6 sm:flex-row">
            <SubNavVertical<SecaoCadastroProf>
              value={secao}
              onChange={setSecao}
              ariaLabel="Seções do cadastro"
              items={[
                { value: "contato", label: "Contato", icon: <Contact className={ICONE} />, alterado: secaoSuja("contato") },
                { value: "registro", label: "Registro profissional", icon: <BadgeCheck className={ICONE} />, alterado: secaoSuja("registro") },
                { value: "endereco", label: "Endereço", icon: <MapPin className={ICONE} />, alterado: secaoSuja("endereco") },
                { value: "observacoes", label: "Observações", icon: <NotebookPen className={ICONE} />, alterado: secaoSuja("observacoes") },
                { value: "imagens", label: "Foto e assinatura", icon: <ImageIcon className={ICONE} /> },
              ]}
            />
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
              <AbaCadastro
                prof={prof}
                form={d.form}
                set={d.set}
                editando={editando}
                secao={secao}
                imagens={<SecaoImagens prof={prof} gravar={d.gravarDireto} confirmar={confirmar} />}
              />
            </div>
          </div>
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

      {inativando && (
        <InativarProfissionalModal
          profissional={{ id: prof.id, nome: prof.nome }}
          onFechar={() => setInativando(false)}
          onFeito={() => { void d.recarregar(); void refetchProfissionais(); void disp.recarregar() }}
          inativarSemGrade={() => d.gravarDireto({ ativo: false })}
        />
      )}

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

/** Esqueleto no formato da ficha (como o da ficha do paciente). */
function FichaEsqueleto() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6" role="status" aria-label="Carregando ficha">
      <div className="rounded-lg border border-border bg-card px-4 py-4">
        <div className="flex items-center gap-4">
          <div className="h-[76px] w-[76px] animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
            <div className="h-3 w-80 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="mt-4 h-9 w-96 max-w-full animate-pulse rounded-full bg-muted" />
      <div className="mt-4 flex flex-col gap-6 sm:flex-row">
        <div className="h-40 animate-pulse rounded-md bg-muted sm:w-56" />
        <div className="h-72 flex-1 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  )
}
