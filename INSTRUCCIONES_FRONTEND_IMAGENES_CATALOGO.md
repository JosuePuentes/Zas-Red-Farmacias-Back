# Instrucciones para el frontend — Imágenes del catálogo

## Cambios en el backend (ya hechos)

- Las imágenes del catálogo maestro están en **backend/public/productos/** (miles de archivos `.jpg` / `.png`).
- El backend sirve esa carpeta en la ruta **`/public`**.
- La URL base del API es la misma que usas para las peticiones (ej. `https://zas-red-farmacias-back.onrender.com`).

## Cómo debe armar el frontend la URL de la imagen

1. **Variable de entorno**  
   Asegúrate de tener la base del backend **sin** `/api` al final para las imágenes, por ejemplo:
   - `VITE_API_URL=https://zas-red-farmacias-back.onrender.com`  
   o, si tu variable incluye `/api`:
   - Para imágenes: usar la misma URL pero sin el sufijo `/api` (ej. `https://zas-red-farmacias-back.onrender.com`).

2. **Valor que devuelve el backend**  
   Cada ítem del catálogo puede traer:
   - `imagen`: `"public/productos/7591127123626.jpg"` (ruta relativa)  
   - o `null` si no hay imagen.

3. **Construcción de la URL en el frontend**  
   - Si `imagen` no existe o es `null` → no mostrar imagen (placeholder o “Sin imagen”).
   - Si `imagen` existe y **no** empieza por `http`:
     - URL final = **base del backend** + **`/`** + **imagen sin barras iniciales**  
     - Ejemplo:  
       `base = "https://zas-red-farmacias-back.onrender.com"`  
       `imagen = "public/productos/7591127123626.jpg"`  
       → `https://zas-red-farmacias-back.onrender.com/public/productos/7591127123626.jpg`
   - Si `imagen` ya empieza por `http` → usarla tal cual.

4. **Ejemplo en código (TypeScript/JavaScript)**  
   ```ts
   const backendBase = import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '') ?? '';
   const imagenUrl =
     p.imagen && !p.imagen.startsWith('http')
       ? `${backendBase}/${p.imagen.replace(/^\/+/, '')}`
       : p.imagen ?? null;
   ```
   Así se evita el error de URL mal formada (ej. `onrender.compublic/...` por faltar la barra).

## Resumen

- **Backend:** sirve las imágenes en `GET https://<tu-backend>/public/productos/<archivo>.<ext>`.
- **Frontend:** usa `VITE_API_URL` (sin `/api`) como base y construye la URL como `base + "/" + imagen` cuando `imagen` es ruta relativa.
- Si no hay `imagen`, no mostrar imagen o mostrar placeholder.
