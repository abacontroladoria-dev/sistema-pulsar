// =============================================================================
// 1ª presença do paciente -> card dele muda de status no ClickUp
// =============================================================================
// Lê os cards parados em `status_origem` ('AGENDAMENTO CONCLUÍDO') na lista de
// entrada de pacientes, pergunta ao banco quais deles já tiveram a 1ª sessão
// concluída (public.presenca_clickup_casar, casamento por NOME) e move esses para
// 'Atendimento Realizado' (o 1º dia foi só avaliação/entrevista/consulta médica)
// ou 'Tratamento Iniciado' (o resto). Desenho e regras: migration 20261016190100.
//
// Chamada pelo cron `primeira-presenca-clickup` a cada 5 min, via
// public.fn_primeira_presenca_clickup_disparar (só quando config.ativo).
// Responde sempre um resumo em JSON, para um teste à mão mostrar o que fez.
//
// ── REGRAS ───────────────────────────────────────────────────────────────────
// - config.simulacao = true: casa e registra, não move nada.
// - Só move card com casamento único: nome ambíguo, dois cards do mesmo paciente
//   ou paciente que já era atendido antes ficam registrados e parados.
// - Token pessoal vai CRU no Authorization, sem "Bearer" (mesmo CLICKUP_TOKEN de
//   glosa, healthcheck e inclusão; rate limit de 100 req/min é dele — aqui são
//   1-2 GETs por rodada mais 1 PUT por card movido).
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLICKUP_TOKEN = Deno.env.get("CLICKUP_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Teto de páginas de 100 cards. Mais que isto no status de origem é config errada. */
const PAGINAS_MAX = 10;

// verify_jwt aceita também a chave anon. Esta função MEXE em card, então só o
// cron (service_role) pode chamá-la. Mesmo critério de painel-entrada-convenio.
function chamadaDeServico(req: Request): boolean {
  const bruto = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bruto) return false;
  if (bruto === SUPABASE_SERVICE_ROLE_KEY) return true;
  const partes = bruto.split(".");
  if (partes.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(partes[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

type Cartao = { id: string; nome: string };

type Casamento = {
  clickup_task_id: string;
  cartao_nome: string | null;
  resultado: "casou" | "nome_ambiguo" | "ja_atendido_antes" | "varios_cartoes";
  paciente_id: string | null;
  paciente_nome: string | null;
  primeira_presenca: string | null;
  fila_id: string | null;
  casamento: string | null;
  terapias_primeiro_dia: string | null;
  destino: "atendimento_realizado" | "tratamento_iniciado";
};

const mesmoStatus = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLocaleLowerCase("pt-BR") === (b ?? "").trim().toLocaleLowerCase("pt-BR");

async function clickup(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: CLICKUP_TOKEN!, "Content-Type": "application/json" },
  });
  const texto = await res.text();
  if (!res.ok) {
    const prefixo = res.status === 429 ? "rate limit do ClickUp" : `ClickUp ${res.status}`;
    throw new Error(`${prefixo}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : {};
}

/** Cards da lista no status de origem. O filtro da API é conferido de novo aqui. */
async function cartoesNoStatus(listId: string, status: string): Promise<Cartao[]> {
  const cartoes: Cartao[] = [];
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const url = new URL(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`);
    url.searchParams.append("statuses[]", status);
    url.searchParams.set("page", String(pagina));
    const corpo = await clickup(url.toString());
    for (const t of corpo?.tasks ?? []) {
      if (t?.id && t?.name && mesmoStatus(t?.status?.status, status)) {
        cartoes.push({ id: String(t.id), nome: String(t.name) });
      }
    }
    if (corpo?.last_page !== false) return cartoes;
  }
  throw new Error(`mais de ${PAGINAS_MAX * 100} cards em '${status}' — conferir status_origem`);
}

/**
 * Move o card. O PUT devolve a task: confere que o status mudou de fato, porque
 * 200 não prova que o campo fez algo (lição do aviso de glosa).
 */
async function moverCartao(taskId: string, destino: string) {
  const task = await clickup(`https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    body: JSON.stringify({ status: destino }),
  });
  if (!mesmoStatus(task?.status?.status, destino)) {
    throw new Error(`PUT aceito mas o card ficou em '${task?.status?.status ?? "?"}'`);
  }
}

async function registrar(linha: Record<string, unknown>) {
  const { error } = await supabase
    .from("presenca_clickup_movimentos")
    .upsert({ ...linha, atualizado_em: new Date().toISOString() }, {
      onConflict: "clickup_task_id,resultado",
    });
  if (error) console.error("❌ registro em presenca_clickup_movimentos:", error.message);
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!chamadaDeServico(req)) return json({ erro: "só service_role" }, 401);

  const resposta = await rodada();

  // net._http_response mistura as respostas de todo pg_net do banco; o resumo
  // desta automação fica na própria config (20261016190400).
  const { error } = await supabase
    .from("presenca_clickup_config")
    .update({
      ultima_rodada_em: new Date().toISOString(),
      ultimo_resumo: await resposta.clone().json(),
    })
    .eq("id", 1);
  if (error) console.error("❌ gravar ultimo_resumo:", error.message);

  return resposta;
});

async function rodada(): Promise<Response> {
  const resumo: Record<string, unknown> = {};

  try {
    const { data: cfg, error: erroCfg } = await supabase
      .from("presenca_clickup_config")
      .select("*")
      .eq("id", 1)
      .single();
    if (erroCfg || !cfg) throw new Error(`config indisponível: ${erroCfg?.message ?? "linha id=1 ausente"}`);
    if (!cfg.ativo) return json({ ignorado: "desativado em presenca_clickup_config.ativo" });
    if (!CLICKUP_TOKEN) throw new Error("CLICKUP_TOKEN ausente nos secrets");

    const simulacao = cfg.simulacao !== false;
    resumo.modo = simulacao ? "simulação (config.simulacao = true)" : "move de verdade";
    const statusPorDestino: Record<Casamento["destino"], string> = {
      atendimento_realizado: cfg.status_atendimento_realizado,
      tratamento_iniciado: cfg.status_tratamento_iniciado,
    };

    const cartoes = await cartoesNoStatus(cfg.clickup_list_id, cfg.status_origem);
    resumo.cartoes_no_status = cartoes.length;
    if (cartoes.length === 0) return json(resumo);

    const { data: casamentos, error: erroRpc } = await supabase.rpc("presenca_clickup_casar", {
      p_cartoes: cartoes,
      p_janela_dias: cfg.janela_dias,
      p_terapias_atendimento: cfg.terapias_atendimento_realizado,
    });
    if (erroRpc) throw new Error(`presenca_clickup_casar: ${erroRpc.message}`);

    // Card cujo nome não existe na agenda nunca casará: é nome divergente do
    // TiTa, e só uma pessoa corrige. Diagnóstico — falhar aqui não para a rodada.
    const { data: semAgenda, error: erroDiag } = await supabase.rpc(
      "presenca_clickup_nomes_sem_agenda",
      { p_cartoes: cartoes },
    );
    if (erroDiag) console.warn("⚠️ presenca_clickup_nomes_sem_agenda:", erroDiag.message);
    else if (semAgenda?.length) {
      resumo.nomes_sem_agenda = semAgenda.map((s: { cartao_nome: string }) => s.cartao_nome);
    }

    const contagem: Record<string, number> = {};
    const falhas: string[] = [];

    for (const c of (casamentos ?? []) as Casamento[]) {
      const destino = statusPorDestino[c.destino];
      const base = {
        clickup_task_id: c.clickup_task_id,
        cartao_nome: c.cartao_nome,
        paciente_id: c.paciente_id,
        paciente_nome: c.paciente_nome,
        primeira_presenca: c.primeira_presenca,
        fila_id: c.fila_id,
        casamento: c.casamento,
        terapias_primeiro_dia: c.terapias_primeiro_dia,
        status_destino: destino,
      };

      let resultado: string = c.resultado;
      if (c.resultado === "casou") {
        if (simulacao) {
          resultado = "simulado";
        } else {
          try {
            await moverCartao(c.clickup_task_id, destino);
            resultado = "movido";
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            falhas.push(`${c.cartao_nome}: ${msg}`);
            // O card segue no status de origem e volta na próxima rodada.
            await registrar({ ...base, resultado: "erro", erro: msg.slice(0, 500) });
            contagem.erro = (contagem.erro ?? 0) + 1;
            continue;
          }
        }
      }

      await registrar({ ...base, resultado, erro: null });
      contagem[resultado] = (contagem[resultado] ?? 0) + 1;
    }

    resumo.resultados = contagem;
    if (falhas.length) resumo.falhas = falhas;
    return json(resumo);
  } catch (e) {
    // 500 para aparecer em cron.job_run_details em vez de virar sucesso calado.
    console.error("⛔ primeira-presenca-clickup:", e);
    return json({ ...resumo, erro_fatal: e instanceof Error ? e.message : String(e) }, 500);
  }
}
