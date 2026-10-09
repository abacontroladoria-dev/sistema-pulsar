-- Status Contratos: libera o código `status_contratos` nos MODELOS dos grupos.
--
-- ORDEM (por isso a trava abaixo):
--   1. migration 20261008150600_catalogo_permissoes_espelha_sidebar.sql
--      (cadastra o código em public.permissoes — sem ele o "Aplicar" falha na FK
--      de usuarios_permissoes);
--   2. migration 20261008160000_pacientes_contratos.sql;
--   3. ESTE snippet, depois de conferir a lista de grupos abaixo;
--   4. /admin/permissoes → "Por grupo" → "Aplicar" em cada grupo alterado. O
--      snippet só mexe no MODELO; quem grava a permissão das pessoas é o
--      "Aplicar" (grupos são aditivos — a união é materializada lá).
--
-- Grupos que recebem a tela (sugestão do plano — confira antes de liberar):
--   Recepção, RP, Diretoria, Administrador → liberado
--   os demais → desmarcado (o código entra explícito como false)
-- Admin e diretoria já leem pelo papel (usuario_tem_permissao); o modelo é para
-- a tela /admin/permissoes mostrar o estado certo.
--
-- `novo || modelo`: se algum grupo já decidiu o código (ex.: alguém marcou na
-- tela antes), a decisão dele vence. Idempotente.

do $$
begin
  -- TRAVA: troque false por true depois de aplicar as duas migrations acima.
  if not false then
    raise exception 'Trava: aplique antes 20261008150600 e 20261008160000, confira a lista de grupos e troque false por true nesta linha.';
  end if;
  if not exists (select 1 from public.permissoes where codigo = 'status_contratos') then
    raise exception 'O código status_contratos ainda não está em public.permissoes — aplique 20261008150600 primeiro.';
  end if;
end $$;

begin;

update public.grupos_permissoes
   set modelo_permissoes = '{"status_contratos":true}'::jsonb || modelo_permissoes,
       updated_at = now()
 where nome in ('Recepção', 'RP', 'Diretoria', 'Administrador');

update public.grupos_permissoes
   set modelo_permissoes = '{"status_contratos":false}'::jsonb || modelo_permissoes,
       updated_at = now()
 where nome not in ('Recepção', 'RP', 'Diretoria', 'Administrador');

commit;

-- CONFERÊNCIA — ESPERADO: Recepção, RP, Diretoria e Administrador = true; o resto = false.
select nome, modelo_permissoes -> 'status_contratos' as status_contratos
  from public.grupos_permissoes
 order by nome;
