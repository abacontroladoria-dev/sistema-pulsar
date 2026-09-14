// =============================================================================
// Aviso de glosa da ASSIM -> canal de Chat do ClickUp
// =============================================================================
// Substitui um trabalho manual: quando a ASSIM recusa uma autorização, a
// atendente tirava um print da tela, colava no canal do ClickUp, escrevia o nome
// do paciente e marcava três pessoas. Todos esses dados o robô já lê do recibo e
// grava em `fila_autorizacoes` (status='glosa'); o trigger
// `trg_avisar_glosa_clickup` os deposita na outbox `glosa_avisos`, e esta função
// só entrega.
//
// Chamada pelo cron `glosa-avisa-clickup` a cada 5 min em horário comercial, via
// public.fn_glosa_avisos_disparar — que só dispara quando há pendência.
// Invocável à mão para teste: responde sempre 200 com um resumo em JSON, porque
// um curl que devolve "ok" não testa nada.
//
// O QUE ESTA FUNÇÃO NÃO FAZ
//
// Não decide o que é glosa. Isso é do trigger, na mesma transação em que o robô
// conclui a tarefa — inclusive a dedup, que é o ponto delicado: `status='glosa'`
// é escrito por DUAS fontes (o robô, na hora, com o motivo completo; e o sync do
// relatório, horas depois, com o motivo truncado em 25 chars). O unique index em
// `fila_id` é o que garante um aviso por sessão.
//
// Não anexa print. A API de Chat v3 do ClickUp NÃO aceita imagem: não há campo no
// request e não existe `attachments` nem no modelo de resposta dela. Anexo lá
// existe só para task e custom field. Decisão do usuário, sabendo disso: mensagem
// de texto com os dados completos. Como não há print, o robô não mudou.
//
// Não notifica de verdade. Menção em chat v3 não avisa ninguém —
// `@[Nome](user:id)` é um link azul que não popula `tagged_users` e não dispara
// notificação (a ClickUp lista "true @mentions" na API como Planned). Quem
// acompanha o canal vê. O aviso com push é o alerta `assim_glosa` no sino do
// Pulsar, que já existe.
//
// POR QUE A FRASE É MONTADA AQUI E NÃO NO SQL
// A outbox guarda os CAMPOS; a frase é deste arquivo. Uma pendência que
// sobreviveu a uma falha do ClickUp é reenviada pela execução seguinte — se a
// frase estivesse gravada no banco, ela chegaria escrita pela versão antiga do
// código. Mesma disciplina de `assim-healthcheck`.
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLICKUP_TOKEN = Deno.env.get("CLICKUP_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Quantos avisos uma execução entrega. Teto baixo de propósito: são ~66 glosas no
 * histórico inteiro do sistema, então mais que isto numa rodada só significa que
 * algo encheu a outbox por engano — e nesse caso é melhor a rodada seguinte
 * continuar do que despejar tudo no canal de uma vez.
 */
const LOTE_MAX = 20;

type Aviso = {
  id: number;
  fila_id: string;
  paciente_nome: string | null;
  motivo: string | null;
  guia: string | null;
  horario_autorizacao: string | null;
  data_atendimento: string | null;
  terapia: string | null;
  terapia_exibicao_id: number | null;
  tuss: string | null;
  matricula: string | null;
  recepcionista: string | null;
  tentativas: number;
  /** Instante em que o trigger depositou o aviso na outbox. Vira o carimbo do rodapé. */
  criado_em: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Nome de exibição da terapia
// ─────────────────────────────────────────────────────────────────────────────
// O TiTa às vezes grava na sessão o nome da AÇÃO em vez do nome de exibição da
// terapia — "Aplicador ABA (PS)" onde a clínica diz "Psicologia ABA". Foi
// exatamente esse dado torto que motivou a migration 20260813120000 (caso
// Isabella, 13/08/2026), e ele chega aqui pela coluna `terapia_nome` da fila.
//
// Regra de negócio: as terapias do Grupo 1 ABA exibem sempre "Psicologia ABA".
// A chave é o ID, nunca o nome — é a convenção do projeto ("toda lógica deve
// operar por ID, nunca hardcodar nomes"), e é o que sobrevive a alguém renomear
// a terapia no TiTa.
//
// ATENÇÃO, ARMADILHA: esta lista NÃO é a mesma do CASE de `tuss_da_sessao()`
// (2317, 2269, 2263, 2260, 2283, 2248). As duas respondem perguntas diferentes —
// aquela é "qual TUSS", esta é "qual nome exibir" — e confundi-las mudaria o
// TUSS de terapias que não são ABA. Espelha `ABA_EXIB_PSICO_IDS` de
// frontend/lib/cronograma/constants.ts:448.
const ABA_EXIB_PSICO_IDS = new Set([2269, 2317, 2262, 2261, 2248, 2353, 2263]);
const ABA_EXIB_NOME = "Psicologia ABA";

/**
 * A linha da terapia, mostrando os DOIS nomes quando eles divergem.
 *
 * Decisão do usuário (2026-08-28): o nome de exibição serve a quem vai contestar
 * a glosa; o nome cru do TiTa serve a quem for investigar por que a sessão está
 * cadastrada torta. Esconder o segundo transformaria este aviso na quarta régua
 * de exibição do sistema, mentindo sobre o que está no cadastro.
 *
 * Quando os dois coincidem — ou quando não há id para decidir — sai um só.
 */
function formatarTerapia(terapia: string | null, exibicaoId: number | null): string | null {
  if (!terapia) return null;

  const deveExibirPsico = exibicaoId != null && ABA_EXIB_PSICO_IDS.has(exibicaoId);
  if (!deveExibirPsico) return terapia;

  // `terapia_nome` pode ser "A + B" (sessão com mais de uma terapia): se o nome
  // de exibição já está lá dentro, repetir não informa nada.
  if (terapia.includes(ABA_EXIB_NOME)) return terapia;

  return `${ABA_EXIB_NOME} (${terapia})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Motivo da glosa
// ─────────────────────────────────────────────────────────────────────────────
// Porte de `frontend/lib/glosa.ts` (lerMotivoGlosa + completarMotivoGlosa). São
// funções puras, sem dependência, e o import cruzado frontend -> Edge Function
// não existe no Deno deste projeto. A REGRA é a mesma e precisa continuar sendo:
// se um dia a ASSIM mudar a forma do texto, as duas pontas mudam juntas.

type MotivoGlosa = { codigo: string | null; descricao: string };

/**
 * Decompõe "1013-CADASTRO DO BENEFICIARIO COM PROBLEMAS".
 *
 * Sem o padrão numérico à frente, o texto inteiro vira descrição e o código fica
 * nulo — é o caso do fallback do robô, quando a ASSIM recusa sem código. Tratar a
 * primeira palavra como código ali inventaria um número que não existe.
 */
function lerMotivoGlosa(texto: string | null | undefined): MotivoGlosa | null {
  const bruto = texto?.trim();
  if (!bruto) return null;

  const comCodigo = bruto.match(/^(\d{3,5})\s*-\s*([\s\S]+)$/);
  if (comCodigo) {
    const descricao = comCodigo[2].trim();
    if (descricao) return { codigo: comCodigo[1], descricao };
  }

  return { codigo: null, descricao: bruto };
}

/**
 * Completa o motivo com o de-para de códigos, quando ele tiver texto melhor.
 *
 * "Melhor" é literalmente mais longo: a ASSIM corta o texto do relatório em 25
 * caracteres, e `glosa_codigos` guarda, por código, a versão mais completa já
 * vista. A comparação por comprimento é a mesma regra do trigger que aprende, e é
 * o que impede as duas pontas de discordarem sobre qual texto vale.
 */
function completarMotivoGlosa(
  motivo: MotivoGlosa | null,
  codigos: Map<string, string>,
): MotivoGlosa | null {
  if (!motivo?.codigo) return motivo;
  const doDePara = codigos.get(motivo.codigo);
  if (!doDePara || doDePara.length <= motivo.descricao.length) return motivo;
  return { codigo: motivo.codigo, descricao: doDePara };
}

// ─────────────────────────────────────────────────────────────────────────────
// A mensagem
// ─────────────────────────────────────────────────────────────────────────────

/** `2026-08-20T16:17:00` -> `20/08/2026 16:17`, sem passar por Date. */
function formatarDataHora(iso: string | null): string | null {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, ano, mes, dia, hh, mi] = m;
  return `${dia}/${mes}/${ano} ${hh}:${mi}`;
}

/** `2026-08-20` -> `20/08/2026`. */
function formatarData(iso: string | null): string | null {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * O carimbo de origem: `#<id da outbox> · <quando o aviso nasceu>`.
 *
 * POR QUE ISTO EXISTE (14/09/2026). O canal recebeu o MESMO aviso duas vezes com
 * quatro dias de intervalo — conteúdo idêntico byte a byte, ambos assinados como
 * ClickBot. A outbox provou que o Pulsar publicou uma vez só (linha 6340,
 * `enviado_em` só em 10/09, `tentativas`=0), então a republicação aconteceu
 * DEPOIS do nosso POST, dentro do Zapier. Nada na mensagem permitia perceber isso
 * a olho: duas cópias idênticas são indistinguíveis de duas glosas iguais.
 *
 * O `id` da outbox é a chave certa porque é ESTÁVEL — sobrevive à republicação,
 * já que o texto inteiro é reemitido como está. Dois avisos com o mesmo `#id` são
 * necessariamente a mesma mensagem duas vezes; dois `#id` diferentes são duas
 * glosas de verdade, ainda que os campos coincidam. A pergunta "isto é duplicata?"
 * passa a se responder olhando o canal, sem ir ao banco nem aos logs do Zapier.
 *
 * O horário é de São Paulo. `criado_em` é `timestamptz` (UTC), ao contrário de
 * `horario_autorizacao`, que já é hora de parede — imprimi-lo cru erraria em 3h e
 * o carimbo contradiria a linha "Quando" logo acima.
 */
function carimboOrigem(a: Aviso): string | null {
  if (!a.criado_em) return `#${a.id}`;

  const d = new Date(a.criado_em);
  if (Number.isNaN(d.getTime())) return `#${a.id}`;

  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  return `#${a.id} · ${partes.replace(",", "")}`;
}

/**
 * Monta a mensagem.
 *
 * A HIERARQUIA, E POR QUE ELA É ASSIM (redesenhada em 2026-08-28, depois do
 * primeiro aviso real)
 *
 * A primeira versão listava os nove campos com o mesmo peso, cada um com seu
 * ícone. Quem lia tinha de montar sozinho o que era do paciente, o que era da
 * autorização e o que era da sessão. A pergunta que a recepção faz ao bater o
 * olho é uma só — "quem foi recusado, e por quê?" —, e o resto é material de
 * contestação, lido depois, quando o processo é aberto. Daí DOIS níveis:
 *
 *   1. O FATO, no topo: paciente no título (é a chave de tudo) e o motivo numa
 *      CITAÇÃO. A citação é deliberada: a faixa vertical é o único recurso do
 *      markdown do ClickUp que cria BLOCO em vez de só engrossar a fonte, e é o
 *      mais perto de destaque colorido que a API permite (não existe cor:
 *      content_format só aceita text/md e text/plain). Ela cai no campo que
 *      decide a ação.
 *   2. O DOSSIÊ, agrupado por QUEM USA O DADO, não por origem: `Guia` e `TUSS`
 *      juntos porque são o que se cita numa contestação; `Beneficiário` sozinho
 *      com a matrícula porque na ASSIM é ela que identifica a pessoa, não o nome.
 *
 * DUAS REGRAS QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. Campo ausente OMITE a linha inteira, em vez de imprimir rótulo vazio. Guia,
 *    terapia e recepcionista são nulos em casos reais (recibo sem guia legível,
 *    máquina sem user_id em `maquinas`), e "**Guia** · null" num canal de
 *    trabalho é pior que a ausência da linha.
 * 2. O horário é impresso CRU. `horario_autorizacao` é hora de PAREDE de São
 *    Paulo — é o que a ASSIM imprime no recibo — enquanto outras colunas da mesma
 *    tabela são UTC. Aplicar fuso aqui erraria em 3h e o aviso mentiria sobre
 *    quando a recusa aconteceu.
 */
function montarMensagem(a: Aviso, codigos: Map<string, string>): string {
  const linhas: string[] = [];

  // ── A origem ──────────────────────────────────────────────────────────────
  // Carimbo de identidade. O autor da mensagem no ClickUp é a conta pessoal cujo
  // token está em CLICKUP_TOKEN — hoje, uma pessoa real —, e a API de Chat v3 não
  // permite trocar isso: não há campo de autor no request. A investigação de
  // 2026-09-03 confirmou que nem pelo conector do Zapier (`send_as_bot`) o nome é
  // escolhível: ele força a identidade genérica "ClickBot" do próprio ClickUp, e
  // o pedido de bot nomeado segue aberto no feedback deles.
  //
  // Então a origem é declarada no CORPO, que é o único lugar sob nosso controle.
  // Sem isto, um aviso automático chega assinado por alguém que não o escreveu —
  // e quem lê o canal responde à pessoa errada.
  //
  // Fica em itálico, sem negrito, de propósito: é metadado, não o fato. O negrito
  // pertence à linha seguinte, que é o que precisa ser lido primeiro.
  linhas.push("_🤖 Robô de Avisos_");
  linhas.push("");

  // ── O fato ────────────────────────────────────────────────────────────────
  const paciente = a.paciente_nome ?? "(nome não registrado)";
  linhas.push(`🚨 **BENEFÍCIO REJEITADO** · ${paciente}`);
  linhas.push("");

  const motivo = completarMotivoGlosa(lerMotivoGlosa(a.motivo), codigos);
  if (motivo) {
    linhas.push(
      motivo.codigo
        ? `> **${motivo.codigo}** — ${motivo.descricao}`
        : `> **${motivo.descricao}**`,
    );
  } else {
    // A ASSIM recusou sem texto legível no recibo. Dizer isso é melhor que
    // omitir: a recusa existiu, e é ela que motiva a mensagem.
    linhas.push("> **Motivo não identificado no recibo**");
  }

  linhas.push("");

  // ── O dossiê ──────────────────────────────────────────────────────────────
  // Sessão em DUAS linhas (decisão do usuário): a terapia mostra os dois nomes e
  // apertá-la junto do horário criava parênteses dentro de parênteses.
  const terapia = formatarTerapia(a.terapia, a.terapia_exibicao_id);
  if (terapia) linhas.push(`**Terapia** · ${terapia}`);

  const quando = formatarDataHora(a.horario_autorizacao);
  // A data da sessão só entra quando difere do dia da autorização — a ASSIM
  // costuma autorizar no mesmo dia, e repetir a data faria a mensagem parecer
  // ter dois campos de data conflitantes.
  const sessao = formatarData(a.data_atendimento);
  const mostrarSessao = sessao && (!quando || !quando.startsWith(sessao));
  if (quando || mostrarSessao) {
    const partes = [
      quando ? `autorizado ${quando}` : null,
      mostrarSessao ? `sessão ${sessao}` : null,
    ].filter(Boolean);
    linhas.push(`**Quando** · ${partes.join(" · ")}`);
  }

  // Guia e TUSS em linhas SEPARADAS (decisão do usuário, 2026-08-28). São dois
  // números distintos e de tamanho parecido; lado a lado na mesma linha, quem
  // procura um acaba lendo o outro.
  //
  // O par junto tinha um custo escondido: sem guia, o rótulo precisava mudar
  // ("**TUSS** · ..." em vez de "**Guia** · TUSS ...") para não anunciar uma guia
  // que não existe — e rótulo que muda de nome conforme o conteúdo é difícil de
  // procurar com o olho. Separados, cada linha tem um rótulo fixo e some inteira
  // quando o dado falta. Recibo sem guia legível é caso real (é o que faz o robô
  // gravar 'concluido_sem_guia').
  if (a.guia) linhas.push(`**Guia** · ${a.guia}`);
  if (a.tuss) linhas.push(`**TUSS** · ${a.tuss}`);

  if (a.matricula) linhas.push(`**Beneficiário** · ${a.matricula}`);

  if (a.recepcionista) {
    linhas.push("");
    linhas.push(`_Solicitado por ${a.recepcionista}_`);
  }

  // O carimbo fecha a mensagem, no menor peso visual possível: quem lê o canal
  // para trabalhar não precisa dele, e quem investiga uma duplicata precisa
  // exatamente dele. Colado à linha do solicitante quando ela existe — são as
  // duas informações de procedência, não merecem um respiro entre si.
  const carimbo = carimboOrigem(a);
  if (carimbo) {
    if (!a.recepcionista) linhas.push("");
    linhas.push(`_${carimbo}_`);
  }

  return linhas.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// A MENÇÃO QUE FUNCIONA: [@Nome](#user_mention#{id})
// ─────────────────────────────────────────────────────────────────────────────
// Esta sintaxe NÃO ESTÁ NA DOC OFICIAL do ClickUp. Foi descoberta por tentativa
// em 2026-08-28, e confirmada de duas formas: o endpoint
// GET /v3/workspaces/{ws}/chat/messages/{id}/tagged_users passou a devolver o
// usuário, e a pessoa mencionada RECEBEU a notificação. Ninguém vai reencontrar
// isto lendo documentação — daí o registro completo aqui.
//
// Sete candidatos, cada um enviado e conferido em tagged_users:
//
//   @Nome (texto puro, o controle) ......... vazio
//   followers: [ids] (campo do POST) ....... 201, vazio
//   clickup://user/{id} .................... vazio
//   [@Nome](clickup://user/{id}) ........... vazio
//   [@Nome](user:{id}) ..................... vazio
//   [@Nome](#user_mention{id}) ............. vazio   <- SEM o # final
//   [@Nome](#user_mention#{id}) ............ ✅ reconheceu E notificou
//   [Nome](#user_mention#{id}) ............. ✅ reconheceu
//
// TRÊS REGRAS QUE SAEM DISSO, e nenhuma é óbvia:
//
//   1. O `#` FINAL É OBRIGATÓRIO. `#user_mention#{id}` funciona;
//      `#user_mention{id}` não. Um caractere separa menção de link morto.
//   2. O `@` do rótulo é DECORATIVO — o que resolve é o LINK. Mantido porque é o
//      que a pessoa espera ver escrito.
//   3. O ALVO PRECISA PERTENCER AO CANAL. A primeira rodada falhou com esta
//      mesma sintaxe: o app mostrava "undefined não tem acesso a este canal",
//      porque o id testado era de alguém de fora. **Trocar de canal exige
//      reconferir os ids**, não só o channel_id.
//
// O caminho até aqui foi longo e vale registrar para não se repetir: `@Nome` em
// texto não notifica, e `followers` foi aceito com 201 sem avisar ninguém
// (testado 2x). Lição de método: **201 não prova que um campo FAZ algo** — prova
// só que o request era válido.
//
// Script do teste: supabase/snippets/testar_mention_clickup.mjs

type UsuarioMencionado = { nome?: string; id?: string };

/**
 * Os nomes a citar, como menções que o ClickUp reconhece.
 *
 * Lê `mencionar_usuarios` (jsonb, pares nome+id) e cai para `mencionar` — a
 * coluna antiga, texto solto — só se a nova estiver vazia. A antiga não
 * notifica; existe como rede de segurança para o caso de a migration 20260828160000
 * não ter sido aplicada, e some quando ela for.
 *
 * Config guarda o FATO (quem citar); a sintaxe mora aqui. A API de Chat v3 é
 * experimental ("subject to change at any time"), então se o formato mudar, muda
 * uma linha nesta função — não a linha de config.
 */
function montarMencoes(usuarios: unknown, textoAntigo: string | null): string | null {
  if (Array.isArray(usuarios) && usuarios.length > 0) {
    const partes = (usuarios as UsuarioMencionado[])
      // Sem id não há menção possível: o link precisa do número. Um nome solto
      // aqui viraria texto que finge notificar — exatamente o que se está
      // corrigindo.
      .filter((u) => u?.id)
      .map((u) => `[@${u.nome ?? "usuário"}](#user_mention#${u.id})`);

    if (partes.length > 0) return partes.join(" ");
  }

  return textoAntigo?.trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// O CAMINHO DO ZAPIER: publicar como ClickBot
// ─────────────────────────────────────────────────────────────────────────────
// Pelo caminho direto (abaixo) o autor da mensagem é a PESSOA dona do
// CLICKUP_TOKEN — a API de Chat v3 não tem campo de autor. Quem lê o canal
// responde a essa pessoa, que não escreveu nada.
//
// O conector oficial do ClickUp no Zapier resolve: a action `createChatMessage`
// aceita `send_as_bot`, e com ele a mensagem sai como **ClickBot**. Comprovado
// em 2026-09-03 por HTTP puro, sem SDK.
//
// TRÊS COISAS QUE CUSTARAM CARO PARA DESCOBRIR E NÃO ESTÃO EM DOCUMENTAÇÃO
// NENHUMA (o caminho completo está em supabase/snippets/zapier-clickbot-*.mjs):
//
// 1. A URL. O `ACTION_RUNS_PATH` do SDK — "/zapier/api/actions/v1/runs" — NÃO é
//    uma URL: é uma chave de roteamento. O SDK remove o prefixo "/zapier",
//    troca por "/api/v0/sdk/zapier" e manda para o subdomínio `sdkapi`. Postar
//    na concatenação ingênua (zapier.com + o path) dá 405 — é o site
//    institucional respondendo, não a API.
//
// 2. `audience: "zapier.com"` é obrigatório na troca de client credentials, e
//    não aparece em nenhum exemplo publicado.
//
// 3. O header depende do FORMATO do token, não do `token_type` da resposta: se
//    tiver três segmentos base64url é `JWT `, senão `Bearer `. Hoje volta
//    opaco (Bearer), mas o SDK decide por inspeção e nós fazemos igual — se um
//    dia virar JWT, isto continua funcionando.
//
// E o principal: `send_as_bot` NÃO ESTÁ no schema público da action. Ele chega
// ao conector porque `inputs` é repassado cru, sem validação. Some sem aviso se
// o Zapier apertar isso um dia — daí o fallback.

const ZAPIER_TOKEN_URL = "https://zapier.com/oauth/token/";
const ZAPIER_RUNS_URL =
  "https://sdkapi.zapier.com/api/v0/sdk/zapier/api/actions/v1/runs";

const ZAPIER_CLIENT_ID = Deno.env.get("ZAPIER_CLIENT_ID");
const ZAPIER_CLIENT_SECRET = Deno.env.get("ZAPIER_CLIENT_SECRET");

/**
 * Teto do polling por aviso. O SDK usa 180s; aqui é menor de propósito: são até
 * 20 avisos por rodada e o cron roda a cada 5 min, então esperar 3 min por um
 * único aviso deixaria a fila parada.
 *
 * MAS O FALLBACK AQUI NÃO É DE GRAÇA, e isso custou uma duplicata no canal para
 * ficar claro (03/09/2026, teste com a linha 4741): o run já tinha CRIADO a
 * mensagem quando o polling desistiu, e o fallback publicou a segunda. Ou seja,
 * timeout curto não significa "aviso não entregue" — significa "não sei se foi",
 * e reenviar por via das dúvidas duplica.
 *
 * Daí 60s: o run observado leva ~1-2s, então 60s só é atingido quando algo está
 * de fato quebrado, e não quando o Zapier está apenas lento. Não elimina a
 * corrida (nada elimina, sem um id de dedup que a action não devolve), mas a
 * torna rara o suficiente para o fallback continuar valendo a pena.
 */
const ZAPIER_POLL_TIMEOUT_MS = 60_000;
const ZAPIER_POLL_INTERVAL_MS = 1_000;

/**
 * Token em memória, reaproveitado entre avisos da mesma execução (e entre
 * execuções, enquanto a instância estiver quente). Vale 10h; renovamos com 5 min
 * de folga para não usar um token que expira no meio do polling.
 */
let zapierTokenCache: { token: string; expiraEm: number } | null = null;

/** Mesmo critério do SDK (getAuthorizationHeader). */
function ehJwt(token: string): boolean {
  const partes = token.split(".");
  return partes.length === 3 &&
    partes.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

async function obterTokenZapier(): Promise<string> {
  const agora = Date.now();
  if (zapierTokenCache && zapierTokenCache.expiraEm > agora) {
    return zapierTokenCache.token;
  }

  const res = await fetch(ZAPIER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: ZAPIER_CLIENT_ID!,
      client_secret: ZAPIER_CLIENT_SECRET!,
      scope: "external",
      audience: "zapier.com",
    }),
  });

  if (!res.ok) {
    throw new Error(`Zapier token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const corpo = await res.json();
  if (!corpo?.access_token) throw new Error("Zapier token: resposta sem access_token");

  const validadeSegundos = Number(corpo.expires_in ?? 3600);
  zapierTokenCache = {
    token: corpo.access_token,
    expiraEm: agora + Math.max(0, validadeSegundos - 300) * 1000,
  };

  return zapierTokenCache.token;
}

function headersZapier(token: string) {
  return {
    Authorization: `${ehJwt(token) ? "JWT" : "Bearer"} ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    // Identifica esta chamada nos logs do Zapier em vez de ela aparecer como
    // cliente anônimo.
    "zapier-sdk-version": "0.107.0",
  };
}

type ConfigZapier = {
  workspaceId: string;
  channelId: string;
  connectionId: string;
  selectedApi: string;
};

/**
 * Publica via Zapier. Assíncrono: cria o run (202 + id) e faz polling até o
 * status sair de "waiting".
 *
 * ARMADILHA: `errors` não-vazio significa falha DA ACTION mesmo com HTTP 200 —
 * é assim que "View not found" aparece. Tratar 200 como sucesso publicaria um
 * "enviado" para uma mensagem que nunca existiu.
 */
async function enviarViaZapier(cfg: ConfigZapier, conteudo: string) {
  const token = await obterTokenZapier();

  const criacao = await fetch(ZAPIER_RUNS_URL, {
    method: "POST",
    headers: headersZapier(token),
    body: JSON.stringify({
      data: {
        selected_api: cfg.selectedApi,
        action_key: "createChatMessage",
        action_type: "write",
        authentication_id: cfg.connectionId,
        inputs: {
          // O Zapier chama de team_id/view_id os mesmos ids que a API v3 chama
          // de workspace/channel.
          team_id: Number(cfg.workspaceId),
          view_id: cfg.channelId,
          comment_type: "message",
          comment_text: conteudo,
          // `markdown: true` é o equivalente ao content_format text/md do
          // caminho direto — sem ele o negrito e a citação chegam como texto
          // cru, com os asteriscos à mostra.
          markdown: true,
          send_as_bot: true,
        },
      },
    }),
  });

  if (!criacao.ok) {
    throw new Error(`Zapier run ${criacao.status}: ${(await criacao.text()).slice(0, 300)}`);
  }

  const runId = (await criacao.json())?.data?.id;
  if (!runId) throw new Error("Zapier run: resposta sem data.id");

  const limite = Date.now() + ZAPIER_POLL_TIMEOUT_MS;
  const urlRun = `${ZAPIER_RUNS_URL}/${encodeURIComponent(runId)}`;

  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, ZAPIER_POLL_INTERVAL_MS));

    const res = await fetch(urlRun, { method: "GET", headers: headersZapier(token) });
    if (!res.ok) {
      throw new Error(`Zapier poll ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const dados = (await res.json())?.data ?? {};
    if (res.status === 202 || dados.status === "waiting") continue;

    const erros = dados.errors ?? [];
    if (erros.length > 0) {
      const detalhe = erros
        .map((e: { detail?: string; title?: string }) => e.detail ?? e.title ?? "erro sem texto")
        .join("; ");
      throw new Error(`Zapier action falhou: ${detalhe}`);
    }

    return; // status terminal sem erros: a mensagem existe no canal.
  }

  // Timeout NÃO é "falhou": é "não sei". O run pode já ter publicado a mensagem
  // — foi exatamente o que aconteceu no teste de 03/09/2026, e o fallback gerou
  // uma duplicata no canal. Por isso este erro é marcado, e `entregar()` o trata
  // como entregue em vez de reenviar: entre duplicar um aviso e arriscar um
  // atraso de 5 min (o aviso volta na rodada seguinte se de fato não saiu), a
  // duplicata é o pior dos dois — ela chega a três pessoas marcadas.
  const incerto = new Error(
    `Zapier poll: timeout de ${ZAPIER_POLL_TIMEOUT_MS}ms no run ${runId} — a mensagem PODE ter sido publicada`,
  );
  (incerto as Error & { entregaIncerta?: boolean }).entregaIncerta = true;
  throw incerto;
}

/**
 * Chat do ClickUp (API v3). O token pessoal vai CRU no Authorization, sem
 * "Bearer" — é assim para token pessoal, diferente do OAuth.
 * content_format text/md é o que faz o negrito chegar negrito.
 */
async function enviarClickUp(workspaceId: string, channelId: string, conteudo: string) {
  const res = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${workspaceId}/chat/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: CLICKUP_TOKEN!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "message",
        content: conteudo,
        content_format: "text/md",
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async () => {
  const resumo: Record<string, unknown> = {};

  try {
    const { data: cfg, error: erroCfg } = await supabase
      .from("glosa_avisos_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (erroCfg || !cfg) {
      throw new Error(`config indisponível: ${erroCfg?.message ?? "linha id=1 ausente"}`);
    }

    if (!cfg.ativo) {
      return json({ ignorado: "aviso de glosa desativado em glosa_avisos_config.ativo" });
    }

    const { data: avisos, error: erroLista } = await supabase
      .from("glosa_avisos")
      .select("*")
      .is("enviado_em", null)
      .order("criado_em", { ascending: true })
      .limit(LOTE_MAX);

    if (erroLista) throw new Error(`leitura da outbox: ${erroLista.message}`);

    resumo.pendentes = avisos?.length ?? 0;

    if (!avisos || avisos.length === 0) {
      resumo.clickup = "nada a enviar";
      return json(resumo);
    }

    if (!CLICKUP_TOKEN) {
      resumo.clickup = "CLICKUP_TOKEN ausente nos secrets — avisos ficam pendentes";
      return json(resumo);
    }
    if (!cfg.clickup_workspace_id || !cfg.clickup_channel_id) {
      resumo.clickup = "clickup_workspace_id/channel_id não configurados — avisos ficam pendentes";
      return json(resumo);
    }

    // O de-para de códigos, uma vez por execução. São 6 códigos conhecidos; ler
    // por aviso seria uma ida ao banco por mensagem sem nada em troca.
    const codigos = new Map<string, string>();
    const { data: linhasCodigos } = await supabase
      .from("glosa_codigos")
      .select("codigo, descricao");
    for (const c of linhasCodigos ?? []) {
      if (c?.codigo && c?.descricao) codigos.set(String(c.codigo), String(c.descricao));
    }

    // Uma vez por execução: quem é citado não muda entre um aviso e outro.
    const mencoes = montarMencoes(cfg.mencionar_usuarios, cfg.mencionar);

    // ── Como publicar ─────────────────────────────────────────────────────────
    // Via Zapier a mensagem sai como ClickBot; direto, sai como a pessoa dona do
    // CLICKUP_TOKEN. O Zapier só entra se estiver LIGADO em config E com os dois
    // secrets presentes — sem eles, cada aviso tentaria e cairia no fallback,
    // trocando uma entrega que funciona por uma ida inútil à rede.
    const zapierConfigurado = Boolean(
      cfg.zapier_ativo && ZAPIER_CLIENT_ID && ZAPIER_CLIENT_SECRET && cfg.zapier_connection_id,
    );

    if (cfg.zapier_ativo && !zapierConfigurado) {
      // Ligado em config mas sem credencial é erro de operação, não estado
      // normal: registrar, porque o sintoma (autor errado) é silencioso.
      console.warn(
        "⚠️ zapier_ativo=true mas falta ZAPIER_CLIENT_ID/SECRET ou zapier_connection_id — usando envio direto",
      );
    }

    resumo.via = zapierConfigurado ? "zapier (ClickBot)" : "direto (conta pessoal)";

    let enviados = 0;
    let porFallback = 0;
    const falhas: string[] = [];

    /**
     * Entrega um aviso, com o fallback embutido.
     *
     * A regra: uma glosa não pode deixar de ser avisada porque o Zapier está
     * fora. Autor errado é um defeito cosmético; aviso que não chega é uma
     * contestação perdida. Por isso a falha do Zapier NÃO propaga — ela cai para
     * o envio direto e fica registrada no resumo.
     */
    async function entregar(conteudo: string): Promise<"zapier" | "direto"> {
      if (zapierConfigurado) {
        try {
          await enviarViaZapier(
            {
              workspaceId: cfg.clickup_workspace_id,
              channelId: cfg.clickup_channel_id,
              connectionId: cfg.zapier_connection_id,
              selectedApi: cfg.zapier_selected_api ?? "ClickUpCLIAPI@2.1.63",
            },
            conteudo,
          );
          return "zapier";
        } catch (e) {
          // Um token vencido no cache derrubaria todos os avisos da rodada;
          // descartá-lo faz o próximo tentar de novo com token novo.
          zapierTokenCache = null;
          const msg = e instanceof Error ? e.message : String(e);

          // Entrega incerta (timeout do polling): NÃO reenviar. A mensagem
          // provavelmente já está no canal, e o fallback faria dela uma
          // duplicata marcando três pessoas.
          //
          // A ESCOLHA, EXPLÍCITA: tratar como entregue MARCA a linha como
          // enviada, então se a mensagem realmente não saiu, este aviso está
          // perdido — não volta na rodada seguinte. É deliberado, e vale para
          // ESTE aviso: ele também está no sino do Pulsar (alerta assim_glosa),
          // que é o canal com push de verdade. O ClickUp aqui é redundância.
          // Para um aviso sem essa rede, a escolha certa seria a inversa.
          // `zapier_incerto` no resumo é o que permite descobrir se aconteceu.
          if ((e as { entregaIncerta?: boolean })?.entregaIncerta) {
            resumo.zapier_incerto = msg.slice(0, 300);
            console.warn(`⚠️ ${msg}`);
            return "zapier";
          }
          console.warn(`⚠️ Zapier falhou, caindo para envio direto: ${msg}`);
          // O motivo também vai para a RESPOSTA, não só para o console: sem
          // isto, descobrir por que o autor saiu errado exige acesso aos logs
          // da plataforma — e o sintoma é silencioso, ninguém vai procurar.
          if (!resumo.zapier_erro) resumo.zapier_erro = msg.slice(0, 300);
        }
      }

      await enviarClickUp(cfg.clickup_workspace_id, cfg.clickup_channel_id, conteudo);
      return "direto";
    }

    for (const aviso of avisos as Aviso[]) {
      try {
        const rota = await entregar(
          // A menção vai no FIM, depois do dossiê: ela chama as pessoas, não
          // informa nada. Quem lê quer saber quem foi recusado antes de ver
          // quem foi chamado.
          mencoes
            ? `${montarMensagem(aviso, codigos)}\n\n${mencoes}`
            : montarMensagem(aviso, codigos),
        );

        // Só o envio confirmado marca como enviado. Se este ponto não for
        // atingido, a execução seguinte reenvia — o aviso atrasa, não se perde.
        const { error: erroMarcar } = await supabase
          .from("glosa_avisos")
          .update({ enviado_em: new Date().toISOString(), ultimo_erro: null })
          .eq("id", aviso.id);

        if (erroMarcar) {
          // Pior caso: a mensagem foi e a marcação não. A próxima execução
          // reenviaria — duplicado é ruim, mas silêncio é pior, e registrar o
          // erro é o que permite descobrir.
          throw new Error(`enviado mas não marcado: ${erroMarcar.message}`);
        }

        enviados++;
        if (rota === "direto" && zapierConfigurado) porFallback++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        falhas.push(`${aviso.fila_id}: ${msg}`);
        await supabase
          .from("glosa_avisos")
          .update({ tentativas: (aviso.tentativas ?? 0) + 1, ultimo_erro: msg.slice(0, 500) })
          .eq("id", aviso.id);
        console.error(`❌ aviso ${aviso.fila_id} falhou:`, msg);
      }
    }

    resumo.enviados = enviados;
    // Fallback usado é o sinal de que o Zapier está quebrado: os avisos
    // chegaram, mas assinados pela pessoa errada. Sem esta contagem o defeito
    // seria invisível — o resumo diria "enviado" e ninguém olharia o canal.
    if (porFallback > 0) resumo.fallback_direto = porFallback;
    resumo.falhas = falhas.length ? falhas : undefined;
    resumo.clickup = falhas.length ? "parcial" : "enviado";

    return json(resumo);
  } catch (e) {
    // 500 de propósito: um erro AQUI é a própria entrega quebrada, e precisa
    // aparecer em cron.job_run_details em vez de virar um "sucesso" silencioso.
    console.error("⛔ glosa-clickup:", e);
    return json({ ...resumo, erro_fatal: e instanceof Error ? e.message : String(e) }, 500);
  }
});
