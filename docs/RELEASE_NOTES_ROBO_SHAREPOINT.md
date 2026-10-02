# 🚀 **Atualizações Entregues: Robô SharePoint e Evidências do PEP**

---

# 🖥️ **Administração · Robô SharePoint**

- 🆕 **Novo:** tela nova no menu Administração, para acompanhar o robô que lê o SharePoint dos prestadores (visível só para Admin até a validação).
- 🆕 **Novo:** faixa de situação do robô: Em dia, Executando agora, Fora do ar, Última execução falhou ou Parado por erro.
- 🆕 **Novo:** mostra a última execução, o horário fixo (todo dia às 03:00, GMT-3), a próxima execução e os dias até o certificado vencer.
- 🆕 **Novo:** botão **Executar agora** no cabeçalho da página, sem ficar por cima do sino de notificações.
- 🆕 **Novo:** seção **Como o robô funciona**, com o caminho do documento desenhado e animado em 8 estações (SharePoint, robô e Pulsar).
- 🆕 **Novo:** desenho da árvore de pastas de um prestador, com a sigla do PEP de cada subpasta e as pastas 6 e 7 marcadas como fora do PEP.
- 🆕 **Novo:** desenho dos 3 sinais (prestador, paciente e sessão no mês) que transformam um arquivo em sugestão.
- 🎯 **Melhoria:** a seção das etapas agora se chama **Resultado da última leitura** (e muda para "O robô está lendo agora" durante a execução).
- 🎯 **Melhoria:** cada etapa mostra o tempo, o estado e os números que ela encontrou, grandes e lado a lado (ex.: 72 evidências, 6 planilhas).
- 🆕 **Novo:** cada etapa concluída é clicável, com o convite **Ver o que foi lido** e destaque ao passar o mouse.
- 🆕 **Novo:** quadro **Custo para o Pulsar** com tempo total, tempo no banco, maior chamada ao banco e chamadas à Microsoft.
- 🎯 **Melhoria:** os quadros de custo ganharam ícone e barra comparando o tempo com a meta (até 15 s no total e até 1 s no banco).
- 🆕 **Novo:** **Histórico completo** de execuções, com filtro por quem pediu (agenda ou Executar agora).
- 🆕 **Novo:** fila de **Não reconhecidos**, com o motivo de cada um e vínculo manual da pasta ao prestador ou paciente certo.
- ⚡ **Desempenho:** Executar agora responde na hora, roda uma execução por vez e respeita 5 minutos de intervalo entre pedidos.

---

# 🔎 **Administração · Robô SharePoint · O que o robô leu**

- 🆕 **Novo:** painel lateral que abre ao tocar numa etapa, com largura ampliada e o resumo da execução no topo.
- 🆕 **Novo:** trilha fixa com as 5 etapas (Autenticar, Listar, Classificar, Ler planilhas e Reconhecer) para navegar sem fechar o painel.
- 🆕 **Novo:** **Autenticar** mostra como o robô entrou: certificado, acesso só de leitura e dias até o vencimento.
- 🆕 **Novo:** **Explorador de pastas**, com um quadro por prestador que desce até cada paciente e suas 7 subpastas.
- 🆕 **Novo:** pastas vazias aparecem esmaecidas, com o total de arquivos e evidências e o atalho para abrir no SharePoint.
- 🆕 **Novo:** lista de **todos os arquivos**, um por um, com busca, filtro por tipo e ordem por pasta, data ou nome.
- 🆕 **Novo:** janela de cada arquivo com prestador, paciente, competência, quem enviou, quando, tamanho e os 3 sinais do reconhecimento.
- 🆕 **Novo:** **Matriz de evidências** no formato da tela PEP: pacientes nas linhas e STC, ETC, TAP, TOP, PIC, RT e OE nas colunas.
- 🆕 **Novo:** cada número da matriz é clicável e mostra os arquivos daquela célula, colorida pela situação (sugestão, confirmada ou não reconhecida).
- 🆕 **Novo:** cada planilha de planejamento desenhada como planilha, com as abas Planejamento e Pacientes.
- 🆕 **Novo:** ao lado de cada paciente da planilha: CPF válido ou inválido (nunca o número), pasta achada ou ausente e nome no Pulsar.
- 🆕 **Novo:** lista dos prestadores sem planilha, com quantos pacientes e evidências estão esperando.
- 🆕 **Novo:** quadro completo de cada sugestão, com os 3 sinais que a validaram e os botões Abrir na PEP e Arquivo.
- 🆕 **Novo:** **Pacientes, um por um**, com os 4 sinais, o nome no Pulsar, os arquivos por item e os filtros "Na planilha sem pasta" e "Pasta fora da planilha".
- 🆕 **Novo:** lista de **arquivos novos** nesta execução e dos arquivos presos em cada motivo de não reconhecimento.
- 🎯 **Melhoria:** execuções antigas avisam que não guardaram o detalhe e oferecem abrir a última leitura completa.

---

# 📋 **Relacionamento Prestador · Entregas PEP**

- 🆕 **Novo:** quadro **Evidências do SharePoint**, com o que o robô achou para o analista no mês e o atalho para o arquivo.
- 🆕 **Novo:** botões **Confirmar entrega** e **Ignorar** em cada sugestão: nada entra sem o clique de uma pessoa do RP.
- 🎯 **Melhoria:** ao confirmar, a entrega é gravada pelo mesmo caminho do lançamento manual, com trilha de auditoria e o nome de quem clicou.
- 🆕 **Novo:** o sistema explica por que uma sugestão não pode ser confirmada (mês liberado, item completo, paciente fora da Grade ou semestral sem planejamento).
- 🎯 **Melhoria:** a regra da entrega semestral, inclusive a antecipada, agora é uma só para o lançamento manual e para o robô.
- 🆕 **Novo:** **Modo teste** exclusivo do Admin, com profissional e paciente fictícios que não entram na apuração nem na remuneração.

---

# 🤖 **Robô (programa na hospedagem)**

- 🆕 **Novo:** programa próprio que lê o SharePoint só para consulta, todo dia às 03:00, sem abrir nenhum documento.
- 🆕 **Novo:** a pasta define o que o arquivo é (Supervisão, Estudo, Treinamento, Plano, Relatório ou Orientação Escolar).
- 🆕 **Novo:** lê a planilha de cada prestador em memória (CNPJ, pacientes e CPF) e a descarta em seguida.
- 🆕 **Novo:** confere o dígito verificador de CPF e CNPJ e usa a planilha mais recente quando há duas.
- ⚡ **Desempenho:** depois da primeira leitura completa, busca só o que mudou e espera sozinho quando a Microsoft pede.
- ⚡ **Desempenho:** envia ao banco em lotes de até 1.000 arquivos, com pausa de 300 ms entre eles.
- 🆕 **Novo:** a partir da versão 0.3, envia todos os arquivos lidos, o endereço de cada pasta e as linhas do Planejamento (sem CPF).
- 🐞 **Bug:** o robô não repete mais a chamada quando o banco corta por excesso de tempo.
- 🆕 **Novo:** inventário só de leitura, que gera relatório sem nome, sem CPF e sem caminho.
- 🧪 **Qualidade:** 35 testes automáticos cobrindo pastas, planilha, CPF, CNPJ e execução.

---

# 🔐 **Configuração · Microsoft**

- 🆕 **Novo:** aplicativo do Pulsar registrado no Microsoft Entra ID, sem usuário e sem senha, autenticado por certificado digital.
- 🔒 **Segurança:** permissão somente leitura em um único site (Sites.Selected): o repositório de documentos dos prestadores.
- 🔒 **Segurança:** dois certificados separados, Pulsar Dev (3 meses) e Pulsar Produção (12 meses).
- 🔒 **Segurança:** o administrador recebeu só a parte pública do certificado; a chave privada nunca saiu da máquina do Pulsar.
- 🔒 **Segurança:** o administrador pode revogar o acesso do robô a qualquer momento, com um clique no Entra ID.
- 📅 **Lembrete:** renovar o certificado de teste até 29/11/2026 e o de produção até 31/08/2027 (o painel avisa 30 dias antes).

---

# 🚀 **Configuração · Hospedagem**

- 🆕 **Novo:** recurso robo-pep-sharepoint criado dentro do projeto Sistema PULSAR, sem projeto novo.
- 🔒 **Segurança:** sem endereço público e sem porta aberta: o robô só responde dentro da rede interna da hospedagem.
- 🔒 **Segurança:** todas as variáveis sensíveis (chave do banco, certificado, chave do robô e segredo do botão) marcadas como secretas e travadas.
- 🔒 **Segurança:** a chave de serviço do banco nunca foi colocada neste recurso.
- ⚡ **Desempenho:** limite de 192 MB de memória e 0,5 CPU, para o robô não competir com o Pulsar.
- 🆕 **Novo:** verificação de saúde automática do robô e duas variáveis internas no aplicativo para o Executar agora funcionar.
- 🐞 **Bug:** o segredo do Executar agora estava diferente entre o robô e o aplicativo (erro 401); igualado e conferido sem expor o valor.
- 🔒 **Segurança:** a chave privada de produção será apagada da máquina local e passa a existir só na hospedagem.

---

# 🗄️ **Banco de Dados**

- 🆕 **Novo:** 7 tabelas próprias do robô, para execuções, pastas, prestadores, pacientes e evidências.
- 🆕 **Novo:** reconhecimento automático: prestador pelo CNPJ, paciente pelo CPF com conferência de nome e sessão de Coordenador de Caso no mês.
- 🆕 **Novo:** registro de cada arquivo lido por execução, guardado por 180 dias.
- 🆕 **Novo:** consultas prontas para a tela (resumo, árvore de pastas, matriz e pacientes), sem o corte silencioso de 1.000 linhas.
- 🔒 **Segurança:** o robô entra só por funções estreitas, com chave por máquina guardada como resumo criptográfico e revogável num comando.
- 🧪 **Qualidade:** atualizações testadas em banco local em todos os cenários, incluindo a simulação que desfaz tudo.

---

# 📊 **Primeira leitura completa**

- 📁 **Resultado:** 1.771 pastas, 14 prestadores, 210 pacientes, 93 arquivos, 72 evidências e 6 planilhas.
- ✅ **Resultado:** 6 de 14 prestadores e 68 pastas de paciente reconhecidos, com 4 sugestões geradas.
- ⏱️ **Desempenho:** 9,7 s no total, com 279 ms dentro do banco.

---

# ⚠️ **Pendências**

- 📥 **Atenção:** 10 dos 14 prestadores ainda não têm planilha de planejamento, e sem ela as evidências ficam em Não reconhecidos.
- 👥 **Atenção:** 3 CPFs duplicados no cadastro e 3 pastas de paciente que não constam na planilha.
- 📁 **Atenção:** 6 pastas "8." e 1 pasta de gráficos fora do padrão de 7 subpastas por paciente.
- 🧑‍⚖️ **Decisão:** o RP precisa definir o nome dos arquivos, a origem da competência e quem altera a planilha.

Tudo isso só lê, sugere e mostra: a decisão é sempre de uma pessoa do RP.
