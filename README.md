# SSO con Keycloak: demo de AuthN / AuthZ (OAuth2 / OIDC / JWT)

Demo del Grupo 2 de Sistemas Distribuidos (UNTDF). Un login único (SSO) para dos apps, con un rol que decide el acceso.

- `docs/GUIA-PASO-A-PASO.md`: cómo armar y configurar todo, empezando de cero.
- `docs/EXPLICACION-CODIGO.md`: explicación línea por línea del compose, el script y el flujo.
- `docs/DEMO.md`: guion de los 5 minutos.
- `docker-compose.yml`: Keycloak, 3 apps estáticas y 3 `oauth2-proxy` (A, B y la prueba de token vencido).
- `keycloak-theme/untdf/login/`: tema de login con el estilo de las apps.
- `scripts/token-expirado.sh`: la prueba del token vencido por consola (en las páginas está el botón **Probar token vencido**).
- La teoría está en Obsidian: `Sistemas Distribuidos/Grupo2-AuthN-AuthZ/Guia-Teoria.md`.

Los usuarios y secretos son de prueba. `.env` no se sube.

## Cómo correrlo y probarlo

Nada arranca solo con la VM: se levanta para la demo y se apaga al terminar. Todos los comandos se corren **en la VM** (`ssh sdist0`, shell fish, `docker-compose` 1.29).

### 1. Levantar

```bash
ssh sdist0
cd ~/sd-keycloak-sso
docker-compose up -d          # Keycloak, las 3 webs y los 3 proxies
docker-compose ps             # todo debe decir "Up"
```

Keycloak tarda 30–60 s en estar listo. Si los proxies quedan en `Restarting` al principio, es normal: esperan a Keycloak y se reintentan solos. Si siguen así pasado 1 minuto:

```bash
docker-compose logs --tail=20 keycloak proxy-a
```

### 2. Enlaces (desde tu PC, en ventana de incógnito)

| Qué | Enlace |
|---|---|
| App A (cualquier usuario autenticado) | http://192.168.56.10:4180 |
| App B (exige el rol `acceso-b`) | http://192.168.56.10:4181 |
| Prueba de token vencido (token de 15 s) | http://192.168.56.10:4182 (o el botón **Probar token vencido** de A y B) |
| Keycloak, consola de administración | http://192.168.56.10:8080 (usuario `admin`, clave en el `.env` de la VM) |
| Cuenta del usuario en Keycloak | http://192.168.56.10:8080/realms/untdf/account |

Usuarios de prueba del realm `untdf` (los de la VM actual):

| Usuario | Clave | Rol | Qué se ve |
|---|---|---|---|
| `alice` | `alice123` | `acceso-b` | entra a A y a B |
| `bob` | `bob123` | ninguno | entra a A; en B sale **403** |

### 3. Qué probar

1. Abrir A sin sesión: redirige a Keycloak. Entrar como `alice`: se ve usuario, correo y roles.
2. Abrir B en la misma ventana: entra **sin pedir login** (SSO).
3. **Cerrar sesión** en B (confirmar en Keycloak): A, que estaba abierta, muestra en 1–2 s **Sesión cerrada**; **Volver a entrar** pide login. Repetir al revés, cerrando en A.
4. Entrar como `bob`: A funciona, B muestra la pantalla de acceso denegado (403).
5. Botón **Probar token vencido**: aparece "Token vence en N s" con el estado del proxy (`202 Accepted`) y a los 15 s pasa a la pantalla **401 Unauthorized** mostrando la respuesta HTTP real del proxy (con enlace a `/oauth2/userinfo` crudo). **Volver a entrar** no pide contraseña (la sesión SSO sigue viva) y da un token nuevo.
6. Por consola, desde tu PC: `./scripts/token-expirado.sh alice` (necesita un `.env` local con `VM_IP` y `REALM`).
7. Todo lo anterior, automático, con Chromium headless (sin instalar nada; Node 22+): `node scripts/e2e.mjs capturas`. Imprime `OK` o `FALLA` por paso, termina con `TODO OK` y guarda capturas en esa carpeta. Usa los usuarios `alice` y `bob` de la tabla de arriba y tarda unos 2 minutos.

### 4. Apagar y dejar limpio

Elegir según cuánto se quiera borrar (todo en la VM, dentro de `~/sd-keycloak-sso`):

```bash
# a) Pausar: detiene todo, conserva el realm, usuarios y secretos. Para volver: docker-compose up -d
docker-compose stop

# b) Borrar los contenedores, conservando el realm (volumen kc-data)
docker-compose down

# c) Borrar TODO, incluido el realm y los usuarios (hay que reconfigurar desde la guía)
docker-compose down -v

# d) Además liberar espacio: borrar las imágenes y la carpeta del proyecto
docker rmi quay.io/keycloak/keycloak:26.0.7 quay.io/oauth2-proxy/oauth2-proxy:v7.6.0 nginx:alpine
cd ~ && rm -rf ~/sd-keycloak-sso
```

Para que **no** se vuelvan a levantar al prender la VM: los `oauth2-proxy` tienen `restart: unless-stopped`, así que Docker los reinicia al arrancar **salvo que se hayan detenido a mano**. Por eso conviene terminar siempre con `docker-compose stop` (o `down`). Keycloak y las webs no tienen política de reinicio y no arrancan solos.

### 5. Respaldo del realm

Para no tener que reconfigurar todo si algo falla, se exporta el realm (usuarios, roles, clientes, tema) a `backup/realm-untdf.json`. **No está en git** (trae secretos y hashes); guardarlo aparte. En la VM, dentro de `~/sd-keycloak-sso`:

```bash
# Exportar (para Keycloak unos segundos)
mkdir -p backup && chmod 777 backup
docker-compose stop keycloak
docker-compose run --rm --no-deps -v $PWD/backup:/backup keycloak export --realm untdf --file /backup/realm-untdf.json
docker-compose up -d keycloak

# Comprobar que el archivo sirve (contenedor descartable, no toca los datos): debe decir "Realm 'untdf' imported"
docker run --rm -v $PWD/backup:/b:ro quay.io/keycloak/keycloak:26.0.7 import --file /b/realm-untdf.json

# Restaurar de verdad (con Keycloak parado)
docker-compose stop keycloak
docker-compose run --rm --no-deps -v $PWD/backup:/backup keycloak import --file /backup/realm-untdf.json
docker-compose up -d
```

Tras restaurar en una VM nueva, copiar los secretos de los clientes al `.env` (`APP_A_SECRET`, `APP_B_SECRET`, `APP_CORTO_SECRET`).

### 6. Si se perdió el realm y no hay respaldo, o es una VM nueva

Seguir `docs/GUIA-PASO-A-PASO.md` desde el paso 0: crea el `.env`, el realm `untdf`, el rol, los usuarios y los clientes `app-a`, `app-b` y `app-corto`. Los secretos de cada cliente van en el `.env` de la VM (`APP_A_SECRET`, `APP_B_SECRET`, `APP_CORTO_SECRET`).
