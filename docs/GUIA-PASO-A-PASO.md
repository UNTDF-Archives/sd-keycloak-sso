# Guía paso a paso: armar el SSO con Keycloak

Se hace entre los dos, en orden. Cada paso dice **qué hacés** y **por qué**.
Esta guía se probó de punta a punta en la VM (con los mismos pasos hechos por API, no por la interfaz web). Los puntos marcados **VERIFICAR** son los únicos que dependen de la interfaz gráfica y no se pudieron comprobar: si algo se ve distinto, corregir la guía.

Usuarios y contraseñas de ejemplo: elijan las suyas. Todo el resto (nombres de realm, rol, clientes) debe copiarse tal cual, porque `docker-compose.yml` los usa.

Arquitectura:

```
Navegador (tu PC)
   ├─ http://192.168.56.10:4180  → proxy-a (oauth2-proxy) → web-a   (cualquier usuario autenticado)
   ├─ http://192.168.56.10:4181  → proxy-b (oauth2-proxy) → web-b   (exige rol acceso-b)
   ├─ http://192.168.56.10:4182  → proxy-corto             → web-corto (prueba de token vencido: token de 15 s)
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
docker-compose up -d keycloak web-a web-b web-corto
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
5. Pestaña **Credentials** → copiar **Client secret** y pegarlo en `.env` (`APP_A_SECRET` / `APP_B_SECRET`; el de `app-corto` es `APP_CORTO_SECRET`, paso 5).

Por qué la redirect URI exacta: Keycloak solo devuelve el código a URLs registradas. Evita que un atacante reciba tu código.

### 4.b Mapper de audiencia (obligatorio, sin esto el login termina en error 500)

Repetir en `app-a` y en `app-b`:

1. **Clients → app-a → Client scopes** → entrar a `app-a-dedicated`.
2. **Add mapper → By configuration → Audience**.
3. Name: `audience-app-a`. **Included Client Audience**: `app-a`. **Add to access token: ON**. Add to ID token: OFF → **Save**.

Por qué: Keycloak pone `aud=account` por defecto y el proxy exige su propio `client_id` en `aud`. Sin mapper, el log del proxy dice `audience from claim aud with value [account] does not match with any of allowed audiences` y el navegador muestra 500 después de loguearse. (**VERIFICAR** los nombres de los botones; el mapper equivalente se probó por API.)

## 5. Token vencido: cliente `app-corto` (y `cli-test` para consola)

Un token de acceso vive poco. Para mostrar el vencimiento **real** (no un contador falso) hace falta un cliente cuyo token dure 15 s y cuyo proxy **no lo renueve**. Va aparte de `app-a` y `app-b` porque el tiempo de vida es una propiedad del *cliente* en Keycloak: si se lo bajamos a esos dos, toda la demo se cortaría cada 15 s.

**5.a Cliente `app-corto`.** Igual que `app-a` (paso 4, con *Client authentication: ON* y *Standard flow*), con estas diferencias:
- Valid redirect URIs `http://192.168.56.10:4182/oauth2/callback`, Web origins `http://192.168.56.10:4182`, **Valid post logout redirect URIs** `http://192.168.56.10:4182/*`.
- Mapper de audiencia `audience-app-corto` con *Included Client Audience* `app-corto` (igual que el paso 4.b).
- Pestaña **Advanced → Advanced settings → Access Token Lifespan: `15 Seconds`** → Save.
- Pestaña **Credentials** → copiar el secreto a `.env` como `APP_CORTO_SECRET`.

Y en `app-a` y `app-b` dejar el *Access Token Lifespan* en el valor del realm (60 s, más abajo): el proxy los renueva cada 30 s y la sesión no se corta sola.

**5.b Tiempo de vida del realm.** **Realm settings → Tokens → Access Token Lifespan: 1 minute** → Save (el valor por defecto es 5 min).

**5.c Cliente `cli-test` (solo para el script de consola `scripts/token-expirado.sh`).** **Clients → Create client**: Client ID `cli-test`, **Client authentication: OFF** (público), marcar **Direct access grants**, desmarcar Standard flow → Save. (Direct access grants es el flujo "password": solo para esa prueba. No se usa en apps reales.)

**Cómo funciona la prueba en las páginas.** El botón **Probar token vencido** de App A y App B lleva a `http://192.168.56.10:4182` (página `apps/corto`, detrás de `proxy-corto`). Se entra por SSO, sin contraseña, y llega un token real de 15 s. La página muestra "Token vence en N s" leyendo el vencimiento del propio token (el proxy lo expone en `/oauth2/auth` con `SET_XAUTHREQUEST` y `PASS_ACCESS_TOKEN`; solo para la demo). A los 15 s el proxy responde 401 y aparece la pantalla "Token vencido". **Volver a entrar** no pide contraseña (Keycloak recuerda la sesión SSO) y emite un token nuevo de 15 s.

## 6. Levantar los proxies

```bash
docker-compose up -d proxy-a proxy-b proxy-corto
docker-compose logs proxy-a proxy-b proxy-corto | tail
```

Si el log dice `failed to discover OIDC configuration`, revisar que el realm se llame `untdf` y que `http://192.168.56.10:8080/realms/untdf/.well-known/openid-configuration` abra en el navegador.

## 7. Probar (en ventana de incógnito)

1. `http://192.168.56.10:4180` → te redirige a Keycloak → login `alice` → ves App A. **(AuthN)**
2. `http://192.168.56.10:4181` → entrás **sin** volver a loguearte. **(SSO)**
3. Ver claims: `http://192.168.56.10:4181/oauth2/userinfo`.
4. Cerrar sesión con el botón **Cerrar sesión** (cierra el proxy y Keycloak; Keycloak pide confirmar y vuelve a la app). La otra app queda cerrada en el momento del clic y, si está abierta, muestra en 1–2 s la pantalla **Sesión cerrada** con **Volver a entrar** (ver "Si nos preguntan"). Entrar con `bob`: App A funciona, App B responde **403 Forbidden** con el texto *"You do not have permission to access this resource."*. **(AuthZ)** Ojo: bob pasa por Keycloak sin login (hay SSO) y recién en el callback el proxy lo rechaza.
5. Token vencido: en App A o App B, botón **Probar token vencido** → se abre `:4182` sin pedir contraseña, con "Token vence en N s". A los 15 s aparece la pantalla **Token vencido** (el proxy respondió 401). **Volver a entrar** emite otro token sin pedir contraseña (SSO).
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
| `400 Bad Request: Request Header Or Cookie Too Large` al volver a una app | Falta montar `proxy-templates/web.conf` en `web-a`, `web-b` y `web-corto` (ver compose) |
| Tras cerrar sesión, la otra app sigue mostrando al usuario | El navegador tiene el JavaScript viejo (Ctrl+F5), o la página se sirvió de caché (falta `web.conf` con `no-store`) |
| `Invalid parameter: redirect_uri` | La redirect URI no coincide exacto con la del cliente |
| Entrar a B pide login de nuevo | Las dos cookies de proxy tienen el mismo nombre (aquí ya son distintas) |
| Proxy en bucle de reinicios | Realm todavía no existe o `VM_IP` mal |
| `issuer` no coincide | El navegador usa otro hostname/IP que `KC_HOSTNAME` |
| Todos pasan a B | Falta `ALLOWED_ROLES` o el rol no llega al token |
| 500 al volver del login, log: `audience ... [account] does not match` | Falta el mapper de audiencia (paso 4.b) |
| Log del proxy: `oidc: issuer did not match` | `OIDC_ISSUER_URL` y `KC_HOSTNAME` no son exactamente la misma URL |
| El script da `HTTP 403` con token vigente | Faltó `scope=openid` al pedir el token |
| El script dice `No se obtuvo token` | `cli-test` sin *Direct access grants*, o usuario/clave mal |
| El botón "Probar token vencido" no abre nada / `proxy-corto` en bucle de reinicios | Falta `APP_CORTO_SECRET` en `.env` o el cliente `app-corto` (paso 5.a); después `docker-compose up -d proxy-corto` |
| La pantalla de token vencido no aparece | `proxy-corto` sin `COOKIE_EXPIRE: 15s` (el proxy no corta por el `exp` del token), con `COOKIE_REFRESH` distinto de `0`, o `app-corto` sin *Access Token Lifespan* de 15 s |
| "Token vence en" queda en `…` | Faltan `SET_XAUTHREQUEST` y `PASS_ACCESS_TOKEN` en `proxy-corto` |
| Al cerrar sesión, Keycloak muestra `Invalid redirect uri` | Falta **Valid post logout redirect URIs** en el cliente (paso 4) |
| Proxy: `missing setting: client-secret` | Secretos vacíos en el entorno de la terminal (ver recuadro del paso 0) |
| El login sale con el estilo de Keycloak | Falta asignar el tema (paso 1.c) o el volumen `keycloak-theme` no está montado |
| La otra app no cae al cerrar sesión con el botón | El navegador sigue con el JavaScript viejo (Ctrl+F5), o el logout se hizo directo en Keycloak (ver "Si nos preguntan") |
| `docker-compose up` no encuentra variables | Falta copiar `.env.example` a `.env` |

## Las trampas, explicadas

Cada una se reprodujo en la VM. La explicación completa, con el porqué de cada regla, está en la sección 8 de `Guia-Teoria.md` (Obsidian). Resumen:

1. **Issuer idéntico:** el proxy y el navegador deben usar la misma URL de Keycloak (`KC_HOSTNAME`). Dos nombres para el mismo servidor son dos emisores distintos.
2. **Cookies por host, no por puerto:** A y B comparten cookies en `192.168.56.10`; por eso cada proxy tiene un `COOKIE_NAME` propio.
3. **Audiencia (`aud`):** el token debe nombrar al cliente que lo recibe (mapper del paso 4.b).
4. **`/userinfo` pide `scope=openid`.**
5. **Los JWT no se revocan solos:** viven poco (Access Token Lifespan) para limitar el daño.
6. **El cierre de sesión no es global por defecto:** cada `oauth2-proxy` guarda su propia cookie de sesión (7 días). "Cerrar sesión" en A borra la cookie de A y la sesión de Keycloak, pero B conserva la suya y sigue abierta. Cómo lo resolvimos y por qué: ver la sección "Si nos preguntan: cierre de sesión en las dos apps" más abajo.

Para entender cada una: reprodúzcanlas a propósito. Cambien el `OIDC_ISSUER_URL` del proxy a `http://keycloak:8080/realms/untdf` (trampa 1), o saquen el `COOKIE_NAME` de uno (trampa 2), y lean el síntoma. Luego restauren.

## Si nos preguntan: cierre de sesión en las dos apps

**El problema.** Con SSO hay una sesión en Keycloak y una cookie por cada app (la de su proxy). Al cerrar sesión en A, Keycloak cierra la suya, pero B no se entera: su cookie sigue válida.

**Lo correcto en producción: *back-channel logout*.** Keycloak, al cerrarse una sesión, le manda a cada app registrada un aviso servidor a servidor (`POST` a una URL de logout con un token firmado) y cada app borra su sesión. Es instantáneo, no depende del navegador y no genera consultas periódicas. Se configura por cliente (*Backchannel logout URL*). **No lo usamos porque `oauth2-proxy` v7.6 no tiene ese endpoint** (no verificado contra una versión más nueva: conviene revisar el changelog antes de afirmarlo para otras versiones). Con otro portero, o con la librería OIDC dentro de cada app, sí se podría.

**Lo que hace la demo (dos piezas, solo en el navegador):**
1. **El botón "Cerrar sesión" cierra las dos apps.** Antes de ir a Keycloak, la página llama a `/oauth2/sign_out?rd=%2Foauth2%2Fauth` del proxy de la *otra* app. Funciona porque las cookies de los dos proxies son del mismo host (`192.168.56.10`, distinto puerto), así que el navegador las envía. El `rd=/oauth2/auth` hace que esa llamada termine en un 401 y **no** en el login de Keycloak: si terminara allí, Keycloak (con el SSO todavía vivo) volvería a loguear a la otra app en silencio.
2. **Las páginas consultan `/oauth2/auth` cada segundo.** Si reciben 401, muestran la pantalla **Sesión cerrada** con **Volver a entrar**. **No se recargan solas**: mientras el usuario no confirma el logout en Keycloak el SSO sigue vivo, y una recarga automática volvería a entrar sola (se vio en las pruebas: `Initiating login` y un segundo después `AuthSuccess` en el log del proxy).

**Dos errores que se encontraron probando en Chromium (para no repetirlos):**
- `fetch(..., { mode: "no-cors", redirect: "manual" })` falla en Chromium con `TypeError: Failed to fetch`, y el error quedaba tapado por un `.catch`: la cookie de la otra app nunca se borraba. Con `rd=/oauth2/auth` y redirección normal funciona.
- Las cookies de los tres proxies viajan juntas (mismo host) y, con el token, superaban los 8 KB de nginx: `400 Request Header Or Cookie Too Large`. `proxy-templates/web.conf` sube el límite (`large_client_header_buffers 4 32k`) y desactiva la caché de las páginas (`Cache-Control: no-store`) para que siempre pasen por el proxy.

**Limitaciones que hay que conocer (y decir si preguntan):**
- Solo cubre el cierre hecho **desde el botón de nuestras páginas**. Si alguien cierra sesión directo en Keycloak (o desde otro navegador, o el administrador mata la sesión), las apps no se enteran al instante.
- Es *polling*: con muchos usuarios genera una consulta por segundo por pestaña. Sirve para la demo, no para producción.
- Depende del navegador: si la llamada a la otra app falla, el logout sigue igual (tiene un tope de 1 s) y la otra app queda abierta.
- La otra app avisa pero no cierra sola: hay que apretar **Volver a entrar**.

**Por qué `COOKIE_REFRESH` solo no alcanza (se probó).** `OAUTH2_PROXY_COOKIE_REFRESH` (30 s en A y B) hace que el proxy renueve su sesión con el refresh token, y por eso la sesión no se corta sola. Pero tras cerrar sesión en Keycloak la renovación falla (`invalid_grant "Session not active"`) y `oauth2-proxy` v7.6 solo registra el error: **sigue aceptando la sesión hasta que vence el access token** (60 s aquí). Por eso sin las dos piezas anteriores la otra app tardaba hasta 1 minuto en caer. Si el cierre se hace directo en Keycloak, la caída llega recién al vencer el token. Bajar el *Access Token Lifespan* acorta esa espera pero genera más renovaciones; para la demo no sirve porque nunca es instantáneo.

**Resumen en una frase:** *la solución correcta es back-channel logout; como nuestro proxy no lo soporta, la demo cierra la otra app desde el navegador y lo declaramos como limitación.*

## Si nos preguntan: token vencido

- **¿El vencimiento es real?** Sí. `app-corto` emite un access token (JWT) con `exp` a 15 s y `proxy-corto` tiene la renovación desactivada (`COOKIE_REFRESH: 0`) y la cookie de sesión de 15 s (`COOKIE_EXPIRE: 15s`). Al vencer, el proxy responde 401 en `/oauth2/auth`. Se probó que `oauth2-proxy` v7.6 **no corta la sesión por el `exp` del access token**: con renovación apagada y cookie de 7 días seguía respondiendo 202 con el token ya vencido. Por eso la sesión del proxy se hace durar lo mismo que el token. La cuenta regresiva sale del `exp` del propio token y se calcula con el reloj del servidor (cabecera `Date`), no con el del navegador.
- **¿Por qué un cliente aparte?** El tiempo de vida del token es del cliente. Con `app-a` y `app-b` en 15 s la demo se cortaría sola todo el tiempo. Así el vencimiento ocurre solo cuando se toca el botón.
- **¿Por qué "Volver a entrar" no pide contraseña?** Porque hay dos cosas distintas: el *token* (vive 15 s) y la *sesión SSO* en Keycloak (vive 30 min de inactividad por defecto). Con el token vencido, el proxy manda a Keycloak, que ve la sesión SSO activa y emite un token nuevo. Es lo esperado y se puede nombrar: el token corto limita el daño si se roba, la sesión larga evita pedir contraseña a cada rato.
- **¿Por qué exponer el access token a la página?** Solo para mostrar el vencimiento en la demo. En una app real el token no se entrega al JavaScript del navegador (queda del lado del proxy o del servidor).

## Sobre docker-compose

La VM tiene `docker-compose` 1.29.2 (versión 1, ya sin soporte). Para esta demo **funciona sin cambios**, se probó entera con esa versión. No hace falta actualizar; hacerlo implicaría `sudo` y tocar la VM de toda la materia sin beneficio para la demo.
