-- Busca mestre (Ctrl+K no Sidebar) — 22/10/2026.
--
-- Uma chamada devolve pacientes, profissionais, convênios e terapias cujo nome
-- bate com o termo. As telas do menu a busca acha no navegador, sem passar aqui.
--
-- Regra de ouro: cada pessoa só acha o que está liberado para ela. Cada categoria
-- só é consultada se a pessoa tem o código da tela do cadastro correspondente —
-- quem não tem não recebe NENHUMA linha daquela categoria, não é só a tela que
-- esconde.
--
-- A checagem é a MESMA do menu e do proxy (frontend/lib/permissions/resolver.ts):
-- `admin` acessa tudo; os demais, os códigos de permissoes_efetivas(). Não usa
-- usuario_tem_permissao() de propósito: ela também libera tudo para
-- `diretoria`, e o menu não — a busca mostraria a quem é da diretoria cadastros
-- que o menu dela esconde.
--
-- Independe da 20261019180100 (leitura restrita de pacientes, ainda com a trava):
-- a função é SECURITY DEFINER e faz a própria checagem, então devolve o mesmo
-- com a policy de pacientes aberta ou fechada.
--
-- Devolve só o necessário para a lista (categoria, id, título, subtítulo,
-- inativo). Nada de CPF, celular ou dado clínico.

create or replace function public.busca_mestre(p_termo text)
returns table (categoria text, id bigint, titulo text, subtitulo text, inativo boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- normalizar_nome_paciente troca pontuação por espaço: `%` e `_` do termo
  -- viram espaço e não funcionam como curinga no LIKE. O btrim é porque ela não
  -- corta as pontas: "laura " viraria '%laura %' e não acharia "Ana Laura".
  v_termo   text := nullif(btrim(public.normalizar_nome_paciente(left(coalesce(p_termo, ''), 80))), '');
  v_digitos text := regexp_replace(coalesce(p_termo, ''), '\D', '', 'g');
  v_like    text;
  v_admin   boolean;
  v_codigos text[] := array[]::text[];
begin
  if v_termo is null or length(v_termo) < 3 then
    return;
  end if;

  -- Sem login ou usuário inativo: nada.
  select u.role = 'admin' into v_admin
  from public.usuarios u
  where u.id = auth.uid() and u.ativo;
  if not found then
    return;
  end if;
  if not v_admin then
    v_codigos := public.permissoes_efetivas();
  end if;

  v_like := '%' || v_termo || '%';

  if v_admin or 'cadastros_pacientes' = any(v_codigos) then
    return query
      select 'paciente'::text, p.id_paciente::bigint, p.nome::text,
             concat_ws(' · ', 'Matr. ' || public.matricula_formatada(p.matricula), nullif(btrim(p.convenio_nome), '')),
             not p.ativo
      from public.pacientes p
      where not p.ficticio
        and (
          p.nome_normalizado like v_like
          or public.normalizar_nome_paciente(p.nome_civil) like v_like
          -- matrícula: só quando o termo é número ("00115" ou "115")
          or (v_digitos = v_termo
              and (public.matricula_formatada(p.matricula) like v_digitos || '%'
                   or p.matricula::text like nullif(ltrim(v_digitos, '0'), '') || '%'))
        )
      order by p.ativo desc, (p.nome_normalizado like v_termo || '%') desc, p.nome
      limit 6;
  end if;

  if v_admin or 'cadastros_profissionais' = any(v_codigos) then
    return query
      select 'profissional'::text, pr.id::bigint, pr.nome::text,
             concat_ws(' · ', t.nome,
                       nullif(concat_ws(' · ', nullif(concat_ws(' ', pr.tipo_registro, pr.codigo_registro), ''), pr.uf_registro), '')),
             not pr.ativo
      from public.profissionais pr
      left join public.cadastro_terapias t on t.id = pr.terapia_focal_id
      where public.normalizar_nome_paciente(pr.nome) like v_like
         or public.normalizar_nome_paciente(pr.codigo_registro) like v_like
      order by pr.ativo desc, (public.normalizar_nome_paciente(pr.nome) like v_termo || '%') desc, pr.nome
      limit 6;
  end if;

  if v_admin or 'cadastros_convenios' = any(v_codigos) then
    return query
      select 'convenio'::text, c.id::bigint, c.nome::text,
             (select case count(*) when 0 then null when 1 then '1 plano de saúde'
                     else count(*) || ' planos de saúde' end
              from public.planos_saude ps where ps.convenio_id = c.id and ps.ativo),
             not c.ativo
      from public.convenios c
      where public.normalizar_nome_paciente(c.nome) like v_like
      order by c.ativo desc, c.nome
      limit 6;
  end if;

  if v_admin or 'cadastros_terapias' = any(v_codigos) then
    return query
      select 'terapia'::text, t.id::bigint, t.nome::text,
             case t.tipo when 'procedimento' then 'Procedimento' else 'Terapia' end,
             not t.ativo
      from public.cadastro_terapias t
      where public.normalizar_nome_paciente(t.nome) like v_like
      order by t.ativo desc, t.nome
      limit 6;
  end if;
end;
$$;

comment on function public.busca_mestre(text) is
  'Busca mestre do Sidebar: pacientes, profissionais, convênios e terapias pelo nome (≥3 letras, até 6 por categoria). '
  'Cada categoria só para quem tem o código da tela do cadastro (admin: todas) — mesma regra do menu, não a de usuario_tem_permissao.';

-- SECURITY DEFINER nasce com EXECUTE para PUBLIC.
revoke all on function public.busca_mestre(text) from public, anon;
grant execute on function public.busca_mestre(text) to authenticated;
