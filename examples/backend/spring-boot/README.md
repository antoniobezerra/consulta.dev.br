# Exemplo Spring Boot

Ponte same-origin para Spring Boot 3.5 e Java 17+. A API key, projeto e origem
ficam exclusivamente no processo Java; o browser usa somente
`endpoint="/api/consulta-autofill"` e, para o funil sem PII,
`metrics-endpoint="/api/consulta-autofill/metrics"`.

```bash
cp .env.example .env
# Exporte as variáveis do .env pelo gerenciador de ambiente do seu projeto.
mvn test
mvn spring-boot:run
```

O exemplo expõe:

```text
POST /api/consulta-autofill/session
POST /api/consulta-autofill/decode
POST /api/consulta-autofill/metrics
```

Ele limita JSON a 1 MiB, valida a origem HTTPS exata configurada no servidor,
fixa `X-Consulta-Project-ID`, aplica timeout de dez segundos, usa rate limit
local e não registra QR, token, foto, campos ou corpo do upstream. Os testes
cobrem origem inválida, campos não permitidos, a origem fixada na sessão e os
headers autenticados do upstream simulado.

Substitua `requirePartnerAccess` pela sessão/RBAC do seu produto e o rate limit
em memória por armazenamento compartilhado antes de produção. Consulte o
[guia de integração](../../../docs/INTEGRATION.md).
