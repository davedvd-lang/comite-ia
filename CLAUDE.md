# Comité de IA

Web app personal de David que orquesta varios modelos de IA con roles distintos para analizar ideas: ronda 1 en paralelo, ronda 2 de réplica opcional y síntesis final (Claude o un modelo de respaldo). Uso exclusivamente personal, desde PC y móvil.

Habla siempre en castellano con David. Sé directo, sin relleno.

## Arquitectura

```
docs/index.html        Frontend completo en un solo HTML (Tailwind CDN, marked, DOMPurify). Se publica con GitHub Pages desde /docs.
worker/src/index.js    Cloudflare Worker: guarda las claves como secretos y hace de proxy con streaming.
worker/wrangler.toml   Config del Worker. ALLOWED_ORIGINS = orígenes permitidos por CORS.
```

- El navegador **nunca** ve las claves de API. Solo manda `Authorization: Bearer <APP_PASSWORD>` al Worker.
- Endpoints del Worker: `GET /api/status` (qué proveedores tienen clave), `GET /api/models?provider=x`, `POST /api/chat` con `{provider, model, system, user}`.
- `/api/chat` responde SSE normalizado: `data: {"t":"..."}`, `data: {"error":"..."}`, `data: {"done":true}`. Errores antes del stream: JSON `{error, retryAfter}` con el status del proveedor (429, 401...).
- Proveedores: `gemini`, `groq`, `openrouter`, `hf` usan la API compatible con OpenAI (Gemini vía `/v1beta/openai`). `anthropic` usa la API nativa de Messages. `cfai` es Workers AI de Cloudflare (p. ej. Mistral `@cf/mistralai/mistral-small-3.1-24b-instruct`): no lleva clave, va por el binding `AI` de `wrangler.toml` y tiene un cupo diario gratuito.
- La configuración del usuario (agentes, roles, modelos, URL del servidor y contraseña) vive en `localStorage` del navegador (`comite_ia_cfg_v2`).

## Reglas

- **Nunca** escribas claves de API ni la contraseña en ningún archivo del repo, ni en commits, ni en `wrangler.toml`. Van solo como secretos de Cloudflare (`npx wrangler secret put NOMBRE`) o en `worker/.dev.vars` (ignorado por git).
- Si David pega una clave en el chat, recuérdale que es mejor que la escriba él en la terminal con `wrangler secret put`.
- Antes de cada commit, comprueba con `git diff --cached` que no se cuela ningún secreto.
- Mantén el frontend como un único HTML sin paso de build, salvo que David pida lo contrario.
- El repo es público (GitHub Pages gratis lo requiere): trata todo lo que se suba como público.

## Secretos del Worker

`APP_PASSWORD` (obligatorio; sin él el Worker rechaza todo), `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `ANTHROPIC_API_KEY`. Los que falten simplemente desactivan ese proveedor.

## Comandos

```bash
cd worker && npm install          # una vez
npm run dev                       # Worker en local (http://localhost:8787), lee worker/.dev.vars
npm run deploy                    # publica el Worker
npx wrangler secret put NOMBRE    # sube un secreto (pide el valor por teclado)
npx wrangler tail                 # logs en vivo del Worker desplegado
# Frontend en local: python -m http.server 8000 --directory docs  → http://localhost:8000
```

## Puesta en marcha inicial (si aún no está hecha)

1. Comprobar que hay Node.js LTS, Git y la CLI de GitHub (`gh`). Si falta algo, decir cómo instalarlo en Windows.
2. `git init`, primer commit y crear el repo público `comite-ia` con `gh repo create comite-ia --public --source . --push` (si `gh` no tiene sesión, que David haga `gh auth login`).
3. Activar GitHub Pages desde la rama `main`, carpeta `/docs`: `gh api -X POST repos/{owner}/comite-ia/pages -f "source[branch]=main" -f "source[path]=/docs"`. La URL será `https://<usuario>.github.io/comite-ia/`.
4. En `worker/`: `npm install`, `npx wrangler login` (abre el navegador; David necesita cuenta gratuita de Cloudflare), poner en `ALLOWED_ORIGINS` el origen de Pages (`https://<usuario>.github.io`, sin ruta ni barra final) y `npm run deploy`.
5. Pedir a David que suba él los secretos en su terminal, uno a uno, con `npx wrangler secret put ...`. Recomiéndale una contraseña larga (p. ej. 4-5 palabras aleatorias).
6. Poner la URL del Worker (`https://comite-ia.<subdominio>.workers.dev`) en la constante `DEFAULT_SERVER` de `docs/index.html`, commit y push.
7. Verificar: `curl -H "Authorization: Bearer <contraseña>" <URL-worker>/api/status` debe listar los proveedores con `true`. Luego abrir la URL de Pages, poner la contraseña en ⚙️ y pulsar "Probar conexión".

## Estado (hecho el 2026-10-28)

- Repo público `davedvd-lang/comite-ia`, Pages en `https://davedvd-lang.github.io/comite-ia/`, Worker en `https://comite-ia.comite-ia-worker.workers.dev`.
- Secretos subidos: `APP_PASSWORD`, `GEMINI_API_KEY` (las claves nuevas de AI Studio empiezan por `AQ.`, son válidas), `GROQ_API_KEY`, `OPENROUTER_API_KEY` y `HF_TOKEN`. Sin `ANTHROPIC_API_KEY` (de pago). Mistral, DeepSeek, Kimi, GLM y Qwen van por Workers AI, sin clave.
- Si `gemini-flash-latest` está saturado (503), el Worker reintenta con `gemini-flash-lite-latest` y lo avisa en la respuesta.

## Particularidades de este PC (Windows)

- No hay `gh`: la API de GitHub se usa con el token de `git credential fill`.
- "Acceso controlado a carpetas" de Windows está activo: solo `git.exe` y `node.exe` tienen permiso para escribir en Documentos.
- PowerShell bloquea `npx.ps1`: en la terminal de David hay que usar `npx.cmd`.
- `wrangler login` normal falla (el callback a localhost no llega): usar `npx.cmd wrangler login --device`.
- Con `curl` en Git Bash, mandar el JSON desde archivo (`--data-binary @archivo`); con tildes en línea da "Problems parsing JSON".

## Pendiente / ideas

- Historial de sesiones (ahora se pierde todo al recargar). Opción natural: Cloudflare KV o D1 desde el mismo Worker.
- Gemini dio errores en la versión antigua (llamada directa desde el navegador). Ahora va por el endpoint compatible con OpenAI; si sigue fallando, mirar el mensaje exacto de error en la burbuja y `wrangler tail`.
- Los modelos gratuitos cambian a menudo: el botón "Cargar listas de modelos" de ajustes consulta lo disponible en cada proveedor.
