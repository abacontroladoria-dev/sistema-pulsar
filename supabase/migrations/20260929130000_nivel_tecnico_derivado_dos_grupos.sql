-- Nível técnico (usuarios.role) passa a ser mantido pelo banco a partir dos
-- grupos de permissão — pedido do usuário (29/09/2026): "o ideal é que apenas
-- 'grupos de permissão' bastasse"; o nível "fique somente no pano de fundo".
--
-- Por que o nível não some: ~200 policies de RLS, RPCs e as rotas de /admin
-- comparam usuarios.role literalmente (is_admin, is_diretoria,
-- remuneracao_has_role, usuario_tem_permissao…). Sem quem o mantenha, ele fica
-- velho em silêncio — foi o caso da Juliana, no grupo Diretoria e com nível
-- terapeutico no banco.
--
-- Como fica:
--   * cada grupo "de setor" carrega o nível que dá (grupos_permissoes.nivel_tecnico);
--     grupos sem nível (Financeiro, Suprimentos, Apoio Operacional…) só dão telas;
--   * ao entrar/sair de um grupo, o nível da pessoa vira o de MAIOR prioridade
--     entre os grupos com nível dela; saindo de todos, o nível atual fica;
--   * o nível `admin` só entra ou sai por aqui se QUEM mexeu é admin — senão
--     alguém da diretoria (que edita grupos, RLS is_diretoria) se promoveria
--     entrando no grupo Administrador. E nunca remove o último admin ativo.
--
-- Prioridade medida contra o banco de 29/09/2026: com esta ordem, o nível
-- calculado bate com o atual para as 36 pessoas — ninguém muda de nível com
-- esta migration, só quando alguém mexer em grupo dali em diante.
--
-- Idempotente.

-- 1. Coluna e níveis dos grupos existentes ----------------------------------
ALTER TABLE public.grupos_permissoes ADD COLUMN IF NOT EXISTS nivel_tecnico text;

UPDATE public.grupos_permissoes g
SET nivel_tecnico = v.nivel
FROM (VALUES
  ('Administrador', 'admin'),
  ('Diretoria', 'diretoria'),
  ('Recepção', 'recepcao'),
  ('Autorização', 'autorizacao'),
  ('Terapêutico', 'terapeutico'),
  ('Faturamento', 'faturamento'),
  ('RP', 'rp'),
  ('Cronograma', 'cronograma'),
  ('Marketing', 'marketing'),
  -- Especialistas (Amanda, Gracielle) são terapeutas.
  ('Especialista Téc. ABA', 'terapeutico')
) AS v(nome, nivel)
WHERE g.nome = v.nome AND g.nivel_tecnico IS DISTINCT FROM v.nivel;

-- Grupo para contas do fluxo /disponibilidade-terapeuta: sem ele, com o nível
-- fora da tela, não haveria como criar esse tipo de conta. Modelo vazio — essa
-- conta não usa o dashboard (app/(dashboard)/layout.tsx a manda embora).
INSERT INTO public.grupos_permissoes (nome, descricao, nivel_tecnico)
VALUES ('Disponibilidade Terapeuta',
        'Contas do formulário de disponibilidade do terapeuta — fora do dashboard',
        'disponibilidade_terapeuta')
ON CONFLICT (nome) DO NOTHING;

-- 2. Cálculo do nível ----------------------------------------------------------
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

  -- Maior prioridade primeiro. A ordem reproduz os níveis atuais de quem está
  -- em mais de um grupo com nível: Juliana (Diretoria + Terapêutico →
  -- diretoria), Victoria (Cronograma + Autorização → cronograma), Pâmela
  -- (Autorização + Faturamento → autorizacao).
  SELECT g.nivel_tecnico INTO v_novo
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  WHERE m.usuario_id = p_usuario_id
    AND g.nivel_tecnico IS NOT NULL
    AND (g.nivel_tecnico <> 'admin' OR v_ator_admin)
  ORDER BY array_position(
    ARRAY['admin','diretoria','cronograma','autorizacao','rp','faturamento',
          'terapeutico','recepcao','marketing','disponibilidade_terapeuta'],
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

-- SECURITY DEFINER nasce com EXECUTE para PUBLIC: fecha. Só os gatilhos abaixo
-- chamam (e gatilho roda com os privilégios do dono, não precisa de grant).
REVOKE ALL ON FUNCTION public.sincronizar_nivel_pelos_grupos(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Gatilhos ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_membro_grupo_sincroniza_nivel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sincronizar_nivel_pelos_grupos(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.usuario_id ELSE NEW.usuario_id END
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_membro_grupo_sincroniza_nivel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_membro_grupo_sincroniza_nivel ON public.grupos_permissoes_membros;
CREATE TRIGGER trg_membro_grupo_sincroniza_nivel
AFTER INSERT OR DELETE ON public.grupos_permissoes_membros
FOR EACH ROW EXECUTE FUNCTION public.trg_membro_grupo_sincroniza_nivel();

-- Mudar o nível de um grupo realinha os membros dele.
CREATE OR REPLACE FUNCTION public.trg_grupo_nivel_sincroniza_membros()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT usuario_id FROM public.grupos_permissoes_membros WHERE grupo_id = NEW.id LOOP
    PERFORM public.sincronizar_nivel_pelos_grupos(r.usuario_id);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_grupo_nivel_sincroniza_membros() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_grupo_nivel_sincroniza_membros ON public.grupos_permissoes;
CREATE TRIGGER trg_grupo_nivel_sincroniza_membros
AFTER UPDATE OF nivel_tecnico ON public.grupos_permissoes
FOR EACH ROW
WHEN (OLD.nivel_tecnico IS DISTINCT FROM NEW.nivel_tecnico)
EXECUTE FUNCTION public.trg_grupo_nivel_sincroniza_membros();

-- Conferência: nível que o banco calcularia × nível atual. Esperado: 0 linhas
-- (ninguém muda de nível por causa desta migration).
SELECT u.nome, u.role AS atual, x.calculado
FROM public.usuarios u
JOIN LATERAL (
  SELECT g.nivel_tecnico AS calculado
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  WHERE m.usuario_id = u.id AND g.nivel_tecnico IS NOT NULL
  ORDER BY array_position(
    ARRAY['admin','diretoria','cronograma','autorizacao','rp','faturamento',
          'terapeutico','recepcao','marketing','disponibilidade_terapeuta'],
    g.nivel_tecnico)
  LIMIT 1
) x ON true
WHERE x.calculado IS DISTINCT FROM u.role
ORDER BY u.nome;
