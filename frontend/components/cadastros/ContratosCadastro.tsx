"use client"

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import toast from "react-hot-toast"
import { AlertCircle, Check, ChevronLeft, ChevronRight, ListFilter, Loader2, Plus, Search, StickyNote, UserPlus, X } from "lucide-react"
import { getContratos, getProfissionaisRoster, upsertContrato } from "@/services/remuneracao.service"
import {
  formatMoedaBRTexto,
  maskCpfCnpj,
  maskMoedaBR,
  onlyDigits,
  parseNumeroBR,
  splitDocumento,
  validarCpfCnpj,
} from "@/lib/remuneracao/formatacao"
import { normKey } from "@/lib/remuneracao/constants"
import { useDraftRow, useDraftTable, type DraftTable, type SaveStatus } from "@/hooks/useDraftRow"
import { useTerapiasAgendaPorProfissional } from "@/hooks/useTerapiasAgendaPorProfissional"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext"
import { UnsavedChangesModal } from "@/components/UnsavedChangesModal"
import { NovoProfissionalModal, type NovoProfissionalPayload } from "./NovoProfissionalModal"
import { ObservacaoContratoModal } from "./ObservacaoContratoModal"
import { SalvarTudoBar } from "./shared/SalvarTudoBar"
import type { ContratoAtual, ContratoAtualItem } from "@/types/remuneracao"

// A ordem das chaves aqui É contrato de API interna: a `assinatura` do
// useDraftRow é JSON.stringify, então presença e ordem de chave decidem se o
// bloco está "sujo". Campo novo entra no FIM, e em todos os literais que montam
// um ContratoItemEdit (`initial`, `addContrato`, o modal de criação) — se um
// deles omitir, o bloco nasce marcado como não salvo sem nada ter mudado.
type ContratoItemEdit = {
  numero: string
  funcao: string
  valorPATexto: string
  vigente: boolean
  modeloFaturamento: "atendimento" | "banco_horas"
  valorTotalTexto: string
  observacoes: string
  // Valor mensal da PEP por paciente (V) — só relevante para contrato de
  // Analista do Comportamento. Vazio = usa o valor de referência global
  // (remuneracao_config.cc_pe_default), mesmo padrão de valorPA/paDoContrato.
  valorPepMensalTexto: string
  // Seleção crua do checkbox de banco de horas — só existe pra reabrir o
  // checkbox marcado como foi salvo. `funcao` (acima) continua sendo o campo
  // que o resto do sistema lê: com 0-1 marcada, funcao = a própria terapia (ou
  // ""); com 2+, funcao vira o rótulo composto FUNCAO_MULTIPLA_LABEL. Só
  // usada quando modeloFaturamento === "banco_horas" — ver LinhaContrato.
  especialidadesBancoHoras: string[]
  // Exceções de valor por sessão dentro deste mesmo contrato (só "Por
  // atendimento"): a terapia listada paga o seu valor, o resto paga
  // valorPATexto. Ver paDoContrato em lib/remuneracao/calculo.ts.
  valoresPorTerapia: ValorPorTerapiaEdit[]
}

type ValorPorTerapiaEdit = { terapia: string; valorPATexto: string }

type LinhaBase = {
  profissionalNome: string
  cpf: string | null
  cnpj: string | null
  razaoSocial: string | null
  documentoTipo: string | null
  contratosAtuais: ContratoAtualItem[]
}

type LinhaValor = {
  documento: string
  razaoSocial: string
  documentoTipo: string
  contratos: ContratoItemEdit[]
}

// ─── Tokens locais ───────────────────────────────────────────────────────────
// Escala de 3 degraus, pelos tokens do projeto e não por px cru:
//   text-md (14px) identidade · text-sm (12px) valores · text-xs (11px) rótulos
// Desceu um degrau nos dois primeiros (eram 15 e 13) porque numa página de 50
// blocos o texto maior empurrava tudo e o conjunto perdia unidade. O terceiro
// ficou em 11px de propósito: 11 é o piso da escala do projeto (--text-xs), e
// os chips de aviso vivem nele — encolher para 10 contrariava o pedido de dar
// destaque a eles. Mesma escala no NovoProfissionalModal.
//
// `tabular-nums` em todo dígito — numa tela cujo conteúdo é dinheiro e
// documento, alinhamento de dígito na vertical É a decisão tipográfica: sem ele
// nada é conferível de bater no olho.
//
// Neutros por token (--card/--border/--foreground/--muted) e as superfícies do
// bloco por --bloco-* (ver globals.css). Matizes semânticos usam classes
// Tailwind, que a camada de compat do globals.css normaliza no tema escuro —
// por isso NÃO se escreve `dark:` nelas: a compat é CSS sem @layer e vence
// qualquer variante `dark:` gerada pelo Tailwind, então o par ficaria morto.
//
// Um matiz = um significado, agora com quatro e só quatro:
//   âmbar    alteração não salva (transitório, move a barra de salvar)
//   emerald  contrato vigente / salvar / salvo
//   rose     dinheiro sai errado: sem vigente, vigente duplicado, valor zerado
//   sky      salvando
//   invertido (foreground/background)  filtro ligado
// Ações de linha (adicionar, descartar, cancelar contrato) são NEUTRAS de
// propósito: eram emerald e roubavam o matiz que precisa significar "vigente".
// Base sem fundo: duas utilitárias de `background-color` na mesma string é
// aposta na ordem de geração do Tailwind, não decisão. Cada variante declara a
// sua uma vez só.
const campoBase =
  "rounded-md border border-border px-2 py-1 text-sm text-foreground " +
  "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
const campo = `${campoBase} bg-transparent`
// Campo que mora na faixa tingida precisa de poço branco: contra a faixa a
// --border rende só 1,12:1, e sem o preenchimento o input deixa de se anunciar
// como input. Branco sobre a faixa dá 1,13:1 — o campo volta a ser uma forma.
const campoNaFaixa = `${campoBase} bg-card`
const foco = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

// Ação de saída da linha. Largura FIXA porque o rótulo muda ("Cancelar
// contrato" / "Reativar contrato" / "Descartar") e, sendo o último item de uma
// linha que reparte folga por flex, um rótulo mais curto puxaria as colunas
// daquela linha só — as colunas ficariam desalinhadas entre linhas do mesmo
// bloco. w-40 + nowrap: em w-36 o rótulo mais longo ("Cancelar contrato")
// quebrava em duas linhas e engordava só aquela linha — exatamente o
// desalinhamento que a largura fixa existe para evitar.
const acaoLinha =
  `${foco} w-40 shrink-0 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 ` +
  "text-center text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors"

// Âncora estável por nome, para rolar até o bloco de um profissional
// recém-criado — com 120+ blocos em 3 páginas, criar e não saber onde foi parar
// é o mesmo que não ter criado.
const idDoBloco = (nome: string) =>
  "prof-" +
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")

// Id determinístico do botão de observação, para devolver o foco a ele quando o
// modal fecha. Mesmo padrão do `getElementById(idDoBloco(...))` já usado para
// rolar até um bloco — `useId` não serve porque o botão mora num componente
// filho e o pai precisa alcançá-lo.
const idBotaoObs = (nome: string, idx: number) => `obs-${idDoBloco(nome)}-${idx}`

// Rótulo que `funcao` recebe quando 2+ terapias são marcadas no checkbox de
// banco de horas (LinhaContrato). Vira uma especialidade própria no dashboard
// de Rem. Mês — a pedido do usuário, o valor NÃO é rateado entre as
// especialidades reais; fica separado justamente para distinguir este caso
// (1 contrato cobrindo várias terapias) de quem tem um contrato por terapia.
const FUNCAO_MULTIPLA_LABEL = "Contrato único, especialidades múltiplas"

const unidadeDe = (modelo: ContratoItemEdit["modeloFaturamento"]) =>
  modelo === "banco_horas" ? "total" : "/sessão"

const valorDoVigente = (c: ContratoItemEdit) =>
  c.modeloFaturamento === "banco_horas" ? c.valorTotalTexto : c.valorPATexto

// Testar string vazia não bastava: formatMoedaBRTexto(0) devolve "0,00", então
// um contrato VIGENTE valendo zero passava sem aviso nenhum — a calculadora
// pagava R$ 0 e o bloco dizia que estava tudo certo. Vale o número, não o texto.
const semValor = (c: ContratoItemEdit) => !(parseNumeroBR(valorDoVigente(c)) ?? 0)

// Exceção com terapia escolhida e valor vazio/zero: a calculadora pagaria R$ 0
// por aquela terapia — mesmo risco do "valor zerado" do contrato.
const excecaoSemValor = (c: ContratoItemEdit) =>
  c.modeloFaturamento === "atendimento" &&
  c.valoresPorTerapia.some(v => v.terapia && !(parseNumeroBR(v.valorPATexto) ?? 0))

// A linha em branco que "Adicionar contrato" cria não deve virar registro. Mas
// "em branco" precisa considerar TODOS os campos do item: enquanto a nota ficou
// de fora deste teste, contrato que só carregava observação era descartado em
// silêncio no primeiro salvamento — inclusive os itens que a migration
// 20260803120000 criou justamente para não perder a nota de quem não tinha
// contrato nenhum. Predicado num lugar só, para o próximo campo novo não repetir
// o bug.
const itemEmBranco = (it: ContratoItemEdit) =>
  !it.numero.trim() &&
  !it.funcao.trim() &&
  !it.valorPATexto.trim() &&
  !it.valorTotalTexto.trim() &&
  !it.observacoes.trim() &&
  !it.valorPepMensalTexto.trim() &&
  !it.valoresPorTerapia.some(v => v.terapia || v.valorPATexto.trim())

// Chip de incompletude, em DOIS níveis — porque as duas faltas não custam a
// mesma coisa e antes eram desenhadas igual:
//
//   grave (rose)  a calculadora já paga errado, e em silêncio. Sem contrato
//                 vigente ela paga R$ 0; com dois vigentes ela escolhe um.
//                 Ninguém descobre até o fechamento do mês.
//   normal        buraco cadastral: atrapalha na hora de emitir, mas atrapalha
//                 avisando. Legível, sem competir com o grave.
//
// Rose aqui não colide com o rose de "remover": os dois dizem *perda* — apagar
// um contrato e não ter contrato vigente terminam no mesmo lugar. E o âmbar
// continua intocado, exclusivo de "não salvo", que é o que move a barra de
// salvar e o guard de navegação.
//
// Os dois abandonaram o tracejado cinza: sobre a faixa nova ele dava 4,20:1,
// abaixo do mínimo AA. E o preenchimento é --card, não um tinto pálido —
// sobre superfície tingida um rose-100 rende 1,06:1 e deixa de se ler como
// forma, então o peso vem do contorno e da tinta, que é onde se mede
// contraste de verdade.
function ChipFalta({ grave = false, children }: { grave?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs tabular-nums ${
        grave
          ? "border-rose-300 font-semibold text-rose-700"
          : "border-border font-medium text-muted-foreground"
      }`}
    >
      {grave && <AlertCircle size={11} className="shrink-0" aria-hidden="true" />}
      {children}
    </span>
  )
}

// ─── Estado do contrato ──────────────────────────────────────────────────────
// Virou SELO, não mais botão. Antes o mesmo elemento mostrava o estado e o
// trocava; agora quem troca é o botão rotulado no fim da linha ("Cancelar
// contrato" / "Reativar contrato"), então manter a pílula clicável seria dois
// controles para a mesma coisa — e o pior tipo de duplicata, a que muda dinheiro.
// Aqui o selo só informa: a calculadora usa este contrato, ou não.

function SeloEstado({ vigente }: { vigente: boolean }) {
  return (
    <span
      title={
        vigente
          ? "Vigente — a calculadora usa este contrato."
          : "Histórico — a calculadora ignora este contrato, mas ele continua registrado."
      }
      className={`inline-flex w-26 shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-bold uppercase tracking-wide ${
        vigente
          // bg-card, e não bg-emerald-50: agora a LINHA vigente é que leva o
          // wash emerald, então um selo emerald sobre ela sumiria. Poço branco
          // sobre bandeja verde — mesma lógica dos chips na faixa.
          ? "border-emerald-600 bg-card text-emerald-700"
          : "border-dashed border-border text-muted-foreground"
      }`}
    >
      {vigente && <Check size={11} aria-hidden="true" />}
      {vigente ? "Vigente" : "Histórico"}
    </span>
  )
}

// ─── Campo de valor ──────────────────────────────────────────────────────────
// "Valor (R$)" servia duas grandezas incomparáveis sob o mesmo rótulo: PA por
// sessão (~R$ 60) e total do contrato (~R$ 8.000). A unidade agora viaja com o
// número, num sufixo de largura fixa — assim a borda direita do número fica no
// mesmo lugar em todas as linhas, mesmo quando o modelo difere.

function CampoValor({
  item,
  descricao,
  onChange,
}: {
  item: ContratoItemEdit
  descricao: string
  onChange: (texto: string) => void
}) {
  const bancoHoras = item.modeloFaturamento === "banco_horas"
  return (
    <div className="inline-flex w-38 shrink-0 items-center rounded-md border border-border focus-within:ring-2 focus-within:ring-ring">
      <span className="select-none pl-2 text-xs text-muted-foreground">R$</span>
      <input
        value={bancoHoras ? item.valorTotalTexto : item.valorPATexto}
        onChange={e => onChange(maskMoedaBR(e.target.value))}
        placeholder="0,00"
        inputMode="numeric"
        aria-label={descricao}
        className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-right text-sm tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
      {/* Largura fixa: mantém a borda direita do número no mesmo lugar em todas
          as linhas, mesmo quando o modelo (e portanto a unidade) difere. */}
      <span className="w-13 shrink-0 select-none pr-2 text-xs text-muted-foreground">
        {unidadeDe(item.modeloFaturamento)}
      </span>
    </div>
  )
}

// Campo opcional do valor mensal da PEP (V) por paciente — só usado em
// contrato de Analista do Comportamento. Vazio de propósito na maioria dos
// contratos (PA), por isso mora fora de CampoValor: aqui a unidade é fixa
// ("PEP/mês") e o campo em branco é um estado válido, não "valor zerado".
function CampoValorPep({
  texto,
  descricao,
  onChange,
}: {
  texto: string
  descricao: string
  onChange: (texto: string) => void
}) {
  return (
    <div
      className="inline-flex w-44 shrink-0 items-center rounded-md border border-border focus-within:ring-2 focus-within:ring-ring"
      title="Valor mensal da PEP por paciente (V). Em branco, usa o valor de referência padrão."
    >
      <span className="select-none pl-2 text-xs text-muted-foreground">R$</span>
      <input
        value={texto}
        onChange={e => onChange(maskMoedaBR(e.target.value))}
        placeholder="padrão"
        inputMode="numeric"
        aria-label={descricao}
        className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-right text-sm tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
      <span className="w-16 shrink-0 select-none pr-2 text-xs text-muted-foreground">PEP/mês</span>
    </div>
  )
}

// ─── Linha de contrato ───────────────────────────────────────────────────────
// Cada campo se auto-rotula (prefixo "Nº", o select mostra o modelo, o valor
// mostra a unidade, o estado mostra a palavra), então o grupo não precisa de
// faixa de cabeçalho de coluna — o que também elimina a fragilidade de manter
// larguras de coluna alinhadas com um cabeçalho separado.

function LinhaContrato({
  item,
  nome,
  posicao,
  persistido,
  mostrarFuncao,
  terapiasAgenda,
  onPatch,
  onRemove,
  onAbrirObs,
}: {
  item: ContratoItemEdit
  nome: string
  posicao: number
  /** Já existe no banco. Define se a saída da linha preserva ou descarta. */
  persistido: boolean
  /** Só faz sentido escolher qual terapia cada contrato cobre quando há mais de
   * um contrato vigente — com um só, o PA dele vale pra qualquer substituição
   * (ver resolverPARow em lib/remuneracao/calculo.ts), então o campo é ruído.
   * Exceção: banco de horas, onde a função é a especialidade usada para
   * agrupar o valor no dashboard de Rem. Mês mesmo com 1 único contrato. */
  mostrarFuncao: boolean
  /** Terapias reais da agenda TiTa deste profissional — mesma fonte do texto
   * abaixo do nome (useTerapiasAgendaPorProfissional). */
  terapiasAgenda: string[]
  onPatch: (patch: Partial<ContratoItemEdit>) => void
  onRemove: () => void
  onAbrirObs: () => void
}) {
  const ref = `contrato ${posicao} de ${nome}`
  const temNota = !!item.observacoes.trim()

  // Com uma única terapia na agenda não há o que escolher — o campo existe só
  // pra desambiguar entre 2+ (ver `mostrarFuncao` acima). Preenche sozinho em
  // vez de deixar "Qual terapia este contrato cobre?" solto pedindo um clique
  // óbvio. Só entra se ainda estiver vazio: não sobrescreve uma função que o
  // operador já escolheu (nem uma "fora da agenda atual" antiga).
  useEffect(() => {
    if (mostrarFuncao && !item.funcao && terapiasAgenda.length === 1) {
      onPatch({ funcao: terapiasAgenda[0], especialidadesBancoHoras: [terapiasAgenda[0]] })
    }
  }, [mostrarFuncao, item.funcao, terapiasAgenda, onPatch])

  // Banco de horas: checkbox multi-seleção em vez do <select> único — um
  // contrato só pode cobrir 2+ terapias quando o modelo é banco de horas (não
  // há PA por sessão pra rotear entre contratos, então nada em calculo.ts
  // depende de `funcao` bater exatamente com a especialidade da linha — ver
  // escolherContratoDaLinha/paDoContrato, que só valem pra "atendimento").
  // Com 0 ou 1 marcada, `funcao` continua sendo a própria terapia (ou ""); com
  // 2+, vira o rótulo composto — ver FUNCAO_MULTIPLA_LABEL.
  const toggleEspecialidadeBancoHoras = (terapia: string) => {
    const selecionadas = item.especialidadesBancoHoras.includes(terapia)
      ? item.especialidadesBancoHoras.filter(t => t !== terapia)
      : [...item.especialidadesBancoHoras, terapia]
    const funcao = selecionadas.length === 0 ? "" : selecionadas.length === 1 ? selecionadas[0] : FUNCAO_MULTIPLA_LABEL
    onPatch({ especialidadesBancoHoras: selecionadas, funcao })
  }

  return (
    // A marca mudou de lado: era o HISTÓRICO que ganhava fundo cinza, e como
    // quase todo contrato importado entrou como histórico, isso pintava a lista
    // inteira — marca que marca tudo não marca nada, e ainda brigava com a
    // faixa do cabeçalho. Agora quem recebe o realce é o VIGENTE, que é o raro
    // e o consequente: num bloco com três contratos dá para ver qual deles a
    // calculadora usa sem ler nenhuma palavra. De quebra, a lista vai ficando
    // verde conforme o trabalho anda.
    // A folga da linha é repartida entre os DOIS campos de texto, em vez de
    // sobrar no fim: antes só a especialidade era flex — com teto, para não
    // engolir a tela inteira — e o que o teto barrava virava vazio à direita.
    // Agora Nº cresce 1 e especialidade cresce 2: a linha fecha na mesma borda
    // do cabeçalho e nenhum dos dois fica desproporcional. Como todos os outros
    // filhos têm largura fixa, a repartição dá igual em todas as linhas e as
    // colunas continuam alinhadas na vertical.
    <div className={`rounded-lg transition-colors ${item.vigente ? "bg-emerald-50" : ""}`}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
      {/* Nº precisa caber inteiro: é identificador, não rótulo — meia string não
          serve para conferir com o contrato em papel. O prefixo "Nº" saiu: com o
          campo preenchido, "Nº PS.ABA-…" repetia o que o próprio valor já diz, e
          um placeholder cobre o campo vazio melhor que um rótulo permanente.
          O botão de observação mora DENTRO do campo de propósito: a nota é sobre
          ESTE contrato, e o campo que identifica o contrato é o número — solto
          entre dois campos com borda, o ícone não teria dono. Também mantém seis
          filhos na linha, então o comportamento de wrap não muda. */}
      <div className="inline-flex min-w-48 flex-1 items-center rounded-md border border-border focus-within:ring-2 focus-within:ring-ring">
        <input
          value={item.numero}
          onChange={e => onPatch({ numero: e.target.value })}
          placeholder="Nº do Contrato"
          aria-label={`Número do ${ref}`}
          className="min-w-0 flex-1 bg-transparent py-1 pl-2.5 pr-1 text-sm tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        {/* Indicador neutro de propósito: âmbar, emerald, rose e sky já
            significam coisas que custam dinheiro confundir nesta tela. O ESTADO
            (tem nota ou não) vai no aria-label, porque leitor de tela não lê
            `title` de forma confiável; o TEXTO da nota fica no title e no modal.
            Um aria-label de 300 caracteres num botão de 24px seria pior. */}
        <button
          type="button"
          id={idBotaoObs(nome, posicao - 1)}
          onClick={onAbrirObs}
          aria-label={`Observação do ${ref} — ${temNota ? "1 observação registrada" : "sem observação"}`}
          title={temNota ? item.observacoes : "Adicionar observação a este contrato"}
          className={`${foco} relative mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
            temNota
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          }`}
        >
          <StickyNote size={13} aria-hidden="true" />
          {temNota && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-foreground"
            />
          )}
        </button>
      </div>

      {/* Só aparece com 2+ contratos vigentes (ou banco de horas — ver
          `mostrarFuncao` acima): é o único caso em que resolverPARow precisa
          saber qual contrato cobre qual terapia pra rotear o PA de
          substituição corretamente (ver escolherContratoDaLinha em
          lib/remuneracao/calculo.ts). Opções vêm da agenda REAL do TiTa, não
          de um vocabulário fixo — o operador escolhe entre o que o profissional
          de fato atende, em vez de adivinhar um rótulo genérico.
          Banco de horas usa checkbox (multi-seleção): sem PA por sessão pra
          rotear, um único contrato pode legitimamente cobrir 2+ terapias (ver
          toggleEspecialidadeBancoHoras). "Por atendimento" continua de escolha
          única — ali `funcao` precisa bater exato com a especialidade da linha. */}
      {mostrarFuncao && item.modeloFaturamento === "banco_horas" ? (
        <div className="min-w-40 flex-2">
          {/* `variant="plano"` + `campo`: mesmo tamanho, borda e cor do select
              de "Banco de horas" ao lado — sem isso o combobox trazia seu
              próprio estilo (rounded-lg, bg-card, padding maior) e destoava
              dos outros campos da linha. */}
          <MultiSearchCombobox
            variant="plano"
            className={campo}
            opcoes={terapiasAgenda.map(t => ({ id: t, nome: t }))}
            selecionados={new Set(item.especialidadesBancoHoras)}
            onToggle={toggleEspecialidadeBancoHoras}
            placeholder="Qual(is) terapia(s) este contrato cobre?"
            nomePlural="terapias"
            resumoCompleto
            ariaLabel={`Terapias cobertas pelo ${ref}`}
          />
        </div>
      ) : mostrarFuncao && (
        <select
          value={item.funcao}
          onChange={e => onPatch({ funcao: e.target.value })}
          aria-label={`Terapia coberta pelo ${ref}`}
          className={`${campo} min-w-40 flex-2 ${item.funcao ? "" : "text-muted-foreground"}`}
        >
          <option value="" className="bg-card text-muted-foreground">
            Qual terapia este contrato cobre?
          </option>
          {item.funcao && !terapiasAgenda.includes(item.funcao) && (
            <option value={item.funcao} className="bg-card text-foreground">
              {item.funcao} (fora da agenda atual)
            </option>
          )}
          {terapiasAgenda.map(t => (
            <option key={t} value={t} className="bg-card text-foreground">
              {t}
            </option>
          ))}
        </select>
      )}

      <select
        value={item.modeloFaturamento}
        onChange={e => onPatch({ modeloFaturamento: e.target.value as ContratoItemEdit["modeloFaturamento"] })}
        aria-label={`Modelo de faturamento do ${ref}`}
        className={`${campo} w-38 shrink-0`}
      >
        <option value="atendimento" className="bg-card text-foreground">
          Por atendimento
        </option>
        <option value="banco_horas" className="bg-card text-foreground">
          Banco de horas
        </option>
      </select>

      <CampoValor
        item={item}
        descricao={
          item.modeloFaturamento === "banco_horas"
            ? `Valor total do ${ref}`
            : `Valor por sessão do ${ref}`
        }
        onChange={texto =>
          onPatch(item.modeloFaturamento === "banco_horas" ? { valorTotalTexto: texto } : { valorPATexto: texto })
        }
      />

      <CampoValorPep
        texto={item.valorPepMensalTexto}
        descricao={`Valor mensal da PEP (V) do ${ref} — só para Analista do Comportamento`}
        onChange={texto => onPatch({ valorPepMensalTexto: texto })}
      />

      <SeloEstado vigente={item.vigente} />

      {/* A saída da linha, rotulada por extenso — o × de 14px não dizia o que
          fazia, e o que ele fazia era apagar.

          CONTRATO JÁ GRAVADO: cancelar NÃO apaga a linha. Desliga o contrato,
          que continua na lista como histórico para o administrativo consultar
          — um contrato encerrado é registro, não lixo, e apagar destruía a
          única prova de sob que valor o profissional foi pago no passado.
          Reversível pelo mesmo botão.

          LINHA AINDA NÃO GRAVADA: aí a saída remove mesmo. Não há histórico a
          preservar de algo que nunca existiu, e transformá-la em "histórico"
          deixaria uma linha fantasma que ninguém pediu. */}
      {persistido ? (
        <button
          type="button"
          onClick={() => onPatch({ vigente: !item.vigente })}
          title={
            item.vigente
              ? "Desliga o contrato. A linha continua registrada como histórico."
              : "Volta a valer. A calculadora passa a usar este contrato."
          }
          className={`${acaoLinha} ${
            item.vigente
              ? "hover:border-rose-600 hover:text-rose-700"
              : "hover:border-emerald-600 hover:text-emerald-700"
          }`}
        >
          {item.vigente ? "Cancelar contrato" : "Reativar contrato"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Descartar o ${ref}, ainda não gravado`}
          title="Descarta esta linha, que ainda não foi gravada."
          className={`${acaoLinha} hover:bg-muted hover:text-foreground`}
        >
          Descartar
        </button>
      )}
    </div>

      {item.modeloFaturamento === "atendimento" && (
        <ValoresPorTerapia
          itens={item.valoresPorTerapia}
          terapiasAgenda={terapiasAgenda}
          refContrato={ref}
          onChange={valoresPorTerapia => onPatch({ valoresPorTerapia })}
        />
      )}
    </div>
  )
}

// ─── Valor diferente por terapia ─────────────────────────────────────────────
// Um contrato, valores separados por terapia: o valor da linha acima vale para
// tudo, e cada exceção aqui troca o valor por sessão de UMA terapia (ex.: R$ 30
// geral, Avaliação Neuropsicopedagógica a R$ 45). Alternativa a cadastrar um
// segundo contrato vigente — que não é o caso real e acenderia o aviso de
// "2 contratos vigentes". Opções vêm da agenda real do profissional, como o
// select de função; uma terapia já usada não aparece de novo.

function ValoresPorTerapia({
  itens,
  terapiasAgenda,
  refContrato,
  onChange,
}: {
  itens: ValorPorTerapiaEdit[]
  terapiasAgenda: string[]
  refContrato: string
  onChange: (itens: ValorPorTerapiaEdit[]) => void
}) {
  const patch = (idx: number, p: Partial<ValorPorTerapiaEdit>) =>
    onChange(itens.map((v, i) => (i === idx ? { ...v, ...p } : v)))
  const usadas = new Set(itens.map(v => v.terapia).filter(Boolean))
  const sobra = terapiasAgenda.filter(t => !usadas.has(t))

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      {itens.map((v, idx) => {
        const ref = `valor da terapia ${idx + 1} do ${refContrato}`
        return (
          <div key={idx} className="flex flex-wrap items-center gap-2 pl-4">
            <span className="text-xs font-semibold text-muted-foreground">exceto</span>
            <select
              value={v.terapia}
              onChange={e => patch(idx, { terapia: e.target.value })}
              aria-label={`Terapia do ${ref}`}
              className={`${campo} min-w-48 flex-1 ${v.terapia ? "" : "text-muted-foreground"}`}
            >
              <option value="" className="bg-card text-muted-foreground">
                Qual terapia tem outro valor?
              </option>
              {v.terapia && !terapiasAgenda.includes(v.terapia) && (
                <option value={v.terapia} className="bg-card text-foreground">
                  {v.terapia} (fora da agenda atual)
                </option>
              )}
              {terapiasAgenda
                .filter(t => t === v.terapia || !usadas.has(t))
                .map(t => (
                  <option key={t} value={t} className="bg-card text-foreground">
                    {t}
                  </option>
                ))}
            </select>
            <div className="inline-flex w-38 shrink-0 items-center rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring">
              <span className="select-none pl-2 text-xs text-muted-foreground">R$</span>
              <input
                value={v.valorPATexto}
                onChange={e => patch(idx, { valorPATexto: maskMoedaBR(e.target.value) })}
                placeholder="0,00"
                inputMode="numeric"
                aria-label={`Valor por sessão do ${ref}`}
                className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-right text-sm tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              <span className="w-13 shrink-0 select-none pr-2 text-xs text-muted-foreground">/sessão</span>
            </div>
            <button
              type="button"
              onClick={() => onChange(itens.filter((_, i) => i !== idx))}
              aria-label={`Remover o ${ref}`}
              title="Remove esta exceção — a terapia volta a pagar o valor do contrato."
              className={`${foco} inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground`}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )
      })}
      {(itens.length === 0 || sobra.length > 0) && (
        <button
          type="button"
          onClick={() => onChange([...itens, { terapia: sobra.length === 1 ? sobra[0] : "", valorPATexto: "" }])}
          className={`${foco} inline-flex w-fit items-center gap-1 rounded-md py-0.5 pl-4 pr-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground`}
        >
          <Plus size={12} aria-hidden="true" />
          Valor diferente para uma terapia
        </button>
      )}
    </div>
  )
}

// ─── Estado de salvamento do grupo ───────────────────────────────────────────
// Fica ao lado do nome, não a ~900px de distância na última coluna. O erro é
// texto no fluxo, não um `title=` só alcançável por mouse.

function ChipStatus({ status }: { status: SaveStatus }) {
  if (status === "dirty") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
        não salvo
      </span>
    )
  }
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-400">
        <Loader2 size={11} className="animate-spin" /> salvando
      </span>
    )
  }
  if (status === "saved") {
    return (
      <span className="inline-flex animate-in items-center gap-1 fade-in text-xs font-semibold text-emerald-700 duration-200 dark:text-emerald-400">
        <Check size={11} /> salvo
      </span>
    )
  }
  return null
}

// ─── Grupo do profissional ───────────────────────────────────────────────────
// A tela antiga repetia nome, CPF, CNPJ e observações em cada linha de contrato
// — campos ligados ao MESMO rascunho, mas com aparência de campos independentes,
// e sem nenhuma marca separando "outro contrato da Ana" de "primeiro contrato do
// Bruno". Aqui a identidade aparece uma vez, no cabeçalho, e os contratos ficam
// aninhados sob ela.

const GrupoProfissional = memo(function GrupoProfissional({
  linha,
  table,
  destaque,
  terapiasAgenda,
}: {
  linha: LinhaBase
  table: DraftTable
  destaque?: boolean
  /** Terapias reais da agenda TiTa (ver useTerapiasAgendaPorProfissional) — só leitura. */
  terapiasAgenda?: string[]
}) {
  const [saveError, setSaveError] = useState<string | null>(null)
  const tituloId = useId()

  const save = useCallback(
    async (v: LinhaValor) => {
      if (v.documento.trim() && !validarCpfCnpj(v.documento)) {
        setSaveError("Documento incompleto — precisa de 11 dígitos (CPF) ou 14 (CNPJ), ou deixe o campo em branco.")
        return false
      }

      // Um só campo na tela, mas o banco ainda guarda cpf/cnpj em colunas
      // separadas — splitDocumento decide a coluna pela contagem de dígitos
      // e sempre zera a outra, pra nunca sobrar as duas preenchidas.
      const documento = splitDocumento(v.documento)
      const { ok, error } = await upsertContrato({
        profissional_nome: linha.profissionalNome,
        documento_tipo: v.documentoTipo.trim() || null,
        ...documento,
        // Razão Social só existe pra CNPJ. Sem isso, trocar de CNPJ pra CPF
        // escondia o campo da tela (input só aparece com 14 dígitos) mas
        // deixava o valor antigo intacto no banco — o próximo "Salvar tudo"
        // regravava o mesmo texto por trás, e o documento voltava a exibir
        // como PJ (ver montarInfoDocumentoPrestador: razaoSocial sozinha já
        // basta pra `temPJ` virar true, mesmo sem CNPJ nenhum).
        razao_social: documento.cnpj ? (v.razaoSocial.trim() || null) : null,
        // `observacoes` NÃO vai no payload do pai, de propósito. A observação
        // agora é por contrato (em contratos[].observacoes): a migration
        // 20260803120000 copiou o valor para o item e deixou a coluna do pai
        // congelada como backup, igual ao blob `contratos` de 20260724160000.
        // Omitir a chave PRESERVA o valor lá — o PostgREST monta o SET do
        // ON CONFLICT DO UPDATE só com as chaves que vêm no payload. Não mandar
        // '' nem null, que sobrescreveriam o backup.
        contratos: v.contratos
          .filter(it => !itemEmBranco(it))
          .map(it => ({
            numero: it.numero.trim(),
            funcao: it.funcao.trim(),
            valorPA: parseNumeroBR(it.valorPATexto) ?? 0,
            vigente: it.vigente,
            modeloFaturamento: it.modeloFaturamento,
            valorTotal: parseNumeroBR(it.valorTotalTexto) ?? 0,
            observacoes: it.observacoes.trim(),
            valorPepMensal: it.valorPepMensalTexto.trim() ? parseNumeroBR(it.valorPepMensalTexto) : null,
            especialidadesBancoHoras: it.especialidadesBancoHoras.length ? it.especialidadesBancoHoras : null,
            // Exceção sem terapia escolhida não diz nada — não vai para o banco.
            // Banco de horas não paga por sessão, então também não leva exceção.
            valoresPorTerapia: it.modeloFaturamento === "atendimento"
              ? it.valoresPorTerapia
                  .filter(v => v.terapia)
                  .map(v => ({ terapia: v.terapia, valorPA: parseNumeroBR(v.valorPATexto) ?? 0 }))
              : [],
          })),
      })
      setSaveError(error)
      return ok
    },
    [linha.profissionalNome],
  )

  const initial = useMemo<LinhaValor>(
    () => ({
      // Se um profissional antigo ainda tem as duas colunas preenchidas, o
      // CNPJ prevalece na tela (mesmo critério da limpeza feita no banco).
      documento: maskCpfCnpj(linha.cnpj || linha.cpf || ""),
      razaoSocial: linha.razaoSocial ?? "",
      documentoTipo: linha.documentoTipo ?? "",
      contratos: linha.contratosAtuais.map(it => ({
        numero: it.numero ?? "",
        funcao: it.funcao ?? "",
        valorPATexto: formatMoedaBRTexto(it.valorPA),
        vigente: it.vigente ?? true,
        modeloFaturamento: it.modeloFaturamento === "banco_horas" ? "banco_horas" : "atendimento",
        valorTotalTexto: formatMoedaBRTexto(it.valorTotal),
        observacoes: it.observacoes ?? "",
        valorPepMensalTexto: it.valorPepMensal != null ? formatMoedaBRTexto(it.valorPepMensal) : "",
        // Contrato salvo antes deste checkbox existir só tem `funcao` (uma
        // string): reabre o checkbox já marcado nela, em vez de nascer vazio.
        especialidadesBancoHoras: it.especialidadesBancoHoras?.length ? it.especialidadesBancoHoras : (it.funcao ? [it.funcao] : []),
        valoresPorTerapia: (it.valoresPorTerapia ?? []).map(v => ({
          terapia: v.terapia,
          valorPATexto: formatMoedaBRTexto(v.valorPA),
        })),
      })),
    }),
    [linha.cpf, linha.cnpj, linha.razaoSocial, linha.documentoTipo, linha.contratosAtuais],
  )

  const { value, update, status } = useDraftRow(linha.profissionalNome, initial, save, table)

  const updateContrato = (idx: number, patch: Partial<ContratoItemEdit>) =>
    update({ contratos: value.contratos.map((c, i) => (i === idx ? { ...c, ...patch } : c)) })

  const addContrato = () =>
    update({
      contratos: [
        ...value.contratos,
        {
          numero: "",
          funcao: "",
          valorPATexto: "",
          vigente: true,
          modeloFaturamento: "atendimento",
          valorTotalTexto: "",
          observacoes: "",
          valorPepMensalTexto: "",
          especialidadesBancoHoras: [],
          valoresPorTerapia: [],
        },
      ],
    })

  const removeContrato = (idx: number) =>
    update({ contratos: value.contratos.filter((_, i) => i !== idx) })

  // Índice do contrato cujo modal de observação está aberto. Montagem
  // condicional (sem prop `open`) para o modal nascer limpo a cada abertura sem
  // efeito de reset — `react-hooks/set-state-in-effect` é erro neste projeto.
  const [obsAberta, setObsAberta] = useState<number | null>(null)

  const semDocumento = !value.documento.trim()
  const vigentes = value.contratos.filter(c => c.vigente)
  const sujo = status === "dirty" || status === "error"

  return (
    // O contorno do bloco NÃO usa mais --border: essa é a borda dos campos, e
    // desenhar o cartão com o mesmo traço dos campos que ele contém fazia o
    // cartão se ler como mais um campo. --bloco-borda (1,50:1 sobre o branco)
    // fica um degrau acima do campo (1,26:1) — é o que dá hierarquia de
    // enclausuramento. A sombra é o segundo reforço, já que --card e
    // --background são o mesmo branco e o cartão não tinha de onde emergir.
    <section
      id={idDoBloco(linha.profissionalNome)}
      aria-labelledby={tituloId}
      className={`scroll-mt-4 overflow-hidden rounded-xl border bg-card shadow-sm transition-colors ${
        sujo ? "border-amber-500" : "border-(--bloco-borda)"
      } ${destaque ? "ring-2 ring-emerald-600 ring-offset-2 ring-offset-background" : ""}`}
    >
      {/* CABEÇALHO — identidade do profissional, uma vez só.
          ASSINATURA: o bloco fica em silêncio quando está correto e diz
          exatamente o que falta quando não está. Os chips ao lado do nome são
          o único lugar de "atenção" da tela, então dá para varrer a coluna da
          esquerda e achar o que precisa de trabalho sem ler valor nenhum.
          Um deles — "sem contrato vigente" — é um buraco operacional que a
          tela antiga não mostrava em lugar algum. */}
      {/* A faixa é a correção principal do "não consigo distinguir os cards":
          num empilhamento de blocos brancos sobre papel branco, o único
          separador era uma linha de 1,26:1 — o mesmo traço dos campos. Com a
          faixa tingida, cada bloco ganha um topo visível e a lista passa a ter
          ritmo: dá para contar profissionais com o canto do olho, sem ler. E o
          nome deixa de disputar atenção com três inputs na mesma linha, porque
          agora mora numa zona própria. */}
      {/* Três zonas, sem aninhamento: nome absorve a folga, avisos e documentos
          têm largura natural e ficam ancorados à direita. Observações saiu da
          tela (o valor continua viajando no rascunho, ver `initial`/`save`), e
          com ela saiu o único campo elástico daqui — as duas colunas restantes
          passam a fechar na mesma borda em todo bloco, sem depender do que
          alguém digitou na nota. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--bloco-cap-borda) bg-(--bloco-cap) px-3 py-2.5">
        {/* `truncate` e não wrap: nome que quebra em duas linhas muda a altura
            do bloco e destrói o ritmo da lista. Com Observações fora, a coluna
            ficou bem mais larga; o `title` cobre o caso extremo. */}
        {/* Nome e faixa são O PAR DO ITEM ATIVO DO MENU, token a token: fundo
            --sidebar-accent (#DBEAFE, via --bloco-cap) e texto
            --sidebar-accent-foreground (#1D4ED8). Não é "um azul parecido" —
            são as mesmas variáveis que a Sidebar consome, então o cabeçalho do
            bloco e o rótulo ativo da navegação não têm como divergir.
            O nome saiu de --foreground (quase-preto neutro, oklch .145 sem
            croma) e a faixa saiu do matiz de marca 217; os detalhes da virada
            de matiz e o teto de gamut do azul claro estão na nota de
            --bloco-cap em globals.css. Contraste do nome sobre a faixa: 5,49:1.
            O azul de TEXTO (accent-foreground) e não --sidebar-primary
            (#2563EB, borda/ícone do item ativo) — este é mais escuro e sobra
            contraste.
            RESSALVA de significado: em toda a tela o matiz carrega estado
            (âmbar = não-salvo, rose = falta, emerald = destaque) e este azul
            NÃO carrega nenhum — é identidade, aparece igual em todo bloco. Se
            um dia algo azul precisar significar estado aqui, vai colidir.
            No tema escuro o par perde o azul e vira quase-branco sobre faixa
            escura (14,96:1), porque no escuro os próprios tokens do sidebar
            são neutros — o menu escuro também não tem acento azul, então os
            dois seguem combinando. */}
        <div className="min-w-48 flex-1">
          <h2
            id={tituloId}
            title={linha.profissionalNome}
            className="truncate text-md font-bold leading-tight tracking-tight text-sidebar-accent-foreground"
          >
            {linha.profissionalNome}
          </h2>
          {/* Terapias reais da agenda TiTa (1ª semana completa do mês
              subsequente, mesma janela de Saída de Profissional) — só leitura,
              pra conferir contra o que foi cadastrado, sem depender de um
              dropdown que o operador tinha que adivinhar. */}
          {terapiasAgenda && terapiasAgenda.length > 0 && (
            <p
              title={terapiasAgenda.join(", ")}
              className="truncate text-[11px] text-muted-foreground"
            >
              <span className="font-semibold">Terapias na Agenda:</span> {terapiasAgenda.join(", ")}
            </p>
          )}
        </div>

        {/* Avisos numa coluna própria, não colados no nome. Cada nome tem um
            comprimento, então chip colada nele começava num x diferente a cada
            bloco e a coluna saía serrilhada — o oposto do que um aviso precisa,
            que é uma borda constante para o olho descer varrendo. Sendo
            `shrink-0` entre o nome elástico e os documentos fixos, a borda
            direita cai no mesmo x em todos os blocos. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <ChipStatus status={status} />
          {semDocumento && <ChipFalta>sem documento</ChipFalta>}
          {/* Nada de resumo quando há exatamente 1 vigente com valor: seria
              duplicata literal da linha logo abaixo. Os três casos abaixo são
              `grave` porque todos terminam em pagamento errado e silencioso. */}
          {vigentes.length === 0 ? (
            <ChipFalta grave>sem contrato vigente</ChipFalta>
          ) : vigentes.length > 1 ? (
            <ChipFalta grave>{vigentes.length} contratos vigentes</ChipFalta>
          ) : semValor(vigentes[0]) ? (
            <ChipFalta grave>valor zerado</ChipFalta>
          ) : excecaoSemValor(vigentes[0]) ? (
            <ChipFalta grave>valor por terapia zerado</ChipFalta>
          ) : null}
        </div>

        {/* Um só campo: o operador digita os dígitos corridos e a máscara
            decide CPF ou CNPJ pela contagem (maskCpfCnpj/splitDocumento). w-38
            é a largura do CNPJ completo ("00.000.000/0000-00", o mais longo
            dos dois formatos), pela mesma lógica de "largura pela máscara,
            não arredondada" — encosta a caixa no texto em vez de sobrar vazio. */}
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={value.documento}
            onChange={e => update({ documento: maskCpfCnpj(e.target.value) })}
            placeholder="CPF ou CNPJ"
            inputMode="numeric"
            aria-label={`CPF ou CNPJ de ${linha.profissionalNome}`}
            className={`${campoNaFaixa} w-38 tabular-nums`}
          />
          {/* Só aparece com CNPJ (14 dígitos): Razão Social não existe pra CPF,
              e mostrar o campo vazio pra todo mundo poluiria a faixa inteira à
              toa pros profissionais PF, que são a maioria. */}
          {onlyDigits(value.documento).length === 14 && (
            <input
              value={value.razaoSocial}
              onChange={e => update({ razaoSocial: e.target.value })}
              placeholder="Razão Social"
              aria-label={`Razão Social de ${linha.profissionalNome}`}
              className={`${campoNaFaixa} w-44`}
            />
          )}
        </div>
      </div>

      {saveError && (
        <p className="mx-3 mb-2 flex items-start gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <AlertCircle size={12} className="mt-px shrink-0" />
          {saveError}
        </p>
      )}

      {/* CONTRATOS — aninhados sob a identidade. Sem border-t próprio: a
          divisória agora é o border-b da faixa, e as duas juntas desenhavam
          linha dupla. */}
      <div className="px-2 py-1.5">
        {value.contratos.map((c, idx) => (
          <LinhaContrato
            key={idx}
            item={c}
            nome={linha.profissionalNome}
            posicao={idx + 1}
            // As linhas vindas do banco ocupam os primeiros índices (a ordem
            // vem de `initial`), então tudo daqui para frente foi adicionado
            // neste rascunho e ainda não existe lá.
            persistido={idx < linha.contratosAtuais.length}
            // Só importa quantos estão VIGENTES: resolverPARow só precisa
            // desambiguar entre contratos que a calculadora usa hoje. Um
            // histórico (vigente=false) ao lado de um vigente único não é
            // "múltiplo contrato" pra fins de pagamento — é só 1 valendo.
            // Banco de horas é exceção mesmo com 1 único contrato: ali a
            // função não desambigua PA (não há PA por sessão), ela é a própria
            // especialidade usada para agrupar o valor fixo no dashboard de
            // Rem. Mês (dashboardRP.ts) — sem ela o valor cai em "Sem
            // especialidade" mesmo o profissional tendo especialidade.
            mostrarFuncao={value.contratos.filter(c => c.vigente).length > 1 || c.modeloFaturamento === "banco_horas"}
            terapiasAgenda={terapiasAgenda || []}
            onPatch={patch => updateContrato(idx, patch)}
            onRemove={() => removeContrato(idx)}
            onAbrirObs={() => setObsAberta(idx)}
          />
        ))}

        {/* O vazio nomeia a ausência e oferece o remédio na mesma linha —
            antes o "Nenhum contrato ainda" ficava 8 colunas longe do botão. */}
        <div className="flex flex-wrap items-center gap-2 px-1 py-1">
          {value.contratos.length === 0 && (
            <span className="text-sm text-muted-foreground">Nenhum contrato cadastrado.</span>
          )}
          <button
            type="button"
            onClick={addContrato}
            // Neutro, não emerald: com 50 blocos na página havia 50 links
            // verdes dizendo "adicionar", e isso é um TERCEIRO significado para
            // um matiz que já dizia "vigente" e "salvar". Agora emerald sobrou
            // só para o estado do contrato e para salvar — que é justamente o
            // que o usuário precisa achar de relance.
            className={`${foco} inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground`}
          >
            <Plus size={13} />
            {value.contratos.length === 0 ? "Adicionar o primeiro" : "Adicionar contrato"}
          </button>
        </div>
      </div>

      {/* O guard `value.contratos[obsAberta]` é defesa contra índice que deixou
          de existir (o item foi descartado enquanto o modal estava aberto). */}
      {obsAberta !== null && value.contratos[obsAberta] && (
        <ObservacaoContratoModal
          numero={value.contratos[obsAberta].numero.trim()}
          referencia={`contrato ${obsAberta + 1} de ${linha.profissionalNome}`}
          valor={value.contratos[obsAberta].observacoes}
          onChange={texto => updateContrato(obsAberta, { observacoes: texto })}
          onClose={() => {
            const id = idBotaoObs(linha.profissionalNome, obsAberta)
            setObsAberta(null)
            // Devolve o foco ao botão que abriu — depois do render que desmonta
            // o modal, senão o elemento ainda não recuperou a focabilidade.
            requestAnimationFrame(() => document.getElementById(id)?.focus())
          }}
        />
      )}
    </section>
  )
})

// ─── Tela ────────────────────────────────────────────────────────────────────

const POR_PAGINA = 50

// Roster ∪ contratos, em ordem alfabética. Fora do componente porque também é
// usada logo após criar um profissional, para descobrir em que página o nome
// novo caiu antes do próximo render.
function montarLinhas(contratos: ContratoAtual[], roster: string[]): LinhaBase[] {
  const porNome = new Map(contratos.map(c => [c.profissional_nome, c]))
  const nomes = new Set<string>([...roster, ...contratos.map(c => c.profissional_nome)])
  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")).map(nome => {
    const c = porNome.get(nome)
    return {
      profissionalNome: nome,
      cpf: c?.cpf ?? null,
      cnpj: c?.cnpj ?? null,
      razaoSocial: c?.razao_social ?? null,
      documentoTipo: c?.documento_tipo ?? null,
      // `c.observacoes` (nível do profissional) não é mais lido: virou backup
      // congelado na migration 20260803120000. A nota vive em cada item.
      contratosAtuais: Array.isArray(c?.contratos) ? c!.contratos : [],
    }
  })
}

// Janela de números com elipses. Gêmea da de TabelaAuditoria (auditoria-assim),
// mantida local porque lá ela não é exportada e não vale mexer numa página que
// não está sendo revisada só para compartilhar 10 linhas de aritmética.
function numerosDePagina(atual: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const range: (number | "…")[] = []
  for (let i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) range.push(i)
  if (atual - 1 > 2) range.unshift("…")
  if (atual + 1 < total - 1) range.push("…")
  range.unshift(1)
  if (range[range.length - 1] !== total) range.push(total)
  return range
}

function Paginacao({
  pagina,
  totalPaginas,
  onChange,
}: {
  pagina: number
  totalPaginas: number
  onChange: (p: number) => void
}) {
  const botao = `${foco} inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-xs font-bold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30`
  return (
    <nav aria-label="Paginação da lista de profissionais" className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(pagina - 1)}
        disabled={pagina === 1}
        aria-label="Página anterior"
        className={`${botao} border-border text-foreground hover:bg-muted`}
      >
        <ChevronLeft size={13} />
      </button>

      {numerosDePagina(pagina, totalPaginas).map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} aria-hidden="true" className="px-0.5 text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-label={`Página ${p}`}
            aria-current={p === pagina ? "page" : undefined}
            className={`${botao} ${
              p === pagina
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground hover:bg-muted"
            }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onChange(pagina + 1)}
        disabled={pagina === totalPaginas}
        aria-label="Próxima página"
        className={`${botao} border-border text-foreground hover:bg-muted`}
      >
        <ChevronRight size={13} />
      </button>
    </nav>
  )
}

const CHIP_BASE = `${foco} inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors`

function ChipFiltro({
  ativo,
  onClick,
  children,
  contagem,
}: {
  ativo: boolean
  onClick: () => void
  children: React.ReactNode
  contagem: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={`${CHIP_BASE} ${
        ativo
          ? "border-foreground bg-foreground text-background"
          : "border-border text-foreground hover:bg-muted"
      }`}
    >
      {children}
      <span
        className={`rounded-full px-1.5 tabular-nums ${
          ativo ? "bg-background/20" : "bg-muted text-muted-foreground"
        }`}
      >
        {contagem}
      </span>
    </button>
  )
}

// ─── Filtro de terapias (multi-seleção) ──────────────────────────────────────
// Popover com checkboxes, não <select multiple> (péssimo em touch e exige
// Ctrl+clique no desktop). Portal em document.body pelo mesmo motivo do
// InfoTooltip de CardRemun.tsx: a toolbar não tem overflow-hidden aqui, mas
// mesmo assim o painel pode ultrapassar a viewport se posicionado inline.
const POPOVER_TERAPIAS_W = 260

function FiltroTerapias({
  opcoes,
  selecionadas,
  onChange,
}: {
  opcoes: string[]
  selecionadas: Set<string>
  onChange: (novo: Set<string>) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  function alternarAberto() {
    if (!aberto && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - POPOVER_TERAPIAS_W - 16) })
    }
    setAberto(v => !v)
  }

  function alternarTerapia(t: string) {
    const novo = new Set(selecionadas)
    if (novo.has(t)) novo.delete(t)
    else novo.add(t)
    onChange(novo)
  }

  if (opcoes.length === 0) return null

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={alternarAberto}
        aria-pressed={selecionadas.size > 0}
        aria-expanded={aberto}
        className={`${CHIP_BASE} ${
          selecionadas.size > 0
            ? "border-foreground bg-foreground text-background"
            : "border-border text-foreground hover:bg-muted"
        }`}
      >
        <ListFilter size={12} />
        Terapia
        {selecionadas.size > 0 && (
          <span
            className={`rounded-full px-1.5 tabular-nums ${
              selecionadas.size > 0 ? "bg-background/20" : "bg-muted text-muted-foreground"
            }`}
          >
            {selecionadas.size}
          </span>
        )}
      </button>
      {aberto && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div
            role="listbox"
            aria-multiselectable="true"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: POPOVER_TERAPIAS_W }}
            className="z-50 max-h-80 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-lg"
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Terapia na agenda
              </span>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X size={13} />
              </button>
            </div>
            {selecionadas.size > 0 && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="mb-1 w-full rounded-md px-1.5 py-1 text-left text-xs font-semibold text-foreground hover:bg-muted"
              >
                Limpar seleção
              </button>
            )}
            {opcoes.map(t => (
              <label
                key={t}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-foreground hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selecionadas.has(t)}
                  onChange={() => alternarTerapia(t)}
                  className="rounded border-border"
                />
                {t}
              </label>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

export function ContratosCadastro() {
  const [contratos, setContratos] = useState<ContratoAtual[]>([])
  const [roster, setRoster] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState("")
  const [semDocumento, setSemDocumento] = useState(false)
  const [semVigente, setSemVigente] = useState(false)
  const [terapiasFiltro, setTerapiasFiltro] = useState<Set<string>>(new Set())
  const [pagina, setPagina] = useState(1)
  const { table, dirtyCount, saving, saveAll } = useDraftTable()
  const { terapiasPorProfissional } = useTerapiasAgendaPorProfissional()

  // Devolve o que carregou: quem cria um profissional precisa saber em que
  // página o nome novo caiu, e `linhas` só reflete isso no render seguinte.
  const carregar = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const [{ data: contratosData }, { data: rosterData }] = await Promise.all([
      getContratos(),
      getProfissionaisRoster(),
    ])
    const c = (contratosData as ContratoAtual[] | null) ?? []
    const r = rosterData ?? []
    if (contratosData) setContratos(c)
    if (rosterData) setRoster(r)
    if (showLoading) setLoading(false)
    return { contratos: c, roster: r }
  }, [])

  const handleSalvarTudo = useCallback(async () => {
    const { total, ok } = await saveAll()
    if (!total) return true
    const sucesso = ok === total
    if (sucesso) {
      toast.success(`${ok} ${ok === 1 ? "alteração salva" : "alterações salvas"}.`)
      // Recarrega a lista-fonte (sem flash de loading) para que contadores e
      // filtros reflitam os documentos recém-salvos.
      await carregar(false)
    } else {
      toast.error(`${ok} de ${total} salvas. Os blocos que falharam mostram o motivo abaixo do nome.`)
    }
    return sucesso
  }, [saveAll, carregar])

  const { registerGuard } = useUnsavedChangesGuard()
  useEffect(() => {
    registerGuard({ isDirty: dirtyCount > 0, save: handleSalvarTudo })
    return () => registerGuard(null)
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial via API, sem valor derivável no primeiro render
    carregar()
  }, [carregar])

  const linhas = useMemo(() => montarLinhas(contratos, roster), [roster, contratos])

  const semDocumentoQtd = useMemo(() => linhas.filter(l => !l.cpf && !l.cnpj).length, [linhas])
  const semVigenteQtd = useMemo(
    () => linhas.filter(l => !l.contratosAtuais.some(c => c.vigente)).length,
    [linhas],
  )

  // Opções do filtro de terapias: união de tudo que a agenda TiTa trouxe,
  // não um vocabulário fixo — se a agenda não tem uma terapia, ela não
  // aparece como opção (nada a filtrar por ela).
  const todasTerapias = useMemo(() => {
    const set = new Set<string>()
    Object.values(terapiasPorProfissional).forEach(ts => ts.forEach(t => set.add(t)))
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"))
  }, [terapiasPorProfissional])

  const filtradas = useMemo(() => {
    let r = linhas
    const q = busca.trim().toLowerCase()
    if (q) r = r.filter(l => l.profissionalNome.toLowerCase().includes(q))
    if (semDocumento) r = r.filter(l => !l.cpf && !l.cnpj)
    if (semVigente) r = r.filter(l => !l.contratosAtuais.some(c => c.vigente))
    if (terapiasFiltro.size > 0) {
      r = r.filter(l => {
        const ts = terapiasPorProfissional[normKey(l.profissionalNome)] || []
        return ts.some(t => terapiasFiltro.has(t))
      })
    }
    return r
  }, [linhas, busca, semDocumento, semVigente, terapiasFiltro, terapiasPorProfissional])

  // Página derivada e travada no total: se a lista encolher (preencher os
  // documentos com o filtro "sem documento" ligado faz isso ao salvar), a
  // renderização cai na última página existente sem precisar de efeito.
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const visiveis = useMemo(
    () => filtradas.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA),
    [filtradas, paginaAtual],
  )

  // Trocar de página desmonta os blocos, e useDraftRow não salva ao desmontar
  // (salvamento explícito, D.4) — sem esta guarda a troca descartaria o
  // rascunho em silêncio, e ainda apagaria o aviso de "não salvo" junto.
  const [paginaPendente, setPaginaPendente] = useState<number | null>(null)
  const [salvandoParaTrocar, setSalvandoParaTrocar] = useState(false)

  const irParaPagina = useCallback(
    (p: number) => {
      if (dirtyCount > 0) setPaginaPendente(p)
      else setPagina(p)
    },
    [dirtyCount],
  )

  const salvarETrocar = useCallback(async () => {
    if (paginaPendente === null) return
    setSalvandoParaTrocar(true)
    const ok = await handleSalvarTudo()
    setSalvandoParaTrocar(false)
    if (ok) {
      setPagina(paginaPendente)
      setPaginaPendente(null)
    }
    // Falhou: o modal fica aberto e os blocos com erro mostram o motivo.
  }, [paginaPendente, handleSalvarTudo])

  // ── Novo profissional ────────────────────────────────────────────────────
  const nomesExistentes = useMemo(() => linhas.map(l => l.profissionalNome), [linhas])
  const [criando, setCriando] = useState(false)
  const [destaque, setDestaque] = useState<string | null>(null)

  const handleCriar = useCallback(
    async (payload: NovoProfissionalPayload) => {
      const r = await upsertContrato(payload)
      if (!r.ok) return r

      setCriando(false)
      toast.success(`${payload.profissional_nome} cadastrado.`)

      // Leva até o bloco criado em vez de deixá-lo perdido em alguma das
      // páginas: limpa os filtros, calcula da lista recém-carregada em que
      // página o nome caiu, e marca para rolar/destacar.
      const { contratos: c, roster: rs } = await carregar(false)
      setBusca("")
      setSemDocumento(false)
      setSemVigente(false)
      const idx = montarLinhas(c, rs).findIndex(l => l.profissionalNome === payload.profissional_nome)
      if (idx >= 0) setPagina(Math.floor(idx / POR_PAGINA) + 1)
      setDestaque(payload.profissional_nome)
      return r
    },
    [carregar],
  )

  useEffect(() => {
    if (!destaque) return
    const el = document.getElementById(idDoBloco(destaque))
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
    const t = setTimeout(() => setDestaque(null), 2600)
    return () => clearTimeout(t)
  }, [destaque, pagina])

  const filtrando = !!busca.trim() || semDocumento || semVigente || terapiasFiltro.size > 0

  // Filtrar remonta a lista inteira, então a página corrente perde sentido.
  const aplicarFiltro = (fn: () => void) => {
    fn()
    setPagina(1)
  }
  const limparFiltros = () =>
    aplicarFiltro(() => {
      setBusca("")
      setSemDocumento(false)
      setSemVigente(false)
      setTerapiasFiltro(new Set())
    })

  return (
    // Sem padding próprio: o <main> do shell já aplica p-6. Antes os dois se
    // somavam em 56px de gutter por lado, saindo direto da largura dos campos.
    <div className="mx-auto flex max-w-6xl animate-in flex-col gap-3 fade-in duration-300">
      {/* TOOLBAR — busca + os dois estados de incompletude que importam.
          O título e a explicação saíram: o shell já renderiza "Contratos" como
          h1, e a regra do "vigente" agora é dita pelo próprio controle e pelo
          resumo "Calculadora usa" de cada bloco. */}
      {/* Contêiner, logo --bloco-borda: a regra da tela agora é "contêiner
          leva a borda forte (1,50:1), campo leva a fraca (1,26:1)". */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-(--bloco-borda) bg-card px-3 py-2.5 shadow-sm">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={e => aplicarFiltro(() => setBusca(e.target.value))}
            placeholder="Buscar profissional…"
            aria-label="Buscar profissional"
            className={`${campoBase} w-full bg-muted/40 pl-8`}
          />
        </div>
        <ChipFiltro
          ativo={semDocumento}
          onClick={() => aplicarFiltro(() => setSemDocumento(v => !v))}
          contagem={semDocumentoQtd}
        >
          Sem documento
        </ChipFiltro>
        <ChipFiltro
          ativo={semVigente}
          onClick={() => aplicarFiltro(() => setSemVigente(v => !v))}
          contagem={semVigenteQtd}
        >
          Sem contrato vigente
        </ChipFiltro>
        <FiltroTerapias
          opcoes={todasTerapias}
          selecionadas={terapiasFiltro}
          onChange={novo => aplicarFiltro(() => setTerapiasFiltro(novo))}
        />
        {filtrando && (
          <button
            type="button"
            onClick={limparFiltros}
            className={`${foco} inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground`}
          >
            <X size={12} />
            Limpar filtros
          </button>
        )}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {filtradas.length} de {linhas.length}
        </span>
        {/* Contorno, não preenchido: o emerald sólido continua exclusivo do
            "Salvar tudo", que é a ação primária da tela.
            Pausado a pedido: cadastro de profissional novo por aqui fica
            temporariamente indisponível (sem apagar o botão), até decisão em
            contrário — ver title. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Cadastro de novo profissional temporariamente pausado"
          className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground opacity-60"
        >
          <UserPlus size={13} />
          Novo profissional
        </button>
      </div>

      {loading ? (
        // Esqueleto com a forma do conteúdo — antes era um spinner num card
        // curto e a lista inteira aparecia de uma vez, deslocando o layout.
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando contratos">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="overflow-hidden rounded-xl border border-(--bloco-borda) bg-card shadow-sm">
              <div className="flex items-center gap-3 border-b border-(--bloco-cap-borda) bg-(--bloco-cap) px-3 py-2.5">
                <div className="h-4 w-56 animate-pulse rounded bg-muted" />
                <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
              </div>
              <div className="px-3 py-3">
                <div className="h-6 w-full animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-xl border border-(--bloco-borda) bg-card p-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Nenhum profissional corresponde aos filtros.</p>
          {filtrando && (
            <button
              type="button"
              onClick={limparFiltros}
              className={`${foco} mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-muted`}
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        // Sem max-h/overflow próprio: o <main> é o único container de scroll.
        // Antes o 70vh criava um segundo scrollbar aninhado.
        // gap-4, não gap-3: o espaço ENTRE blocos era 12px enquanto o espaço
        // DENTRO do cabeçalho era 10px — proximidade quase idêntica, então a
        // Gestalt não tinha como agrupar. Agora separa mais do que agrupa.
        <div className="flex flex-col gap-4">
          {visiveis.map(linha => (
            <GrupoProfissional
              key={linha.profissionalNome}
              linha={linha}
              table={table}
              destaque={destaque === linha.profissionalNome}
              terapiasAgenda={terapiasPorProfissional[normKey(linha.profissionalNome)]}
            />
          ))}
        </div>
      )}

      {/* RODAPÉ FIXO — navegação e ação primária no mesmo lugar, alcançáveis de
          qualquer ponto da lista. Antes o "Salvar tudo" ficava no topo da
          página, fora de alcance ao editar o 40º bloco; e a paginação no fim da
          lista exigiria rolar 50 blocos só para virar a página. */}
      {!loading && (totalPaginas > 1 || dirtyCount > 0) && (
        <div className="sticky bottom-0 z-20">
          <div
            className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-card px-3 py-2 shadow-lg transition-colors ${
              dirtyCount > 0 ? "border-amber-500" : "border-(--bloco-borda)"
            }`}
          >
            {totalPaginas > 1 ? (
              <>
                <Paginacao pagina={paginaAtual} totalPaginas={totalPaginas} onChange={irParaPagina} />
                <span className="text-xs tabular-nums text-muted-foreground">
                  Página {paginaAtual} de {totalPaginas}
                </span>
              </>
            ) : (
              <span />
            )}
            {dirtyCount > 0 && (
              <SalvarTudoBar dirtyCount={dirtyCount} saving={saving} onSave={handleSalvarTudo} />
            )}
          </div>
        </div>
      )}

      {criando && (
        <NovoProfissionalModal
          nomesExistentes={nomesExistentes}
          onCancel={() => setCriando(false)}
          onSubmit={handleCriar}
        />
      )}

      <UnsavedChangesModal
        open={paginaPendente !== null}
        saving={salvandoParaTrocar}
        descricao="Trocar de página descarta o que você editou nos blocos desta página."
        labelSalvar="Salvar e trocar de página"
        labelDescartar="Trocar sem salvar"
        onSaveAndLeave={salvarETrocar}
        onDiscardAndLeave={() => {
          if (paginaPendente !== null) setPagina(paginaPendente)
          setPaginaPendente(null)
        }}
        onCancel={() => setPaginaPendente(null)}
      />
    </div>
  )
}
