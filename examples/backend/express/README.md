# Exemplo Express

Ponte same-origin de referência para `@consulta-dev/autofill`. A API key fica somente no processo Node.

```bash
cp .env.example .env
npm install
npm start
```

Exponha o componente com `endpoint="/api/consulta-autofill"` e, para o funil
sem PII, `metrics-endpoint="/api/consulta-autofill/metrics"`. Antes de
produção, conecte `requirePartnerAccess` à autenticação/autorização do seu
produto e substitua o rate limit em memória por Redis ou equivalente
compartilhado.

O exemplo não registra corpo de request/response, QR, token, foto ou campos. Consulte [a integração completa](../../../docs/INTEGRATION.md).
