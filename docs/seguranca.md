# Segurança, LGPD e auditoria

## Autenticação e sessão
- Senhas com **Argon2id** (19 MiB, t=2, p=1). Bloqueio de 15 min após 10 falhas; rate limit por IP e email (Redis).
- Sessão por cookie `__Host-ap_session` (HttpOnly, Secure, SameSite=Lax), token de 256 bits armazenado como SHA-256; expiração absoluta 7 dias, ociosa 12 h; revogação em logout, troca de senha e ativação de MFA.
- **CSRF**: double-submit (`__Host-ap_csrf` + header `X-CSRF-Token`) e verificação de `Origin`.
- **MFA TOTP** (RFC 6238) com 10 códigos de recuperação de uso único e proteção contra reuso de código. Obrigatório para superadmin (forçado no primeiro login). Para admins, operações `@Critical` exigem step-up quando o usuário tem MFA; a empresa pode exigir MFA de todos os admins.

## Autorização
- Tenant, papel e lojas resolvidos da **sessão** a cada requisição; IDs da URL nunca substituem autorização.
- RBAC (`packages/shared/src/roles.ts`) + escopo por loja (`store_memberships`) para VENDEDOR e CONTADOR.
- FKs compostas `(id, tenant_id)` impedem associações cross-tenant no banco. Testes de acesso cruzado em `apps/api/test`.

## Segredos e criptografia
- AES-256-GCM (`ENCRYPTION_KEY`, id de chave no ciphertext) para tokens MP, segredo MFA e CPF/CNPJ.
- **Rotação**: defina nova `ENCRYPTION_KEY`/`ENCRYPTION_KEY_ID` e mova a antiga para `ENCRYPTION_PREVIOUS_KEYS`; o job `key-rotation` (diário) recifra tudo; depois remova a chave antiga.
- `.env` com permissão 600; token da plataforma como Docker secret.
- Logs pino com redação de `authorization`, cookies, tokens e senhas; snapshots do provedor saneados (`redactPayload`) antes de persistir.

## HTTP
- HTTPS obrigatório, HSTS, CSP com nonce no web (`script-src 'self' 'nonce-…' 'strict-dynamic'`), `frame-ancestors 'none'`, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy.
- `trust proxy` restrito à rede do Traefik (`TRUSTED_PROXIES`).
- OpenAPI só com HTTP Basic configurado; `/metrics` só com bearer token.

## Páginas públicas
- Slugs/tokens aleatórios (≥128 bits), rate limit, `Cache-Control: no-store`, `noindex`.
- Somente: nome da loja/caixa, primeiro nome do vendedor, valor, prazo e BR Code do POS enquanto a cobrança é a ativa. Sem IDs internos, comprador ou histórico.
- BR Code validado (EMV + CRC16 + GUI Pix); mudanças de BR Code são auditadas (`pos.brcode_changed`); código inválido não é exibido.
- Slug rotacionável (`rotatePublicSlug`) se uma placa for comprometida.

## LGPD
- Exportação de dados da empresa (`GET /privacy/export`, auditada).
- Exclusão lógica de usuários (desativação); registros financeiros e auditoria preservados.
- Limpeza diária de sessões, tokens de email e states OAuth expirados.
- Recibo interno é **não fiscal**; não há emissão de NF-e/NFC-e.

## Auditoria
`audit_logs`: ator, tenant, recurso, ação, before/after saneados, IP, user-agent, correlation_id. Cobre login, MFA, OAuth, lojas, POS, cobranças, usuários, assinaturas, exportações e ações de superadmin.
