// E2E del demo con Chromium headless via CDP (sin dependencias, requiere chromium y Node 22+).
// Uso: node scripts/e2e.mjs <carpeta-capturas>   (VM_IP por entorno, por defecto 192.168.56.10)
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IP = process.env.VM_IP || "192.168.56.10", OUT = process.argv[2] || ".", PORT = 9333;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "e2e-"))}`, "--window-size=1100,900", "about:blank"], { stdio: "ignore" });

async function ready() { for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); return; } catch { await sleep(200); } } throw new Error("chromium no arranca"); }
async function openTab(url) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  const tab = {
    send,
    async ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; },
    async goto(u) { await send("Page.navigate", { url: u }); await sleep(700); },
    async shot(name) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64")); },
    async wait(expr, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await tab.ev(expr)) return true; } catch {} await sleep(200); } return false; },
  };
  return tab;
}

const res = [];
const check = (name, ok, extra = "") => { res.push(ok); console.log(`${ok ? "OK   " : "FALLA"} ${name}${extra ? " — " + extra : ""}`); };
const quien = (u) => `document.getElementById("user")?.textContent===${JSON.stringify(u)}`;

async function login(tab, user, pass) {
  if (!(await tab.wait(`location.port==="8080" && !!document.querySelector("#username")`, 15000))) return false;
  await tab.ev(`document.querySelector("#username").value=${JSON.stringify(user)};document.querySelector("#password").value=${JSON.stringify(pass)};document.querySelector("#kc-login").click();true`);
  return true;
}
// Cierra sesion con el boton de la pagina y confirma en Keycloak; devuelve segundos hasta que el otro tab cae.
async function logoutDesde(tab, otro, nombre) {
  await tab.ev(`document.getElementById("logout").click();true`);
  const t0 = Date.now();
  await tab.wait(`location.port==="8080"`, 8000);
  await tab.shot(`logout-confirmacion-${nombre}.png`);
  await tab.ev(`(document.querySelector("#kc-logout")||document.querySelector("input[type=submit],button[type=submit]")).click();true`);
  const cayo = await otro.wait(`document.getElementById("cerrada")?.hidden===false`, 12000);
  return { cayo, seg: ((Date.now() - t0) / 1000).toFixed(1) };
}

try {
  await ready();
  const A = await openTab(`http://${IP}:4180/`);
  check("A redirige al login de Keycloak", await login(A, "alice", "alice123"));
  check("A muestra a alice", await A.wait(quien("alice")));
  check("A muestra correo y rol (sesión leída)", await A.ev(`document.getElementById("email").textContent.includes("@")`));
  await A.shot("1-app-a.png");
  const B = await openTab(`http://${IP}:4181/`);
  check("B entra por SSO sin pedir login", await B.wait(quien("alice")));
  check("B muestra rol acceso-b", await B.ev(`document.getElementById("roles").textContent.includes("acceso-b")`));
  await B.shot("2-app-b.png");

  // --- Logout B -> A ---
  let r = await logoutDesde(B, A, "B");
  check("cerrar sesión en B: A vuelve al login", r.cayo, `${r.seg} s desde el clic`);
  await A.shot("3-a-tras-logout-en-b.png");
  await A.ev(`document.getElementById("reentrar")?.click();true`);
  check("A: 'Volver a entrar' pide login (sin re-login silencioso)", await A.wait(`location.port==="8080" && !!document.querySelector("#username")`, 10000));
  check("B vuelve al login/app tras el logout", await B.wait(`location.port==="4181" || (location.port==="8080" && !!document.querySelector("#username"))`, 10000), await B.ev("location.href"));

  // --- Volver a entrar y logout A -> B ---
  await login(A, "alice", "alice123");
  check("alice entra de nuevo en A", await A.wait(quien("alice")));
  await B.goto(`http://${IP}:4181/`);
  check("alice entra en B por SSO", await B.wait(quien("alice")));
  r = await logoutDesde(A, B, "A");
  check("cerrar sesión en A: B vuelve al login", r.cayo, `${r.seg} s desde el clic`);
  await B.shot("4-b-tras-logout-en-a.png");
  await B.ev(`document.getElementById("reentrar")?.click();true`);
  // la sesión debe estar realmente muerta: recargar B pide login
  await B.goto(`http://${IP}:4181/`);
  check("B recargada pide login (sesión muerta de verdad)", await B.wait(`location.port==="8080" && !!document.querySelector("#username")`, 10000));

  // --- Token vencido ---
  await A.goto(`http://${IP}:4180/`);
  await login(A, "alice", "alice123");
  await A.wait(quien("alice"));
  await A.ev(`document.getElementById("corto").click();true`);
  check("botón 'Probar token vencido' abre :4182 con cuenta regresiva", await A.wait(`location.port==="4182" && /^\\d+ s$/.test(document.getElementById("exp")?.textContent||"")`, 15000));
  await A.shot("5-corto-vigente.png");
  check("pantalla 'Token vencido' aparece sola (<=25 s)", await A.wait(`document.getElementById("vencido")?.hidden===false`, 25000));
  await A.shot("6-corto-vencido.png");
  await A.ev(`document.getElementById("reentrar").click();true`);
  const reok = await A.wait(`location.port==="4182" && /^\\d+ s$/.test(document.getElementById("exp")?.textContent||"") && document.getElementById("vencido").hidden`, 20000);
  check("'Volver a entrar' no pide contraseña y da token nuevo", reok, reok ? "" : `href=${await A.ev("location.href")} exp=${await A.ev(`document.getElementById("exp")?.textContent`)} overlay.hidden=${await A.ev(`document.getElementById("vencido")?.hidden`)} cuerpo=${(await A.ev("document.body.innerText"))?.slice(0,160).replace(/\n/g," ")}`);

  // --- bob: 403 ---
  await A.send("Network.enable"); await A.send("Network.clearBrowserCookies");
  await A.goto(`http://${IP}:4180/`);
  await login(A, "bob", "bob123");
  const bobok = await A.wait(quien("bob"));
  check("A muestra a bob", bobok, bobok ? "" : `href=${(await A.ev("location.href"))?.slice(0,90)} cuerpo=${(await A.ev("document.body.innerText"))?.slice(0,200).replace(/\n/g," ")}`);
  if (!bobok) await A.shot("bob-fallo.png");
  await B.goto(`http://${IP}:4181/`);
  check("B con bob: pantalla 403 'Acceso denegado'", await B.wait(`document.body.innerText.includes("Acceso denegado")`, 10000));
  await B.shot("7-b-bob-403.png");
} catch (e) { console.log("ERROR", e); res.push(false); }
finally { chrome.kill(); }
console.log(res.every(Boolean) ? "TODO OK" : "HAY FALLAS");
