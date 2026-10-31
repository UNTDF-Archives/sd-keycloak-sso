# SSO con Keycloak: demo de AuthN / AuthZ (OAuth2 / OIDC / JWT)

Demo del Grupo 2 de Sistemas Distribuidos (UNTDF). Un login único (SSO) para dos apps, con un rol que decide el acceso.

- `GUIA-PASO-A-PASO.md`: cómo armar y configurar todo, empezando de cero.
- `docs/EXPLICACION-CODIGO.md`: explicación línea por línea del compose, el script y el flujo.
- `DEMO.md`: guion de los 5 minutos.
- `docker-compose.yml`: Keycloak, 2 apps estáticas y 2 `oauth2-proxy`.
- `scripts/token-expirado.sh`: muestra la falla del token vencido.
- La teoría está en Obsidian: `Sistemas Distribuidos/Grupo2-AuthN-AuthZ/Guia-Teoria.md`.

Los usuarios y secretos son de prueba. `.env` no se sube.
