-- Adiciona o setor (role) 'marketing'.
--
-- O marketing entra no sistema por UMA tela: /tv-avisos, o carrossel de cartazes
-- da TV da recepção (20260831150000). É o primeiro setor cujo trabalho não toca
-- em nenhum dado de paciente, e é justamente por isso que ele precisa de papel
-- próprio: pendurá-lo em `recepcao` para "resolver o acesso" daria a quem troca
-- um cartaz de parede a fila de autorizações inteira.
--
-- Mesma abordagem dinâmica de 20260616000003_add_role_cronograma: inclui os
-- papéis esperados MAIS os já presentes na tabela, para o constraint não falhar
-- por causa de um valor que entrou no banco sem passar por migration.

DO $$
DECLARE
  allowed     text[] := ARRAY[
    'admin','diretoria','recepcao','autorizacao','terapeutico',
    'faturamento','rp','cronograma','disponibilidade_terapeuta','marketing'
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

  RAISE NOTICE 'Constraint usuarios_role_check criado com roles: %', array_to_string(allowed, ', ');
END;
$$;
