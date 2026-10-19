-- Aplica 20261019200000_papel_terapeuta_app (Fase 1 do app de evoluções).
-- Teste PGlite: supabase/tests/papel_terapeuta_app.pglite.mjs (15/15). Ensaio em produção 19/10 (desfeito):
-- sincronizar só mudou o array; app_meu_perfil = gestão p/ 2 admins (evolui) e 4 diretoria (consulta), nada p/ o resto.
begin;
set local lock_timeout = '5s';

-- Fase 1 do app de evoluções (docs/app-evolucoes/PLANO_BACKEND.md): papel
-- 'terapeuta' — o profissional que entra no APP para ver a própria agenda,
-- evoluir e marcar falta do paciente. Não é o 'terapeutico' (setor do Pulsar
-- web) nem o 'disponibilidade_terapeuta' (login compartilhado da tela de
-- disponibilidade).
--
-- Como em 20261008130000 (comercial), o nível técnico vem dos grupos: entrar no
-- grupo "Terapeuta (App)" dá role = 'terapeuta'. Por isso:
--   1. caber no usuarios_role_check;
--   2. grupo com nivel_tecnico = 'terapeuta' (nasce sem telas: o terapeuta não
--      usa o Pulsar web; no web ele cai em /sem-permissao);
--   3. lugar na prioridade de sincronizar_nivel_pelos_grupos — logo antes de
--      'disponibilidade_terapeuta', abaixo de todo setor do Pulsar: quem também
--      está num grupo de setor continua com o setor.
--
-- 4. Um login por profissional: o índice parcial de profissional_id
--    (20261016180000) vira UNIQUE. Em produção, 19/10/2026: 0 usuários ligados.
--    Não há CHECK "terapeuta exige profissional_id": o papel chega pelo gatilho
--    do grupo ANTES de o admin escolher o profissional, e o CHECK faria a entrada
--    no grupo falhar. Terapeuta sem profissional simplesmente não abre o app
--    (app_meu_perfil não devolve linha) — a tela de usuários avisa.
--
-- 5. app_meu_perfil(): quem é a pessoa logada, para o app escolher a área.
--    Prevista para a Fase 4; vem agora para o app já funcionar para terapeuta e
--    gestão. O ramo do responsável entra na Fase 3.
--
-- Idempotente.

-- 1. Constraint ----------------------------------------------------------------
DO $$
DECLARE
  allowed     text[] := ARRAY[
    'admin','diretoria','recepcao','autorizacao','terapeutico',
    'faturamento','rp','cronograma','disponibilidade_terapeuta','marketing',
    'comercial','terapeuta'
  ];
  extra_role  text;
BEGIN
  FOR extra_role IN
    SELECT DISTINCT role FROM public.usuarios WHERE role IS NOT NULL
  LOOP
    IF NOT (extra_role = ANY(allowed)) THEN
      allowed := array_append(allowed, extra_role);
      RAISE NOTICE 'Role existente não mapeado incluído no constraint: %', extra_role;
    END IF;
  END LOOP;

  ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check;

  EXECUTE format(
    'ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ',') FROM unnest(allowed) AS r)
  );
END;
$$;

-- 2. Grupo ---------------------------------------------------------------------
INSERT INTO public.grupos_permissoes (nome, descricao, nivel_tecnico)
VALUES ('Terapeuta (App)', 'Profissional que usa o app de evoluções. Sem telas no Pulsar web.', 'terapeuta')
ON CONFLICT (nome) DO UPDATE SET nivel_tecnico = EXCLUDED.nivel_tecnico
WHERE public.grupos_permissoes.nivel_tecnico IS DISTINCT FROM EXCLUDED.nivel_tecnico;

-- 3. Prioridade do nível -------------------------------------------------------
-- Mesmo corpo de 20261008130000, com 'terapeuta' antes de 'disponibilidade_terapeuta'.
CREATE OR REPLACE FUNCTION public.sincronizar_nivel_pelos_grupos(p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_atual text;
  v_novo  text;
  v_ator_admin boolean := public.is_admin();
BEGIN
  SELECT role INTO v_atual FROM public.usuarios WHERE id = p_usuario_id;
  IF v_atual IS NULL THEN
    RETURN;  -- usuário excluído (cascade dos membros) ou inexistente
  END IF;

  SELECT g.nivel_tecnico INTO v_novo
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  WHERE m.usuario_id = p_usuario_id
    AND g.nivel_tecnico IS NOT NULL
    AND (g.nivel_tecnico <> 'admin' OR v_ator_admin)
  ORDER BY array_position(
    ARRAY['admin','diretoria','cronograma','autorizacao','rp','faturamento',
          'terapeutico','recepcao','comercial','marketing','terapeuta','disponibilidade_terapeuta'],
    g.nivel_tecnico)
  LIMIT 1;

  IF v_novo IS NULL OR v_novo = v_atual THEN
    RETURN;  -- sem grupo com nível: mantém o que tem
  END IF;

  IF v_atual = 'admin' THEN
    IF NOT v_ator_admin THEN
      RETURN;  -- só admin tira alguém do nível admin
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE role = 'admin' AND ativo AND id <> p_usuario_id
    ) THEN
      RETURN;  -- nunca remove o último admin ativo
    END IF;
  END IF;

  UPDATE public.usuarios SET role = v_novo WHERE id = p_usuario_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_nivel_pelos_grupos(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Um login por profissional -------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_profissional_id
  ON public.usuarios (profissional_id)
  WHERE profissional_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_usuarios_profissional_id;

-- 5. app_meu_perfil() ----------------------------------------------------------
-- Uma linha (tipo, nome, pode_evoluir) ou nenhuma (sem acesso ao app):
--   terapeuta → role 'terapeuta', ativo, ligado a profissional ativo;
--   gestao    → role 'admin' (evolui) ou 'diretoria' (só consulta — mesma regra
--               da Grade web: nem diretoria evolui).
-- `pode_evoluir` descreve o papel; quem barra de fato são as RPCs da Grade
-- (sp_grade_pode_evoluir), que se abrem ao terapeuta na Fase 2.
CREATE OR REPLACE FUNCTION public.app_meu_perfil()
RETURNS TABLE (tipo text, nome text, pode_evoluir boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE WHEN u.role = 'terapeuta' THEN 'terapeuta' ELSE 'gestao' END,
    COALESCE(
      NULLIF(btrim(CASE WHEN u.role = 'terapeuta' THEN p.nome ELSE u.nome END), ''),
      NULLIF(btrim(u.nome), ''),
      ''
    ),
    u.role IN ('terapeuta', 'admin')
  FROM public.usuarios u
  LEFT JOIN public.profissionais p ON p.id = u.profissional_id
  WHERE u.id = auth.uid()
    AND COALESCE(u.ativo, false)
    AND (
      u.role IN ('admin', 'diretoria')
      OR (u.role = 'terapeuta' AND COALESCE(p.ativo, false))
    )
$$;

REVOKE ALL ON FUNCTION public.app_meu_perfil() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_meu_perfil() TO authenticated;

COMMENT ON FUNCTION public.app_meu_perfil() IS
  'App de evoluções: perfil da pessoa logada (terapeuta | gestao; responsavel na Fase 3). Nenhuma linha = sem acesso ao app.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261019200000', 'papel_terapeuta_app')
on conflict (version) do nothing;

commit;

-- Conferência
select (select pg_get_constraintdef(oid) from pg_constraint where conname = 'usuarios_role_check') like '%''terapeuta''%' as constraint_ok,
       exists (select 1 from public.grupos_permissoes where nome = 'Terapeuta (App)' and nivel_tecnico = 'terapeuta') as grupo_ok,
       pg_get_functiondef('public.sincronizar_nivel_pelos_grupos(uuid)'::regprocedure) like '%''terapeuta'',''disponibilidade_terapeuta''%' as prioridade_ok,
       exists (select 1 from pg_indexes where indexname = 'uq_usuarios_profissional_id') as indice_ok,
       has_function_privilege('authenticated', 'public.app_meu_perfil()', 'EXECUTE') and not has_function_privilege('anon', 'public.app_meu_perfil()', 'EXECUTE') as perfil_ok,
       exists (select 1 from supabase_migrations.schema_migrations where version = '20261019200000') as registrada;
