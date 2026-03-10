# Instrucciones para el frontend: Recordatorios de medicamentos y Recetas / Escáner

El backend ya expone las rutas descritas abajo. Todas requieren **Authorization: Bearer &lt;token&gt;** y rol `cliente`.

---

## 1. Módulo de recordatorios de medicamentos

### Descripción

El cliente puede agregar medicamentos (desde el catálogo o manual), con fecha de compra, cantidad inicial, cada cuántas horas lo toma y cantidad por toma. El backend calcula la fecha estimada de fin y, **2 días antes**, crea una notificación tipo `recordatorio_quedapoco` para avisar que le queda poco y gestionar la compra.

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/cliente/recordatorios` | Lista los recordatorios activos del cliente. Al listar, el backend revisa si algún recordatorio entra en ventana “2 días antes” y, si no se había notificado, crea la notificación y marca `notificadoFinProximo: true`. |
| POST | `/api/cliente/recordatorios` | Crear recordatorio. |
| PATCH | `/api/cliente/recordatorios/:id` | Actualizar recordatorio (fechas, cantidades, intervalo, precio referencia, activo). |
| DELETE | `/api/cliente/recordatorios/:id` | “Eliminar” = desactivar (`activo: false`). |

### POST /api/cliente/recordatorios — Body

```json
{
  "codigo": "7501055314105",
  "descripcion": "Acetaminofén 500mg x10 tabletas",
  "imagen": "/uploads/...",
  "fechaCompra": "2025-03-01T00:00:00.000Z",
  "cantidadInicial": 30,
  "cantidadPorToma": 1,
  "intervaloHoras": 8,
  "precioReferencia": 1.2
}
```

- **Obligatorios**: `codigo`, `descripcion`, `fechaCompra`, `cantidadInicial`, `cantidadPorToma`, `intervaloHoras`.
- **Opcionales**: `imagen`, `precioReferencia` (precio de referencia si lo compró por la app).
- **Cálculo en backend**: con esos datos se calcula `fechaEstimadaFin` y se guarda. No hace falta enviarla.

### Respuesta de GET /api/cliente/recordatorios

Array de documentos con forma similar a:

```json
[
  {
    "_id": "...",
    "clienteId": "...",
    "codigo": "7501055314105",
    "descripcion": "Acetaminofén 500mg x10 tabletas",
    "imagen": "/uploads/...",
    "fechaCompra": "2025-03-01T00:00:00.000Z",
    "cantidadInicial": 30,
    "cantidadPorToma": 1,
    "intervaloHoras": 8,
    "precioReferencia": 1.2,
    "fechaEstimadaFin": "2025-03-11T00:00:00.000Z",
    "notificadoFinProximo": false,
    "activo": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

En el frontend puedes mostrar una “cuenta regresiva” hasta `fechaEstimadaFin` y el listado fijado con la fecha de compra y cada cuántas horas lo toma.

### Notificaciones

- Al entrar al listado de recordatorios (GET), el backend crea una **Notificacion** con `tipo: 'recordatorio_quedapoco'` cuando faltan 2 días o menos para `fechaEstimadaFin` y aún no se había notificado.
- Esa notificación puede incluir `recordatorioId` para enlazar a la pantalla de recordatorios.
- El mensaje es del estilo: *“Te queda poco de [descripcion]. Se estima que se te acabe en 2 días o menos. Gestiona tu compra.”*

### Flujo sugerido en el frontend

1. **Pantalla “Recordatorios”**  
   - GET `/api/cliente/recordatorios`.  
   - Mostrar lista (fijada con fecha compra, intervalo, cuenta regresiva hasta `fechaEstimadaFin`, precio referencia si existe).

2. **Agregar medicamento desde el catálogo**  
   - En esa misma pantalla, un **buscador** que llame a `GET /api/cliente/catalogo?q=...` (o el endpoint de recetas si prefieres buscar también por texto libre).  
   - El usuario elige un producto y abre el formulario de “Nuevo recordatorio” con `codigo`, `descripcion`, `imagen` y, si aplica, `precioReferencia` (precio actual del producto elegido).  
   - Completa `fechaCompra`, `cantidadInicial`, `cantidadPorToma`, `intervaloHoras` y envía POST `/api/cliente/recordatorios`.

3. **Al comprar por la app**  
   - Si quieres guardar el precio pagado como referencia, al confirmar compra puedes crear o actualizar el recordatorio con `precioReferencia` igual al precio del producto en ese pedido.

---

## 2. Recetas / escáner — buscar y agregar al carrito

### Descripción

El usuario puede escribir texto (por ejemplo extraído de un escáner de recetas con OCR en el frontend) y el backend busca en **catálogo maestro** y en **productos con stock**. Luego puede agregar en lote al carrito eligiendo ofertas (producto + farmacia).

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/cliente/recetas/buscar?q=texto` | Busca por `q` en código, descripción y marca (catálogo maestro + Producto con existencia > 0). Devuelve coincidencias agrupadas por código con ofertas por farmacia. |
| POST | `/api/cliente/recetas/agregar-al-carrito` | Agrega en lote al carrito por `productoId` y cantidad. |

### GET /api/cliente/recetas/buscar?q=acetaminofen

**Respuesta:**

```json
{
  "coincidencias": [
    {
      "codigo": "7501055314105",
      "descripcion": "Acetaminofén 500mg x10 tabletas",
      "marca": "Genérico",
      "imagen": "/uploads/...",
      "ofertas": [
        {
          "productoId": "67c0e4d9f1a2b34c12345678",
          "farmaciaId": "67c0e1aa9a2f1234567890ab",
          "nombreFarmacia": "Farmacia Central",
          "precio": 1.08,
          "existencia": 25
        }
      ]
    }
  ]
}
```

- Si un código solo está en catálogo maestro y no en inventario de ninguna farmacia, `ofertas` será `[]` (no se puede agregar al carrito).
- Para agregar al carrito el frontend debe usar un `productoId` de alguna oferta.

### POST /api/cliente/recetas/agregar-al-carrito — Body

```json
{
  "items": [
    { "productoId": "67c0e4d9f1a2b34c12345678", "cantidad": 2 },
    { "productoId": "67c0e4f3f1a2b34c87654321", "cantidad": 1 }
  ]
}
```

**Respuesta:**

```json
{
  "carrito": [ ... ],
  "agregados": [
    { "productoId": "67c0e4d9f1a2b34c12345678", "cantidad": 2 },
    { "productoId": "67c0e4f3f1a2b34c87654321", "cantidad": 1 }
  ],
  "errores": []
}
```

- `carrito`: array actual del carrito (como en GET `/api/cliente/carrito`).
- `agregados`: items que se agregaron correctamente.
- `errores`: lista de `{ productoId, error }` para los que no se pudo agregar (ej. sin stock).

### Flujo sugerido en el frontend (recetas / escáner)

1. **Pantalla “Receta” o “Escáner”**  
   - Opción A: el usuario **escribe** el nombre del medicamento y se llama a `GET /api/cliente/recetas/buscar?q=...`.  
   - Opción B: el usuario **escanea** la receta (cámara + OCR en el frontend); con el texto extraído se arma una o varias búsquedas (por ejemplo por líneas o por palabras clave) y se llama a `GET /api/cliente/recetas/buscar?q=...` por cada búsqueda, o se concatena el texto y se hace una búsqueda.

2. **Mostrar coincidencias**  
   - Por cada elemento de `coincidencias`, mostrar descripción, marca, imagen.  
   - Si `ofertas.length > 0`, mostrar opciones (farmacia, precio) y un selector de cantidad.  
   - Si `ofertas.length === 0`, mostrar “No disponible en farmacias” y no permitir agregar.

3. **Agregar al carrito**  
   - El usuario selecciona ofertas y cantidades.  
   - Se arma `items: [ { productoId, cantidad } ]` con los `productoId` de las ofertas elegidas.  
   - POST `/api/cliente/recetas/agregar-al-carrito` con ese body.  
   - Mostrar resultado: qué se agregó y qué errores hubo (por ejemplo sin stock).

**Nota sobre OCR:**  
El backend **no** procesa imágenes de recetas; solo busca por texto. Si quieres “leer” recetas con escáner, en el frontend debes usar una librería o API de OCR (por ejemplo Tesseract.js en el navegador o un servicio en la nube), obtener el texto y enviarlo a `/api/cliente/recetas/buscar?q=...`.

---

## 3. Resumen de autenticación

Todas las rutas usadas aquí son de cliente y requieren:

- Header: `Authorization: Bearer <token>`
- Token JWT con rol `cliente` (o `master` con header de suplencia si aplica).

No se exponen rutas públicas nuevas para recordatorios ni recetas.
