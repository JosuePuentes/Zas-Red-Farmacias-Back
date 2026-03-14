# Backend: imágenes admin y texto OCR en recetas

## 1. Imágenes de solicitudes de delivery (Admin)

### Endpoint

- **Método y ruta:** `GET /api/admin/documento-imagen?path=uploads/archivo.jpeg`
- **Autenticación:** Solo admin (rol `master`).
- **Query:** `path` (obligatorio): ruta relativa del archivo bajo `uploads/`, ej. `uploads/solicitudes-delivery/abc/fotoLicencia.jpg`.

### Comportamiento

- El backend lee el archivo del servidor y lo devuelve con el **Content-Type** correcto según la extensión (image/jpeg, image/png, etc.).
- Así las fotos (licencia, carnet, vehículo, etc.) se ven en el panel sin problemas de CORS.
- Validaciones:
  - `path` no puede contener `..` ni salir del directorio `uploads/`.
  - Si el archivo no existe o no es un fichero, responder 404 o 403 según corresponda.

### Uso en el frontend

- Construir la URL: `getApiBaseUrl() + '/admin/documento-imagen?path=' + encodeURIComponent(rutaRelativa)`.
- La ruta relativa es la que devuelve la API de solicitudes (ej. `uploads/solicitudes-delivery/xxx/foto.jpg`).

---

## 2. Análisis de receta por imagen (texto OCR)

### Endpoint

- **Método y ruta:** `POST /api/cliente/recetas/analizar-imagen`
- **Body:** `multipart/form-data`, campo `file` (imagen).
- **Autenticación:** Cliente autenticado.

### Respuesta

Incluir en el JSON de respuesta el campo **`texto_receta`** (string) con el texto OCR de la imagen (todo el texto que se logre leer).

Ejemplo:

```json
{
  "medicamentos": [ ... ],
  "es_recipe_valido": true,
  "texto_receta": "Dr. Juan Pérez\nParacetamol 500mg\n1 tableta cada 8 horas\n30 tabletas\n...",
  "medicamento": "...",
  "dosis": "...",
  "cantidad": "...",
  "es_recipe": true
}
```

### Uso en el frontend

- Mostrar `texto_receta` en el cuadro “Texto de la receta” para que el usuario vea lo que se leyó de la imagen.
