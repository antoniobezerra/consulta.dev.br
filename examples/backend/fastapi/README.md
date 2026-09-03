# Exemplo FastAPI

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload
```

O exemplo oferece `/api/consulta-autofill/session` e `/decode`, com limite de corpo, origem exata, timeout e limite local. Troque `require_partner_access` pela autenticação/autorização do seu produto e o rate limiter em memória por Redis antes de múltiplos processos/instâncias.

Nenhum corpo sensível é escrito em logs. Leia [docs/INTEGRATION.md](../../../docs/INTEGRATION.md).
