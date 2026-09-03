# Pontes de backend

Cada exemplo mantém a API key, o projeto e a origem configurados no servidor. Todos expõem a mesma interface para o Web Component:

```text
POST /api/consulta-autofill/session
POST /api/consulta-autofill/decode
POST /api/consulta-autofill/metrics  # opcional, recomendado
```

| Stack | Estado |
|---|---|
| [Next.js](nextjs) | App Router, Route Handler Node e teste de handler. |
| [Express](express) | Servidor Node executável e teste HTTP. |
| [Laravel](laravel) | Controller, config, rotas e testes de feature. |
| [FastAPI](fastapi) | Aplicação Python e testes ASGI. |
| [Go](go) | Servidor `net/http` e testes com `httptest`. |
| [Spring Boot](spring-boot) | Java 17+, Maven, controller e upstream simulado. |
| [ASP.NET Core](aspnet-core) | .NET 10 LTS Minimal API e `HttpMessageHandler` simulado. |

O workflow **Backend examples** executa os sete exemplos contra upstreams
sintéticos. Nenhum teste usa uma chave, QR, foto ou documento real.

As pontes não vêm com bypass de autenticação: Next.js, Express, FastAPI, Go,
Spring Boot e ASP.NET Core negam por padrão com `401` até que o parceiro
conecte o adaptador à sua sessão server-side e ao escopo/RBAC de cadastro.
Laravel usa o middleware `auth` nas rotas de produção. Não use `project-id`,
QR, payload, header inventado pelo browser ou token compartilhado como prova
de identidade. Os testes injetam uma política sintética apenas para verificar
o encaminhamento; ela não vira configuração de produção.

Cada rota exige o header `Origin` idêntico à origem HTTPS configurada. Não
torne essa checagem opcional: o componente envia o header em todas as chamadas
JSON, e uma requisição sem ele deve receber `403`.

O adaptador deve ter esta semântica, usando o mecanismo de sessão já existente
na aplicação parceira:

```text
principal = ler_sessao_server_side(request)
permitir = principal autenticado && principal.tem_permissao("cadastro:escrever")
```

Ele deve falhar fechado quando a sessão, o provedor de identidade ou a regra de
autorização estiver indisponível.

`/metrics` aceita apenas `protocol_version`, `session_token` e um evento fixo;
ela encaminha o funil sem PII ao painel Consulta. Os limites de taxa em memória
são deliberadamente didáticos. Produção distribuída deve usar a
identidade/autorização do parceiro e um armazenamento compartilhado para rate
limit, sem incluir QR, token, foto, campo, valor ou identidade final nas chaves
ou nos logs.
