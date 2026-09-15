'use client'

import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'

// Documentação da API de faltas — a versão que se entrega ao parceiro.
//
// Mora DENTRO do Pulsar de propósito: o botão "Salvar em PDF" chama
// `window.print()`, e isso só funciona sobre conteúdo da mesma origem. Uma
// página hospedada fora (o artifact publicado) não pode ser impressa a partir
// daqui — o browser bloqueia, e um <iframe> seria recusado pelo X-Frame-Options
// dos dois lados.
//
// O @media print no fim do arquivo faz duas coisas distintas:
//   1. esconde o chrome do app — sidebar, header do shell, sino de alertas,
//      barra de impersonação e os próprios controles desta tela;
//   2. DESFAZ o `h-screen` + `overflow-auto` do <main> do layout
//      (app/(dashboard)/layout.tsx). Sem isso a impressão sairia cortada na
//      primeira página: um container com altura de viewport e scroll próprio
//      não pagina — o que não coube simplesmente some.
// Não havia precedente de impressão no projeto; este é o primeiro.

export default function DocumentacaoApiShell() {
  return (
    <>
      <style>{cssImpressao}</style>

      <div className="doc-raiz mx-auto max-w-4xl pb-16">
        {/* Controles — somem na impressão */}
        <div className="doc-controles mb-8 flex items-center justify-between gap-4">
          <Link
            href="/admin/api"
            className="
              inline-flex items-center gap-2 text-sm font-medium
              text-slate-600 hover:text-slate-900 transition-colors
            "
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para API
          </Link>

          <button
            type="button"
            onClick={() => window.print()}
            className="
              inline-flex items-center gap-2
              rounded-lg bg-slate-800 px-4 py-2
              text-sm font-medium text-white
              hover:bg-slate-700 transition-colors cursor-pointer
            "
          >
            <Printer className="h-4 w-4" />
            Salvar em PDF
          </button>
        </div>

        {/* ── Capa ──────────────────────────────────────────── */}
        <header className="doc-capa mb-10 border-b border-slate-200 pb-8">
          {/* Lockup do Pulsar. Só a variante clara: este documento é feito para
              virar papel, e no papel o fundo é sempre branco — a variante escura
              do Sidebar não tem uso aqui.

              `h-9 w-auto` em vez de largura fixa porque o arquivo é 1920x768
              com ~40% de margem transparente embutida (ver Sidebar.tsx): travar
              pela altura da arte é o único jeito de a marca sair do mesmo
              tamanho aqui e lá. */}
          <img
            src="/pulsar-lockup-1920-transparent.png"
            alt="Pulsar"
            className="doc-marca mb-6 h-9 w-auto"
          />
          <p className="mb-4 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-[#E6357E]" />
            Documentação de integração &middot; v1.0
          </p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-slate-900">
            API de Faltas
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-snug text-slate-600">
            Leia as faltas registradas no Pulsar e lance-as no seu sistema, casando pelo mesmo
            id de agendamento que você já recebe do TiTa.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-7 gap-y-2 font-mono text-[11px] text-slate-500">
            <span><b className="font-medium text-slate-700">Base</b> orbitaautomacao.com.br</span>
            <span><b className="font-medium text-slate-700">Auth</b> Bearer token</span>
            <span><b className="font-medium text-slate-700">Formato</b> JSON</span>
            <span><b className="font-medium text-slate-700">Atualizado</b> 15/09/2026</span>
          </div>
        </header>

        {/* ── Configuração de acesso ───────────────────────── */}
        <Secao titulo="Configuração de acesso">
          <H3>Base URL</H3>
          <P>Todas as requisições devem ser feitas para:</P>
          <Endpoint url="https://orbitaautomacao.com.br/api" />
          <P>
            Nos exemplos deste documento ela aparece como <C>{'{{baseUrl}}'}</C> — o mesmo
            formato de variável que o Postman e o Insomnia usam, para você colar sem reescrever.
          </P>

          <H3>Autenticação</H3>
          <P>Todas as requisições devem incluir o seguinte header:</P>
          <Pre>{`Authorization: Bearer <seu-token>`}</Pre>
          <P>
            O token é individual por parceiro e entregue por canal privado. Ele viaja no header
            e <B>nunca na URL</B>, portanto nunca aparece em log de acesso nem em histórico de
            navegador. É revogável isoladamente: se vazar, o seu é cortado sem afetar nenhum
            outro parceiro.
          </P>

          <H3>Recorte do seu token</H3>
          <P>
            Cada token carrega uma <B>data de corte</B>: faltas anteriores a ela não são
            enviadas. O padrão é <C>2026-09-01</C>. Se precisar de mais histórico, peça — é um
            ajuste do nosso lado, sem mudança no seu código.
          </P>

          <Aviso tipo="crit" titulo="A barra final é obrigatória">
            <P>
              O caminho é <C>/api/integracao/faltas<B>/</B></C>, com barra no fim e{' '}
              <B>antes</B> da query string. Sem ela o servidor responde um <C>308</C> em vez
              dos dados, e a maioria dos clientes HTTP não repassa o header{' '}
              <C>Authorization</C> num redirecionamento — o que aparece como <C>404</C> ou{' '}
              <C>401</C>. Nos dois casos o problema é a barra, não o token.
            </P>
            <div className="mt-3 space-y-1.5 font-mono text-xs">
              <Linha ok>/api/integracao/faltas/</Linha>
              <Linha ok>/api/integracao/faltas/?limite=500</Linha>
              <Linha>/api/integracao/faltas &rarr; 308</Linha>
              <Linha>/api/integracao/faltas?limite=500 &rarr; 308</Linha>
            </div>
          </Aviso>

          <H3>Teste rápido</H3>
          <Pre>{`curl -H "Authorization: Bearer SEU_TOKEN" \\
  "{{baseUrl}}/integracao/faltas/?limite=5"`}</Pre>
          <P>
            Resposta <C>200</C> com uma lista em <C>faltas</C> significa que o acesso está
            configurado.
          </P>
        </Secao>

        {/* ── O que é ───────────────────────────────────────── */}
        <Secao titulo="O que é esta API">
          <P>
            O <B>Pulsar</B> é o sistema de gestão clínica da Universo ABA. Quando um paciente
            não comparece a uma sessão de terapia, a recepção registra a falta ali, com o
            motivo. Esta API entrega esses registros para que o seu sistema faça o mesmo
            lançamento do lado de lá — sem digitação dupla e sem divergência entre os dois lados.
          </P>
          <P>
            O modelo é <B>pull</B>: você consulta quando quiser. O Pulsar não conhece a sua URL,
            não mantém fila de entrega e não depende da sua disponibilidade. Se o seu sistema
            ficar fora do ar, nada se perde — na próxima consulta você recebe tudo que mudou.
          </P>
        </Secao>

        {/* ── Parâmetros ────────────────────────────────────── */}
        <Secao titulo="Parâmetros">
          <Tabela
            cabecalho={['Parâmetro', 'Tipo', 'Padrão', 'Para quê']}
            linhas={[
              ['desde', 'ISO 8601', '—', 'Só o que mudou depois deste instante. Omita na primeira carga.'],
              ['desde_id', 'inteiro', '—', 'Segunda metade do cursor. Sempre junto com `desde`.'],
              ['limite', '1–1000', '500', 'Tamanho da página.'],
              ['agendamento_id', 'lista', '—', 'Só estes agendamentos. Até 200, separados por vírgula.'],
              ['paciente_id', 'lista', '—', 'Só estes pacientes. Até 200.'],
              ['data_de', 'AAAA-MM-DD', '—', 'Sessões a partir deste dia, inclusive.'],
              ['data_ate', 'AAAA-MM-DD', '—', 'Sessões até este dia, inclusive.'],
            ]}
            mono={[0]}
          />
          <P>
            Limite de <B>60 requisições por minuto</B> por token. Ao estourar, a resposta é{' '}
            <C>429</C> com <C>Retry-After</C>.
          </P>
        </Secao>

        {/* ── Modos ─────────────────────────────────────────── */}
        <Secao titulo="Os dois modos de uso">
          <div className="mb-5 grid gap-4 sm:grid-cols-2">
            <Modo
              tag="Modo 1"
              titulo="Sincronizar"
              texto="“O que mudou desde a última vez?” Sem filtro, usando o cursor desde/desde_id. É como você mantém sua base em dia — inclusive recebendo os estornos."
            />
            <Modo
              tag="Modo 2"
              titulo="Consultar"
              texto="“Esse agendamento faltou?” ou “quais faltas houve em setembro?” Com qualquer filtro de id ou data. Devolve o estado atual do que você pediu."
            />
          </div>

          <Aviso tipo="crit" titulo="Qualquer filtro desliga o cursor">
            <P>
              Ao passar <B>qualquer</B> um dos quatro filtros (<C>agendamento_id</C>,{' '}
              <C>paciente_id</C>, <C>data_de</C>, <C>data_ate</C>), os parâmetros{' '}
              <C>desde</C>/<C>desde_id</C> são descartados e a resposta <B>não traz</B> o
              cursor <C>proximo_desde</C>.
            </P>
            <P>
              É uma regra só, para não haver o que decorar: <B>filtro = consulta pontual</B>.
            </P>
            <P>
              Isso existe para que a resposta vazia tenha um significado único. Sob filtro,{' '}
              <C>{'"faltas": []'}</C> significa sempre <B>“não há falta que satisfaça o que
              você pediu”</B> — e nunca “há, mas não mudou desde o seu cursor”. Se as duas
              coisas se combinassem, perguntar “o agendamento X faltou?” carregando um cursor
              antigo devolveria vazio para uma falta que existe, e você concluiria o oposto do
              verdadeiro.
            </P>
          </Aviso>

          <Aviso tipo="warn" titulo="Não sincronize pelo modo 2">
            <P>
              O modo de consulta só responde sobre ids que você já sabe perguntar — ele não tem
              como informar um estorno de algo que você ainda não conhece. Para manter a base
              em dia, o cursor é o único caminho.
            </P>
          </Aviso>
        </Secao>

        {/* ── Cursor ────────────────────────────────────────── */}
        <Secao titulo="Sincronizar: o cursor">
          <P>
            O cursor é o <B>par</B> <C>proximo_desde</C> + <C>proximo_desde_id</C>. Devolva os
            dois na chamada seguinte.
          </P>

          <ol className="mb-5 space-y-5">
            <Passo n={1} titulo="Primeira carga">
              Chame sem parâmetro algum. Você recebe a página inicial e o cursor no fim da
              resposta.
              <Pre>{`GET {{baseUrl}}/integracao/faltas/?limite=500`}</Pre>
            </Passo>
            <Passo n={2} titulo="Enquanto tem_mais for true">
              Repita passando o cursor que veio na resposta anterior.
              <Pre>{`GET {{baseUrl}}/integracao/faltas/?desde=2026-09-14T16:32:37.834Z&desde_id=1890203`}</Pre>
            </Passo>
            <Passo n={3} titulo="Guarde o último cursor">
              Na próxima sincronização — daqui a uma hora, amanhã — comece dele. Você recebe só
              o que mudou no intervalo.
            </Passo>
          </ol>

          <Aviso tipo="warn" titulo="Por que o cursor tem duas partes">
            <P>
              Milhares de faltas podem compartilhar o mesmo <C>atualizado_em</C>: uma
              manutenção interna já carimbou 3.858 linhas no mesmo instante. Paginar apenas
              pelo tempo faria você <B>perder em silêncio</B> todas as que não coubessem na
              primeira página daquele instante. O <C>desde_id</C> continua a varredura dentro
              do empate.
            </P>
            <P>Por isso: devolva sempre os dois valores, nunca só o primeiro.</P>
          </Aviso>
        </Secao>

        {/* ── Filtros ───────────────────────────────────────── */}
        <Secao titulo="Consultar: filtros">
          <Pre>{`# um agendamento específico
{{baseUrl}}/integracao/faltas/?agendamento_id=1882480

# vários de uma vez — até 200, evita bater no limite de 60/min
{{baseUrl}}/integracao/faltas/?agendamento_id=1882480,1887765,1887869

# todas as faltas de um paciente
{{baseUrl}}/integracao/faltas/?paciente_id=11556

# um mês fechado — para reconciliar competência
{{baseUrl}}/integracao/faltas/?data_de=2026-09-01&data_ate=2026-09-30

# um dia específico: os dois iguais
{{baseUrl}}/integracao/faltas/?data_de=2026-09-07&data_ate=2026-09-07

# combinados restringem (E, não OU)
{{baseUrl}}/integracao/faltas/?paciente_id=11556&data_de=2026-09-01&data_ate=2026-09-30`}</Pre>

          <H3>Sobre as datas</H3>
          <P>
            <C>data_de</C> e <C>data_ate</C> filtram o <B>dia da sessão</B> (
            <C>data_atendimento</C>), não quando o registro mudou no Pulsar. Quem filtra por
            “quando mudou” é o cursor <C>desde</C>.
          </P>
          <P>
            A diferença aparece assim: uma falta de 01/09 corrigida hoje tem{' '}
            <C>data_atendimento = 2026-09-01</C> e <C>atualizado_em = hoje</C>. Ela entra num
            filtro de setembro e <B>não</B> entra num <C>desde</C> de uma hora atrás, se não
            tiver mudado de novo nesse intervalo.
          </P>

          <Aviso tipo="warn" titulo="Formato de data: só AAAA-MM-DD">
            <P>
              Data com fuso é recusada com <C>400</C>. O motivo é concreto:{' '}
              <C>2026-09-01T00:00:00-03:00</C> vira 31/08 em UTC e tiraria um dia do seu
              intervalo sem avisar.
            </P>
            <P>
              Intervalo invertido também é <C>400</C>, não lista vazia — vazio ali seria lido
              como “não houve falta no período” quando a verdade é que os parâmetros estão
              trocados. E <C>data_de</C> <B>não libera histórico</B> anterior à data de corte
              do seu token: pedir julho com corte em setembro devolve <C>[]</C>, não erro.
            </P>
          </Aviso>
        </Secao>

        {/* ── Resposta ──────────────────────────────────────── */}
        <Secao titulo="A resposta">
          <Pre>{`{
  "faltas": [
    {
      "tita_agendamento_id": 1882480,
      "paciente_id": 14133,
      "profissional_id": 8690,
      "data_atendimento": "2026-09-09",
      "horario": "14:20:00",
      "terapia_nome": "Terapia Ocupacional",
      "tipo_falta": "paciente",
      "codigo_justificativa": 102,
      "justificativa": "não vem",
      "ativa": true,
      "status": "falta",
      "atualizado_em": "2026-09-09T17:55:00.772Z"
    }
  ],
  "tem_mais": false,
  "proximo_desde": "2026-09-09T17:55:00.772Z",
  "proximo_desde_id": 1882480
}`}</Pre>

          <Tabela
            cabecalho={['Campo', 'O que é']}
            linhas={[
              ['tita_agendamento_id', 'A chave. É o id do agendamento no TiTa.'],
              ['paciente_id', 'Id do paciente no TiTa (o favorecido.id).'],
              ['profissional_id', 'Id do profissional no TiTa. Pode vir null.'],
              ['data_atendimento', 'O dia em que a sessão aconteceria.'],
              ['horario', 'Horário da sessão.'],
              ['terapia_nome', 'Terapia da sessão.'],
              ['tipo_falta', 'paciente, terapeuta ou unidade_fechada.'],
              ['codigo_justificativa', 'O motivo, na lista 101–113.'],
              ['justificativa', 'Texto livre da recepção. Pode ser null.'],
              ['ativa', 'true = vale agora. false = estorne.'],
              ['status', 'Estado interno da linha. Diagnóstico apenas.'],
              ['atualizado_em', 'Instante UTC da última alteração. Metade do cursor.'],
            ]}
            mono={[0]}
          />
        </Secao>

        {/* ── Chave ─────────────────────────────────────────── */}
        <Secao titulo="A chave casa com o TiTa">
          <P>
            <C>tita_agendamento_id</C> <B>não é um id interno do Pulsar</B>. É literalmente o
            campo <C>id</C> de cada item de <C>agenda_favorecido[]</C> na resposta de{' '}
            <C>GET /api/integracao/agendamento</C> do TiTa — o mesmo valor que aparece como a
            coluna <C>id agendamento</C> no CSV <C>csv_grade_profissionais</C>.
          </P>
          <P>
            Se o seu sistema lê a API do TiTa, <B>você já tem esse número</B>. É só casar pelo
            id, sem depender de nome de paciente, data ou horário — que mudam, têm acento,
            homônimo e remarcação.
          </P>
          <Numeros
            itens={[
              { n: '8.171', l: 'faltas com a chave' },
              { n: '8.171', l: 'valores distintos' },
              { n: '0', l: 'repetições', destaque: true },
            ]}
          />
          <p className="text-xs text-slate-500">
            Verificado em produção em 15/09/2026: a chave é única e não repete.
          </p>
        </Secao>

        {/* ── Estornos ──────────────────────────────────────── */}
        <Secao titulo="Estornos: o campo ativa">
          <P>Uma falta registrada no Pulsar <B>pode deixar de valer</B>, de três formas:</P>
          <Lista
            itens={[
              'a recepção reverte a falta — o paciente chegou atrasado, ou foi engano;',
              'um feriado lançado em lote é revertido;',
              'a guia é liberada no convênio e o sistema cancela a falta automaticamente.',
            ]}
          />
          <P>
            Em qualquer uma delas a linha volta a aparecer com <C>{'"ativa": false'}</C> e um{' '}
            <C>atualizado_em</C> novo. Trate como <B>estorno</B> do lançamento anterior daquele{' '}
            <C>tita_agendamento_id</C>.
          </P>

          <Aviso tipo="crit" titulo="Faça upsert pela chave, nunca insert cego">
            <P>
              Além dos estornos, manutenções internas no Pulsar podem recarimbar linhas
              antigas, que então reaparecem no cursor. Um sistema idempotente por{' '}
              <C>tita_agendamento_id</C> absorve isso sem duplicar nada. Um que só insere vai
              acumular duplicata a cada manutenção.
            </P>
            <P>
              Use <C>ativa</C> como o estado atual. <B>Não tente inferir pelo <C>status</C></B>,
              que existe só para diagnóstico.
            </P>
          </Aviso>
        </Secao>

        {/* ── Códigos ───────────────────────────────────────── */}
        <Secao titulo="Códigos de justificativa">
          <P>
            A recepcionista escolhe o motivo no ato do registro, nesta lista de 13 códigos:
          </P>
          <Tabela
            cabecalho={['Código', 'Motivo']}
            linhas={[
              ['101', 'Atestado / internação / falecimento'],
              ['102', 'Ausência de justificativa'],
              ['103', 'Conflito com cronograma'],
              ['104', 'Conflito terapêutico'],
              ['105', 'Consultas / compromissos'],
              ['106', 'Falta do profissional'],
              ['107', 'Férias / viagem'],
              ['108', 'Logística / deslocamento / clima'],
              ['109', 'Pendência administrativa'],
              ['110', 'Saúde da criança'],
              ['111', 'Saúde do responsável'],
              ['112', 'Solicitação de liberação pelo responsável'],
              ['113', 'Feriado / recesso da clínica'],
            ]}
            mono={[0]}
          />

          <H3>Códigos derivados pelo sistema</H3>
          <P>Alguns casos não são perguntados à recepção — o código sai da própria situação:</P>
          <Tabela
            cabecalho={['Código', 'Quando']}
            linhas={[
              ['106', 'O terapeuta faltou (tipo_falta = terapeuta)'],
              ['113', 'Feriado ou ponto facultativo'],
              ['108', 'Falta de energia ou evento climático'],
              ['109', 'Outro motivo de fechamento da clínica'],
            ]}
            mono={[0]}
          />
          <P>
            O último merece nota: “outro” é o fechamento que ninguém classificou — dedetização,
            obra, greve de transporte. Ele <B>não</B> vai como 113, porque dizer “feriado” num
            dia que não é feriado afirmaria um fato que você pode conferir contra o calendário
            e não encontrar.
          </P>
        </Secao>

        {/* ── unidade_fechada ───────────────────────────────── */}
        <Secao titulo="Dias em que a clínica não abriu">
          <Aviso tipo="crit" titulo="Leia antes de importar">
            <P>
              Quando <C>tipo_falta</C> é <C>unidade_fechada</C>, <B>o paciente não faltou</B>.
              São dias em que a clínica não abriu: feriado, recesso, falta de energia. O Pulsar
              mantém essas linhas fora da assiduidade do paciente em todos os cálculos internos.
            </P>
          </Aviso>

          <P>
            <B>Isso é um quarto da carga.</B> Na primeira sincronização com o corte padrão:
          </P>
          <Numeros
            itens={[
              { n: '1.019', l: 'faltas reais — paciente + terapeuta · 75%' },
              { n: '336', l: 'a clínica não abriu — unidade_fechada · 25%', destaque: true },
              { n: '1.367', l: 'total entregue' },
            ]}
          />
          <P>
            As 336 vêm de <B>um único dia</B>: o feriado de 07/09. Um feriado derruba a agenda
            inteira de uma vez, então esse padrão se repete a cada data comemorativa.
          </P>
          <P>
            Se o seu sistema tratar essas linhas como falta do paciente, <B>o número de faltas
            dele fica 33% acima do real</B> já na primeira carga — e cada paciente atendido
            naquele dia leva uma falta que nunca aconteceu.
          </P>
          <P>Filtrar é uma linha. Qualquer um destes serve:</P>
          <Pre>{`// recomendado: explícito
faltas.filter(f => f.tipo_falta !== 'unidade_fechada')

// equivalente, pelo código
faltas.filter(f => f.codigo_justificativa !== 113)`}</Pre>
          <P>
            Enviamos em vez de omitir porque o dado é útil: ele explica uma agenda vazia,
            justifica a ausência sem cobrança, e evita que alguém do seu lado vá procurar o que
            aconteceu naquele dia. Mas a decisão de contá-lo ou não é sua.
          </P>
        </Secao>

        {/* ── Sessão combinada ──────────────────────────────── */}
        <Secao titulo="Sessão combinada: duas linhas, uma ausência">
          <P>
            Alguns pacientes têm <B>duas terapias no mesmo horário</B>, com profissionais
            diferentes — por exemplo “Aplicador ABA (AE)” e “Coordenador de Caso” às 11:20. No
            TiTa isso são <B>dois agendamentos</B>, cada um com seu <C>id</C>.
          </P>
          <P>
            Do lado do Pulsar a recepção registra <B>uma</B> falta: o paciente não veio uma vez.
            Mas como você precisa marcar os dois agendamentos, a API entrega <B>uma linha por
            agendamento</B>:
          </P>
          <Pre>{`{ "tita_agendamento_id": 3195192,  "terapia_nome": "Aplicador ABA (AE)",
  "profissional_id": 8742,      "codigo_justificativa": 102, "ativa": true }

{ "tita_agendamento_id": 3535628,  "terapia_nome": "Coordenador de Caso",
  "profissional_id": 10981,     "codigo_justificativa": 102, "ativa": true }`}</Pre>
          <P>
            Cada linha traz <B>o profissional da sua própria sessão</B> e o <C>terapia_nome</C>{' '}
            específico — não a lista combinada.
          </P>

          <Aviso tipo="warn" titulo="São duas linhas, mas uma falta só">
            <P>
              As duas compartilham <C>justificativa</C> e <C>codigo_justificativa</C>, porque é
              a mesma ausência descrita duas vezes. Se você contar assiduidade do paciente,{' '}
              <B>agrupe por (paciente, data, horário) antes de somar</B> — caso contrário o
              número dele fica inflado.
            </P>
          </Aviso>

          <P>
            Nada muda no seu upsert: a chave continua sendo <C>tita_agendamento_id</C>, e ela
            segue única — cada linha aponta para um agendamento distinto.
          </P>
        </Secao>

        {/* ── Erros ─────────────────────────────────────────── */}
        <Secao titulo="Erros">
          <Tabela
            cabecalho={['Status', 'Quando acontece']}
            linhas={[
              ['401', 'Token ausente, malformado, inexistente, expirado ou revogado. A mensagem é sempre a mesma, de propósito. Confira a barra final antes de suspeitar do token.'],
              ['400', 'Parâmetro inválido: desde fora do ISO 8601, desde_id não inteiro, limite fora de 1–1000, mais de 200 ids, data fora de AAAA-MM-DD ou intervalo invertido.'],
              ['404', 'Quase sempre a barra final ausente.'],
              ['429', 'Mais de 60 requisições por minuto. Respeite o Retry-After. Se estiver consultando ids num laço, agrupe: agendamento_id aceita 200 por vez.'],
              ['500', 'Falha na consulta do nosso lado. O detalhe fica no nosso log, não na resposta.'],
            ]}
            mono={[0]}
          />
          <P>Todo erro vem como JSON com uma chave <C>erro</C>:</P>
          <Pre>{`{ "erro": "token invalido" }`}</Pre>
        </Secao>

        {/* ── Limites ───────────────────────────────────────── */}
        <Secao titulo="Limites conhecidos">
          <P>Preferimos declarar isto a deixar você descobrir sozinho.</P>

          <H3>Recorte histórico</H3>
          <P>
            Faltas anteriores à data de corte do seu token não são enviadas. O padrão é{' '}
            <C>2026-09-01</C>. A razão é que a chave do TiTa só passou a ser preenchida de
            forma confiável em meados de 2026 — antes disso você receberia linha sem chave, que
            não teria como casar. A data é ajustável: peça.
          </P>

          <H3>profissional_id nulo em cerca de 13%</H3>
          <P>
            O id vem da agenda do TiTa e, quando o agendamento é alterado ou removido lá, a
            versão antiga deixa de ter profissional associado. A falta continua sendo enviada,
            só sem esse campo — preferimos entregá-la incompleta a escondê-la. Trate o campo
            como opcional.
          </P>

          <H3>Faltas cujo agendamento foi excluído no TiTa</H3>
          <P>
            É o único caso restante de falta sem <C>tita_agendamento_id</C> — cerca de{' '}
            <B>3 por mês</B>. Uma rotina remove o agendamento do TiTa, e minutos depois a
            recepção registra a falta do que ainda via na tela. A sessão existiu e conta como
            ausência do nosso lado, mas o agendamento correspondente não existe mais para você
            casar, então preferimos não enviar a inventar uma chave.
          </P>
          <P>
            Se notar um buraco na sua base — uma falta que a clínica relata e você não recebeu —
            este é o primeiro motivo a considerar. É só perguntar que conferimos a sessão
            específica.
          </P>
        </Secao>

        {/* ── Checklist ─────────────────────────────────────── */}
        <Secao titulo="Checklist de integração" ultima>
          <P>Os pontos que mais causam retrabalho, em ordem:</P>
          <Lista
            itens={[
              'Barra final em toda URL, antes da query string.',
              'Upsert por tita_agendamento_id, nunca insert cego.',
              'Honrar ativa: false como estorno do lançamento anterior.',
              'Filtrar unidade_fechada da assiduidade do paciente — ou assumir conscientemente contá-la.',
              'Agrupar sessão combinada por (paciente, data, horário) antes de contar faltas.',
              'Devolver as duas partes do cursor, não só proximo_desde.',
              'Paginar até tem_mais: false antes de considerar a sincronização em dia.',
              'Guardar o último cursor entre execuções.',
              'Chamar do backend, nunca do navegador.',
              'Tratar profissional_id como opcional.',
            ]}
          />
          <Aviso tipo="ok" titulo="Dúvida ou ajuste">
            <P>
              Data de corte, campo adicional, filtro novo, limite de requisições: fale com a
              equipe de tecnologia da Universo ABA. Mudanças que quebrem contrato são avisadas
              antes.
            </P>
          </Aviso>
        </Secao>

        <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-500">
          <p>
            <b className="font-semibold text-slate-600">API de Faltas do Pulsar</b> &middot;
            versão 1.0 &middot; 15 de setembro de 2026
            <br />
            Universo ABA &middot; documento destinado a parceiros de integração
          </p>
        </footer>
      </div>
    </>
  )
}

/* ─────────────────────────────────────────────────────────────
   Blocos de conteúdo
   ───────────────────────────────────────────────────────────── */

function Secao({
  titulo,
  children,
  ultima,
}: {
  titulo: string
  children: React.ReactNode
  ultima?: boolean
}) {
  return (
    <section className={`doc-secao ${ultima ? '' : 'mb-10'}`}>
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">{titulo}</h2>
      {children}
    </section>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-7 text-base font-semibold text-slate-800">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3.5 text-[15px] leading-relaxed text-slate-700">{children}</p>
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-slate-900">{children}</strong>
}

function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.86em] text-slate-700">
      {children}
    </code>
  )
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="doc-pre mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700">
      {children}
    </pre>
  )
}

function Endpoint({ url }: { url: string }) {
  return (
    <div className="doc-endpoint mb-4 overflow-x-auto rounded-lg bg-[#222847] px-4 py-3 font-mono text-sm text-slate-100">
      {url}
    </div>
  )
}

function Linha({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className={`shrink-0 font-bold ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>
        {ok ? '✓' : '✗'}
      </span>
      <span className={ok ? 'text-slate-700' : 'text-slate-500'}>{children}</span>
    </div>
  )
}

const AVISO_ESTILO = {
  crit: 'border-rose-200 bg-rose-50 text-rose-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
} as const

const AVISO_TITULO = {
  crit: 'text-rose-700',
  warn: 'text-amber-700',
  ok: 'text-emerald-700',
} as const

function Aviso({
  tipo,
  titulo,
  children,
}: {
  tipo: keyof typeof AVISO_ESTILO
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div className={`doc-aviso mb-5 rounded-lg border p-4 ${AVISO_ESTILO[tipo]}`}>
      <p
        className={`mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider ${AVISO_TITULO[tipo]}`}
      >
        {titulo}
      </p>
      <div className="[&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_p]:text-sm [&_p]:text-inherit">
        {children}
      </div>
    </div>
  )
}

function Tabela({
  cabecalho,
  linhas,
  mono = [],
}: {
  cabecalho: string[]
  linhas: string[][]
  mono?: number[]
}) {
  return (
    <div className="doc-tabela mb-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300">
            {cabecalho.map((h) => (
              <th
                key={h}
                className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              {linha.map((celula, j) => (
                <td
                  key={j}
                  className={`py-2.5 pr-4 align-top leading-relaxed ${
                    mono.includes(j)
                      ? 'whitespace-nowrap font-mono text-xs text-slate-700'
                      : 'text-[13px] text-slate-600'
                  }`}
                >
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Modo({ tag, titulo, texto }: { tag: string; titulo: string; texto: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#1E5A7D]">
        {tag}
      </p>
      <h4 className="mb-1.5 text-[15px] font-semibold text-slate-800">{titulo}</h4>
      <p className="text-[13px] leading-relaxed text-slate-600">{texto}</p>
    </div>
  )
}

function Passo({
  n,
  titulo,
  children,
}: {
  n: number
  titulo: string
  children: React.ReactNode
}) {
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-full bg-[#222847] font-mono text-[11px] font-semibold text-white">
        {n}
      </span>
      <div className="text-[15px] leading-relaxed text-slate-700">
        <B>{titulo}.</B> {children}
      </div>
    </li>
  )
}

function Numeros({
  itens,
}: {
  itens: { n: string; l: string; destaque?: boolean }[]
}) {
  return (
    <div className="doc-numeros mb-4 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
      {itens.map((it) => (
        <div key={it.l} className="bg-white p-4">
          <p
            className={`text-2xl font-bold tabular-nums leading-none tracking-tight ${
              it.destaque ? 'text-[#E6357E]' : 'text-slate-800'
            }`}
          >
            {it.n}
          </p>
          <p className="mt-1.5 text-xs leading-snug text-slate-500">{it.l}</p>
        </div>
      ))}
    </div>
  )
}

function Lista({ itens }: { itens: string[] }) {
  return (
    <ul className="mb-4 space-y-2">
      {itens.map((it) => (
        <li key={it} className="flex gap-2.5 text-[15px] leading-relaxed text-slate-700">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

/* ─────────────────────────────────────────────────────────────
   Impressão
   ───────────────────────────────────────────────────────────── */

const cssImpressao = `
@media print {
  @page { size: A4; margin: 16mm 15mm 17mm; }

  /* 1. Esconde o chrome do app. Esta tela não controla esses elementos, mas
        precisa removê-los do papel.

        A regra que faz o trabalho pesado é a do posicionamento fixo: no papel
        não existe viewport, então nada pode estar ancorado a ela — um elemento
        fixo sai carimbado numa coordenada arbitraria da primeira pagina. E
        assim que o sino de alertas (uma div fixed, sem tag semantica) e a barra
        de impersonacao somem sem eu precisar nomear cada um. Nomea-los seria
        pior: o proximo elemento fixo que alguem acrescentar ao layout voltaria
        a aparecer aqui, e ninguem lembraria desta tela.

        Todo o conteudo deste documento e estatico, entao a varredura por classe
        nao tem como remover nada que devesse ser impresso. */
  [class*="fixed"],
  aside,
  nav,
  header:not(.doc-capa),
  .doc-controles { display: none !important; }

  /* 2. Desfaz o h-screen + overflow-auto do <main> do layout. Sem isto a
        impressão sai cortada na primeira página: container com altura de
        viewport e scroll próprio não pagina. */
  main {
    overflow: visible !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 0 !important;
  }
  body, html { height: auto !important; overflow: visible !important; }
  .ml-64 { margin-left: 0 !important; }
  .h-screen { height: auto !important; }

  .doc-raiz { max-width: none !important; padding: 0 !important; }

  /* 3. Tipografia de papel e quebras nos lugares certos. */
  body { font-size: 10pt; background: #fff !important; }
  h1 { font-size: 24pt; }
  h2 { font-size: 14pt; break-after: avoid; }
  h3, h4 { break-after: avoid; }
  p, li { orphans: 3; widows: 3; }

  .doc-secao { break-inside: auto; }
  .doc-pre, .doc-tabela, .doc-aviso, .doc-endpoint,
  .doc-numeros, table, pre { break-inside: avoid; }

  /* A capa é a primeira página: a marca não pode ser separada do título. */
  .doc-capa { break-inside: avoid; break-after: avoid; }

  /* O lockup é PNG com transparência e um ponto rosa que é o único acento da
     marca. Sem preservar cor, o navegador o imprime em escala de cinza. */
  .doc-marca {
    height: 11mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Cores chapadas precisam ser explicitamente preservadas. */
  .doc-endpoint, .doc-aviso, .doc-numeros * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  a { text-decoration: none; color: inherit; }
}
`
