# GitGud

Cliente Git de escritorio construido con Tauri, React y Rust para cubrir el flujo diario basico sin depender de la terminal.

## Alcance de la primera version

GitGud permite:

- Abrir un repositorio Git local desde el dialogo nativo.
- Ver el estado actual separado en cambios `staged` y `unstaged`.
- Hacer `stage` y `unstage` por archivo o en bloque.
- Crear commits desde la UI.
- Ver historial reciente en forma de grafo.
- Inspeccionar el detalle de un commit.
- Crear ramas locales y hacer `checkout`.
- Ejecutar `fetch`, `pull` y `push`.

## Limitaciones conocidas

- Solo trabaja con repositorios locales ya existentes; no crea ni clona repositorios.
- La sincronizacion remota usa el binario `git` del sistema con `GIT_TERMINAL_PROMPT=0`, por lo que no resuelve flujos interactivos de autenticacion dentro de la app.
- `pull` y `push` requieren una rama local con upstream configurado.
- El historial visible se limita a commits recientes para mantener la UI liviana.
- El detalle de commit depende del diff que Git pueda exponer; commits vacios u otros casos especiales pueden mostrar una advertencia sin archivos.
- No hay resolucion de conflictos ni manejo de stash en esta version.

## Errores esperables en la UI

Los errores del flujo basico se muestran con el mismo patron visual de feedback en la parte superior de la interfaz o en la tarjeta afectada:

- Apertura de carpeta no Git.
- Fallo al refrescar estado.
- Error de `stage` o `unstage`.
- Commit rechazado por falta de identidad, mensaje vacio o ausencia de cambios staged.
- Checkout bloqueado por cambios locales.
- Creacion de rama con nombre invalido o duplicado.
- `fetch`, `pull` o `push` sin remoto, sin upstream o con error de autenticacion/sincronizacion.

## Validacion manual sugerida

Usa un repositorio de prueba con al menos un remoto local o accesible.

1. Abrir repositorio: selecciona una carpeta Git valida y confirma que nombre, ruta, rama y estado se cargan; luego intenta abrir una carpeta sin `.git` y verifica el mensaje de error.
2. Stage por archivo: modifica un archivo tracked, usa `Agregar al stage` y confirma que pasa de la columna `Unstaged` a `Staged`.
3. Unstage por archivo: usa `Sacar del stage` y confirma que el archivo vuelve a `Unstaged`.
4. Stage masivo: deja varios cambios visibles y usa `Stage de todo`; todos deben quedar en `Staged`.
5. Unstage masivo: con varios cambios staged usa `Sacar todo del stage`; todos deben volver a `Unstaged`.
6. Commit: con cambios staged crea un commit y verifica que el mensaje aparece al inicio del historial y que el estado local queda limpio.
7. Historial: confirma que la lista muestra SHA corto, autor, fecha, grafo y marca visual de `HEAD`.
8. Detalle de commit: selecciona un commit y valida metadata, padres y archivos modificados.
9. Checkout: cambia a otra rama local y confirma que la rama activa se actualiza; luego repite con cambios locales conflictivos para verificar el error.
10. Fetch: genera un commit remoto desde otro clon, ejecuta `Fetch` y valida el cambio en `ahead/behind`.
11. Pull: con cambios remotos pendientes ejecuta `Pull` y confirma que el historial local se actualiza.
12. Push: crea un commit local, ejecuta `Push` y valida que `ahead` vuelva a `0`.

## Desarrollo

Requisitos:

- Node.js
- Rust
- Dependencias de Tauri para tu sistema operativo
- Git disponible en `PATH`

Comandos principales:

```bash
npm install
npm run tauri dev
```

Verificaciones usadas en esta iteracion:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```
