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
| [Spring Boot](spring-boot) | Java 17+, Maven, controller e upstream simulado. |
| [ASP.NET Core](aspnet-core) | .NET 10 LTS Minimal API e `HttpMessageHandler` simulado. |

Os limites de taxa em memória são deliberadamente didáticos. Produção distribuída deve usar a identidade/autorização do parceiro e um armazenamento compartilhado para rate limit, sem incluir QR, token, foto ou campos nas chaves ou nos logs.
