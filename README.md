# Agenda — local-first

Agenda personal digital inspirada en las agendas de papel: planificar el día,
escribir notas e ideas, y guardar un diario. **Los datos se quedan en el navegador.**

> **Privacidad por arquitectura:** el servidor solo entrega archivos estáticos.
> Tareas, notas, ideas, diario y búsquedas **no se envían a ningún servidor** en la V0.1.

## Qué es

- Vista **día** con tareas, citas, notas, ideas y diario (guardado automático).
- **Calendario mensual** con puntos en los días con contenido.
- **Búsqueda local**.
- **Exportar/Importar**: JSON, y exportar también **Markdown** y **Org-mode** (Emacs).
- **PWA**: instalable y funcional **sin conexión** tras la primera carga.
- **Sin registro, sin cuenta, sin login**. Sin trackers ni analítica.

**Versión**: `0.1.0`.

## Privacidad y riesgo (leer)

- El **servidor solo entrega los archivos** de la página. **No guarda nada tuyo**: ni tareas,
  ni notas, ni diario, ni búsquedas. No hay cuenta ni registro.
- Tus datos se guardan en el **almacenamiento local del navegador** (IndexedDB), en tu dispositivo.
- Por eso **puedes perderlos**: si borras los datos del sitio, usas el modo privado, cambias de
  navegador o de dispositivo, o se daña el almacenamiento. **Exporta una copia** (JSON/Markdown/Org)
  de vez en cuando y guárdala en otro sitio.
- No hay publicidad, rastreadores ni analítica. Si te resulta útil, puedes
  [invitarme a un café](https://ko-fi.com/m_castillo).

## Arquitectura

```
Cloudflare → Nginx → archivos estáticos → navegador → IndexedDB
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
├── css/style.css
├── js/
│   ├── app.js       # arranque y vistas
│   ├── db.js        # IndexedDB
│   ├── date.js      # utilidades de fecha
│   ├── calendar.js  # vista mensual
│   ├── search.js    # búsqueda local
│   └── export.js    # exportar/importar
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
- **Importar JSON** lo restaura (útil si se borran los datos del sitio).
- Exportar **Markdown** / **Org** sirve para leer o llevar el contenido a otros
  programas (por ejemplo, Emacs Org-mode).

Los datos dependen del navegador: si se borran los datos del sitio, se pierden.
Exportar una copia periódicamente es la única red de seguridad.

## Despliegue (servidor estático)

1. Copiar la carpeta a un directorio servido por nginx (p. ej. `/home/deploy/agenda`).
2. Apuntar un `root` a esa carpeta y añadir cabeceras:
   - `sw.js` e `index.html`: `Cache-Control: no-cache` (para que las
     actualizaciones lleguen).
   - assets con hash (si algún día se añaden): `immutable`.
   - CSP con `worker-src 'self'` y `connect-src 'self'`.

## Estado

V0.1 — local-first. Hoja de ruta (no implementada): sincronización opcional,
cuentas opcionales, CalDAV/ICS.

## Licencia

AGPL-3.0-or-later — ver `LICENSE`. Copyright (C) 2026 Miguel Castillo.
