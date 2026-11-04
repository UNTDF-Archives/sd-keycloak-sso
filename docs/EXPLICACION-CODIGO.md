# Explicación del código, línea por línea

Objetivo: poder defender cada línea del repo. Cada sección dice **qué hace**, **para qué** y **qué pasa si se quita**.

## 1. Idea general

Las apps A y B son páginas HTML estáticas: no saben nada de usuarios. Delante de cada una hay un `oauth2-proxy`, un "portero" que habla OIDC con Keycloak. Toda petición del navegador pasa primero por el portero:

```
navegador ──► oauth2-proxy ──(si hay sesión y rol)──► nginx con la página
                  │
                  └─(si no hay sesión)──► redirige a Keycloak
```

Ventaja: se agrega autenticación sin tocar el código de las apps. Costo: el portero es un componente más que operar, y la app confía en que nadie llegue a ella saltándoselo (por eso `web-a` y `web-b` **no publican puertos** al exterior: solo se alcanzan a través del proxy).

## 2. `docker-compose.yml`

Docker Compose describe varios contenedores y cómo se conectan, en un solo archivo. Se usa porque la demo son 5 contenedores; con `docker run` serían 5 comandos largos imposibles de repetir sin errores. `docker-compose up -d` los levanta todos; `down` los apaga.

### Cabecera
- `version: "3.8"`: versión del formato. Necesaria en `docker-compose` 1.29 (la que tiene la VM).
- Todos los servicios quedan en una red interna creada por Compose. Ahí se resuelven por nombre: el proxy llega a la página con `http://web-a:80`. Es un DNS interno de Docker, parecido en idea al Bind9 del TP8.

### `x-proxy-common` (bloque reutilizable)
(`volumes: ./proxy-templates:/templates:ro` monta la plantilla `error.html` en los dos proxies; `error.html` usa `{{.StatusCode}}` para cambiar el texto cuando el error es 403.)
- Las claves que empiezan con `x-` las ignora Compose: sirven para guardar texto reutilizable.
- `&proxy-common` le pone nombre ("ancla") al bloque; `<<: *proxy-common` en cada proxy lo copia. Así no se repiten las líneas que son iguales para A y B. `&proxy-env` y `<<: *proxy-env` hacen lo mismo con las variables de entorno.
- `image: quay.io/oauth2-proxy/oauth2-proxy:v7.6.0`: imagen del portero con versión fija (si no fijás versión, mañana puede cambiar y romper la demo).
- `restart: unless-stopped`: si el contenedor se cae, Docker lo reinicia. Lo usamos porque el proxy **falla al arrancar** si el realm aún no existe; con esto se levanta solo en cuanto exista.

### Variables `OAUTH2_PROXY_*` (equivalen a flags de la herramienta)
| Variable | Qué hace | Si se quita |
|---|---|---|
| `PROVIDER: keycloak-oidc` | Usa el adaptador de Keycloak, que además sabe leer roles | Con `oidc` genérico no filtra por rol |
| `OIDC_ISSUER_URL` | URL del realm. De ahí descubre solo los endpoints (`/.well-known/openid-configuration`) y las claves públicas | No arranca |
| `SCOPE: openid email profile` | Permisos pedidos. `openid` es lo que convierte OAuth2 en OIDC y trae el ID token | Sin `openid` no hay identidad |
| `EMAIL_DOMAINS: "*"` | Acepta usuarios de cualquier dominio de email | Rechaza a todos (por defecto exige uno) |
| `CODE_CHALLENGE_METHOD: S256` | Activa PKCE: el proxy manda un hash de un secreto temporal y luego lo demuestra. Evita que un código robado sirva | Funciona igual, pero menos seguro |
| `COOKIE_SECURE: "false"` | Permite la cookie por HTTP. En producción va `true` con HTTPS | Con HTTP el navegador no guarda la cookie y se entra en bucle |
| `COOKIE_SECRET` | Clave con la que el proxy cifra su cookie de sesión. Debe tener 16, 24 o 32 bytes | No arranca |
| `SKIP_PROVIDER_BUTTON: "true"` | Salta la pantalla "Sign in with Keycloak" y redirige directo | Aparece un botón extra |
| `WHITELIST_DOMAINS: ${VM_IP}:8080` | Dominios a los que el proxy deja redirigir con `rd=` (aquí, Keycloak para el logout) | `/oauth2/sign_out?rd=...` rechaza la redirección |
| `COOKIE_REFRESH: 30s` | Cada 30 s el proxy renueva la sesión con el refresh token, así la sesión no se corta cuando vence el access token (60 s). Si Keycloak ya cerró la sesión, la renovación falla pero v7.6 solo lo registra y acepta la sesión hasta que vence el token. `proxy-corto` lo pone en `0` a propósito: sin renovación el token vence de verdad | Sin él, la sesión de A y B se corta cada 60 s |
| `CUSTOM_TEMPLATES_DIR: /templates` | Carpeta con plantillas propias del proxy. Se usa `error.html` para mostrar el 403 en español y con el estilo de las apps | El 403 sale en inglés y sin estilo |
| `HTTP_ADDRESS: 0.0.0.0:4180` | Escucha en todas las interfaces del contenedor, puerto 4180 | Escucha solo en localhost del contenedor y no se alcanza |

Las comillas en `"*"` y `"true"` son para que YAML no los interprete como otra cosa.

### Servicio `keycloak`
- `image: quay.io/keycloak/keycloak:26.0.7`: el servidor de identidad.
- `command: start-dev`: modo desarrollo. Habilita HTTP, base de datos H2 embebida y no exige HTTPS. **Nunca en producción** (ahí es `start` con HTTPS y base real).
- `KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD`: crea el primer administrador al iniciar. Los valores salen de `.env`.
- `KC_HOSTNAME: http://${VM_IP}:8080`: la URL pública de Keycloak. **Es la línea más importante.** Keycloak escribe esta URL como `iss` (issuer) dentro de cada token. El proxy compara el `iss` con `OIDC_ISSUER_URL`; si el navegador entró por otra dirección, no coinciden y la validación falla.
- `ports: "8080:8080"`: publica el puerto en la VM (`puerto_vm:puerto_contenedor`). Así tu PC llega a `192.168.56.10:8080`.
- `volumes: kc-data:/opt/keycloak/data`: guarda los datos fuera del contenedor. Sin esto, `docker-compose down` borra el realm, los usuarios y los clientes.

### `web-a` y `web-b`
- `nginx:alpine`: servidor web mínimo.
- `./apps/a:/usr/share/nginx/html:ro`: monta la carpeta local como carpeta pública de nginx. `:ro` = solo lectura. No tienen `ports`: no se alcanzan desde afuera.

### `proxy-a` y `proxy-b`
- `ports: "4180:4180"` (A) y `"4181:4180"` (B): el puerto interno es el mismo, el externo cambia para que no choquen en la VM.
- `CLIENT_ID`: nombre del cliente en Keycloak (`app-a`, `app-b`). Debe coincidir exacto.
- `CLIENT_SECRET`: contraseña del cliente. Demuestra a Keycloak que quien pide el intercambio de código es realmente esa app. Viene de `.env`.
- `REDIRECT_URL`: dónde vuelve el navegador tras el login. Debe estar registrada igual en Keycloak.
- `COOKIE_NAME` distinto (`_proxy_a`, `_proxy_b`): **trampa importante**. Las cookies se aíslan por *host*, no por puerto. `192.168.56.10:4180` y `:4181` comparten cookies. Con el mismo nombre, A y B se pisarían la sesión.
- `UPSTREAMS: http://web-a:80`: a dónde reenvía el tráfico autorizado.
- `ALLOWED_ROLES: acceso-b` (solo B): **es toda la autorización de la demo.** El proxy lee los roles del token y responde 403 si falta ese rol. A no lo tiene, por eso acepta a cualquier usuario autenticado.

### `volumes: kc-data:`
Declara el volumen nombrado que usa Keycloak.

## 3. `.env` y `.env.example`
Compose reemplaza `${VAR}` con lo que hay en `.env`. Se separa del compose para no subir secretos a git (`.env` está en `.gitignore`; `.env.example` es la plantilla sin valores reales). `VM_IP` cambia si la IP de la VM cambia; `REALM` es el nombre del realm.

## 4. `apps/a/index.html` y `apps/b/index.html`

Son dos páginas estáticas casi idénticas. Solo cambian los atributos `data-*` del `<body>` (nombre, puerto de la otra app) y el color de acento. No traen fuentes ni librerías externas: funcionan sin internet. Los colores salen del tema claro de Lumina (fondo `#f8f7f4`, tinta `#131209`; A azul `#1d4ed8`, B rojo `#be123c`). A tiene forma de cuadrado y B de círculo, para distinguirlas aunque no se vean bien los colores.

Cómo muestran quién eres, sin que las apps tengan lógica de login:
- Al cargar, el JavaScript hace `fetch("/oauth2/userinfo")`. Es del mismo origen: el proxy responde con los datos de la sesión (usuario, correo, `groups`). No se maneja ningún token en la página.
- Keycloak entrega los roles de realm dentro de `groups` como `role:<nombre>`. El script deja solo los de negocio y descarta los técnicos (`offline_access`, `uma_authorization`, `default-roles-*`, `account:*`).
- Todo se escribe con `textContent` (nunca `innerHTML`), para que un dato raro no pueda inyectar HTML.
- Si `userinfo` falla, la página dice "No se pudo leer tu sesión" en vez de quedar vacía.
- "Ir a App X": el enlace se arma con `location.hostname` y el puerto de la otra app, así no hay IP escrita a mano.
- Logout global: el clic en "Cerrar sesión" primero llama a `/oauth2/sign_out?rd=%2Foauth2%2Fauth` del proxy de la otra app (`fetch` con `mode: "no-cors"` y `credentials: "include"`, tope de 1 s) y recién después navega al logout de Keycloak. Las cookies de los proxies son del mismo host, por eso el navegador las envía. El `rd=/oauth2/auth` hace que la llamada termine en 401 y no en Keycloak, que re-loguearía a la otra app por el SSO activo. (`redirect: "manual"` con `no-cors` no sirve: Chromium lo rechaza.)
- Chequeo de sesión: un `setInterval` consulta `/oauth2/auth` cada 1 s; si responde 401 (la sesión murió en otra app), muestra la pantalla **Sesión cerrada** con **Volver a entrar** (`location.reload()`). No recarga sola, porque con el SSO de Keycloak todavía vivo la página se volvería a loguear en silencio. Es *polling*, válido para la demo. Lo correcto en producción sería *back-channel logout* (ver "Si nos preguntan" en `GUIA-PASO-A-PASO.md`).
- Botón "Probar token vencido": enlace a `origin:4182` (la página de prueba, ver 4.c). No maneja tokens en A ni en B.
- "Cerrar sesión": va a `/oauth2/sign_out?rd=<logout de Keycloak>`, y ese logout lleva `client_id` y `post_logout_redirect_uri` para que Keycloak vuelva a la app (requiere *Valid post logout redirect URIs* en el cliente). El proxy borra su cookie y redirige a Keycloak, que cierra la sesión SSO. Si solo se cerrara la del proxy, entrar de nuevo reautenticaría solo (el SSO sigue vivo). Para que el proxy acepte ese `rd` externo existe `WHITELIST_DOMAINS: ${VM_IP}:8080` en el compose. Keycloak puede mostrar una pantalla de confirmación de cierre.

## 4.b0 `proxy-templates/web.conf`

Configuración de nginx de `web-a`, `web-b` y `web-corto` (reemplaza el `default.conf`). Igual al de fábrica salvo dos líneas: `large_client_header_buffers 4 32k` (las cookies de sesión de los tres proxies viajan juntas porque comparten host, y con el token superan los 8 KB por defecto: error 400) y `Cache-Control: no-store` (así el navegador no muestra una página guardada tras cerrar sesión: siempre pasa por el proxy).

## 4.c `apps/corto/index.html` y `proxy-corto`

Página de la prueba de token vencido. Es la misma plantilla que App A, más una fila "Token vence en" y una pantalla modal "Token vencido". Se sirve con `web-corto` (nginx) detrás de `proxy-corto` (puerto 4182, cliente `app-corto`).
- `app-corto` tiene *Access Token Lifespan* de 15 s en Keycloak, y `proxy-corto` tiene `COOKIE_REFRESH: "0"` (no renueva) y `COOKIE_EXPIRE: 15s` (la sesión del proxy dura lo mismo que el token). Esto último es necesario: se probó que `oauth2-proxy` v7.6 no rechaza la sesión por el `exp` del access token, solo por el tiempo de vida de su cookie. Con ambos valores en 15 s, `/oauth2/auth` responde 401 a los 15 s.
- `SET_XAUTHREQUEST` y `PASS_ACCESS_TOKEN` hacen que `/oauth2/auth` devuelva la cabecera `X-Auth-Request-Access-Token`. La página la decodifica (base64url, segunda parte del JWT), lee `exp` y lo resta a la hora del servidor (cabecera `Date`) para evitar errores por relojes distintos. **Solo demo**: en producción el token no se entrega al JavaScript.
- Cada segundo consulta `/oauth2/auth`. Con 401 muestra la pantalla (no recarga sola) con **Volver a entrar** (`location.reload()`: el proxy va a Keycloak, que tiene la sesión SSO y emite otro token sin pedir contraseña) y **Cerrar sesión**.

## 4.b `keycloak-theme/untdf/login/`

Tema de login de Keycloak. `theme.properties` hereda del tema `keycloak` (`parent=keycloak`) y agrega `css/untdf.css` después del CSS base (`styles=css/login.css css/untdf.css`). El CSS usa los mismos tokens que las apps (fondo `#f8f7f4`, tinta `#131209`, bordes cuadrados, barra superior de 12 px) y reemplaza el logo de Keycloak por un cuadrado con el nombre del realm. El compose lo monta en `/opt/keycloak/themes/untdf` (solo lectura) y el realm lo usa con `loginTheme: untdf`. Detalle: en los campos se usa `background-color`, no `background`; el atajo borra el `no-repeat` con que PatternFly pone el ícono de error y el ícono se repite por todo el campo.

## 5. `scripts/token-expirado.sh`

Muestra que un token no dura para siempre. Usa el flujo *password* (`Direct access grants`): se manda usuario y contraseña directo al endpoint de tokens. Se usa **solo** por comodidad de consola: en apps reales está desaconsejado, porque la contraseña pasa por la app.

Línea por línea:
- `set -euo pipefail`: corta el script ante cualquier error (`-e`), variable no definida (`-u`) o fallo dentro de una tubería (`pipefail`).
- `source .../.env`: carga `VM_IP` y `REALM`.
- `read -rsp`: pide la contraseña sin mostrarla (`-s`) ni interpretar `\` (`-r`).
- `BASE=.../protocol/openid-connect`: raíz de los endpoints OIDC de Keycloak.
- `curl .../token -d grant_type=password -d client_id=cli-test ...`: pide un access token. `jq -r .access_token` extrae solo ese campo.
- `-d scope=openid`: sin este scope el token sirve, pero `/userinfo` (endpoint de OIDC) responde 403.
- `[ "$TOKEN" != "null" ] || ...`: si el login falla, `jq` devuelve el texto `null`; el script corta con un mensaje claro.
- `payload()`: un JWT es `header.payload.firma`, cada parte en **base64url**. `cut -d. -f2` toma el payload, `tr '_-' '/+'` pasa de base64url a base64 común y `jq -R '@base64d | fromjson'` lo decodifica y lo interpreta como JSON (jq tolera que falte el relleno `=`). Se muestran `iss` (emisor), `sub` (id del usuario), `preferred_username`, roles, `exp` (vence) e `iat` (emitido). Nota: decodificar **no** verifica la firma; solo la lee.
- `call()`: manda el token en `Authorization: Bearer ...` al endpoint `/userinfo` de Keycloak y muestra solo el código HTTP (`-o /dev/null -w`). Keycloak valida firma y vigencia: 200 si sirve, 401 si no.
- `LIFE = exp - iat` (con `payload`): segundos de vida del token (60 si dejaron 1 minuto).
- `sleep LIFE+2`: espera a que venza. Segunda llamada: debe dar **401**.

Qué enseña: el servidor no "recuerda" el token; lo valida por firma y fecha. Ventaja: escala sin consultar una base. Costo: si roban el token, sirve hasta que venza (por eso viven poco) y no se puede revocar al instante sin consultar al emisor.

## 6. Secuencia completa de lo que pasa al entrar a App A

1. El navegador pide `GET :4180/`. No hay cookie `_proxy_a`.
2. El proxy responde `302` a `.../realms/untdf/protocol/openid-connect/auth?client_id=app-a&redirect_uri=...&code_challenge=...`.
3. El navegador va a Keycloak, que muestra el login y crea la **sesión SSO** (cookie propia de Keycloak).
4. Keycloak responde `302` a `:4180/oauth2/callback?code=XYZ`.
5. El proxy, **por detrás** (servidor a servidor), llama al endpoint `/token` con `code`, `client_secret` y el verificador PKCE. Recibe ID token, access token y refresh token (JWT firmados).
6. El proxy valida la firma con las claves públicas de Keycloak (JWKS), el `iss`, el `aud` y la expiración. Si hay `ALLOWED_ROLES`, mira `realm_access.roles`.
7. Crea su cookie `_proxy_a` y reenvía a `web-a`.

Para App B el paso 3 cambia: el navegador ya trae la cookie de sesión de Keycloak, así que Keycloak **no pide login** y responde de inmediato con el código. Eso es el SSO.

## 7. Preguntas para autoevaluarse
1. ¿Por qué `web-a` no publica puertos?
2. ¿Qué pasaría si `KC_HOSTNAME` usara `localhost` y el navegador entrara por `192.168.56.10`?
3. ¿Por qué las dos cookies de proxy necesitan nombres distintos?
4. ¿Qué diferencia hay entre `/oauth2/sign_out` y cerrar sesión en Keycloak?
5. ¿Quién decide el 403 de B: Keycloak o el proxy? (El proxy, leyendo el token; Keycloak solo puso el rol adentro.)
6. ¿Por qué el script no necesita consultar una base para saber que el token venció?
7. ¿Qué riesgo trae el flujo `password` y por qué solo se usa en la prueba?
8. ¿Por qué el logout en A tardaba hasta 1 minuto en llegar a B aunque `COOKIE_REFRESH` fuera 2 s? ¿Cómo lo resuelve la demo y cuál sería la solución correcta en producción?

El stack se probó entero en la VM. Hay dos errores que aparecen si se arma mal: el 500 por audiencia (mapper, ver trampa 3 en `Guia-Teoria.md`) y `issuer did not match` (trampa 1).
