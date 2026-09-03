# Exemplo Go

```bash
cp .env.example .env # exporte as variáveis, ou use seu gerenciador de segredos
go run .
```

Para executar os testes da ponte contra um upstream sintético:

```bash
go test ./...
```

O servidor expõe a ponte same-origin em `/api/consulta-autofill/session`,
`/decode` e a ponte opcional `/metrics`, fixa a credencial/projeto no ambiente
e limita corpo, origem, timeout e taxa localmente. Use
`metrics-endpoint="/api/consulta-autofill/metrics"` para acompanhar o funil sem
PII. O servidor passa `denyPartnerAccess` e portanto responde `401` até que
você conecte o middleware de sessão/RBAC do seu produto ao parâmetro do
handler. Nunca derive acesso de `project-id`, QR, payload ou token estático do
browser. Troque o limiter em memória por Redis/serviço compartilhado em
produção horizontal.

Não há log de QR, token, foto, arquivo ou campos. Veja [docs/INTEGRATION.md](../../../docs/INTEGRATION.md).
