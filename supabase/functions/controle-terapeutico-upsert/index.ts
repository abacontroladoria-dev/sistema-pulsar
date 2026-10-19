import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

const ALLOWED_ORIGINS = [
  "http://127.0.0.1:3000",
  "https://127.0.0.1:3000",
  "https://orbitaautomacao.com.br",
];

function getCorsHeaders(requestOrigin: string) {
  const isAllowed = ALLOWED_ORIGINS.includes(requestOrigin);
  return isAllowed
    ? {
        "Access-Control-Allow-Origin": requestOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      }
    : {
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      };
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const statusPermitidos = new Set([
  "pendente",
  "presente",
  "faltou",
  "disponivel",
  "indisponivel",
  "cobertura_planejada",
  "cobertura_confirmada",
  "substituido",
]);

type UpsertItem = {
  tita_agendamento_id?: string | number;
  status?: string;
  profissional_substituto_id?: string | number | null;
  profissional_substituto_nome?: string | null;
  observacao?: string | null;
};

function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Quem grava: a tela Central de Terapeutas (permissão `escala_terapeutica`) e a
// tela da própria terapeuta, /disponibilidade-terapeuta (papel
// `disponibilidade_terapeuta`, fora do mapa de permissões — fluxo dedicado).
// Até 19/10/2026 bastava estar logado.
const PERMISSAO_GRAVA = "escala_terapeutica";
const PAPEIS_QUE_GRAVAM = new Set(["admin", "disponibilidade_terapeuta"]);

async function getCurrentUser(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = tokenMatch?.[1];

  if (!token) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  return { user, supabase };
}

/** Usuário ativo, com o papel ou a permissão de uma das telas que gravam. */
async function podeGravar(userId: string, supabaseDoUsuario: ReturnType<typeof createClient>) {
  const { data: perfil } = await supabaseAdmin
    .from("usuarios")
    .select("role, ativo")
    .eq("id", userId)
    .maybeSingle();
  if (!perfil?.ativo) return false;
  if (PAPEIS_QUE_GRAVAM.has(String(perfil.role ?? ""))) return true;

  // Mesma resolução do frontend (lib/permissions/carregar.ts): grupos + ajustes
  // individuais, calculados pelo banco para o usuário do token.
  const { data: codigos, error } = await supabaseDoUsuario.rpc("permissoes_efetivas", {});
  if (error) {
    console.error("[controle-terapeutico-upsert] permissoes_efetivas falhou", error.message);
    return false;
  }
  return Array.isArray(codigos) && codigos.includes(PERMISSAO_GRAVA);
}

function toBigintValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);
  }

  const sessao = await getCurrentUser(req);

  if (!sessao) {
    return jsonResponse({ error: "not_authenticated" }, 401, corsHeaders);
  }

  const { user } = sessao;

  if (!(await podeGravar(user.id, sessao.supabase))) {
    return jsonResponse({ error: "sem_permissao" }, 403, corsHeaders);
  }

  const { data: usuarioData } = await supabaseAdmin
    .from("usuarios")
    .select("nome")
    .eq("id", user.id)
    .single();
  const confirmadoPorNome: string | null = usuarioData?.nome ?? null;

  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? (body.items as UpsertItem[]) : [];

    const sanitizedItems = items
      .map((item) => ({
        ...item,
        tita_agendamento_id: toBigintValue(item.tita_agendamento_id),
      }))
      .filter((item) => item.tita_agendamento_id);

    if (sanitizedItems.length === 0) {
      return jsonResponse({ error: "empty_items" }, 400, corsHeaders);
    }

    const statusInvalido = sanitizedItems.find(
      (item) => !item.status || !statusPermitidos.has(item.status)
    );

    if (statusInvalido) {
      return jsonResponse(
        {
          error: "invalid_status",
          status: statusInvalido.status,
        },
        400,
        corsHeaders
      );
    }

    const ids = sanitizedItems.map((item) => item.tita_agendamento_id);

    const { data: agendaItems, error: agendaError } = await supabaseAdmin
      .from("agenda_tita")
      .select(
        "tita_agendamento_id,data_atendimento,hora_inicial,hora_final,profissional_id,profissional_nome,terapia_id,terapia_nome"
      )
      .in("tita_agendamento_id", ids);

    if (agendaError) {
      return jsonResponse(
        {
          error: "agenda_lookup_failed",
          message: agendaError.message,
        },
        500,
        corsHeaders
      );
    }

    const agendaById = new Map(
      (agendaItems || []).map((item) => [Number(item.tita_agendamento_id), item])
    );

    const rows = sanitizedItems.map((item) => {
      const agenda = agendaById.get(Number(item.tita_agendamento_id));

      return {
        tita_agendamento_id: item.tita_agendamento_id,
        status: item.status,
        profissional_substituto_id: toBigintValue(item.profissional_substituto_id),
        profissional_substituto_nome: item.profissional_substituto_nome || null,
        observacao: item.observacao || null,
        confirmado_por: user.id,
        confirmado_em: new Date().toISOString(),
        confirmado_por_nome: confirmadoPorNome,
        data_atendimento: agenda?.data_atendimento || null,
        hora_inicial: agenda?.hora_inicial || null,
        hora_final: agenda?.hora_final || null,
        profissional_id: agenda?.profissional_id || null,
        profissional_nome: agenda?.profissional_nome || null,
        terapia_id: agenda?.terapia_id || null,
        terapia_nome: agenda?.terapia_nome || null,
      };
    });

    const { data, error } = await supabaseAdmin
      .from("controle_terapeutico")
      .upsert(rows, {
        onConflict: "tita_agendamento_id",
      })
      .select();

    if (error) {
      return jsonResponse(
        {
          error: "upsert_failed",
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
        500,
        corsHeaders
      );
    }

    return jsonResponse({
      data,
      count: data?.length || 0,
    }, 200, corsHeaders);
  } catch (error) {
    return jsonResponse(
      {
        error: "unexpected_error",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      },
      500,
      corsHeaders
    );
  }
});
