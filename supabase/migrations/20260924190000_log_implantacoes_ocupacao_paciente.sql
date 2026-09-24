-- Pedido do usuário (2026-09-24): log confiável de quem implantou o quê na TiTa
-- por /cronograma/ocupacao-paciente.
--
-- Até aqui nenhuma das três fontes servia:
--   - inclusoes_terapia é a fila de cards do ClickUp (1 linha por pacote, só
--     grava com inclusoes_terapia_config.ativo = true);
--   - esta tabela só tinha as 61 implantações escritas à mão em 20260818180000
--     e, depois disso, apenas observações (terapia nula por desenho);
--   - acomp_pac_bundles é o ESTADO da tela: perde linhas (sessão removida,
--     bundle cancelado, navegador desatualizado apagando o que não conhece).
--
-- Daqui pra frente esta tabela é o log, com três escritores:
--   origem 'servidor' → /api/tita/confirmar-agendamento, toda tentativa na TiTa
--                        (aceita, parcial, conflito, falha), gravada com service_role;
--   origem 'banco'    → trigger em acomp_pac_bundles: remoções, exclusões,
--                        removido_tita e confirmação manual em lote;
--   origem 'tela'     → observações (pacienteObservacoes.service.ts).
--
-- Continua sem criado_em (removido a pedido em 20260818190000): data/hora em
-- texto, horário de Brasília, seguem sendo o carimbo.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ===== 1. Colunas novas =====
alter table public.aumentar_ocupacao_paciente_auditoria
  add column if not exists tipo text,
  add column if not exists origem text,
  add column if not exists modalidade text,
  add column if not exists detalhe text,
  add column if not exists csv_grade_id text,
  add column if not exists id_agenda_fav bigint,
  add column if not exists criadas integer,
  add column if not exists conflitos integer,
  add column if not exists bundle_id text;

-- ===== 2. Classificar as linhas que já existem =====
-- A tabela tem FORCE RLS e nenhuma policy de UPDATE; tirar o FORCE só durante
-- este UPDATE deixa o dono (quem roda a migration) passar, sem abrir nada para
-- authenticated/anon. Só toca linhas ainda sem tipo, então rodar de novo não muda nada.
alter table public.aumentar_ocupacao_paciente_auditoria no force row level security;

update public.aumentar_ocupacao_paciente_auditoria
set tipo   = case when terapia is not null then 'implantacao' else 'observacao' end,
    origem = case when terapia is not null then 'backfill_2026-08-18' else 'tela' end
where tipo is null;

alter table public.aumentar_ocupacao_paciente_auditoria force row level security;

-- ===== 3. Checks de acao / tipo =====
-- O check antigo de acao (criar/editar/excluir) nasceu inline em 20260818170000,
-- com nome gerado pelo Postgres; por isso é achado em pg_constraint, não por nome.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.aumentar_ocupacao_paciente_auditoria'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%acao%' or pg_get_constraintdef(oid) ilike '%tipo%')
  loop
    execute format('alter table public.aumentar_ocupacao_paciente_auditoria drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.aumentar_ocupacao_paciente_auditoria
  add constraint aumentar_ocupacao_paciente_auditoria_acao_check check (
    acao is null or acao in (
      -- observação
      'criar', 'editar', 'excluir',
      -- implantação: tentativa na TiTa (origem servidor)
      'implantada', 'implantada_parcial', 'falha_conflito', 'falha_api',
      'falha_preparacao', 'falha_disponibilidade', 'cancelada',
      -- implantação: ciclo de vida do bundle (origem banco / backfill)
      'confirmado_manual', 'removido_tita', 'status_alterado',
      'sessao_removida', 'bundle_excluido'
    )
  );

-- tipo fica anulável: observações gravadas por um navegador com o JS antigo,
-- entre esta migration e o deploy, chegam sem tipo. Nenhum escritor de
-- implantação deixa tipo nulo, então `where tipo = 'implantacao'` é exato.
alter table public.aumentar_ocupacao_paciente_auditoria
  add constraint aumentar_ocupacao_paciente_auditoria_tipo_check check (
    tipo is null or tipo in ('implantacao', 'observacao')
  );

-- ===== 4. Quem a trigger usa para gravar =====
-- A função da trigger é SECURITY DEFINER (roda como o dono, postgres). Com
-- FORCE RLS o dono também passa pela RLS, então sem uma policy para ele o
-- insert seria filtrado em silêncio. Vale só para postgres, que já administra
-- o banco; authenticated/anon continuam como estavam.
drop policy if exists "aumentar_ocupacao_paciente_auditoria_insert_postgres" on public.aumentar_ocupacao_paciente_auditoria;
create policy "aumentar_ocupacao_paciente_auditoria_insert_postgres" on public.aumentar_ocupacao_paciente_auditoria
  for insert to postgres
  with check (true);

-- ===== 5. Trigger de ciclo de vida em acomp_pac_bundles =====
-- Só olha bundles que estavam ou ficaram confirmado/removido_tita: pendente é
-- proposta, não implantação. INSERT fica de fora de propósito — a implantação
-- é registrada pela rota do servidor com o resultado real da TiTa.
create or replace function public.fn_log_acomp_pac_bundles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_nome     text;
  v_email    text;
  v_agora    timestamp := now() at time zone 'America/Sao_Paulo';
  v_data     text := to_char(v_agora, 'DD/MM/YYYY');
  v_hora     text := to_char(v_agora, 'HH24:MI:SS');
  v_acao     text;
  v_detalhe  text;
  v_implantados constant text[] := array['confirmado', 'removido_tita'];
begin
  if v_uid is not null then
    select coalesce(us.nome, pf.nome), us.email
      into v_nome, v_email
    from (select v_uid as id) u
    left join public.usuarios us on us.id = u.id
    left join public.perfis   pf on pf.id = u.id;
  end if;
  v_email := coalesce(v_email, auth.jwt() ->> 'email');
  v_nome  := coalesce(v_nome, v_email, '(sistema)');

  if tg_op = 'DELETE' then
    if old.status = any (v_implantados) then
      insert into public.aumentar_ocupacao_paciente_auditoria
        (data, hora, usuario, email, usuario_id, paciente, terapia, profissional,
         dia_sessao, hora_sessao, status, acao, detalhe, tipo, origem, csv_grade_id, bundle_id)
      select v_data, v_hora, v_nome, v_email, v_uid, old.pac, s->>'tP', s->>'prof',
             s->>'dia', s->>'hora', old.status, 'bundle_excluido',
             'bundle apagado (status era ' || old.status || ')',
             'implantacao', 'banco', nullif(s->>'csvGradeId', ''), old.id
      from jsonb_array_elements(coalesce(old.dados->'sessoes', '[]'::jsonb)) s;
    end if;
    return null;
  end if;

  -- UPDATE: mudança de status
  if old.status is distinct from new.status
     and (old.status = any (v_implantados) or new.status = any (v_implantados)) then

    if new.status = 'confirmado' and old.status = 'pendente' then
      -- implantadoPor aparecendo agora = veio da implantação real, que a rota já registrou.
      if (new.dados->>'implantadoPor') is not null
         and (new.dados->>'implantadoPor') is distinct from (old.dados->>'implantadoPor') then
        v_acao := null;
      else
        v_acao := 'confirmado_manual';
        v_detalhe := 'marcado confirmado sem passar pela TiTa (de pendente para confirmado)';
      end if;
    elsif new.status = 'removido_tita' then
      v_acao := 'removido_tita';
      v_detalhe := 'automático (reconciliação com a grade), de ' || coalesce(old.status, '?') || ' para removido_tita';
    else
      v_acao := 'status_alterado';
      v_detalhe := 'de ' || coalesce(old.status, '?') || ' para ' || coalesce(new.status, '?');
    end if;

    if v_acao is not null then
      insert into public.aumentar_ocupacao_paciente_auditoria
        (data, hora, usuario, email, usuario_id, paciente, terapia, profissional,
         dia_sessao, hora_sessao, status, acao, detalhe, tipo, origem, csv_grade_id, bundle_id)
      select v_data, v_hora, v_nome, v_email, v_uid, new.pac, s->>'tP', s->>'prof',
             s->>'dia', s->>'hora', new.status, v_acao, v_detalhe,
             'implantacao', 'banco', nullif(s->>'csvGradeId', ''), new.id
      from jsonb_array_elements(coalesce(new.dados->'sessoes', '[]'::jsonb)) s;
    end if;
  end if;

  -- UPDATE: sessões que saíram de um bundle implantado
  if old.status = any (v_implantados) then
    insert into public.aumentar_ocupacao_paciente_auditoria
      (data, hora, usuario, email, usuario_id, paciente, terapia, profissional,
       dia_sessao, hora_sessao, status, acao, detalhe, tipo, origem, csv_grade_id, bundle_id)
    select v_data, v_hora, v_nome, v_email, v_uid, old.pac, o->>'tP', o->>'prof',
           o->>'dia', o->>'hora', new.status, 'sessao_removida',
           'sessão retirada do bundle (status era ' || old.status || ')',
           'implantacao', 'banco', nullif(o->>'csvGradeId', ''), old.id
    from jsonb_array_elements(coalesce(old.dados->'sessoes', '[]'::jsonb)) o
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(new.dados->'sessoes', '[]'::jsonb)) n
      where coalesce(nullif(n->>'csvGradeId', ''), concat_ws('|', n->>'dia', n->>'hora', n->>'tP', n->>'prof'))
          = coalesce(nullif(o->>'csvGradeId', ''), concat_ws('|', o->>'dia', o->>'hora', o->>'tP', o->>'prof'))
    );
  end if;

  return null;
exception when others then
  -- Log não pode desfazer a ação do usuário na tela.
  raise warning 'fn_log_acomp_pac_bundles: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

revoke all on function public.fn_log_acomp_pac_bundles() from public, anon, authenticated;

drop trigger if exists trg_log_acomp_pac_bundles on public.acomp_pac_bundles;
create trigger trg_log_acomp_pac_bundles
  after update or delete on public.acomp_pac_bundles
  for each row execute function public.fn_log_acomp_pac_bundles();

comment on table public.aumentar_ocupacao_paciente_auditoria is
  'Log de /cronograma/ocupacao-paciente: implantações na TiTa (tipo=implantacao; origem servidor/banco/backfill) + observações (tipo=observacao). Imutável: sem policy de UPDATE/DELETE. Ver 20260924190000.';
