# Release notes — Nome e conteúdo das evidências do PEP (14–15/10/2026)

Branches `feat/pep-validacao-documentos` (mesclada em 14/10), `fix/pep-documentos-calibracao` (mesclada em 14/10) e `feat/pep-auditoria-documentos`. Robô SharePoint 0.4.0 → **0.5.0**.

## Resumo

Até aqui o robô SharePoint só lia o **nome** e a **pasta** de cada arquivo. Agora:

1. **Nome**: a regra de nome que já existia (desde 02/10) passa a dizer o motivo certo de cada erro, e entrega aceita por uma pessoa com nome fora do padrão ganha o selo **"Ajustar nomenclatura"**.
2. **Conteúdo**: o robô lê o **texto** de cada evidência (.docx e .pdf). Uma tela nova, **Auditoria de Documentos PEP**, audita esse texto **quando alguém pede**: o que está bom, o que pode conter erros e o que está errado, com o trecho que prova.

Nada disso desconta valor nem muda entrega: é indicação para uma pessoa olhar.

## O que encontramos na primeira leitura (14/10/2026)

- **Das 164 evidências nas pastas, nenhuma segue o padrão de nome.** Nenhum nome termina com o mês (MMAAAA). Por isso o robô nunca entregou nada sozinho: toda entrega depende de uma pessoa.
- **135 das 150 lidas estão em pastas sem planilha de planejamento**: o robô não sabe de quem são. A tela Entregas PEP não as mostra; a Auditoria de Documentos mostra.
- Das 150 lidas, 31 não deu para ler: 23 em formato que o robô não lê (foto, planilha, .doc antigo), 7 PDFs escaneados e 1 grande demais.

## Para quem usa

### Auditoria de Documentos PEP (`/relacionamento-prestador/auditoria-documentos`) — nova
- **Todos os documentos lidos**, inclusive de pastas sem planilha.
- **Cartões que filtram**: Lidos · Não auditados · Está bom · Pode conter erros · Está errado · Não foi possível ler · Cópias.
- **Abas**: *Por prestador* (um cartão por pasta, com o aviso "Pasta sem planilha"), *Todos os documentos* e *Cópias*.
- **Filtros**: mês, prestador (vários), documento (STC, ETC, TAP, TOP, PIC, RT, OE) e busca.
- **"Auditar N"**: audita os não auditados (e os auditados com régua antiga) do recorte. O progresso aparece no próprio botão; dá para sair da tela e cancelar o restante.
- **Painel do documento** (clique numa linha): o que está errado e o que pode conter erros, cada um com o trecho; a leitura da IA; as cópias com **"Comparar lado a lado"** (o realce mostra o que está escrito igual; o texto do modelo aparece apagado); a revisão de uma pessoa (problema confirmado, alarme falso, corrigido) com histórico; "Abrir no SharePoint".
- **Réguas**: o que a IA confere em cada tipo de documento. Uma régua por sigla, versionada. Dá para ler e baixar (.docx ou .md); editar e publicar uma versão nova, só RP e administradores, com nota obrigatória. Hoje há régua de **OE, ETC e PIC**; STC, TAP, TOP e RT passam só pelas conferências fixas até ganharem régua.

### Entregas PEP (`/relacionamento-prestador/pep`)
- **Selo "Ajustar nomenclatura"** na célula da grade, no painel de lançamento e numa aba do cartão do robô: a entrega vale, mas o arquivo precisa ser renomeado. Some quando o arquivo é renomeado no SharePoint.
- O lançamento manual confere o nome do caminho digitado.
- "Esperando você" mostra o nome esperado e avisa que dá para marcar mesmo assim.
- A seção de conferência de conteúdo saiu desta tela (foi para a Auditoria de Documentos).

### PDF por prestador
- A seção de arquivos fora do padrão se chama **"Ajustar nomenclatura"** e lista o nome certo de cada um.

### Painel do robô (`/admin/robo-sharepoint`)
- Etapa nova **"Ler documentos"**: quantos o robô leu e por que não leu alguns (só números; o texto não vai para o painel).

## Como cada documento é julgado

| Indicação | Quando |
|---|---|
| **Está errado** | Erro provado pelo trecho: sobra do modelo (`[nome]`, "colocar o nome do paciente", "xx horas", "Fulano", "Incluir gráfico", "(Ex. …"), campo vazio (data, coordenador, financiadora, vigência…), data que não existe, horário de término antes do início, documento de outro paciente, documento de outro tipo na pasta, só o modelo sem preenchimento, cópia ≥ 80% ou arquivo idêntico em outro lugar |
| **Pode conter erros** | Precisa de julgamento: tudo o que a IA aponta, data fora do mês, título não identificado, outro paciente citado, versão repetida do mesmo documento, parecido 50–80% |
| **Está bom** | Passou em todas as conferências |
| **Não foi possível ler** | PDF escaneado, com senha, corrompido, formato que o robô não lê, grande demais |
| **Lido, não auditado** | O robô leu; ninguém pediu a auditoria |

Calibrado com os documentos reais em 14/10 (antes, quase tudo saía "errado" por alarme falso): datas em mês/ano valem; linha de assinatura não é campo vazio; TAP (manual e folha de registro para o aplicador) não conta instruções como sobra do modelo; cópia exige conteúdo escrito de verdade (formulário em branco não é cópia).

## Proteção dos dados

- O **texto** dos documentos fica numa tabela que **nenhum login lê** — só o servidor do Pulsar, depois de conferir a permissão. Some em **90 dias** (limpeza diária às 04:15). Fica uma impressão digital, que continua acusando cópias de documentos antigos.
- A IA (OpenAI) recebe o texto **mascarado**: paciente, profissional, responsáveis, escola, data de nascimento, CPF, telefone e e-mail viram marcadores. Risco que sobra: um nome solto no meio de uma frase que não está em nenhum campo nem no cadastro.
- O comparador só abre pares que o sistema já marcou como parecidos.
- Quem tem só a permissão da Auditoria de Documentos **não lê as tabelas do robô**, que guardam CPF de paciente (e as planilhas dos prestadores, CPFs em lista): a tela recebe a lista por uma função do banco que devolve só os campos necessários, sem CPF.
- Testado: 35 + 34 conferências no PGlite (quem lê e quem escreve o quê, CPF fora da lista) e teste com a chave pública em produção.

## Para aplicar (nesta ordem)

1. Migration `20261015100000_pep_auditoria_documentos.sql` — volta tudo a "Lido, não auditado", cria as réguas e a permissão da tela.
2. Migration `20261014161000_catalogo_permissoes_espelha_sidebar.sql` — cadastra o código da tela no catálogo.
3. Redeploy do frontend. O robô não precisa de redeploy.
4. Em /admin/permissoes → Por grupo, marcar **Auditoria de Documentos PEP** nos grupos que devem ver a tela (nasce sem grupo; só admin vê até lá).

Já aplicadas em 14/10: `20261014100000` (motivos do nome) e `20261014110000` (conteúdo). Robô 0.5.0 já em produção.

## Pendências

- Réguas de STC, TAP, TOP e RT (quando chegarem, publicar na tela).
- Pastas sem planilha: 135 documentos sem prestador reconhecido.
- Leitura completa das 03:00 de 14/10 estourou o tempo do banco na etapa "Reconhecer no Pulsar" (robô 0.4.0, antes desta entrega). Acompanhar.
