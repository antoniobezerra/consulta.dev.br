# Exemplo ASP.NET Core

Ponte same-origin em Minimal API para .NET 10 LTS. A chave, o projeto e a
origem são carregados somente pelo processo; o componente usa
`endpoint="/api/consulta-autofill"` e, para o funil sem PII,
`metrics-endpoint="/api/consulta-autofill/metrics"`.

```bash
cp .env.example .env
# Exporte as variáveis do .env pelo gerenciador de ambiente do seu projeto.
dotnet test ConsultaAutofill.AspNetCore.sln
dotnet run --project ConsultaAutofill.AspNetCore
```

Os endpoints são:

```text
POST /api/consulta-autofill/session
POST /api/consulta-autofill/decode
POST /api/consulta-autofill/metrics
```

O exemplo faz parsing JSON estrito com limite de 1 MiB, valida a origem HTTPS
fixada no servidor, usa timeout/cancelamento do `HttpClient`, limita respostas
do upstream, aplica rate limit local e não registra QR, token, foto, campos ou
corpos. Os testes cobrem origem inválida, campo de browser não permitido e os
headers configurados no servidor contra um `HttpMessageHandler` sintético.

`DenyPartnerAccessPolicy` é registrada por padrão e responde `401`. Substitua
o registro de `IPartnerAccessPolicy` por uma implementação que leia a
autenticação/RBAC server-side e exija a permissão de cadastro do seu produto;
não derive acesso de `project-id`, QR, payload ou token estático do browser.
Troque também o rate limit em memória por armazenamento compartilhado antes de
produção. Leia o [guia de integração](../../../docs/INTEGRATION.md).
