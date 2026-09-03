# Exemplo Go

```bash
cp .env.example .env # exporte as variáveis, ou use seu gerenciador de segredos
go run .
```

O servidor expõe a ponte same-origin em `/api/consulta-autofill/session` e `/decode`, fixa a credencial/projeto no ambiente e limita corpo, origem, timeout e taxa localmente. Integre `requirePartnerAccess` ao seu middleware de autenticação e troque o limiter em memória por Redis/serviço compartilhado em produção horizontal.

Não há log de QR, token, foto, arquivo ou campos. Veja [docs/INTEGRATION.md](../../../docs/INTEGRATION.md).
