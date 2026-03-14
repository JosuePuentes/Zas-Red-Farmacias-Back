# Instrucciones frontend: Dona, chat con producto y recordatorios

## 1. Chat (Dona)

### Respuesta del backend
- **Antes:** El backend devolvía `Content-Type: text/plain` y solo texto.
- **Ahora:** El backend devuelve **JSON**:
  ```json
  {
    "message": "Mira, el Paracetamol de 500mg lo tenemos en $2.50. Aquí te dejo la foto por si quieres agregarlo de una vez.",
    "product": {
      "id": "...",
      "codigo": "PARACETAMOL001",
      "descripcion": "Paracetamol 500mg x 30",
      "precio": 2.5,
      "imagen": "uploads/...",
      "farmaciaId": "...",
      "existencia": 10
    }
  }
  ```
  - `product` solo viene cuando el usuario preguntó por un producto y se encontró en catálogo. Si no hay producto, `product` no viene o es `undefined`.

### Qué hacer en el frontend
1. **Llamar a `POST /api/chat`** con `Content-Type: application/json` y body `{ userName, messages }`. La respuesta es **JSON** (no texto plano).
2. Si la respuesta tiene **`product`**, mostrar una **tarjeta de producto** en el chat (foto, descripción, precio, botón "Agregar al carrito") además del texto `message`. La imagen: si `product.imagen` es relativa, usar `getBackendBaseUrl() + '/' + product.imagen`.
3. **Historial:** Al abrir el chat, llamar a **`GET /api/chat/history`** (con auth). Respuesta: `{ messages: [{ role, content, product? }] }`. Cargar esos mensajes en el estado del chat y, al enviar un mensaje nuevo, enviar a `POST /api/chat` el array completo (historial + nuevo mensaje del usuario). Así Dona “recuerda” y puede preguntar por el dolor o el tratamiento de antes.

---

## 2. Recordatorios: hora y días

### Modelo (backend)
- **`hora`** (string, opcional): hora del recordatorio, ej. `"14:00"` (2:00pm).
- **`dias`** (array de 0–6, opcional): días de la semana (0 = domingo, 1 = lunes, …). Si no se envía o está vacío = todos los días.

### API
- **POST /api/cliente/recordatorios**  
  Body puede incluir: `hora`, `dias` (además de los campos actuales).
  - Ejemplo: `{ ..., "hora": "14:00", "dias": [1, 3, 5] }` (lunes, miércoles, viernes a las 14:00).
- **PATCH /api/cliente/recordatorios/:id**  
  Se puede actualizar `hora` y `dias`.

### Notificaciones por hora
- El backend tiene un cron **GET /api/cron/recordatorios-hora?secret=CRON_SECRET** que, si el recordatorio tiene `hora` y `dias`, envía una notificación tipo: *"Dona: Recuerda, [nombre], tomarte tu pastilla de las 14:00. ¡Cuídate!"*
- En Render hay que configurar un Cron Job que llame a esa URL cada 15 minutos y definir la variable **CRON_SECRET** en el servicio.

---

## 3. Notificaciones en voz de Dona
Todas las notificaciones al cliente que crea el backend llevan el mensaje como si lo dijera Dona (ej. empiezan con "Dona: ..."). No hace falta cambiar el tipo; solo mostrar el `mensaje` en la UI. Para notificaciones push o sonido en el teléfono, usar el mismo texto y, si se muestra un “remitente”, se puede poner “Dona” o “Zas!”.
