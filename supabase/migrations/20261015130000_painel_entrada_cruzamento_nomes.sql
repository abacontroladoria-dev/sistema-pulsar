-- =============================================================================
-- Painel de Entrada de Pacientes: cruzamento de nomes mais tolerante
-- =============================================================================
-- Medido em 15/10/2026 com a rodada de 13/10 (40 nomes em andamento): 28 casavam
-- com o cadastro e 12 não. Dos 12, 4 eram só o sufixo "(ABA)"/"(Neuro)" (dois
-- pacientes com dois processos, nome idêntico ao do cadastro sem o sufixo), 1 era
-- nome incompleto no ClickUp (começo do nome do cadastro) e 7 são pacientes novos
-- que ainda não estão no cadastro (esses continuam "sem_cadastro", e está certo).
--
-- Só redefine painel_entrada_convenio_atual(): mesmos grants (CREATE OR REPLACE
-- preserva), search_path dentro do CREATE. Novo campo "casamento" em cada item de
-- disponibilidade: 'exato' ou 'inicio_do_nome' (a tela pede para conferir).
-- Formato do painel.json da Ana Carolina: inalterado.
-- =============================================================================

create or replace function public.painel_entrada_convenio_atual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _snap    public.painel_entrada_convenio_snapshots%rowtype;
  _leitura public.painel_entrada_convenio_leituras%rowtype;
  _disp    jsonb := '[]'::jsonb;
  _atras   integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.usuario_tem_permissao('indicadores_entrada_convenio') then
    raise exception 'sem permissão para o Painel de Entrada de Pacientes'
      using errcode = '42501';
  end if;

  select * into _leitura
    from public.painel_entrada_convenio_leituras
   order by lido_em desc, id desc
   limit 1;

  select * into _snap
    from public.painel_entrada_convenio_snapshots
   order by gerado_em desc, lido_em desc, id desc
   limit 1;

  if _snap.id is null then
    return jsonb_build_object(
      'snapshot', null,
      'ultima_leitura', case when _leitura.id is null then null else jsonb_build_object(
        'lido_em', _leitura.lido_em, 'status', _leitura.status, 'erro', _leitura.erro) end,
      'disponibilidade', '[]'::jsonb);
  end if;

  _atras := public.painel_entrada_convenio_dias_uteis_atras(_snap.gerado_em);

  with nomes as (
    -- chave = o nome sem o sufixo entre parênteses no fim, como "(ABA)" ou
    -- "(Neuro)", que a rotina do ClickUp põe quando o mesmo paciente tem dois
    -- processos. Quem aparece nas duas linhas é a mesma pessoa no cadastro.
    select distinct p->>'paciente' as nome,
           public.normalizar_nome_paciente(
             regexp_replace(p->>'paciente', '\s*\([^)]*\)\s*$', '')) as chave
      from jsonb_array_elements(_snap.dados->'pacientes') p
     where coalesce(p->>'paciente', '') <> ''
       and coalesce(p->>'situacao', '') <> 'encerrado'
  ),
  exatos as (
    select n.nome, n.chave,
           array_agg(pa.id_paciente order by pa.id_paciente) filter (where pa.id_paciente is not null) as ids
      from nomes n
      left join public.pacientes pa
        on pa.nome_normalizado = n.chave
       and pa.ativo
       and not pa.ficticio
     group by n.nome, n.chave
  ),
  -- Só para quem não casou por inteiro: o nome do ClickUp é o COMEÇO do nome do
  -- cadastro ("Maria Estela de Albuquerque" x "Maria Estela de Albuquerque
  -- Povoleri Marins França"). Exige 3 palavras ou mais, para "Ana Maria" não
  -- casar com meio cadastro. Se mais de um paciente combinar, vira nome_ambiguo.
  aprox as (
    select e.nome,
           array_agg(pa.id_paciente order by pa.id_paciente) as ids
      from exatos e
      join public.pacientes pa
        on pa.nome_normalizado like e.chave || ' %'
       and pa.ativo
       and not pa.ficticio
     where (e.ids is null or cardinality(e.ids) = 0)
       and coalesce(array_length(string_to_array(e.chave, ' '), 1), 0) >= 3
     group by e.nome
  ),
  casados as (
    select e.nome,
           case when e.ids is not null and cardinality(e.ids) > 0 then e.ids else a.ids end as ids,
           case when e.ids is not null and cardinality(e.ids) > 0 then 'exato'
                when a.ids is not null then 'inicio_do_nome'
           end as casamento
      from exatos e
      left join aprox a on a.nome = e.nome
  ),
  unico as (
    select c.nome, c.ids, c.casamento, c.ids[1] as id
      from casados c
  ),
  ultima as (
    select distinct on (v.paciente_id) v.paciente_id, v.origem, v.criado_em
      from public.pacientes_disponibilidade_versoes v
     where v.paciente_id in (select u.id from unico u where cardinality(u.ids) = 1)
     order by v.paciente_id, v.numero_versao desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', u.nome,
           'paciente_id', case when cardinality(u.ids) = 1 then u.id end,
           'estado', case
              when u.ids is null or cardinality(u.ids) = 0 then 'sem_cadastro'
              when cardinality(u.ids) > 1 then 'nome_ambiguo'
              when ul.paciente_id is not null and ul.origem = 'formulario' then 'preenchida_familia'
              when ul.paciente_id is not null then 'preenchida_equipe'
              when length(regexp_replace(coalesce(pa.cpf, ''), '\D', '', 'g')) <> 11 then 'sem_cpf'
              else 'nao_preenchida'
            end,
           'casamento', u.casamento,
           'preenchida_em', ul.criado_em)), '[]'::jsonb)
    into _disp
    from unico u
    left join public.pacientes pa on pa.id_paciente = u.id and cardinality(u.ids) = 1
    left join ultima ul on ul.paciente_id = u.id and cardinality(u.ids) = 1;

  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'id', _snap.id,
      'gerado_em', _snap.gerado_em,
      'publicado_em', _snap.publicado_em,
      'lido_em', _snap.lido_em,
      'versao_fluxo', _snap.versao_fluxo,
      'dados', _snap.dados),
    'dias_uteis_atras', _atras,
    'desatualizado', _atras > 1,
    'ultima_leitura', case when _leitura.id is null then null else jsonb_build_object(
      'lido_em', _leitura.lido_em, 'status', _leitura.status, 'erro', _leitura.erro) end,
    'disponibilidade', _disp);
end;
$$;

comment on function public.painel_entrada_convenio_atual() is
  'Tela do Painel de Entrada de Pacientes: última rodada, frescor e selo de disponibilidade. Só service_role (a rota confere indicadores_entrada_convenio). Cruza nome sem sufixo (ABA)/(Neuro) e, se não casar, pelo começo do nome do cadastro (3+ palavras, único).';
