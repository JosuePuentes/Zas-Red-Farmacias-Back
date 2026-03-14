import Producto from '../models/Producto.js';

function getPrecio(producto) {
  const base = Number(producto.precioBase) || 0;
  const desc = Number(producto.descuentoPorcentaje) || 0;
  if (typeof producto.precioConPorcentaje === 'number') {
    return Math.round(producto.precioConPorcentaje * 100) / 100;
  }
  return Math.round(base * (1 - desc / 100) * 100) / 100;
}

/**
 * Busca un producto por nombre o código para mostrar en el chat (precio + card).
 * Devuelve el más barato disponible o null.
 * @param {string} query - Texto del usuario (ej. "Paracetamol", "ibuprofeno 400")
 * @returns {Promise<{ id, codigo, descripcion, precio, imagen, farmaciaId, existencia } | null>}
 */
export async function buscarProductoParaChat(query) {
  const q = (query && String(query).trim()) || '';
  if (!q || q.length < 2) return null;

  const search = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const productos = await Producto.find({
    existencia: { $gt: 0 },
    $or: [
      { codigo: search },
      { descripcion: search },
      { marca: search },
    ],
  })
    .populate('farmaciaId', 'nombreFarmacia')
    .limit(50)
    .lean();

  if (!productos.length) return null;

  let best = productos[0];
  let bestPrecio = getPrecio(best);
  for (const p of productos) {
    const precio = getPrecio(p);
    if (precio < bestPrecio) {
      best = p;
      bestPrecio = precio;
    }
  }

  const descripcion = best.descripcionCatalogo || best.descripcionPersonalizada || best.descripcion || '';
  return {
    id: best._id.toString(),
    codigo: best.codigo || '',
    descripcion,
    precio: bestPrecio,
    imagen: best.foto || null,
    farmaciaId: (best.farmaciaId && (best.farmaciaId._id || best.farmaciaId).toString()) || null,
    existencia: best.existencia ?? 0,
  };
}
