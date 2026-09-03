# Pontes de backend

Cada exemplo mantém a API key, o projeto e a origem configurados no servidor. Todos expõem a mesma interface para o Web Component:

```text
POST /api/consulta-autofill/session
POST /api/consulta-autofill/decode
```

| Stack | Estado |
|---|---|
| [Next.js](nextjs) | App Router, Route Handler Node. |
| [Express](express) | Servidor Node executável. |
| [Laravel](laravel) | Controller, config e rotas para projeto Laravel. |
| [FastAPI](fastapi) | Aplicação Python executável. |
| [Go](go) | Servidor `net/http` executável. |
| [Spring Boot](spring-boot) | Segunda fase. |
| [ASP.NET Core](aspnet-core) | Segunda fase. |

Os limites de taxa em memória são deliberadamente didáticos. Produção distribuída deve usar a identidade/autorização do parceiro e um armazenamento compartilhado para rate limit, sem incluir QR, token, foto ou campos nas chaves ou nos logs.
