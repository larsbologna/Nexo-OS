# Nexo OS — demo estática

Panel para negocios locales: Dashboard, Caja, Ventas (POS), Productos, Stock, Gastos, Finanzas, Empleados y Configuración. HTML/CSS/JS sin dependencias ni build; los datos de ejemplo se guardan en el navegador (`localStorage`).

**Demo, no segura:** el login es simulado en el navegador. No cargar datos reales.

- Usuario: `admin@demo.local`
- Clave: `Demo2026!`

## Publicar en GitHub Pages

1. Creá un repositorio en GitHub (público, o privado con un plan que incluya Pages).
2. Subí **el contenido de esta carpeta** a la raíz de la rama `main`: `index.html`, `config.js`, `css/`, `js/`, `assets/`, `.nojekyll` y este `README.md`.
3. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. En 1-2 minutos queda en `https://<usuario>.github.io/<repositorio>/`.

Importante:

- **No borres `.nojekyll`.** Sin ese archivo, GitHub Pages ignora los archivos que empiezan con `_` (por ejemplo `js/views/_cash.js`) y la app no carga.
- Todas las rutas son relativas y la navegación usa `#/…`, así que funciona dentro de `/<repositorio>/` sin configurar nada más.
- Abrirla con doble clic (`file://`) **no** funciona: los módulos JS y el login necesitan HTTPS o `http://localhost`. Para probar en tu PC: `npx http-server . -a 127.0.0.1 -p 8080` y abrir `http://127.0.0.1:8080`.
- Cada navegador tiene sus propios datos de demo. **Configuración → Restablecer datos de demo** los vuelve a generar.
