# PLMECO - Inventario de Vehículos de Manutención

PWA offline para publicar en GitHub Pages e instalar desde Chrome.

## Archivos

- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `service-worker.js`
- `icons/icon-192.png`
- `icons/icon-512.png`

## Publicación en GitHub Pages

1. Crear repositorio nuevo en GitHub.
2. Subir todos los archivos de este ZIP a la raíz del repositorio.
3. Entrar en `Settings` > `Pages`.
4. En `Build and deployment`, seleccionar:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Guardar.
6. Abrir la URL generada por GitHub Pages en Chrome.
7. Pulsar `Instalar app` o el icono de instalación de Chrome.

## Funcionamiento

- Guarda datos en IndexedDB del navegador de cada ordenador.
- Funciona sin servidor.
- Funciona offline tras la primera carga.
- Exporta PDF y Excel.
- Incluye datos de ejemplo.

## Aviso importante

Los datos son locales en cada PC. Si se borra la caché/datos del navegador, pueden perderse. Para conservar respaldo, usar `Exportar todo Excel` periódicamente.
