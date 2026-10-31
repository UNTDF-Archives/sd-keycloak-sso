# Guía paso a paso: armar el SSO con Keycloak

Se hace entre los dos, en orden. Cada paso dice **qué hacés** y **por qué**.
Esta guía se probó de punta a punta en la VM (con los mismos pasos hechos por API, no por la interfaz web). Los puntos marcados **VERIFICAR** son los únicos que dependen de la interfaz gráfica y no se pudieron comprobar: si algo se ve distinto, corregir la guía.

Usuarios y contraseñas de ejemplo: elijan las suyas. Todo el resto (nombres de realm, rol, clientes) debe copiarse tal cual, porque `docker-compose.yml` los usa.

Arquitectura:

```
Navegador (tu PC)
   ├─ http://192.168.56.10:4180  → proxy-a (oauth2-proxy) → web-a   (cualquier usuario autenticado)
   ├─ http://192.168.56.10:4181  → proxy-b (oauth2-proxy) → web-b   (exige rol acceso-b)
   └─ http://192.168.56.10:8080  → Keycloak (realm "untdf")
```

`oauth2-proxy` hace de "portero": si no hay sesión, redirige a Keycloak; vuelve con un código, lo cambia por tokens y deja pasar (o no) a la app. Así no hay que programar login en las apps.

## 0. Preparar la VM (sdist0)

> En `sdist0` el shell de login es **fish**, no bash. Los comandos de esta guía sirven igual en fish. Si alguna vez pegan un script con `for ...; do ... done`, ejecútenlo con `bash`.

```bash
ssh sdist0
git clone <URL-del-repo> sd-keycloak-sso && cd sd-keycloak-sso   # o copiarlo con scp
cp .env.example .env && nano .env       # poner KC_ADMIN_PASSWORD
docker-compose pull                      # baja imágenes (hacerlo con internet, queda cacheado)
docker-compose up -d keycloak web-a web-b
docker-compose logs -f keycloak          # esperar "Listening on: http://0.0.0.0:8080"; Ctrl+C
```

Por qué solo `keycloak`, `web-a` y `web-b`: los proxies necesitan que el realm ya exista para descubrir la configuración de Keycloak. Se levantan en el paso 6.

Abrí en tu PC: `http://192.168.56.10:8080` → *Administration Console* → entrá con `KC_ADMIN` / tu password.

## 1. Crear el realm

*Realm* = espacio aislado con sus propios usuarios, clientes y roles. Nunca se usa `master` para las apps.

1. Menú superior izquierdo (dice *master*) → **Create realm**.
2. Realm name: `untdf` → **Create**.

### 1.b Idioma en español (para que el login y el logout salgan en español)

1. **Realm settings → Localization** → **Internationalization: ON**.
2. **Supported locales**: `Español` (y `English` si quieren). **Default locale**: `Español` → **Save**.

Sin esto, Keycloak muestra el login y la confirmación de cierre de sesión en inglés. Por API se probó con `internationalizationEnabled`, `supportedLocales` y `defaultLocale`; los nombres exactos de la pantalla son **VERIFICAR**. La pantalla de acceso denegado (403) ya sale en español desde `proxy-templates/error.html`, sin configurar nada.

## 2. Crear el rol

1. Menú izquierdo **Realm roles** → **Create role**.
2. Role name: `acceso-b` → **Save**.

## 3. Crear dos usuarios

Por cada uno: **Users → Add user**.

| Usuario | Rol |
|---|---|
| `alice` | `acceso-b` |
| `bob` | ninguno |

1. Username, Email (`alice@demo.local`), First name, Last name. **Email verified: ON**. **Create**.
2. Pestaña **Credentials** → **Set password** → poner una, **Temporary: OFF** → Save.
3. Solo `alice`: pestaña **Role mapping** → **Assign role** → marcar `acceso-b` → **Assign**.

## 4. Crear los clientes (las dos apps)

*Client* = una aplicación que le pide a Keycloak que autentique usuarios.

Repetir para `app-a` y `app-b`: **Clients → Create client**.

1. General: Client type `OpenID Connect`, Client ID `app-a` (después `app-b`) → Next.
2. Capability config: **Client authentication: ON** (confidential, tiene secreto), **Standard flow** marcado (Authorization Code), el resto sin marcar → Next.
3. Login settings:
   - `app-a`: Valid redirect URIs `http://192.168.56.10:4180/oauth2/callback`, Web origins `http://192.168.56.10:4180`.
   - `app-b`: igual con puerto `4181`.
4. **Save**.
5. Pestaña **Credentials** → copiar **Client secret** y pegarlo en `.env` (`APP_A_SECRET` / `APP_B_SECRET`).

Por qué la redirect URI exacta: Keycloak solo devuelve el código a URLs registradas. Evita que un atacante reciba tu código.

### 4.b Mapper de audiencia (obligatorio, sin esto el login termina en error 500)

Repetir en `app-a` y en `app-b`:

1. **Clients → app-a → Client scopes** → entrar a `app-a-dedicated`.
2. **Add mapper → By configuration → Audience**.
3. Name: `audience-app-a`. **Included Client Audience**: `app-a`. **Add to access token: ON**. Add to ID token: OFF → **Save**.

Por qué: Keycloak pone `aud=account` por defecto y el proxy exige su propio `client_id` en `aud`. Sin mapper, el log del proxy dice `audience from claim aud with value [account] does not match with any of allowed audiences` y el navegador muestra 500 después de loguearse. (**VERIFICAR** los nombres de los botones; el mapper equivalente se probó por API.)

## 5. Cliente para la falla del token vencido

**Clients → Create client**: Client ID `cli-test`, **Client authentication: OFF** (público), marcar **Direct access grants**, desmarcar Standard flow → Save.
(Direct access grants es el flujo "password": solo para esta prueba por consola. No se usa en apps reales.)

Después: **Realm settings → Tokens → Access Token Lifespan: 1 minute** → Save. Así el vencimiento se ve en 1 min en vez de 5 (valor por defecto).

## 6. Levantar los proxies

```bash
docker-compose up -d proxy-a proxy-b
docker-compose logs proxy-a proxy-b | tail
```

Si el log dice `failed to discover OIDC configuration`, revisar que el realm se llame `untdf` y que `http://192.168.56.10:8080/realms/untdf/.well-known/openid-configuration` abra en el navegador.

## 7. Probar (en ventana de incógnito)

1. `http://192.168.56.10:4180` → te redirige a Keycloak → login `alice` → ves App A. **(AuthN)**
2. `http://192.168.56.10:4181` → entrás **sin** volver a loguearte. **(SSO)**
3. Ver claims: `http://192.168.56.10:4181/oauth2/userinfo`.
4. Cerrar sesión (`/oauth2/sign_out` y también en Keycloak: `http://192.168.56.10:8080/realms/untdf/account` → Sign out). Entrar con `bob`: App A funciona, App B responde **403 Forbidden** con el texto *"You do not have permission to access this resource."*. **(AuthZ)** Ojo: bob pasa por Keycloak sin login (hay SSO) y recién en el callback el proxy lo rechaza.
5. Token vencido: `./scripts/token-expirado.sh alice` (desde tu PC; copiar `.env` ahí). Muestra 200, espera, y da 401.

## 8. Respaldar el realm (cuando todo ande)

`kc.sh export` **no funciona con el servidor encendido** (la base H2 queda bloqueada). Hay que detener Keycloak y exportar con un contenedor temporal:

```bash
docker-compose stop keycloak
docker-compose run --rm keycloak export --realm untdf --file /opt/keycloak/data/realm-untdf.json
docker-compose up -d keycloak
docker-compose cp keycloak:/opt/keycloak/data/realm-untdf.json ./realm-untdf.json
```

Alternativa desde la interfaz: **Realm settings → Action → Partial export** (exporta roles, clientes y configuración, **no** usuarios ni contraseñas). **VERIFICAR** cuál de las dos prefieren; la de la consola es la más simple.

Para reimportar al arrancar: montar el archivo en `/opt/keycloak/data/import/` y usar `command: start-dev --import-realm`.

## Problemas típicos

| Síntoma | Causa probable |
|---|---|
| `Invalid parameter: redirect_uri` | La redirect URI no coincide exacto con la del cliente |
| Entrar a B pide login de nuevo | Las dos cookies de proxy tienen el mismo nombre (aquí ya son distintas) |
| Proxy en bucle de reinicios | Realm todavía no existe o `VM_IP` mal |
| `issuer` no coincide | El navegador usa otro hostname/IP que `KC_HOSTNAME` |
| Todos pasan a B | Falta `ALLOWED_ROLES` o el rol no llega al token |
| 500 al volver del login, log: `audience ... [account] does not match` | Falta el mapper de audiencia (paso 4.b) |
| Log del proxy: `oidc: issuer did not match` | `OIDC_ISSUER_URL` y `KC_HOSTNAME` no son exactamente la misma URL |
| El script da `HTTP 403` con token vigente | Faltó `scope=openid` al pedir el token |
| El script dice `No se obtuvo token` | `cli-test` sin *Direct access grants*, o usuario/clave mal |
| `docker-compose up` no encuentra variables | Falta copiar `.env.example` a `.env` |

## Las trampas, explicadas

Cada una se reprodujo en la VM. La explicación completa, con el porqué de cada regla, está en la sección 8 de `Guia-Teoria.md` (Obsidian). Resumen:

1. **Issuer idéntico:** el proxy y el navegador deben usar la misma URL de Keycloak (`KC_HOSTNAME`). Dos nombres para el mismo servidor son dos emisores distintos.
2. **Cookies por host, no por puerto:** A y B comparten cookies en `192.168.56.10`; por eso cada proxy tiene un `COOKIE_NAME` propio.
3. **Audiencia (`aud`):** el token debe nombrar al cliente que lo recibe (mapper del paso 4.b).
4. **`/userinfo` pide `scope=openid`.**
5. **Los JWT no se revocan solos:** viven poco (Access Token Lifespan) para limitar el daño.
6. **El cierre de sesión no es global:** "Cerrar sesión" en A borra la cookie de A y la sesión de Keycloak, pero B conserva su propia cookie de proxy y sigue abierta hasta que venza (7 días por defecto). Observado en la VM. Para la demo, usar **ventanas de incógnito nuevas** al cambiar de usuario (como dice `DEMO.md`) en vez de depender del botón. Cerrar todas las apps a la vez requiere *back-channel logout* (Keycloak avisa a cada app), fuera del alcance de esta demo; se puede nombrar como trade-off.

Para entender cada una: reprodúzcanlas a propósito. Cambien el `OIDC_ISSUER_URL` del proxy a `http://keycloak:8080/realms/untdf` (trampa 1), o saquen el `COOKIE_NAME` de uno (trampa 2), y lean el síntoma. Luego restauren.

## Sobre docker-compose

La VM tiene `docker-compose` 1.29.2 (versión 1, ya sin soporte). Para esta demo **funciona sin cambios**, se probó entera con esa versión. No hace falta actualizar; hacerlo implicaría `sudo` y tocar la VM de toda la materia sin beneficio para la demo.
