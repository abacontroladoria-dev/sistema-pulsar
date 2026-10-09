"use client"

import { useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { AlertTriangle, Link2, Loader2, Pencil, Save, X } from "lucide-react"
import { DatePicker } from "@/components/ui/date-picker"
import { btnPrimario, btnSecundario, opcaoForm } from "@/components/cronograma/grade/estilo"
import {
  ROTULO_STATUS,
  ROTULO_TIPO,
  TIPOS_CONTRATO,
  dataBR,
  hojeBrasilia,
  statusEfetivo,
  vencimentoSugerido,
  type TipoContrato,
} from "@/lib/contratos/status"
import type { AutorizacoesImagem } from "@/lib/contratos/documento/montarDados"
import { reais } from "@/lib/contratos/documento/extenso"
import {
  buscarValoresPadraoNeuro,
  criarContrato,
  editarRascunho,
} from "@/services/pacienteContratos.service"
import type { ContratoPaciente } from "@/types/contratosPaciente"
import { Campo, CampoCheckbox, CampoSelect, campo, rotulo } from "../../ui/campos"

// Formulário "Novo contrato", aberto na própria aba (não em gaveta) — e o mesmo painel para editar um RASCUNHO
// (depois de enviado para assinatura, o documento é o que vale e as datas
// travam; a RPC recusa a edição).
//
// Os campos dependem do tipo, porque cada modelo de documento imprime coisas
// diferentes (lib/contratos/documento/montarDados.ts):
//   • Avaliação Neuropsicológica: valor (sugerido pela tabela Particular, à
//     vista), limite de sessões e valor da sessão avulsa + autorizações de
//     imagem da cláusula décima.
//   • Termo de Uso de Imagem: o contrato de Terapias a que ele se vincula (o
//     vencimento é o dele) + os canais autorizados e o primeiro nome.
// As autorizações são marcadas AQUI, antes do envio: na assinatura eletrônica
// o responsável não marca caixa.
//
// O QUE É PADRÃO NÃO SE DIGITA (decisão do usuário, 09/10/2026). Nos tipos com
// modelo, valores e datas vêm sozinhos e aparecem num resumo; "Alterar" abre os
// campos só para exceção:
//   • valor = pacote Particular à vista; sessão avulsa = valor por sessão
//     Particular (as duas pela rota /api/contratos/valor-sugerido/, das tabelas
//     do Cronograma); limite = 10 sessões;
//   • início = hoje; vencimento = +3 meses no Neuro (o documento não imprime as
//     datas: valem só para o acompanhamento no Pulsar) e o do contrato de
//     Terapias no Termo.
// Valor que a tabela não tem fica vazio: o contrato é criado assim mesmo e o
// documento acusa a pendência.

const OPCOES_TIPO = TIPOS_CONTRATO.map((t) => ({ valor: t, rotulo: ROTULO_TIPO[t] }))

const PRAZOS = [
  { meses: 3, rotulo: "3 meses" },
  { meses: 6, rotulo: "6 meses" },
  { meses: 12, rotulo: "12 meses" },
]

const CANAIS: { chave: keyof AutorizacoesImagem; rotulo: string; soTermo?: boolean }[] = [
  { chave: "site", rotulo: "Website institucional" },
  { chave: "redes", rotulo: "Redes sociais (Instagram, Facebook, LinkedIn, YouTube…)" },
  { chave: "impressos", rotulo: "Materiais impressos (folders, cartazes, murais)" },
  { chave: "ensino", rotulo: "Apresentações e conteúdos de ensino/EAD" },
  { chave: "primeiro_nome", rotulo: "Identificar o paciente pelo primeiro nome", soTermo: true },
]

const temImagem = (t: TipoContrato | null) => t === "avaliacao_neuropsicologica" || t === "termo_uso_imagem"

const SESSOES_PADRAO = 10
const MESES_NEURO = 3

/** "1.755,50" / "1755.5" / "R$ 1755" → 1755.5. Vazio ou inválido → null. */
export function lerValorBR(s: string): number | null {
  const limpo = s.replace(/[R$\s]/g, "")
  if (!limpo) return null
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo
  const n = Number(normal)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

const escreverValorBR = (n: number | string | null | undefined) =>
  n == null || n === "" ? "" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function NovoContratoPainel({
  pacienteId,
  contratos,
  tipoInicial,
  editando,
  onFechar,
  onSalvo,
}: {
  pacienteId: number
  /** Os contratos do paciente — o Termo escolhe entre os de Terapias. */
  contratos: ContratoPaciente[]
  /** Tipo já escolhido pelo botão "Gerar …" da aba. */
  tipoInicial?: TipoContrato
  /** Presente = editar este rascunho. */
  editando?: ContratoPaciente
  onFechar: () => void
  onSalvo: (c: ContratoPaciente) => void
}) {
  const hoje = hojeBrasilia()
  const [tipo, setTipo] = useState<TipoContrato | null>(editando?.tipo ?? tipoInicial ?? null)
  const [inicio, setInicio] = useState(editando?.data_inicio ?? hoje)
  const [vencimento, setVencimento] = useState(
    editando?.data_vencimento ?? vencimentoSugerido(hoje, tipoInicial === "avaliacao_neuropsicologica" ? MESES_NEURO : 12),
  )
  const [observacao, setObservacao] = useState(editando?.observacao ?? "")
  const [valor, setValor] = useState(escreverValorBR(editando?.valor_total))
  const [sessoes, setSessoes] = useState(String(editando?.sessoes_max ?? SESSOES_PADRAO))
  const [avulsa, setAvulsa] = useState(escreverValorBR(editando?.valor_sessao_avulsa))
  const [vinculadoId, setVinculadoId] = useState<string | null>(
    editando?.contrato_vinculado_id != null ? String(editando.contrato_vinculado_id) : null,
  )
  const [imagem, setImagem] = useState<AutorizacoesImagem>(editando?.autorizacoes_imagem ?? {})
  /** Campos de valores/datas abertos ("Alterar"). Fechado = resumo com os padrões. */
  const [alterar, setAlterar] = useState(false)
  /** Leitura das tabelas de valores em andamento (Neuro). */
  const [lendoPadrao, setLendoPadrao] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const ref = useRef<HTMLElement>(null)

  // Abre na própria página: leva o formulário à vista.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  // Valores padrão do Neuro: preenchem só o que está vazio (ao editar um
  // rascunho criado sem avulsa, a tabela cadastrada depois completa).
  useEffect(() => {
    if (tipo !== "avaliacao_neuropsicologica") return
    let cancelado = false
    setLendoPadrao(true)
    void buscarValoresPadraoNeuro().then((p) => {
      if (cancelado) return
      setLendoPadrao(false)
      if (p.valor != null) setValor((atual) => atual || escreverValorBR(p.valor))
      if (p.avulsa != null) setAvulsa((atual) => atual || escreverValorBR(p.avulsa))
    })
    return () => {
      cancelado = true
    }
  }, [tipo])

  // Termo: só contrato de Terapias não cancelado do paciente.
  const terapias = contratos.filter((c) => c.tipo === "terapias" && statusEfetivo(c) !== "cancelado")
  const opcoesVinculo = terapias.map((c) => ({
    valor: String(c.id),
    rotulo: `${c.numero} · ${dataBR(c.data_inicio)} → ${dataBR(c.data_vencimento)} · ${ROTULO_STATUS[statusEfetivo(c)]}`,
  }))
  const vinculado = terapias.find((c) => String(c.id) === vinculadoId) ?? null

  const ehTermo = tipo === "termo_uso_imagem"
  const ehNeuro = tipo === "avaliacao_neuropsicologica"
  // Tipos com modelo: datas (e valores, no Neuro) ficam no resumo até "Alterar".
  const resumido = (ehNeuro || ehTermo) && !alterar
  // No Termo o vencimento é o do contrato vinculado (o banco também força isso).
  const vencimentoEfetivo = ehTermo ? vinculado?.data_vencimento ?? "" : vencimento

  const valorNum = lerValorBR(valor)
  const avulsaNum = lerValorBR(avulsa)
  const sessoesNum = Number(sessoes)
  const sessoesOk = Number.isInteger(sessoesNum) && sessoesNum >= 1 && sessoesNum <= 100

  const datasOk = !!inicio && !!vencimentoEfetivo && vencimentoEfetivo >= inicio
  // Valor vazio é aceito (a tabela pode não ter); digitado, precisa ser válido.
  const neuroOk = !ehNeuro || ((!valor || valorNum !== null) && (!avulsa || avulsaNum !== null) && sessoesOk)
  const termoOk = !ehTermo || !!vinculado
  const valido = !!tipo && datasOk && neuroOk && termoOk

  async function salvar() {
    if (!valido || !tipo) return
    setSalvando(true)
    const dados = {
      tipo,
      dataInicio: inicio,
      dataVencimento: vencimentoEfetivo,
      observacao: observacao.trim() || null,
      valorTotal: ehNeuro ? valorNum : null,
      sessoesMax: ehNeuro ? sessoesNum : null,
      valorSessaoAvulsa: ehNeuro ? avulsaNum : null,
      contratoVinculadoId: ehTermo && vinculado ? vinculado.id : null,
      autorizacoesImagem: temImagem(tipo) ? imagem : null,
    }
    try {
      const contrato = editando ? await editarRascunho(editando.id, dados) : await criarContrato(pacienteId, dados)
      toast.success(editando ? "Contrato salvo." : `Contrato ${contrato.numero} criado em Rascunho.`)
      onSalvo(contrato)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o contrato.", { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section
      ref={ref}
      aria-labelledby="novo-contrato-titulo"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !salvando && !e.defaultPrevented) onFechar()
      }}
      className="scroll-mt-4 rounded-lg border border-primary/30 bg-card shadow-sm"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="novo-contrato-titulo" className="text-base font-semibold text-foreground">
            {editando ? `Editar contrato ${editando.numero}` : tipo ? `Novo: ${ROTULO_TIPO[tipo]}` : "Novo contrato"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {editando
              ? "Só é possível editar enquanto está em Rascunho."
              : "Nasce em Rascunho, com número. Depois, no detalhe, visualize e baixe o documento preenchido."}
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          disabled={salvando}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="space-y-5 px-4 py-4">
        <CampoSelect<TipoContrato>
          label="Tipo de contrato *"
          value={tipo}
          onChange={setTipo}
          disabled={false}
          opcoes={OPCOES_TIPO}
          vazio="Escolha o tipo"
        />

        {ehTermo && (
          <div className="space-y-2">
            {opcoesVinculo.length === 0 ? (
              <p role="alert" className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                O Termo se vincula ao contrato de Terapias do paciente, e ele ainda não tem um. Crie o contrato de Terapias primeiro.
              </p>
            ) : (
              <CampoSelect<string>
                label="Vinculado ao contrato de Terapias *"
                value={vinculadoId}
                onChange={setVinculadoId}
                disabled={false}
                opcoes={opcoesVinculo}
                vazio="Escolha o contrato"
                dica="O Termo imprime o número e a data deste contrato e vence junto com ele."
              />
            )}
          </div>
        )}

        {resumido && (
          <ResumoPadrao
            itens={
              ehNeuro
                ? [
                    {
                      rotulo: "Valor total",
                      valor: valorNum !== null ? `${reais(valorNum)} (tabela Particular, à vista)` : null,
                      falta: lendoPadrao ? "lendo a tabela…" : "sem valor na tabela de pacotes",
                    },
                    { rotulo: "Limite de sessões", valor: sessoesOk ? `até ${sessoesNum}` : null, falta: "inválido" },
                    {
                      rotulo: "Sessão avulsa",
                      valor: avulsaNum !== null ? reais(avulsaNum) : null,
                      falta: lendoPadrao ? "lendo a tabela…" : "sem valor por sessão Particular na tabela de valores",
                    },
                    {
                      rotulo: "Vigência no Pulsar",
                      valor: `${dataBR(inicio)} → ${dataBR(vencimento)}`,
                      falta: "",
                    },
                  ]
                : [
                    {
                      rotulo: "Vigência no Pulsar",
                      valor: `${dataBR(inicio)} → ${vinculado ? dataBR(vinculado.data_vencimento) : "vencimento do contrato de Terapias"}`,
                      falta: "",
                    },
                  ]
            }
            nota={
              ehNeuro
                ? "Valores do documento (cláusula sétima). As datas não saem no contrato: servem ao acompanhamento."
                : "As datas não saem no Termo: ele imprime o número e a data do contrato de Terapias."
            }
            rotuloAlterar={ehNeuro ? "Alterar valores e datas" : "Alterar data de início"}
            onAlterar={() => setAlterar(true)}
          />
        )}

        {!resumido && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className={rotulo}>Data de início *</span>
                <div className="mt-1">
                  <DatePicker value={inicio} onChange={(v) => v && setInicio(v)} />
                </div>
              </div>
              <div>
                <span className={rotulo}>Data de vencimento *</span>
                <div className="mt-1">
                  {ehTermo ? (
                    <p className="rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5 text-sm text-muted-foreground">
                      {vinculado ? `${dataBR(vinculado.data_vencimento)} (a do contrato de Terapias)` : "A do contrato de Terapias"}
                    </p>
                  ) : (
                    <DatePicker value={vencimento} onChange={(v) => v && setVencimento(v)} />
                  )}
                </div>
              </div>
            </div>
            {!ehTermo && (
              <div className="-mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Vencimento em:</span>
                {PRAZOS.map((p) => {
                  const alvo = inicio ? vencimentoSugerido(inicio, p.meses) : ""
                  return (
                    <button
                      key={p.meses}
                      type="button"
                      aria-pressed={vencimento === alvo}
                      disabled={!inicio}
                      onClick={() => setVencimento(alvo)}
                      className={`${opcaoForm(vencimento === alvo)} min-h-9 text-xs`}
                      title={alvo ? `Vence em ${dataBR(alvo)}` : undefined}
                    >
                      {p.rotulo}
                    </button>
                  )
                })}
              </div>
            )}
            {!datasOk && inicio && vencimentoEfetivo && (
              <p role="alert" className="-mt-2 text-xs text-destructive">
                O vencimento precisa ser igual ou depois do início.
              </p>
            )}

            {ehNeuro && (
              <fieldset className="space-y-3 rounded-lg border border-border p-3">
                <legend className={`${rotulo} px-1`}>Valores do contrato (cláusula sétima)</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo
                    label="Valor total (R$) *"
                    value={valor}
                    onChange={setValor}
                    disabled={false}
                    placeholder="0,00"
                  />
                  <Campo
                    label="Limite de sessões *"
                    value={sessoes}
                    onChange={(v) => setSessoes(v.replace(/\D/g, ""))}
                    disabled={false}
                    inputMode="numeric"
                    maxLength={3}
                  />
                  <Campo
                    label="Sessão avulsa (R$) *"
                    value={avulsa}
                    onChange={setAvulsa}
                    disabled={false}
                    placeholder="0,00"
                  />
                </div>
                {(valor && valorNum === null) || (avulsa && avulsaNum === null) ? (
                  <p role="alert" className="text-xs text-destructive">Valor inválido. Use o formato 1.755,00.</p>
                ) : null}
                {sessoes && !sessoesOk && <p role="alert" className="text-xs text-destructive">Sessões: de 1 a 100.</p>}
              </fieldset>
            )}
          </>
        )}

        {temImagem(tipo) && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className={`${rotulo} px-1`}>Uso externo de imagem</legend>
            <p className="text-xs text-muted-foreground">
              Marque só o que o responsável autorizou. Sem marcação = NÃO AUTORIZO. As caixas saem marcadas no documento.
            </p>
            <div className="grid gap-2">
              {CANAIS.filter((c) => !c.soTermo || ehTermo).map((c) => (
                <CampoCheckbox
                  key={c.chave}
                  label={c.rotulo}
                  checked={!!imagem[c.chave]}
                  onChange={(v) => setImagem((atual) => ({ ...atual, [c.chave]: v }))}
                  disabled={false}
                />
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <label className={rotulo} htmlFor="contrato-observacao">
            Observação
          </label>
          <textarea
            id="contrato-observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Ex.: condição especial, quem negociou"
            className={`mt-1 ${campo} resize-y`}
          />
        </div>
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onFechar} disabled={salvando} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
          Cancelar
        </button>
        <button type="button" onClick={() => void salvar()} disabled={!valido || salvando} className={`${btnPrimario} min-h-11 sm:min-h-0`}>
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {salvando ? "Salvando…" : editando ? "Salvar" : "Criar contrato"}
        </button>
      </footer>
    </section>
  )
}

/** Os padrões do contrato, prontos — só "Alterar" abre os campos. */
function ResumoPadrao({
  itens,
  nota,
  rotuloAlterar,
  onAlterar,
}: {
  itens: { rotulo: string; valor: string | null; falta: string }[]
  nota: string
  rotuloAlterar: string
  onAlterar: () => void
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        {itens.map((i) => (
          <div key={i.rotulo} className="contents">
            <dt className="text-muted-foreground">{i.rotulo}</dt>
            <dd className="text-foreground">
              {i.valor ?? (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {i.falta}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{nota}</p>
        <button type="button" onClick={onAlterar} className={`${btnSecundario} min-h-11 text-xs sm:min-h-0`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          {rotuloAlterar}
        </button>
      </div>
    </div>
  )
}
