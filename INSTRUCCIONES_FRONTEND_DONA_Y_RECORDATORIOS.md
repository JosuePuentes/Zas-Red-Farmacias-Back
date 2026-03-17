# Instrucciones frontend: Dona, chat con producto y recordatorios

## 1. Chat (Dona)

### Respuesta del backend
- El backend devuelve **JSON** con siempre dos campos:
  ```json
  {
    "message": "¡Claro que sí! Aquí en Zas! tenemos Acetaminofén disponible. Con gusto te muestro las presentaciones.",
    "productos": [
      {
        "id": "69ae9521e695008c8ae43839",
        "codigo": "7591818215265",
        "descripcion": "Acetaminofen + Clorfeniramina 500 Mg/4Mg Clorace Caja x 20 tabletas",
        "precio": 0,
        "imagen": "public/productos/7591818215265.jpg",
        "farmaciaId": null,
        "disponible": false,
        "existencia": 0
      }
    ]
  }
  ```
- **`message`** (string): texto de Dona. Mostrarlo siempre como mensaje del asistente.
- **`productos`** (array): lista de productos encontrados. Puede ser `[]`. Cada ítem: `id`, `codigo`, `descripcion`, `precio`, `imagen`, `farmaciaId`, **`disponible`** (boolean), `existencia`. Si `disponible === true` → botón "Agregar al carrito"; si `false` → botón "Solicitar".

### Qué hacer en el frontend
1. **Llamar a `POST /api/chat`** con `Content-Type: application/json` y body `{ userName, messages }`. Respuesta: `{ message, productos }`.
2. Mostrar **`message`** como mensaje de Dona.
3. Si **`productos.length > 0`**, mostrar **tarjetas** debajo del mensaje: **imagen** = `baseURL + '/' + producto.imagen` (ej. `https://zas-red-farmacias-back.onrender.com/public/productos/xxx.jpg`), **descripción**, **precio** (o "Consultar" si 0), **botón** "Agregar al carrito" si `producto.disponible === true`, o "Solicitar" si `false` (usar `POST /api/cliente/solicitar-producto` por código o `solicitar-producto-por-nombre` por nombre).
4. **Historial:** Al abrir el chat, llamar a **`GET /api/chat/history`** (con auth). Respuesta: `{ messages: [{ role, content, product? }] }`. Cargar mensajes y al enviar uno nuevo enviar a `POST /api/chat` el array completo (historial + nuevo). Así Dona “recuerda” y puede preguntar por el dolor o el tratamiento de antes.

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
