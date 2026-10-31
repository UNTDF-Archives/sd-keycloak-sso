#!/usr/bin/env bash
# Falla 2: un JWT vence. Pide un token, lo usa (200), espera a que expire y lo reusa (401).
# Requiere: curl, jq. Cliente publico "cli-test" con Direct access grants (ver guia).
set -euo pipefail
source "$(dirname "$0")/../.env"
USER_NAME="${1:-alice}"; read -rsp "Password de $USER_NAME: " PASS; echo
BASE="http://${VM_IP}:8080/realms/${REALM}/protocol/openid-connect"

TOKEN=$(curl -s "$BASE/token" -d grant_type=password -d client_id=cli-test -d scope=openid \
  -d username="$USER_NAME" -d password="$PASS" | jq -r .access_token)
[ "$TOKEN" != "null" ] || { echo "No se obtuvo token: revisar usuario, password y cliente cli-test"; exit 1; }

# Payload del JWT = 2da parte, en base64url. tr lo pasa a base64 comun; jq lo decodifica (sin exigir relleno).
payload() { cut -d. -f2 <<<"$TOKEN" | tr '_-' '/+' | jq -R '@base64d | fromjson'; }

echo "== Claims del token (payload) =="
payload | jq '{iss, sub, preferred_username, roles: .realm_access.roles, exp, iat}'

call() { curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$BASE/userinfo"; }
echo "== Token vigente =="; call
LIFE=$(payload | jq '.exp - .iat')
echo "== Esperando ${LIFE}s a que expire =="; sleep "$((LIFE + 2))"
echo "== Token vencido =="; call
