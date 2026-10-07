# Chamados Anônimos — Backend

Backend do sistema de recebimento de denúncias anônimas via WhatsApp. É esta API que recebe os webhooks da Evolution API, conduz a conversa com o cidadão (máquina de estados) e grava os chamados no Supabase — sempre sem armazenar nenhum dado que identifique o remetente.

Projeto desenvolvido como trabalho de conclusão de curso (TG 2). O painel administrativo (`canal-denuncias-painel`, React + Supabase) é um repositório irmão.

## Como funciona

```
Cidadão ── WhatsApp ──> Evolution API ──webhook──> Esta API (Express)
                                                      │
                          máquina de estados: LGPD → menu → categoria →
                          relato → confirmação → protocolo DEN-####-XXXX
                                                      │
                                                      ▼
                                              Supabase (PostgreSQL)
                                            chamados + registro_chamados
```

O retorno ao cidadão é feito sob consulta: ele recebe um protocolo ao enviar a denúncia e, quando quiser, consulta o andamento pelo próprio WhatsApp — o sistema nunca envia mensagens espontâneas.

## Endpoints

| Método | Rota | Autenticação | Descrição |
| --- | --- | --- | --- |
| `GET` | `/health` | — | Health check (uptime do serviço) |
| `POST` | `/webhook` | — | Recebe eventos da Evolution API (mensagens e status de conexão) |
| `POST` | `/provisionar/:empresaId` | Bearer | Cria a instância de WhatsApp de uma empresa e devolve o QR Code |
| `GET` | `/qr/:empresaId` | Bearer | Retorna o QR Code da instância de uma empresa |
| `POST` | `/simular` | Bearer* | Simula uma mensagem do cidadão e devolve a saída do bot (simulador) |
| `GET` | `/simular/:empresaId` | Bearer* | Lista conversas simuladas; com `?numero=` devolve a transcrição |
| `POST` | `/deploy-hook` | — | Acionado pelo GitHub: `git pull` + reinício do serviço |

\* A autenticação do simulador (`Bearer PROVISION_SECRET`) só é exigida se a variável `PROVISION_SECRET` estiver definida — assim é possível rodar 100% local sem segredos.

O webhook é registrado automaticamente na Evolution no provisionamento (`lib/evolution.js`), apontando para `${BACKEND_PUBLIC_URL}/webhook`.

## Máquina de estados

| Etapa | O que acontece |
| --- | --- |
| `/start` | Boas-vindas + aceite dos termos LGPD (obrigatório antes do menu) |
| Menu principal | Nova denúncia · Consultar protocolo · Encerrar |
| Categoria | Lista de categorias da própria empresa (vinda do banco) |
| Relato | Texto com mínimo de 10 caracteres, com confirmação ou reescrita |
| Protocolo | Gera `DEN-####-XXXX` e grava o chamado + histórico |
| Consulta | Devolve as atualizações do protocolo, incluindo respostas do painel |

Proteções: limite de 3 erros por etapa, encerramento automático por inatividade (5 min; 25 min durante a digitação do relato) e cancelamento de sessão a cada nova interação.

## Variáveis de ambiente (`.env`)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `SUPABASE_URL` | ✅ | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE` | ✅ | Chave `service_role` (o backend opera fora do RLS) |
| `SALT` | ✅ | Segredo do HMAC-SHA256 usado para anonimizar a sessão |
| `PROVISION_SECRET` | recomendado | Bearer das rotas de provisionamento/simulador |
| `EVOLUTION_API_URL` | para WhatsApp real | URL da Evolution API |
| `EVOLUTION_GLOBAL_API_KEY` | para WhatsApp real | Chave de acesso da Evolution API |
| `EVOLUTION_INSTANCE_NAME` | opcional | Instância padrão quando não informada |
| `BACKEND_PUBLIC_URL` | para WhatsApp real | URL pública desta API (registro do webhook) |
| `DRY_RUN` | opcional | `true` = loga as mensagens em vez de enviar |

## Rodando o projeto

```bash
npm install
node index.js          # servidor na porta 8000
```

Requisitos: Node.js 18+ e um projeto Supabase com as tabelas `chamados`, `registro_chamados`, `empresas`, `categorias` e `mensagens_bot` (scripts SQL no repositório `canal-denuncias-painel`).

Modo desenvolvimento: com `DRY_RUN=true` (ou sem as envs da Evolution) o servidor sobe normalmente e apenas loga os disparos; o fluxo completo pode ser exercitado pelo **Simulador de WhatsApp** do painel.

## Estrutura

```
├── index.js                 # Rotas Express (webhook, provisionamento, simulador)
├── functions.js             # Máquina de estados, gravação de chamados, disparos
├── db.js                    # Cliente Supabase (service role)
├── messages.js              # Textos padrão das mensagens do bot
├── lib/
│   └── evolution.js         # Criar/remover instância, QR e webhook da Evolution
└── utils/
    ├── botTexts.js          # Textos por empresa (mensagens_bot) + fallback
    └── messageBuilder.js    # Payloads de botões e listas do WhatsApp
```

## Integração com o painel

O `canal-denuncias-painel` consome este backend pelas Edge Functions do Supabase (`create-empresa`, `get-qr-empresa`, `simular-whatsapp`), que repassam as requisições com `Bearer PROVISION_SECRET` — o navegador nunca fala diretamente com a Evolution API.

## Licença

Uso acadêmico (trabalho de conclusão de curso).
