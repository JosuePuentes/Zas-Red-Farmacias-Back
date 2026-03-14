# Instrucciones generales del backend

Resumen de lo que debe hacer el backend. Detalle por tema en los otros documentos.

---

## 1. Imágenes de solicitudes de delivery (Admin)

- **Endpoint:** `GET /api/admin/documento-imagen?path=uploads/archivo.jpeg`
- Solo **admin** (rol master). Lee el archivo del servidor y lo devuelve con el `Content-Type` correcto.
- Así las fotos (licencia, carnet, etc.) se ven en el panel sin problemas de CORS.
- El `path` debe ser relativo y estar bajo `uploads/` (ej. `uploads/solicitudes-delivery/abc/foto.jpg`).

---

## 2. Análisis de receta por imagen

- **Endpoint:** `POST /api/cliente/recetas/analizar-imagen`
- En la respuesta incluir el campo **`texto_receta`** (string) con el texto OCR de la imagen.
- El frontend lo muestra en el cuadro “Texto de la receta”.

---

## 3. Chat Dona

- **No** devolver texto tipo `[ACCION:CONSULTAR_PRECIO]`; ejecutar la consulta en backend y responder en texto natural.
- Si hay producto, añadir al final del mensaje: `\n__PRODUCTOS__\n` + JSON del producto (para que el frontend muestre la tarjeta con foto y “Agregar al carrito”).
- Guardar historial por cliente para poder retomar conversaciones (`GET /api/chat/history`, persistencia en `ConversacionDona`).
- Ajustar el “prompt” de Dona (tono, uso del nombre, recordatorio del médico, etc.) según el doc de Dona.

---

## 4. Recordatorios

- Aceptar y guardar **hora** y **dias** en `GET`/`POST`/`PATCH` `/api/cliente/recordatorios`.
- Usar esos datos para enviar notificaciones a la hora/días indicados (cron `GET /api/cron/recordatorios-hora`), con texto en voz de Dona.

---

## 5. Notificaciones

- Que los recordatorios y avisos se redacten como si los envía **Dona** (tono cercano, nombre del cliente cuando aplique).
- Todas las notificaciones al cliente en primera persona de Dona.

---

## Dónde está cada cosa

| Tema | Documento |
|------|-----------|
| Todo junto | **docs/INSTRUCCIONES_BACKEND.md** (este) |
| Solo imágenes admin y texto OCR recetas | **docs/BACKEND_ADMIN_IMAGENES_RECETAS.md** |
| Solo Dona, recordatorios y notificaciones | **docs/DONA_BACKEND_INSTRUCCIONES.md** |

Con enviar **docs/INSTRUCCIONES_BACKEND.md** suele ser suficiente para que el backend tenga todas las instrucciones.
