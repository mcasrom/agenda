# Agenda — local-first

Agenda personal digital inspirada en las agendas de papel: planificar el día,
escribir notas e ideas, y guardar un diario. **Los datos se quedan en el navegador.**
Es una **PWA**: se instala como aplicación (Android/Chrome, iPhone/Safari) y **funciona sin conexión**.

> **Privacidad por arquitectura:** el servidor solo entrega archivos estáticos.
> Tareas, notas, ideas, diario y búsquedas **no se envían a ningún servidor** en la V0.1.

- **En producción**: <https://agenda.pruebapublica.com>
- **Versión**: `0.1.11`
- **Código**: <https://github.com/mcasrom/agenda> (privado)

## Qué es

- Vista **día** con tareas, citas, notas, ideas y diario (guardado automático).
- **Calendario mensual** con puntos en los días con contenido.
- **Búsqueda local**.
- **Exportar**: JSON, Markdown, **Org-mode** (Emacs) y **.ics** (para los avisos nativos del calendario). Importar: JSON, Markdown, Org y .ics, con **fusión** (no duplica) o reemplazo.
- **PWA**: instalable y funcional **sin conexión** tras la primera carga.
- **Varias pestañas**: se avisan entre sí (`BroadcastChannel`) y las escrituras se serializan
  (`Web Locks`), para que una pestaña no pise a otra.
- **Sin registro, sin cuenta, sin login**. Sin trackers ni analítica.

## Privacidad y riesgo (leer)

- El **servidor solo entrega los archivos** de la página. **No guarda tu contenido**: ni tareas,
  ni notas, ni diario, ni búsquedas. No hay cuenta ni registro.
- Al abrir la página, el servidor anota la **petición** (IP, fecha, agente) en sus *logs de acceso*
  por seguridad y estadística agregada, con retención limitada. Se explica en la propia app
  (*Acerca de → Qué registra el servidor*).
- Tus datos se guardan en el **almacenamiento local del navegador** (IndexedDB), en tu dispositivo.
  Al primer uso se pide **almacenamiento persistente** (`navigator.storage.persist()`) para que el
  navegador no lo purgue por poco espacio.
- Por eso **puedes perderlos**: si borras los datos del sitio, usas el modo privado, cambias de
  navegador o de dispositivo, o se daña el almacenamiento. La app muestra **«Copia: hace N días»**
  y avisa si llevas mucho sin exportar. **Exporta una copia** (JSON/Markdown/Org) y guárdala aparte.
- La **importación** valida el esquema (`schemaVersion`) y sanea cada campo (solo tipos esperados;
  el contenido se pinta como texto, nunca como HTML) — un fichero malicioso no ejecuta código.
- No hay publicidad, rastreadores ni analítica. Si te resulta útil, puedes
  [invitarme a un café](https://ko-fi.com/m_castillo).

## Funnel (puesta en marcha)

Para que la primera visita acabe en uso real, la app guía al usuario:

1. **Onboarding de primer uso** (una vez): «sin registro, tus datos en el navegador» + CTA
   *Empezar a escribir*.
2. **«Puesta en marcha»** (marcador visible en la vista de día, 3 pasos): **escribe tu primera
   entrada** · **instálala como app** · **exporta una copia**.
3. **Refuerzos**: botón **Instalar** cuando el navegador lo permite, **Compartir**, y **Ko-fi**.

El estado del funnel se guarda **localmente** (`localStorage: agenda-funnel`) y se puede
ocultar. Sirve como guía para el usuario; **no se envía a ningún servidor**.

## Medición del uso (respetuosa)

No hay analítica en el cliente. El uso del microservicio se aprecia **solo server-side**:

- **Visitas** en el `access.log` de nginx (humano vs máquina) con `accesos_todos.py`.
- **Atribución** por *referrer*/*UTM*: la tarjeta de <https://www.pruebapublica.com> enlaza con
  `?utm_source=pruebapublica&utm_medium=card&utm_campaign=agenda`.
- **Indexación**: `robots.txt` + `sitemap.xml` + IndexNow + Search Console.
  La propiedad `agenda.pruebapublica.com` quedó **verificada por etiqueta HTML** (3-oct-2026) y se
  envió el sitemap; IndexNow avisó a Bing/Yandex.

> El uso **dentro** de la app (qué se escribe, cuántos días, etc.) **no se mide por diseño**:
> contradiría la promesa de privacidad. Lo que no sale del navegador, no se puede medir.

## Arquitectura

```
Cloudflare (proxied, BFM off) → Nginx → archivos estáticos → navegador → IndexedDB
```

No hay backend, ni API de escritura, ni base de datos de usuarios, ni proceso
permanente en el servidor. Es un sitio estático con un Service Worker.

## Desarrollo local

No hay compilación ni dependencias. Sirve la carpeta con cualquier servidor estático:

```sh
cd agenda-local
python3 -m http.server 8123
# abrir http://localhost:8123
```

> El Service Worker y `IndexedDB` requieren contexto seguro: `http://localhost`
> o `https://`. Abrir el `index.html` con `file://` no habilita el offline.

## Estructura

```
agenda-local/
├── index.html
├── manifest.json
├── sw.js
├── robots.txt
├── sitemap.xml
├── css/style.css
├── js/
│   ├── app.js       # arranque, vistas y funnel
│   ├── db.js        # IndexedDB
│   ├── date.js      # utilidades de fecha
│   ├── calendar.js  # vista mensual
│   ├── search.js    # búsqueda local
│   ├── export.js    # exportar/importar
│   └── version.js   # versión, URL, Ko-fi, repo, licencia
├── icons/
├── README.md
└── LICENSE
```

Sin frameworks: HTML, CSS y JavaScript (módulos ES) con IndexedDB.

## Modelo de datos

Un registro por día en el almacén `days` de IndexedDB (clave `date`, ISO `YYYY-MM-DD`):

```js
{
  date: "2026-10-03",
  tasks: [{ text: "Comprar material", done: false }],
  citas: [{ h: "09:30", t: "Reunión" }],
  notas: "",
  ideas: "",
  diario: ""
}
```

## Copia de seguridad

- **Exportar JSON** guarda todo el contenido en un archivo.
- **Exportar cifrado (`.enc`)**: copia protegida con **contraseña** (**AES-GCM 256 + PBKDF2-SHA256**, WebCrypto).
  La contraseña **no se guarda**; si la pierdes, ese fichero no se puede abrir (se importa pidiéndola).
- **Importar** (JSON / Markdown / Org / .ics) lo restaura, o **fusiona** con lo que ya tienes
  (tareas/citas nuevas sin duplicar; rellena los campos vacíos) — elige *Fusionar* o *Reemplazar*.
- Exportar **Markdown** / **Org** / **.ics** sirve para leer, llevar el contenido a otros
  programas (Emacs Org-mode) o a los avisos nativos del calendario.
- **Copias rotativas internas**: la app guarda **las últimas 10 copias** dentro del navegador
  (una automática al día, y antes de importar o borrar todo), con **«Restaurar»** en
  *Configuración → Copias de seguridad*.
- **Deshacer**: al eliminar una tarea o cita aparece un aviso **«Deshacer»** unos segundos.

Los datos dependen del navegador: si se borran los datos del sitio, se pierden.
Exportar una copia periódicamente (y el indicador «Copia: hace N días») sigue siendo la
red de seguridad frente a perder el navegador entero.

## Despliegue

Estático, servido por nginx desde `/home/deploy/agenda`:

- **Vhost**: `/etc/nginx/sites-available/agenda.pruebapublica.com` (en `sites-enabled`).
  `:80` → 301 a `https`; `:443` con TLS Let's Encrypt + cabeceras.
- **Cabeceras**: CSP (`default-src 'self'`, `worker-src 'self'`, `connect-src 'self'`,
  `base-uri 'none'`, `frame-ancestors 'none'`), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, HSTS. El bloque JSON-LD inline va autorizado por **hash sha256** en el CSP.
- **Caché**: `sw.js`, `index.html` y JS/CSS → `no-cache` (las actualizaciones llegan solas);
  iconos/imágenes → 7 días.
- **DNS**: `agenda` A → `178.105.80.193`, **proxied** (Cloudflare).
- **IndexNow**: `include /etc/nginx/snippets/indexnow.conf` sirve la key del subdominio.
- Tras desplegar: **purge de Cloudflare** de la zona `pruebapublica.com`.

> Certificado: emitir con el DNS en **gris (DNS-only)** y pasar a **naranja (proxied)** después.

## Estado

**V0.1 desplegada** (3-oct-2026) en `agenda.pruebapublica.com`. Hoja de ruta (no implementada):
sincronización opcional, cuentas opcionales, CalDAV/ICS.

## Licencia

AGPL-3.0-or-later — ver `LICENSE`. Copyright (C) 2026 Miguel Castillo.
