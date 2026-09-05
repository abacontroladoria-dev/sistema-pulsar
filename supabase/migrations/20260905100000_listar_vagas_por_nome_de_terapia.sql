-- ============================================================================
-- listar_vagas_disponiveis ganha p_terapia_nomes: o filtro de especialidade
-- passa a cair sobre o NOME, porque o id não identifica a terapia
--
-- O QUE FOI MEDIDO (05/09/2026, produção, janela de 30 dias)
--
-- `terapia_id` NÃO identifica a terapia. O id 2317 aparece com SETE
-- `terapia_nome` diferentes, e 2260 com três:
--
--   2317  'Aplicador ABA (PS)'                                     135 vagas
--   2317  'Aplicador ABA (PS), Coordenador de Caso'                 13
--   2317  'Aplicador ABA (PS), Coordenador de Caso, Psicopedagogia' 21
--   2317  'Aplicador ABA (PS), Psicologia'                          12
--   2317  'Aplicador ABA (PS), Psicologia ABA'                      21
--   2317  'Aplicador ABA (PS), Psicopedagogia'                      11
--   2317  'Aplicador ABA (PS), Supervisão ABA'                       5
--   2259  'Psicologia'                                              61
--
-- `terapia_nome` é a LISTA do que aquele profissional atende naquele horário,
-- não a terapia da vaga. Então filtrar por id erra nos DOIS sentidos:
--
--   p_terapia_id = 2317  traz as 135 vagas de quem só aplica ABA junto com as
--                        12 de psicologia — profissionais que não atendem o que
--                        o responsável pediu.
--   p_terapia_id = 2259  esconde essas mesmas 12 vagas de psicologia, que vivem
--                        sob 2317 e nunca aparecem para quem pede 2259.
--
-- Nenhum id resolve isso, porque a informação não está no id.
--
-- E HÁ DUAS LÍNGUAS PARA A MESMA TERAPIA
--
-- O TiTa grava o nome da AÇÃO na escala ('Aplicador ABA (PS)'); o laudo que o
-- responsável tem em mãos diz 'Psicologia ABA'. Ninguém escreve "aplicador" no
-- WhatsApp. São 218 vagas que ficavam inalcançáveis para quem as procurava pelo
-- nome que tem em mãos — e o agente respondia que não havia.
--
-- 'Psicologia' e 'Psicologia ABA' são terapias DIFERENTES, com TUSS diferente.
-- O de-para de nomes vive em frontend/modules/atendimento/agente/terapia.ts,
-- que traduz o nome do laudo para os textos que casam na grade e manda a lista
-- pronta em p_terapia_nomes. Ele fica lá, e não aqui, porque é vocabulário de
-- ATENDIMENTO (o que se oferece, como se chama) e muda com a clínica, não com o
-- schema.
--
-- COMO O CASAMENTO FUNCIONA
--
-- p_terapia_nomes é um array dos textos que a grade usa. A vaga casa quando
-- QUALQUER um deles é uma das partes de `terapia_nome` separadas por vírgula.
--
-- Igualdade de parte, não ILIKE '%...%', e isso não é preciosismo:
--   - 'Arteterapia (Psicologia ABA)' é arteterapia feita dentro do ABA. Com
--     substring ela seria contada como Psicologia ABA — terapia errada.
--   - 'Aplicador ABA (PS)' e 'Aplicador ABA (SF)' são ações diferentes (180
--     vagas na segunda). Com substring de 'Aplicador ABA' viravam a mesma.
--
-- O unaccent/lower vive no TypeScript (chaveTerapia), e o que chega aqui já são
-- os literais exatos da grade — por isso a comparação aqui é crua e barata.
--
-- p_terapia_id CONTINUA EXISTINDO e não muda de comportamento: a tela de
-- Agendamentos o usa, e ali o operador escolhe de uma lista, não digita. Os dois
-- filtros são AND quando ambos vêm, o que é o esperado.
--
-- ATENÇÃO — O DROP NÃO É LIMPEZA, É REQUISITO
--
-- `create or replace` com assinatura nova CRIA UMA SEGUNDA função sobrecarregada
-- (todos os parâmetros têm default), e o PostgREST passa a responder PGRST203
-- ("could not choose the best candidate function") a TODA consulta de
-- disponibilidade — derrubando o agente e a tela juntos, com um sintoma que não
-- menciona terapia nenhuma. Mesma armadilha de 20260904100100.
--
-- E o DROP apaga os grants: o grant no fim é obrigatório, senão o `authenticated`
-- recebe "permission denied for function", que chega à tela como 403.
--
-- JANELA DE QUEBRA — aplicar JUNTO do deploy do frontend
--
-- Entre esta migration e o deploy, a assinatura antiga não existe mais e
-- /api/central/appointments/availability recebe PGRST202. Fora do horário de
-- atendimento, ou junto.
--
-- ROLLBACK:
--   drop function if exists central.listar_vagas_disponiveis(date,date,bigint,bigint,text,text[],integer);
--   e reaplicar 20260904100100 inteira (recria a assinatura anterior e o grant).
-- ============================================================================

drop function if exists central.listar_vagas_disponiveis(
  date, date, bigint, bigint, text, integer
);

create or replace function central.listar_vagas_disponiveis(
  p_data_inicio     date    default null,
  p_data_fim        date    default null,
  p_terapia_id      bigint  default null,
  p_profissional_id bigint  default null,
  p_unidade         text    default null,
  -- Novo, no fim: os textos que a grade usa para a especialidade pedida.
  p_terapia_nomes   text[]  default null,
  p_limite          integer default 50
)
returns table (
  -- As 13 colunas de 20260904100100, na mesma ordem. `returns table` é
  -- posicional para alguns clientes, e VagaDisponivel as declara.
  data              date,
  dia_semana        text,
  hora_inicial      time,
  hora_final        time,
  profissional_id   bigint,
  profissional_nome text,
  terapia_id        bigint,
  terapia_nome      text,
  unidade_id        bigint,
  unidade_nome      text,
  sala_nome         text,
  unidade           text,
  e_sala_numerada   boolean
)
language plpgsql
stable
set search_path = public, central
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_inicio date;
  v_fim    date;
begin
  -- Falha alta em unidade desconhecida: silenciar aqui devolveria as três
  -- misturadas, que é o bug original reintroduzido por um typo.
  if p_unidade is not null
     and p_unidade not in ('Realengo', 'Fazendinha', 'Padre Miguel') then
    raise exception
      'p_unidade inválida: %. Valores aceitos: Realengo, Fazendinha, Padre Miguel.',
      p_unidade
      using errcode = '22023';
  end if;

  -- Array vazio é quase certamente bug de chamador (um de-para que não achou
  -- nada e mandou a lista vazia mesmo assim). Sem esta guarda ele se comporta
  -- como "sem filtro" e devolve a agenda inteira — o responsável receberia
  -- horários de qualquer especialidade achando que pediu a dele.
  if p_terapia_nomes is not null and cardinality(p_terapia_nomes) = 0 then
    raise exception
      'p_terapia_nomes veio vazio. Passe null para não filtrar por especialidade, ou os nomes que a grade usa.'
      using errcode = '22023';
  end if;

  v_inicio := coalesce(p_data_inicio, v_agora::date);
  v_fim    := coalesce(p_data_fim,    v_agora::date + 30);

  return query
  select
    v.data,
    v.dia_semana,
    v.hora_inicial,
    v.hora_final,
    v.profissional_id,
    v.profissional_nome,
    v.terapia_id,
    v.terapia_nome,
    v.unidade_id,
    v.unidade_nome,
    v.sala_nome,
    v.unidade,
    v.e_sala_numerada
  from central.vw_vagas_livres v
  where v.data >= v_inicio
    and v.data <= v_fim
    -- No dia corrente a comparação é por HORA: às 14h não se oferece a vaga das
    -- 09h20. Oferecer horário que já passou é o erro mais visível que um
    -- atendente automático comete.
    and (v.data > v_agora::date or v.hora_inicial > v_agora::time)
    and (p_terapia_id      is null or v.terapia_id      = p_terapia_id)
    and (p_profissional_id is null or v.profissional_id = p_profissional_id)
    and (p_unidade         is null or v.unidade         = p_unidade)
    -- O filtro que motivou esta migration.
    --
    -- `string_to_array(v.terapia_nome, ', ')` quebra o nome-lista nas mesmas
    -- partes que partesDoNome() produz no TypeScript, e `&&` (sobreposição de
    -- arrays) pergunta se alguma parte é um dos nomes pedidos.
    --
    -- O separador é ', ' com espaço, que é como o TiTa grava — o btrim cobre o
    -- caso de vir sem. Sem o btrim, ' Psicologia' com espaço à esquerda não
    -- casaria 'Psicologia', e a vaga sumiria em silêncio.
    and (
      p_terapia_nomes is null
      or exists (
        select 1
        from unnest(string_to_array(v.terapia_nome, ',')) as parte
        where btrim(parte) = any (p_terapia_nomes)
      )
    )
    -- A vaga não pode já ter sido prometida por nós. Continua aqui, e não na
    -- view, para que a regra de "vaga prometida" tenha um lugar só.
    and not exists (
      select 1
      from central.appointments ap
      where ap.profissional_id = v.profissional_id
        and ap.date            = v.data
        and ap.time            = v.hora_inicial
        and ap.status in ('scheduled', 'confirmed')
    )
  order by v.data, v.hora_inicial, v.profissional_nome
  limit greatest(1, least(coalesce(p_limite, 50), 500));
end;
$$;

comment on function central.listar_vagas_disponiveis(date, date, bigint, bigint, text, text[], integer) is
  'Vagas ofertáveis: central.vw_vagas_livres menos as já prometidas em central.appointments, menos o passado. p_unidade filtra NO BANCO para o teto de 500 valer por unidade. p_terapia_nomes filtra por NOME da especialidade, casando por PARTE do nome-lista (terapia_nome é a lista do que o profissional atende naquele horário) — necessário porque terapia_id NÃO identifica a terapia: o id 2317 aparece com sete nomes diferentes, então filtrar por ele mistura quem só aplica ABA com quem faz psicologia, e esconde as 12 vagas de psicologia que vivem sob 2317. O de-para do nome que o responsável usa (o do laudo, "Psicologia ABA") para o que a grade grava ("Aplicador ABA (PS)") vive em frontend/modules/atendimento/agente/terapia.ts. Fonte única para a página de Agendamentos e para o agente de WhatsApp.';

grant execute on function central.listar_vagas_disponiveis(date, date, bigint, bigint, text, text[], integer)
  to authenticated, service_role;
