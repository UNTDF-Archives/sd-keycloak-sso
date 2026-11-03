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
git clone <URL-del-repo> sd-keycloak-sso && cd sd-keycloak-sso   # o copiarlo con scp (incluir keycloak-theme/)
cp .env.example .env && nano .env       # poner KC_ADMIN_PASSWORD
docker-compose pull                      # baja imágenes (hacerlo con internet, queda cacheado)
docker-compose up -d keycloak web-a web-b
docker-compose logs -f keycloak          # esperar "Listening on: http://0.0.0.0:8080"; Ctrl+C
```

> **Ojo con `.env`:** `docker-compose` da prioridad a las variables ya exportadas en la terminal. Si hicieron `source .env` (o `set -a; . ./.env`) *antes* de completar `APP_A_SECRET` y `APP_B_SECRET`, los proxies arrancan con el secreto vacío y fallan con `missing setting: client-secret`. Solución: abrir una terminal nueva (o `unset APP_A_SECRET APP_B_SECRET`) y repetir `docker-compose up -d`.

El compose monta `keycloak-theme/untdf` dentro de Keycloak (tema de login, paso 1.c). Si lo agregan después de haber levantado Keycloak, hay que recrear el contenedor: `docker-compose up -d keycloak` (los datos del realm no se pierden, viven en el volumen `kc-data`).

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

### 1.c Tema de login con el estilo de las apps

El login y la pantalla de confirmación de cierre de sesión usan un tema propio (`keycloak-theme/untdf/login/`): mismos colores, bordes cuadrados y tipografía que App A y App B, sin recursos externos.

1. **Realm settings → General** → **Display name**: `SSO UNTDF` (es el texto de la cabecera) → **Save**.
2. **Realm settings → Themes** → **Login theme**: `untdf` → **Save**.

Por API: `loginTheme: "untdf"` y `displayName: "SSO UNTDF"` en el realm. Si el tema no aparece en la lista, el volumen no está montado (ver paso 0). Al editar el CSS no hace falta reiniciar: `start-dev` no cachea temas; alcanza con Ctrl+F5. Alcance: login, errores y confirmación de logout; la consola de administración y la página de cuenta siguen con el estilo de Keycloak.

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
   - En ambos: **Valid post logout redirect URIs** `http://192.168.56.10:4180/*` (`4181` en `app-b`). Sin esto, al cerrar sesión Keycloak no vuelve a la app.
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
En la pestaña **Settings** de `cli-test`, **Web origins**: `http://192.168.56.10:4180` y `http://192.168.56.10:4181`. Sin esto el navegador bloquea (CORS) el botón de prueba que está en las páginas de App A y App B.
(Direct access grants es el flujo "password": solo para esta prueba. No se usa en apps reales.)

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
4. Cerrar sesión con el botón **Cerrar sesión** (cierra el proxy y Keycloak; Keycloak pide confirmar y vuelve a la app). La otra app, si está abierta, vuelve sola al login en unos 2–4 s (ver trampa 6). Entrar con `bob`: App A funciona, App B responde **403 Forbidden** con el texto *"You do not have permission to access this resource."*. **(AuthZ)** Ojo: bob pasa por Keycloak sin login (hay SSO) y recién en el callback el proxy lo rechaza.
5. Token vencido, con el botón: en App A o App B, panel **Prueba: token vencido** → contraseña de `alice` → **Probar token vencido**. Muestra "Token vigente · HTTP 200" con una cuenta regresiva y, a los 60 s, "Token vencido · HTTP 401". Usa un token propio (`cli-test`), independiente de tu sesión: el proxy renueva la sesión del navegador solo, por eso ahí el vencimiento no se ve.
   Alternativa por consola: `./scripts/token-expirado.sh alice` (desde tu PC; copiar `.env` ahí).

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
| El botón de token dice `No se pudo probar: Failed to fetch` | Falta *Web origins* en `cli-test` (CORS, paso 5) |
| El botón de token dice `usuario o contraseña incorrectos` | Credenciales mal, o `cli-test` sin *Direct access grants* |
| Al cerrar sesión, Keycloak muestra `Invalid redirect uri` | Falta **Valid post logout redirect URIs** en el cliente (paso 4) |
| Proxy: `missing setting: client-secret` | Secretos vacíos en el entorno de la terminal (ver recuadro del paso 0) |
| El login sale con el estilo de Keycloak | Falta asignar el tema (paso 1.c) o el volumen `keycloak-theme` no está montado |
| La otra app tarda más de ~5 s en caer tras el logout | `OAUTH2_PROXY_COOKIE_REFRESH` alto o proxy sin recrear (`docker-compose up -d proxy-a proxy-b`) |
| `docker-compose up` no encuentra variables | Falta copiar `.env.example` a `.env` |

## Las trampas, explicadas

Cada una se reprodujo en la VM. La explicación completa, con el porqué de cada regla, está en la sección 8 de `Guia-Teoria.md` (Obsidian). Resumen:

1. **Issuer idéntico:** el proxy y el navegador deben usar la misma URL de Keycloak (`KC_HOSTNAME`). Dos nombres para el mismo servidor son dos emisores distintos.
2. **Cookies por host, no por puerto:** A y B comparten cookies en `192.168.56.10`; por eso cada proxy tiene un `COOKIE_NAME` propio.
3. **Audiencia (`aud`):** el token debe nombrar al cliente que lo recibe (mapper del paso 4.b).
4. **`/userinfo` pide `scope=openid`.**
5. **Los JWT no se revocan solos:** viven poco (Access Token Lifespan) para limitar el daño.
6. **El cierre de sesión no es global por defecto:** "Cerrar sesión" en A borra la cookie de A y la sesión de Keycloak, pero B conserva su propia cookie de proxy (7 días por defecto) y seguiría abierta. Se mitiga con dos piezas: `OAUTH2_PROXY_COOKIE_REFRESH: 2s` hace que cada proxy revalide su sesión con Keycloak (refresh token) cada 2 s, y cada página consulta `/oauth2/auth` cada 2 s y se recarga si recibe 401. Resultado: la otra app cae en unos 2–4 s. Es *polling*: sirve para la demo, pero con muchos usuarios genera carga en Keycloak. La solución real es *back-channel logout* (Keycloak avisa a cada app), que `oauth2-proxy` v7.6 no soporta; se puede nombrar como trade-off. Detalle observado: con la revalidación en 1 minuto, un usuario que entra a B justo después del logout en A todavía veía la sesión anterior.

Para entender cada una: reprodúzcanlas a propósito. Cambien el `OIDC_ISSUER_URL` del proxy a `http://keycloak:8080/realms/untdf` (trampa 1), o saquen el `COOKIE_NAME` de uno (trampa 2), y lean el síntoma. Luego restauren.

## Sobre docker-compose

La VM tiene `docker-compose` 1.29.2 (versión 1, ya sin soporte). Para esta demo **funciona sin cambios**, se probó entera con esa versión. No hace falta actualizar; hacerlo implicaría `sudo` y tocar la VM de toda la materia sin beneficio para la demo.
