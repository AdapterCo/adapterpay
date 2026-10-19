# Segredos (não versionados)

Este diretório é ignorado pelo Git (exceto este README).

- `mp_platform_access_token`: Access Token de **produção** da conta Mercado Pago da **plataforma Adapter Co.** (cobrança das assinaturas). Montado como Docker secret em `/run/secrets/mp_platform_access_token` nos serviços `api` e `worker`. No `.env`: `MP_PLATFORM_CREDENTIALS_REF=file:/run/secrets/mp_platform_access_token`.

```bash
install -m 600 /dev/null infra/secrets/mp_platform_access_token
printf '%s' 'APP_USR-...' > infra/secrets/mp_platform_access_token
```

As credenciais dos **lojistas** nunca ficam aqui: são obtidas por OAuth e armazenadas cifradas (AES-256-GCM) no banco.

O `.env` de produção deve ter permissão `600` e pertencer ao usuário de deploy.
