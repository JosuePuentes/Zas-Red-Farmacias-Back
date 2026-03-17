# Frontend: Chat Dona – Mostrar productos con imagen y botones

## Contrato del API

**POST /api/chat** (con auth)  
Body: `{ userName?: string, messages: Array<{ role: 'user'|'assistant', content: string }> }`

Respuesta siempre:
```json
{
  "message": "Texto de Dona...",
  "productos": [
    {
      "id": "..." | null,
      "codigo": "..." | null,
      "descripcion": "string",
      "precio": number,
      "imagen": "public/productos/xxx.jpg" | null,
      "farmaciaId": "..." | null,
      "disponible": true | false,
      "existencia": number
    }
  ]
}
```

- `productos` puede ser `[]` si no hay resultados.
- **disponible === true** → mostrar botón **"Agregar al carrito"**.
- **disponible === false** → mostrar botón **"Solicitar"**.

---

## Qué implementar en el frontend

1. **Tras recibir la respuesta de POST /api/chat:**
   - Mostrar `data.message` como mensaje de Dona.
   - Si `data.productos && data.productos.length > 0`, renderizar **una tarjeta por cada producto**.

2. **Por cada tarjeta:**
   - **Imagen:**  
     - Si `producto.imagen` existe: `BASE_URL_BACKEND + '/' + producto.imagen`  
       Ejemplo: `https://zas-red-farmacias-back.onrender.com/public/productos/7591818215265.jpg`
     - Si `producto.imagen` es `null`: mostrar imagen placeholder.
   - **Texto:** `producto.descripcion`.
   - **Precio:** mostrar `producto.precio` (formato moneda). Si es `0`, mostrar "Consultar" o no mostrar precio.
   - **Botón:**
     - Si `producto.disponible === true` → **"Agregar al carrito"** (integrar con tu flujo de carrito usando `producto.id` o `producto.codigo`).
     - Si `producto.disponible === false` → **"Solicitar"**:
       - Con código: **POST /api/cliente/solicitar-producto** (body con `codigo`).
       - Sin código (solo nombre): **POST /api/cliente/solicitar-producto-por-nombre** (body con `nombre` o `descripcion`).

3. **Historial:** Al abrir el chat, llamar **GET /api/chat/history** (auth). Respuesta: `{ messages: [{ role, content, product? }] }`. Al enviar un mensaje nuevo, enviar a **POST /api/chat** el array completo: historial + nuevo mensaje del usuario.

---

## Resumen

- La respuesta del chat **siempre** trae `message` y `productos` (array).
- Para que se vean **imagen y botones**, el frontend debe leer `productos` de la respuesta y dibujar las tarjetas; no usar otra llamada (ej. inventario) para ese mensaje.
