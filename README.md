# Comité de IA

Varios modelos de IA (Gemini, Groq, OpenRouter, Hugging Face) analizan una idea cada uno con su rol, se replican entre ellos y Claude (o un modelo de respaldo) sintetiza un plan. Todo en directo, desde el PC o el móvil.

```
Navegador (GitHub Pages)  ──contraseña──▶  Cloudflare Worker (claves secretas)  ──▶  Gemini / Groq / OpenRouter / HF / Claude
```

- **Web:** `docs/index.html`, publicada con GitHub Pages.
- **Servidor:** `worker/`, un Cloudflare Worker gratuito que guarda las claves de API y reenvía las peticiones con streaming.

## Qué necesitas

- Cuenta de GitHub y cuenta gratuita de Cloudflare.
- En el PC: Node.js LTS, Git, la CLI de GitHub (`gh`) y Claude Code.
- Tus claves de API: [Gemini](https://aistudio.google.com/apikey), [Groq](https://console.groq.com/keys), [OpenRouter](https://openrouter.ai/keys), [Hugging Face](https://huggingface.co/settings/tokens) (token con permiso *Make calls to Inference Providers*), [Anthropic](https://console.anthropic.com/settings/keys) (pon un límite de gasto mensual).

## Puesta en marcha con Claude Code

Abre una terminal en esta carpeta, ejecuta `claude` y pega esto:

> Lee CLAUDE.md y haz la puesta en marcha inicial paso a paso: repo en GitHub, GitHub Pages, despliegue del Worker y configuración. Para cuando tenga que iniciar sesión o meter las claves y dime exactamente qué escribir.

Las claves mételas tú en la terminal cuando Claude Code te lo pida (`npx wrangler secret put ...`); no hace falta pegarlas en el chat.

## Uso diario

Abre `https://<tu-usuario>.github.io/comite-ia/`, mete la contraseña en ⚙️ una vez por dispositivo y listo. Desde ⚙️ puedes añadir, quitar o editar agentes, elegir modelos, activar o desactivar la réplica, y encender o apagar Claude con el botón de la cabecera.
