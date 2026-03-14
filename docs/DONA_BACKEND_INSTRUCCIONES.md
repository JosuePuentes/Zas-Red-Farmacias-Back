# Backend: Dona, recordatorios y notificaciones

## 1. Chat Dona

### No devolver etiquetas [ACCION:...]

- **No** devolver texto tipo `[ACCION:CONSULTAR_PRECIO]` ni similares.
- Ejecutar la consulta en backend (buscar producto en BD), obtener precio y datos, y que la IA responda en **texto natural** (ej. “Mira, el Paracetamol de 500mg lo tenemos en $2.50…”).

### Productos en el mensaje

- Si hay producto asociado a la respuesta, añadir al final del mensaje:
  - `\n__PRODUCTOS__\n` + JSON del producto.
- Así el frontend puede parsear y mostrar la **tarjeta** con foto, precio y botón “Agregar al carrito”.
- La respuesta JSON del chat puede incluir además el objeto `product` en el body para uso directo.

### Historial por cliente

- Guardar el historial de conversación por cliente (modelo `ConversacionDona` o equivalente).
- Endpoint **GET /api/chat/history** para que el frontend cargue los mensajes al abrir el chat y pueda retomar conversaciones.
- Al responder, persistir el nuevo mensaje de Dona (y el de usuario) en ese historial.

### Prompt de Dona

- Ajustar tono: cercano, dulce, sin repetir “Claro, voy a buscar” ni “Recuerde consultar a su médico” en cada mensaje (una vez por conversación o de forma natural).
- Usar el nombre del cliente solo al inicio o al retomar la conversación, no en cada respuesta.
- Incluir lógica de ventas (antiácido + agua mineral en acidez, sugerir recordatorios para medicamentos de uso frecuente, etc.) según el documento de producto.

---

## 2. Recordatorios

- Aceptar y guardar en los endpoints de recordatorios:
  - **hora** (ej. `"14:00"`).
  - **dias** (array de 0–6, domingo = 0; si vacío/null = todos los días).
- Usar esos datos para enviar notificaciones **a la hora y días indicados** (cron que llame a algo tipo `GET /api/cron/recordatorios-hora`).
- El texto de la notificación en **voz de Dona**, ej.: “Recuerda, [nombre], tomarte tu pastilla de las 14:00. ¡Cuídate!”.

---

## 3. Notificaciones

- Que los recordatorios y avisos (poco tratamiento, producto disponible, pedido asignado/entregado, etc.) se redacten como si los envía **Dona**:
  - Tono cercano.
  - Nombre del cliente cuando aplique.
  - Sin texto genérico tipo “Tu pedido ha sido entregado”; mejor “Dona: Tu pedido ya fue entregado. Gracias por confiar en Zas!.”.
