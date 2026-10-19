-- REVERTE 20261019200000_papel_terapeuta_app. Só funciona enquanto ninguém
-- estiver com role 'terapeuta' (a constraint antiga recusaria a linha): tire as
-- pessoas do grupo "Terapeuta (App)" antes. sincronizar_nivel_pelos_grupos volta
-- exatamente como estava em produção em 19/10/2026 (pg_get_functiondef).
begin;
set local lock_timeout = '5s';

drop function if exists public.app_meu_perfil();

create index if not exists idx_usuarios_profissional_id
  on public.usuarios (profissional_id) where profissional_id is not null;
drop index if exists public.uq_usuarios_profissional_id;

CREATE OR REPLACE FUNCTION public.sincronizar_nivel_pelos_grupos(p_usuario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          'terapeutico','recepcao','comercial','marketing','disponibilidade_terapeuta'],
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
$function$;

delete from public.grupos_permissoes g
 where g.nome = 'Terapeuta (App)'
   and not exists (select 1 from public.grupos_permissoes_membros m where m.grupo_id = g.id);

DO $$
DECLARE
  allowed text[] := ARRAY['admin','diretoria','recepcao','autorizacao','terapeutico',
    'faturamento','rp','cronograma','disponibilidade_terapeuta','marketing','comercial'];
BEGIN
  ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check;
  EXECUTE format('ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ',') FROM unnest(allowed) AS r));
END $$;

delete from supabase_migrations.schema_migrations where version = '20261019200000';

commit;

select not exists (select 1 from pg_proc where proname = 'app_meu_perfil') as perfil_removido,
       not exists (select 1 from public.grupos_permissoes where nome = 'Terapeuta (App)') as grupo_removido;
