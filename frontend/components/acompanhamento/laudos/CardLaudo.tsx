"use client"

import { memo, useEffect, useState, type ReactNode } from "react"
import { CalendarDays, CheckCircle2, Hourglass, MailCheck, AlertTriangle } from "lucide-react"
import { getFotoUrlAssinada } from "@/services/pacientesFoto.service"
import { ICONES, getTomAvatar, indiceIconeAvatar } from "@/lib/cadastros/avatarPastel"
import { isoParaBr } from "@/lib/laudos/acompanhamento"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import type { ItemAcompanhamentoLaudo, SenhasDoLaudo } from "@/types/laudosAcompanhamento"
import { TOM_SENHA, fonteQueCabe, textoStatusSenha, textoStatusSenhaCurto } from "./senhaUi"
import type { SenhaDoRol } from "@/types/laudosAcompanhamento"

// O cartão de laudo. MOLDE do CardPaciente de /cadastros/pacientes: mesma
// moldura (rounded-xl, border-border, bg-card, p-5, shadow-sm), mesmo hover
// (-translate-y-1.5 + shadow-lg, desligado em motion-reduce), avatar de 96px que
// cresce 5% no hover, `<hr>` e `<dl>` de linhas ícone + rótulo + valor.
//
// Três diferenças, todas de propósito:
//
//   • O alvo de clique é um <button>, não um <Link>: aqui o cartão ABRE o
//     registro do aviso, não navega. Se fosse Link, ctrl+clique abriria uma aba
//     que não existe.
//   • Os dados são do LAUDO (Data laudo / Validade / Autorizado em), não do
//     paciente. CPF, nascimento e telefone ficam de fora — pedido explícito.
//   • "Avisado em" é a última linha e é a que a recepção varre: `—` significa
//     pendência em aberto.
//
// A FOTO é a mesma de /cadastros/pacientes, não uma cópia: `fotoPath` é a coluna
// `pacientes.foto_path` e a URL assinada sai do mesmo serviço, contra o mesmo
// bucket privado. Trocar a foto de um lado aparece no outro porque não existem
// dois lugares.

export const CardLaudo = memo(function CardLaudo({
  item,
  onAbrir,
}: {
  item: ItemAcompanhamentoLaudo
  onAbrir: () => void
}) {
  // O tom do avatar segue o ID do PACIENTE quando ele existe, para o mesmo
  // paciente ter a mesma cor aqui e no cadastro. Sem cadastro, cai no ID do
  // laudo — cor estável, só não compartilhada com uma tela onde ele não está.
  const tom = getTomAvatar(item.pacienteId ?? item.idLaudo)

  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        className={`group flex h-full w-full flex-col rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 ease-out hover:-translate-y-1.5 hover:border-foreground/15 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none ${foco}`}
        aria-label={`Registrar aviso do laudo ${item.idLaudo} de ${item.nome}`}
      >
        {/* ── Identificação ──
            DUAS CAIXAS, uma por assunto, cada uma completa em si: o número, a
            que ele se refere, e o estado desse alguém.

              ┌──────────┐ ┌───────────────┐
              │   278    │ │    1234567    │
              │  LAUDO   │ │     SENHA     │
              │ Vencido  │ │ Vigente até … │
              └──────────┘ └───────────────┘

            A caixa da direita era a do PACIENTE (ID PAC + Ativo/Inativo). Deu
            lugar à SENHA da ASSIM — pedido do usuário (28/09/2026): "basta
            aparecer o Status da Senha e o Status do Laudo". A situação do
            paciente continua como filtro, e o ID PAC está no título do detalhe.

            O contorno é o que resolve o problema que três formatos anteriores
            não resolveram: sem ele, seis pedaços de texto flutuavam soltos e a
            leitura dependia de adivinhar qual número ia com qual estado. Agora o
            agrupamento é visual, não posicional — não há como ler errado.

            `grid-cols-2` com as caixas esticadas: as duas têm a mesma largura e a
            mesma altura mesmo quando um texto ("Sem cadastro") ocupa duas
            linhas e o outro ("Vencido") ocupa uma. */}
        {/* 2/5 para o laudo e 3/5 para a senha: o laudo tem pouco texto ("238 /
            LAUDO / Vencido"), a senha precisa de espaço — dois números quando há
            senha fora do ROL, ou o nome do convênio. `min-h` igual nas duas e em
            todos os cartões: as fotos e os nomes ficam na mesma altura de um
            cartão para o outro. */}
        <div className="grid grid-cols-[2fr_3fr] gap-2">
          <CaixaIdent id={item.idLaudo} escopo="laudo" {...estadoDoLaudo(item)} />
          <CaixaSenha senhas={item.senhas} convenio={item.convenio} />
        </div>

        <div className="mt-4 flex flex-col items-center text-center">
          <Avatar item={item} tom={tom} />
          <h2
            className="mt-4 w-full truncate text-base font-bold leading-snug text-foreground"
            title={item.nome}
          >
            {item.nome}
          </h2>
          {/* Quantas especialidades o laudo cobre — o que diz se a renovação
              atrasada trava uma terapia ou onze. O ID do paciente NÃO aparece
              aqui (pedido do usuário, 28/09/2026): está no título do detalhe
              ("PAC 14551, LAUDO 267"), e a busca por ele continua valendo. */}
          {item.especialidades.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {item.especialidades.length}{" "}
              {item.especialidades.length === 1 ? "especialidade" : "especialidades"}
            </p>
          )}
        </div>

        <hr className="my-4 border-border" />

        {/* GRADE de duas colunas, e não três linhas de flex: com flex, cada
            linha calculava a sua própria largura de rótulo e os valores saíam
            desalinhados por alguns pixels. Aqui `COLUNAS` fixa o eixo, e o bloco
            do aviso mais abaixo usa a MESMA constante — é isso que faz as quatro
            datas caírem exatamente uma sob a outra. */}
        <dl className={`${COLUNAS} gap-y-2.5`}>
          <Linha icone={CalendarDays} rotulo="Data laudo" valor={isoParaBr(item.dataLaudo)} />
          <Linha icone={Hourglass} rotulo="Validade" valor={isoParaBr(item.validade)} />
          <Linha icone={CheckCircle2} rotulo="Autorizado" valor={isoParaBr(item.autorizadoEm)} />
        </dl>

        {/* ── O nosso registro ──
            Fora do <dl> acima porque não é dado do Órbita: é a razão da tela
            existir. Mas na MESMA grade (`COLUNAS`), para "Avisado em" cair sob
            "Autorizado" e a data sob as outras datas. O que separa os dois
            blocos é a linha e a cor do valor, não um recuo — o bloco pintado que
            estava aqui antes empurrava o rótulo alguns pixels para dentro e
            jogava a data para a borda direita, desalinhando as quatro.

            `mt-auto pt-4` empurra para o rodapé (alinhando os cartões da linha),
            e o `pt-4` garante o respiro do <dl> mesmo quando o cartão é curto e
            não sobra folga para o `auto` distribuir. */}
        <div className="mt-auto pt-4">
          <dl className={`${COLUNAS} border-t border-border pt-3`}>
            <dt className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
              <MailCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Avisado em
            </dt>
            <dd
              className={`whitespace-nowrap text-sm font-bold tabular-nums ${
                item.mensagemEnviadaEm
                  ? "text-emerald-600 dark:text-emerald-400"
                  : item.situacao === "vencido"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground"
              }`}
            >
              {item.mensagemEnviadaEm
                ? isoParaBr(item.mensagemEnviadaEm)
                : item.situacao === "vencido"
                  ? "Sem aviso"
                  : "—"}
            </dd>

            {/* Quem registrou e quando NÃO aparecem aqui, por decisão do usuário
                (28/08/2026): no cartão o que importa é se já avisou e em que dia.
                O crédito continua em dois lugares onde há espaço para ele — o
                rodapé do modal ("Último registro por …") e o Histórico, que
                guarda todas as alterações, não só a última. */}
          </dl>
        </div>

        {item.situacaoDivergente && (
          <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              O Órbita marca este laudo como {item.situacaoOrbita || "—"}, mas a validade diz o
              contrário.
            </span>
          </p>
        )}
      </button>
    </li>
  )
})

/**
 * A grade de rótulo + valor, compartilhada pelas linhas do laudo e pelo bloco do
 * aviso. É a razão de as quatro datas ficarem no mesmo eixo vertical.
 *
 * As DUAS colunas têm largura fixa, e o `justify-center` centraliza o par no
 * cartão. A coluna de valor era `1fr` e por isso a grade ocupava a largura
 * inteira: o conteúdo ficava encostado à esquerda, desalinhado do avatar e do
 * nome, que são centralizados. Fixando as duas, o bloco vira uma peça de 184px
 * que se centraliza como unidade — e continua com um eixo só, porque os dois
 * blocos usam esta mesma constante.
 *
 * 92px no rótulo: "Avisado em" é o mais longo e precisa de ~62px ao lado do
 * ícone de 14px, sem quebrar. 84px no valor: cabe "02/07/2026" e "Sem aviso" em
 * `text-sm` semibold, que são os mais largos que aparecem ali.
 *
 * `items-baseline` alinha rótulo de 12px com valor de 14px pela linha do texto,
 * não pelo topo da caixa — sem isso a data fica visivelmente mais alta que o
 * rótulo ao lado.
 */
const COLUNAS = "grid grid-cols-[92px_84px] justify-center items-baseline gap-x-2"

/**
 * Uma linha do laudo. `<dt>` e `<dd>` são filhos DIRETOS da grade (por isso o
 * fragmento, e não um `<div>` em volta): embrulhá-los criaria uma grade por
 * linha, cada uma medindo o seu rótulo, e os valores voltariam a desalinhar.
 *
 * `tabular-nums` mantém todas as datas com a mesma largura, para a coluna de
 * valores não dançar entre um cartão e outro.
 */
function Linha({
  icone: Icone,
  rotulo,
  valor,
}: {
  icone: typeof CalendarDays
  rotulo: string
  valor: string
}) {
  return (
    <>
      <dt className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {rotulo}
      </dt>
      <dd className="truncate text-left text-sm font-semibold tabular-nums text-foreground">
        {valor}
      </dd>
    </>
  )
}

/**
 * Uma caixa de identificação: número em cima, o assunto no meio, o estado
 * embaixo.
 *
 * O número vem primeiro porque é o que se procura quando se confere com o
 * Órbita, e o assunto logo abaixo em caixa alta miúda funciona como legenda dele
 * — o padrão de "métrica com rótulo", que se lê de relance sem precisar de
 * pontuação nem de preposição.
 */
function CaixaIdent({
  id,
  escopo,
  estado,
  cor,
  contorno,
}: {
  id: string | number
  escopo: "laudo"
  estado: string
  cor: string
  /** Borda e fundo, tingidos pelo estado. */
  contorno: string
}) {
  return (
    <div
      className={`flex ${ALTURA_CAIXA} flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-center ${contorno}`}
    >
      <p className="truncate text-sm font-bold leading-none tabular-nums text-foreground">{id}</p>
      {/* 11px, e não um tamanho menor: é o menor degrau da tipografia do
          projeto (DESIGN.md §3, "Caption") — abaixo dele sai do ramp
          documentado. `tracking-widest` é o que mantém "LAUDO"/"SENHA"
          legível nessa altura apesar de compartilhar o degrau com o "estado"
          logo abaixo. */}
      <p className="mt-1 text-[11px] font-semibold uppercase leading-none tracking-widest text-muted-foreground">
        {escopo}
      </p>
      <p className={`mt-1.5 text-[11px] font-bold leading-tight ${cor}`}>{estado}</p>
    </div>
  )
}

/**
 * Vigente / Vencido — os dois sinais que a tela existe para destacar.
 * Vencido em vermelho, Vigente em verde — decisão do usuário (28/08/2026). A
 * senha usa a mesma paleta (ver senhaUi.ts).
 */
function estadoDoLaudo(
  item: ItemAcompanhamentoLaudo,
): { estado: string; cor: string; contorno: string } {
  if (item.situacao === "vencido") {
    return {
      estado: "Vencido",
      cor: "text-rose-600 dark:text-rose-400",
      contorno: "border-rose-500/40 bg-rose-500/5",
    }
  }
  if (item.situacao === "vigente") {
    return {
      estado: "Vigente",
      cor: "text-emerald-600 dark:text-emerald-400",
      contorno: "border-emerald-500/40 bg-emerald-500/5",
    }
  }
  return {
    estado: "Sem validade",
    cor: "text-muted-foreground",
    contorno: "border-border bg-muted/20",
  }
}

/**
 * A caixa da SENHA ASSIM, irmã da caixa do laudo: número em cima, o assunto no
 * meio, o estado embaixo.
 *
 * O número é o da senha DENTRO do ROL (decisão do usuário, 28/09/2026: o número
 * aparece no cartão). Quando o laudo também tem senha FORA do ROL — ou precisa
 * de uma e não tem —, uma segunda faixa aparece embaixo, no mesmo formato. O
 * contorno segue o PIOR dos dois lados, para uma senha fora do ROL vencida não
 * se esconder atrás de uma dentro do ROL vigente.
 *
 * "+N" quando o laudo tem mais de uma autorização no relatório — a exibida é a
 * de validade mais longa (regra em lib/laudos/senhas.ts); as outras estão no
 * detalhe.
 *
 * Sem relatório importado (`senhas` nulo), a caixa diz isso em vez de "Sem
 * senha": ausência de arquivo não é ausência de senha.
 *
 * Laudo de OUTRO convênio (a senha da ASSIM não se aplica), a caixa fica cinza e
 * diz SÓ o nome do convênio — pedido do usuário (28/09/2026): sem "—", sem
 * "senha", sem "Outro convênio". O convênio é o da grade do TiTa (ver
 * lib/laudos/convenio.ts).
 */
function CaixaSenha({
  senhas,
  convenio,
}: {
  senhas: SenhasDoLaudo | null
  convenio: string | null
}) {
  if (!senhas) {
    return (
      <div
        className={`flex ${ALTURA_CAIXA} flex-col items-center justify-center rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-center`}
      >
        <p className="text-sm font-bold leading-none text-muted-foreground">—</p>
        <p className="mt-1 text-[11px] font-semibold uppercase leading-none tracking-widest text-muted-foreground">
          senha
        </p>
        <p className="mt-1.5 text-[11px] font-bold leading-tight text-muted-foreground">
          Sem relatório
        </p>
      </div>
    )
  }

  const { dentro, fora, pior, autorizacoes } = senhas

  if (dentro.status === "nao_se_aplica" && autorizacoes.length === 0) {
    // CAIXA ALTA sempre (pedido do usuário, 28/09/2026) e NUNCA partindo
    // palavra: quebra só entre palavras (`keep-all`, sem hifenização), e a
    // letra encolhe o necessário para a palavra mais longa caber (`fonteQueCabe`).
    const nome = (convenio ?? "Sem convênio").toLocaleUpperCase("pt-BR")
    return (
      <div
        className={`@container flex ${ALTURA_CAIXA} items-center justify-center rounded-lg border px-2 py-1.5 text-center ${TOM_SENHA.nao_se_aplica.contorno}`}
        title={`${nome} — convênio do paciente; a tela acompanha senha só de ASSIM e LEVE`}
      >
        <p
          className="line-clamp-3 font-bold uppercase leading-tight tracking-tight text-muted-foreground [hyphens:none] [overflow-wrap:normal] [word-break:keep-all]"
          style={{ fontSize: fonteQueCabe(nome) }}
        >
          {nome}
        </p>
      </div>
    )
  }

  const foraAplica = fora.status !== "nao_se_aplica"
  const extras = autorizacoes.length - 1
  const selo =
    extras > 0 ? (
      <span
        className="rounded bg-foreground/10 px-1 text-[11px] font-bold leading-4 text-muted-foreground"
        title={`${autorizacoes.length} autorizações no relatório — veja todas no detalhe`}
      >
        +{extras}
      </span>
    ) : null

  // ROL + FORA na mesma caixa, na MESMA altura da caixa padrão (pedido do
  // usuário, 28/09/2026: o cartão com as duas senhas ficava bem mais alto que o
  // vizinho). Duas linhas por senha — "ROL L772D21" e o status curto na cor
  // dele — no lugar das três de cada uma. O texto completo fica no `title` e no
  // detalhe do laudo.
  if (foraAplica) {
    return (
      <div
        className={`flex ${ALTURA_CAIXA} flex-col justify-center gap-1 rounded-lg border px-2 py-1.5 text-center ${TOM_SENHA[pior].contorno}`}
      >
        <LinhaSenhaCompacta rotulo="ROL" senha={dentro} lado="dentro" selo={selo} />
        <span className="mx-2 border-t border-border" aria-hidden="true" />
        <LinhaSenhaCompacta rotulo="FORA" senha={fora} lado="fora" />
      </div>
    )
  }

  return (
    <div
      className={`relative flex ${ALTURA_CAIXA} flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-center ${TOM_SENHA[pior].contorno}`}
      title={
        pior === "laudo_antigo"
          ? `Senha do laudo antigo ${senhas.laudosAntigos.join(", ")} — ainda não vinculada a este laudo`
          : undefined
      }
    >
      {selo && <span className="absolute right-1 top-1">{selo}</span>}
      <p className="truncate text-sm font-bold leading-none tabular-nums text-foreground">
        {dentro.senha ?? "—"}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase leading-none tracking-widest text-muted-foreground">
        senha
      </p>
      <p className={`mt-1.5 text-[11px] font-bold leading-tight ${TOM_SENHA[dentro.status].cor}`}>
        {textoStatusSenha(dentro, "dentro")}
      </p>
    </div>
  )
}

/** Uma senha em duas linhas: "ROL L772D21" e o status curto, na cor dele. */
function LinhaSenhaCompacta({
  rotulo,
  senha,
  lado,
  selo,
}: {
  rotulo: "ROL" | "FORA"
  senha: SenhaDoRol
  lado: "dentro" | "fora"
  selo?: ReactNode
}) {
  const completo = `${lado === "dentro" ? "Dentro" : "Fora"} do ROL: ${senha.senha ?? "sem número"} — ${textoStatusSenha(senha, lado)}`
  return (
    <div className="min-w-0" title={completo}>
      <p className="flex items-baseline justify-center gap-1.5 leading-none">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {rotulo}
        </span>
        <span className="truncate text-[13px] font-bold tabular-nums text-foreground">
          {senha.senha ?? "—"}
        </span>
        {selo}
      </p>
      <p className={`mt-0.5 truncate text-[11px] font-bold leading-tight ${TOM_SENHA[senha.status].cor}`}>
        {textoStatusSenhaCurto(senha, lado)}
      </p>
    </div>
  )
}

/**
 * Altura mínima das caixas de identificação — a de uma caixa com status em duas
 * linhas ("Vigente até / 27/02/27"). Igual em todas, para os cartões lado a lado
 * alinharem foto e nome na mesma altura.
 */
const ALTURA_CAIXA = "min-h-[78px]"

function Avatar({
  item,
  tom,
}: {
  item: ItemAcompanhamentoLaudo
  tom: { bg: string; fg: string }
}) {
  // O estado guarda o PAR (path, url), e a url exibida é derivada da comparação
  // com o path atual — em vez de um `setUrl(null)` no corpo do efeito quando o
  // path muda. Assim o efeito só chama setState dentro do callback assíncrono
  // (nada de render em cascata), e trocar a foto nunca deixa a URL antiga
  // aparecer por um render sob o path novo.
  const [foto, setFoto] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    let ativo = true
    const path = item.fotoPath
    if (!path) return
    getFotoUrlAssinada(path).then((assinada) => {
      // Path órfão (objeto apagado por fora) devolve null: cai no fallback de
      // iniciais em vez de mostrar imagem quebrada.
      if (ativo && assinada) setFoto({ path, url: assinada })
    })
    return () => {
      ativo = false
    }
  }, [item.fotoPath])

  const url = foto && foto.path === item.fotoPath ? foto.url : null

  if (url) {
    return (
      <div className="flex h-24 w-24 overflow-hidden rounded-full border border-border bg-muted transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none">
        <img src={url} alt={`Foto de ${item.nome}`} className="h-full w-full object-cover" />
      </div>
    )
  }

  // O ícone segue o mesmo ID que decide a cor (`tom`, no chamador): mesmo
  // paciente, mesmo bicho, em qualquer tela onde ele aparece sem foto. Acesso
  // por ÍNDICE em `ICONES`, não chamada de função — ver o comentário lá.
  const Icone = ICONES[indiceIconeAvatar(item.pacienteId ?? item.idLaudo)]

  return (
    <span
      className="flex h-24 w-24 items-center justify-center rounded-full transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
      style={{ backgroundColor: tom.bg, color: tom.fg }}
      aria-hidden="true"
    >
      <Icone className="h-11 w-11" strokeWidth={1.75} />
    </span>
  )
}
