import mongoose from 'mongoose';
import Producto from '../models/Producto.js';

function getPrecio(producto) {
  const base = Number(producto.precioBase) || 0;
  const desc = Number(producto.descuentoPorcentaje) || 0;
  if (typeof producto.precioConPorcentaje === 'number') {
    return Math.round(producto.precioConPorcentaje * 100) / 100;
  }
  return Math.round(base * (1 - desc / 100) * 100) / 100;
}

function toProductItem(p, precio) {
  const descripcion = p.descripcionCatalogo || p.descripcionPersonalizada || p.descripcion || '';
  const existencia = p.existencia ?? 0;
  return {
    id: p._id.toString(),
    codigo: p.codigo || '',
    descripcion,
    precio: precio ?? 0,
    imagen: p.foto || null,
    farmaciaId: (p.farmaciaId && (p.farmaciaId._id || p.farmaciaId).toString()) || null,
    disponible: existencia > 0,
    existencia,
  };
}

/**
 * Construye un RegExp que coincide con el texto ignorando tildes (e con é, o con ó, etc.).
 * Así "acetaminofen" encuentra "Acetaminofén" en la BD.
 */
function buildAccentInsensitiveRegex(text) {
  const escaped = String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const accentClasses = {
    a: '[aáàäâã]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöôõ]', u: '[uúùüû]',
    n: '[nñ]', c: '[cç]',
  };
  const pattern = escaped.replace(/(.)/g, (ch) => {
    const lower = ch.toLowerCase();
    return accentClasses[lower] || (accentClasses[ch] || ch);
  });
  return new RegExp(pattern, 'i');
}

/**
 * Busca productos por nombre o código para el chat Dona.
 * Devuelve array de productos (con o sin stock); cada uno lleva disponible (boolean) y existencia (number).
 * Si hay stock: al menos uno con disponible true para "Agregar al carrito". Si no hay: disponible false para "Solicitar".
 * @param {string} query - Texto del usuario (ej. "Paracetamol", "ibuprofeno 400")
 * @returns {Promise<Array<{ id, codigo, descripcion, precio, imagen, farmaciaId, disponible, existencia }>>}
 */
export async function buscarProductoParaChat(query) {
  const q = (query && String(query).trim()) || '';
  if (!q || q.length < 2) return [];

  const search = buildAccentInsensitiveRegex(q);
  const productos = await Producto.find({
    $or: [
      { codigo: search },
      { descripcion: search },
      { marca: search },
    ],
  })
    .populate('farmaciaId', 'nombreFarmacia')
    .limit(50)
    .lean();

  if (productos.length === 0) {
    // Si la consulta parece una frase/pregunta larga (no un nombre de producto),
    // no generamos un "producto no catalogado" con todo el texto, solo devolvemos vacío
    // para que Dona pida más detalles sin mostrar tarjeta de producto.
    // PERO consultas cortas tipo "acetaminofen?" o "ibuprofeno?" SÍ deben buscar producto.
    const hasQuestionWord = /\b(que|qué|como|cómo|para|tengo|siento|me|quiero|necesito)\b/i.test(q);
    const looksLikeSentence = q.length > 60 || (q.includes('?') && hasQuestionWord);
    if (looksLikeSentence) {
      return [];
    }
    const dbCatalogo = mongoose.connection.useDb(process.env.MONGO_DB_CATALOGO || 'Zas');
    const coll = dbCatalogo.collection('catalogo_maestro');
    const enCatalogo = await coll.findOne({
      $or: [
        { ean_13: search },
        { description: search },
        { brand: search },
      ],
    });
    if (enCatalogo) {
      return [{
        id: null,
        codigo: enCatalogo.ean_13 || '',
        descripcion: (enCatalogo.description && enCatalogo.description.trim()) || '',
        precio: 0,
        imagen: enCatalogo.image_path || null,
        farmaciaId: null,
        disponible: false,
        existencia: 0,
      }];
    }
    // No está en catálogo: producto "no catalogado" por nombre para que el frontend muestre "Solicitar" y llame a solicitar-producto-por-nombre.
    return [{
      id: null,
      codigo: null,
      descripcion: q,
      precio: 0,
      imagen: null,
      farmaciaId: null,
      disponible: false,
      existencia: 0,
    }];
  }

  const conStock = productos.filter((p) => (p.existencia ?? 0) > 0);
  const sinStock = productos.filter((p) => (p.existencia ?? 0) <= 0);

  if (conStock.length > 0) {
    conStock.sort((a, b) => getPrecio(a) - getPrecio(b));
    return conStock.map((p) => toProductItem(p, getPrecio(p)));
  }

  return sinStock.slice(0, 5).map((p) => toProductItem(p, getPrecio(p)));
}
