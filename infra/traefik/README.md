# Traefik existente na VPS

O AdapterPay **não** sobe um Traefik próprio e **não** publica portas 80/443/3000 no host (a porta 3000 do host pertence ao EasyPanel). O roteamento é feito pelo Traefik já instalado na VPS, por labels Docker no `docker-compose.prod.yml`.

## 1. Inspecione a VPS antes do deploy

Não presuma nomes. Descubra os valores reais:

```bash
# Rede usada pelo Traefik (ex.: traefik, traefik9, easypanel)
docker network ls
docker inspect $(docker ps -q --filter "name=traefik") --format '{{json .NetworkSettings.Networks}}' | jq 'keys'

# Entrypoints e certresolver configurados
docker inspect $(docker ps -q --filter "name=traefik") --format '{{json .Args}}' | tr ',' '\n' | grep -E 'entrypoints|certificatesresolvers'
# ou leia o traefik.yml/static config montado no container
```

Preencha no `.env`:

| Variável | Exemplo | Origem |
|---|---|---|
| `TRAEFIK_NETWORK` | `traefik9` | rede externa à qual o Traefik está conectado |
| `TRAEFIK_ENTRYPOINT` | `https` | nome do entrypoint TLS (`--entrypoints.<nome>.address=:443`) |
| `TRAEFIK_CERT_RESOLVER` | `letsencrypt` | `--certificatesresolvers.<nome>...` |
| `APP_HOST` | `adapterpay.adapterco.com.br` | domínio único de produção |
| `TRUSTED_PROXIES` | `172.18.0.0/16` | sub-rede da rede `TRAEFIK_NETWORK` (`docker network inspect $TRAEFIK_NETWORK`) |

## 2. Roteamento

- `Host(adapterpay.adapterco.com.br) && PathPrefix(/api)` → serviço `api:4000` (prioridade **100**)
- `Host(adapterpay.adapterco.com.br)` → serviço `web:3000` (prioridade **10**)

SSE (`/api/v1/events/...` e `/api/v1/public/.../events`) passa pelo Traefik sem buffering; a API envia `X-Accel-Buffering: no` e heartbeats a cada 15 s.

## 3. DNS e TLS

1. Registros `A`/`AAAA` de `adapterpay.adapterco.com.br` apontando para o IP da VPS.
2. O certificado é emitido pelo resolver existente no primeiro acesso HTTPS.
3. Verifique: `curl -I https://adapterpay.adapterco.com.br/api/v1/health/live`.

## 4. OAuth Mercado Pago

Cadastre no app Mercado Pago a Redirect URL **exata**:

```
https://adapterpay.adapterco.com.br/api/v1/integrations/mercado-pago/callback
```

## 5. HTTP → HTTPS

O redirecionamento de HTTP para HTTPS deve estar no entrypoint web do Traefik existente (configuração global). Se não estiver, adicione um router HTTP com middleware `redirectscheme` — sem publicar novas portas.
