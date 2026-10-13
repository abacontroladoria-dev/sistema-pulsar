// =============================================================================
// Painel de Entrada de Pacientes de Convênio — cópia do Doc do ClickUp
// =============================================================================
// A tarefa agendada do claude.ai na conta da Carol calcula o painel (calc.py do
// pacote de implantação, fluxo v4) às 7h40 e 12h40 e grava o resultado numa
// página de Doc fixa do ClickUp, como UM bloco ```json com {"dados": …}.
// Esta função copia essa página para public.painel_entrada_convenio_snapshots.
//
// Chamada pelo cron (fn_painel_entrada_convenio_disparar: 7h55/8h25 e
// 12h55/13h25, seg-sex) e pelo botão "Atualizar agora" da tela
// (/api/indicadores/entrada-convenio/atualizar). Responde 200 com um resumo em
// JSON, para um teste à mão mostrar o que aconteceu.
//
// ── REGRAS ───────────────────────────────────────────────────────────────────
// - Só GET no ClickUp. Nunca escreve lá.
// - Token: CLICKUP_TOKEN_PAINEL se existir; senão o CLICKUP_TOKEN que já serve
//   glosa, healthcheck e inclusão de terapia (decisão de 13/10/2026, com o dono
//   do token dando acesso ao Doc). Aqui só se LÊ; o token nunca é alterado. Duas
//   consequências de dividir o token: o rate limit de 100 req/min é dele (esta
//   função gasta 1 GET por rodada) e, se o dono o regenerar, o painel para junto
//   (o alerta "sem dado novo" avisa). Criar CLICKUP_TOKEN_PAINEL separa os dois
//   sem mudar código.
// - Token pessoal vai CRU no Authorization, sem "Bearer".
// - JSON fora da forma não grava nada: o painel fica com a rodada anterior e o
//   registrar abre alerta. Dado pela metade é pior que dado de ontem.
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { extrairJson, validarDados } from "./forma.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLICKUP_TOKEN_PAINEL = Deno.env.get("CLICKUP_TOKEN_PAINEL") ?? Deno.env.get("CLICKUP_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─────────────────────────────────────────────────────────────────────────────
// Quem pode chamar
// ─────────────────────────────────────────────────────────────────────────────
// verify_jwt já confere a assinatura, mas a chave anon também passa nele. Só o
// cron e a rota do Pulsar (ambos com service_role) podem disparar a cópia.
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

// ─────────────────────────────────────────────────────────────────────────────
// Leitura da página
// ─────────────────────────────────────────────────────────────────────────────
type Pagina = { conteudo: string; publicadoEm: string | null };
type PaginaApi = { id?: string; content?: string; date_updated?: number | string; pages?: PaginaApi[] };

async function clickupGet(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: CLICKUP_TOKEN_PAINEL! } });
  const texto = await res.text();
  if (!res.ok) {
    const prefixo = res.status === 429 ? "rate limit do ClickUp" : `ClickUp ${res.status}`;
    throw new Error(`${prefixo}: ${texto.slice(0, 300)}`);
  }
  return JSON.parse(texto);
}

function paraPagina(p: PaginaApi): Pagina {
  const ms = Number(p.date_updated);
  return {
    conteudo: p.content ?? "",
    publicadoEm: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
  };
}

// Com page_id, lê aquela página. Sem page_id (o link de um Doc de uma página só
// traz apenas o id do Doc), lista as páginas do Doc e usa a única que existe; se
// houver mais de uma, recusa em vez de adivinhar qual é a certa.
async function lerPagina(workspaceId: string, docId: string, pageId: string | null): Promise<Pagina> {
  const base =
    `https://api.clickup.com/api/v3/workspaces/${encodeURIComponent(workspaceId)}` +
    `/docs/${encodeURIComponent(docId)}/pages`;

  if (pageId) {
    return paraPagina((await clickupGet(`${base}/${encodeURIComponent(pageId)}?content_format=text/md`)) as PaginaApi);
  }

  const lista = (await clickupGet(`${base}?content_format=text/md&max_page_depth=0`)) as PaginaApi | PaginaApi[];
  const paginas = Array.isArray(lista) ? lista : (lista.pages ?? []);
  if (paginas.length === 0) throw new Error("o Doc não tem nenhuma página");
  if (paginas.length > 1) {
    throw new Error(`o Doc tem ${paginas.length} páginas; deixe só uma ou preencha page_id em painel_entrada_convenio_config`);
  }
  return paraPagina(paginas[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function registrar(origem: string, dados: unknown, publicadoEm: string | null, erro: string | null) {
  const { data, error } = await supabase.rpc("painel_entrada_convenio_registrar", {
    p_origem: origem,
    p_dados: dados,
    p_publicado_em: publicadoEm,
    p_erro: erro,
  });
  if (error) throw new Error(`registrar: ${error.message}`);
  return data;
}

serve(async (req) => {
  if (!chamadaDeServico(req)) return json({ erro: "não autorizado" }, 401);

  let origem = "cron";
  try {
    const corpo = await req.json();
    if (corpo?.origem === "manual") origem = "manual";
  } catch {
    // corpo vazio = cron
  }

  try {
    const { data: cfg, error: erroCfg } = await supabase
      .from("painel_entrada_convenio_config")
      .select("workspace_id, doc_id, page_id, ativo")
      .eq("id", 1)
      .single();
    if (erroCfg || !cfg) throw new Error(`config indisponível: ${erroCfg?.message ?? "linha id=1 ausente"}`);

    const ignorar = async (motivo: string) => {
      await supabase.rpc("painel_entrada_convenio_registrar_ignorado", { p_origem: origem, p_motivo: motivo });
      return json({ status: "ignorado", motivo });
    };
    if (!cfg.ativo) return await ignorar("leitura desligada em painel_entrada_convenio_config.ativo");
    if (!cfg.doc_id) return await ignorar("Doc do ClickUp ainda não configurado (doc_id)");
    if (!CLICKUP_TOKEN_PAINEL) return json(await registrar(origem, null, null, "nenhum token do ClickUp nos secrets (CLICKUP_TOKEN_PAINEL ou CLICKUP_TOKEN)"));

    let pagina: Pagina;
    let dados: Record<string, unknown>;
    try {
      pagina = await lerPagina(cfg.workspace_id, cfg.doc_id, cfg.page_id);
      dados = validarDados(extrairJson(pagina.conteudo));
    } catch (e) {
      return json(await registrar(origem, null, null, e instanceof Error ? e.message : String(e)));
    }

    return json(await registrar(origem, dados, pagina.publicadoEm, null));
  } catch (e) {
    // Falha do próprio banco: não há onde registrar; o 500 aparece no log da função.
    return json({ status: "erro", erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
