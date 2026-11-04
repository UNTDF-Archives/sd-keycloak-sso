# Guion de la demo (5 min máx.)

**Antes de empezar (precargado):** VM encendida, `docker-compose ps` con todo `Up`, imágenes cacheadas, dos ventanas de incógnito cerradas, `.env` listo, un video de respaldo grabado.

| Min | Qué se hace | Qué se dice |
|---|---|---|
| 0:00 | Ventana incógnito → `http://192.168.56.10:4180` | "Sin sesión. App A no tiene login propio: nos manda a Keycloak." (mostrar la URL del redirect) |
| 0:45 | Login `alice` → App A | "AuthN: Keycloak verificó quién somos y devolvió un código; el proxy lo cambió por tokens." |
| 1:30 | Misma ventana → `http://192.168.56.10:4181` | "App B: entramos sin login. Ese es el SSO: la sesión vive en Keycloak, no en cada app." |
| 2:00 | `/oauth2/userinfo` en B | "Estos son los claims del token: usuario, roles, emisor, expiración." |
| 2:30 | Incógnito nueva → login `bob` → App A ok → App B | "AuthZ: bob está autenticado pero no tiene el rol `acceso-b`. App B lo rechaza: 403 Forbidden, "You do not have permission to access this resource"." |
| 3:30 | App A o B → botón **Probar token vencido** (abre `:4182`) → mirar "Token vence en N s" → antes de que venza, bajar al panel **Así es el token (JWT)** (cabecera, claims, firma) → a los 15 s sale **Token vencido** (alternativa en terminal: `./scripts/token-expirado.sh alice`) | "Esto es un JWT: tres partes, y la firma la hizo Keycloak; cualquier servicio la valida con la clave pública sin volver a preguntar. Los tokens vencen: este dura 15 s y el proxy no lo renueva. A los 15 s, 401. Eso limita el daño si se roban. Volver a entrar no pide contraseña porque la sesión SSO sigue viva en Keycloak: son dos tiempos distintos." |
| 4:30 | Cierre | "Costo: Keycloak es pesado y es punto único de falla. No lo usaríamos para 2 servicios en red privada." |

**Plan B si algo falla:** reproducir el video (grabarlo antes: 5 min); `docker-compose restart`; si se perdió el realm, reimportar `backup/realm-untdf.json` (comandos en el paso 8 de `GUIA-PASO-A-PASO.md` y en el README). El archivo no está en git: guardarlo aparte.
