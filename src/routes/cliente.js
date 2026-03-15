import { Router } from 'express';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import { body, validationResult } from 'express-validator';
import Producto from '../models/Producto.js';
import Farmacia from '../models/Farmacia.js';
import Carrito from '../models/Carrito.js';
import Pedido from '../models/Pedido.js';
import Notificacion from '../models/Notificacion.js';
import RecordatorioMedicamento from '../models/RecordatorioMedicamento.js';
import SolicitudProductoCliente from '../models/SolicitudProductoCliente.js';
import SolicitudProductoNoCatalogado from '../models/SolicitudProductoNoCatalogado.js';
import User from '../models/User.js';
import { auth, requireRole, attachUser } from '../middleware/auth.js';
import { upload, uploadMemory } from '../middleware/upload.js';
import { ESTADOS_VENEZUELA } from '../constants/estados.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();
const GOOGLE_DISTANCE_MATRIX_API_KEY = process.env.GOOGLE_DISTANCE_MATRIX_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

function getClienteId(req) {
  if (req.role === 'master' && (req.headers['x-cliente-id'] || req.query.clienteId)) {
    const id = req.headers['x-cliente-id'] || req.query.clienteId;
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  }
  return req.userId;
}

function clampPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function getDescuento(producto) {
  if (typeof producto.descuentoPorcentaje === 'number') {
    return clampPercentage(producto.descuentoPorcentaje);
  }
  return 0;
}

function getPrecioConPorcentaje(producto) {
  const base = Number(producto.precioBase) || 0;
  const descuento = getDescuento(producto);
  if (typeof producto.precioConPorcentaje === 'number') {
    return Math.round(producto.precioConPorcentaje * 100) / 100;
  }
  if (descuento > 0) {
    const factor = 1 - descuento / 100;
    return Math.round(base * factor * 100) / 100;
  }
  return base;
}

// Catálogo: productos con filtro por estado (Venezuela). No se muestra nombre de farmacia.
router.get('/productos', async (req, res) => {
  try {
    const { estado, q } = req.query;
    let filter = { existencia: { $gt: 0 } };

    if (estado && ESTADOS_VENEZUELA.includes(estado)) {
      const farmacias = await Farmacia.find({ estado }).select('_id');
      const ids = farmacias.map((f) => f._id);
      filter.farmaciaId = { $in: ids };
    }

    if (q && String(q).trim()) {
      const search = new RegExp(String(q).trim(), 'i');
      filter.$or = [
        { codigo: search },
        { descripcion: search },
        { principioActivo: search },
        { marca: search },
      ];
    }

    const productos = await Producto.find(filter)
      .populate('farmaciaId', 'estado _id')
      .sort({ descripcion: 1 });

    // Precio ya viene con % aplicado (precioBase en Producto). En cliente no mostramos nombre farmacia, solo agrupamos por farmaciaId.
    const list = productos.map((p) => ({
      _id: p._id,
      codigo: p.codigo,
      descripcion: p.descripcion,
      principioActivo: p.principioActivo,
      presentacion: p.presentacion,
      marca: p.marca,
      categoria: p.categoria,
      precio: p.precioBase,
      existencia: p.existencia,
      foto: p.foto,
      farmaciaId: p.farmaciaId?._id,
      estadoFarmacia: p.farmaciaId?.estado,
    }));

    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// Catálogo: ofertas por producto/comercio (varias filas por mismo producto). q, page, page_size, opcional lat, lng.
router.get('/catalogo', async (req, res) => {
  try {
    const { estado, farmaciaId, q, page = 1, page_size = 20, lat, lng } = req.query;
    const filter = { existencia: { $gt: 0 } };

    if (farmaciaId) filter.farmaciaId = farmaciaId;
    if (estado && ESTADOS_VENEZUELA.includes(estado)) {
      const farmacias = await Farmacia.find({ estado }).select('_id');
      filter.farmaciaId = { $in: farmacias.map((f) => f._id) };
    }
    if (q && String(q).trim()) {
      const search = new RegExp(String(q).trim(), 'i');
      filter.$or = [
        { codigo: search },
        { descripcion: search },
        { principioActivo: search },
        { marca: search },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(page_size, 10) || 20));
    const skip = (pageNum - 1) * pageSize;

    // Primero miramos si hay productos de farmacias con existencia.
    const totalProductos = await Producto.countDocuments(filter);

    // Fallback: si no hay inventario cargado en ninguna farmacia, usar el catálogo maestro global.
    if (!totalProductos) {
      const dbCatalogo = mongoose.connection.useDb(process.env.MONGO_DB_CATALOGO || 'Zas');
      const coll = dbCatalogo.collection('catalogo_maestro');

      const maestroFilter = {};
      if (q && String(q).trim()) {
        const search = new RegExp(String(q).trim(), 'i');
        maestroFilter.$or = [
          { ean_13: search },
          { description: search },
          { brand: search },
        ];
      }

      const totalMaestro = await coll.countDocuments(maestroFilter);
      const docs = await coll.find(maestroFilter).skip(skip).limit(pageSize).toArray();

      const items = docs.map((d) => ({
        id: String(d._id),
        codigo: d.ean_13,
        descripcion: d.description,
        principioActivo: null,
        presentacion: null,
        marca: d.brand,
        categoria: null,
        precio: null,
        descuentoPorcentaje: 0,
        precioConPorcentaje: null,
        // image_path suele ser "public/...", el frontend decidirá cómo resolver la ruta.
        imagen: d.image_path || null,
        farmaciaId: null,
        nombreFarmacia: null,
        existencia: 0,
      }));

      return res.json({
        items,
        page: pageNum,
        page_size: pageSize,
        total: totalMaestro,
        total_pages: Math.ceil(totalMaestro / pageSize) || 1,
      });
    }

    let productos;
    const latNum = lat != null && lat !== '' ? parseFloat(lat) : null;
    const lngNum = lng != null && lng !== '' ? parseFloat(lng) : null;

    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      const all = await Producto.find(filter).populate('farmaciaId', 'estado _id lat lng nombreFarmacia');
      const withDist = all.map((p) => {
        const f = p.farmaciaId;
        const dist = f?.lat != null && f?.lng != null
          ? Math.hypot((f.lat - latNum), (f.lng - lngNum))
          : Infinity;
        return { product: p, distance: dist };
      });
      withDist.sort((a, b) => a.distance - b.distance);
      productos = withDist.slice(skip, skip + pageSize).map((x) => x.product);
    } else {
      productos = await Producto.find(filter)
        .populate('farmaciaId', 'estado _id lat lng nombreFarmacia')
        .sort({ precioConPorcentaje: 1, descripcion: 1 })
        .skip(skip)
        .limit(pageSize);
    }

    const respuesta = productos.map((p) => {
      const descuento = getDescuento(p);
      const precioBase = Number(p.precioBase) || 0;
      const precioCon = getPrecioConPorcentaje(p);
      const descripcion = (p.usarDescripcionCatalogo && p.descripcionCatalogo) ? p.descripcionCatalogo : (p.descripcionPersonalizada || p.descripcion);
      return {
        id: p._id.toString(),
        codigo: p.codigo,
        descripcion,
        principioActivo: p.principioActivo,
        presentacion: p.presentacion,
        marca: p.marca,
        categoria: p.categoria,
        precio: precioBase,
        descuentoPorcentaje: descuento,
        precioConPorcentaje: precioCon,
        imagen: p.foto,
        farmaciaId: (p.farmaciaId?._id || p.farmaciaId)?.toString(),
        nombreFarmacia: p.farmaciaId?.nombreFarmacia,
        existencia: p.existencia,
      };
    });

    res.json({
      items: respuesta,
      page: pageNum,
      page_size: pageSize,
      total: totalProductos,
      total_pages: Math.ceil(totalProductos / pageSize),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar catálogo' });
  }
});

// A partir de aquí, todas las rutas requieren cliente autenticado.
router.use(auth, requireRole('cliente'), attachUser);

// Costo de delivery estimado para motos según carrito y distancia aproximada cliente–farmacia(s).
// Usa un tabulador por km y nunca deja que el costo supere una fracción del subtotal.
router.get('/delivery/estimado', async (req, res) => {
  try {
    const items = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
    let subtotal = 0;
    const byFarmacia = new Map(); // farmaciaId -> monto del carrito asociado

    for (const it of items) {
      const p = it.productoId;
      if (!p) continue;
      const precioUnitario = getPrecioConPorcentaje(p);
      const monto = precioUnitario * it.cantidad;
      subtotal += monto;
      const fid = (p.farmaciaId && (p.farmaciaId._id || p.farmaciaId))?.toString();
      if (fid) byFarmacia.set(fid, (byFarmacia.get(fid) || 0) + monto);
    }

    if (subtotal <= 0 || byFarmacia.size === 0) {
      return res.json({ costo: 0 });
    }

    // Tabulador de referencia para delivery en moto (por pedido, según la distancia máxima a las farmacias).
    const TARIFAS_MOTO_KM = [
      { kmMax: 2, precio: 1.0 },
      { kmMax: 5, precio: 1.5 },
      { kmMax: 8, precio: 2.0 },
      { kmMax: 12, precio: 2.5 },
      { kmMax: 20, precio: 3.0 },
      { kmMax: 30, precio: 3.5 },
    ];
    const RECARGO_FARMACIA_ADICIONAL = 0.5;

    const numFarmacias = byFarmacia.size;

    // 1) Determinar coordenadas del cliente: primero query ?lat,lng, si no usar ultimaLat/ultimaLng guardadas.
    let latCliente = Number.isFinite(parseFloat(req.query.lat)) ? parseFloat(req.query.lat) : null;
    let lngCliente = Number.isFinite(parseFloat(req.query.lng)) ? parseFloat(req.query.lng) : null;

    if (!Number.isFinite(latCliente) || !Number.isFinite(lngCliente)) {
      const cliente = await User.findById(getClienteId(req)).select('ultimaLat ultimaLng');
      if (cliente?.ultimaLat != null && cliente?.ultimaLng != null) {
        latCliente = cliente.ultimaLat;
        lngCliente = cliente.ultimaLng;
      }
    }

    let costo;

    if (Number.isFinite(latCliente) && Number.isFinite(lngCliente)) {
      // 2) Calcular distancia máxima a las farmacias del carrito.
      const farmaciaIds = Array.from(byFarmacia.keys());
      const farmacias = await Farmacia.find({ _id: { $in: farmaciaIds } }).select('lat lng');

      const coordsFarmacias = farmacias.filter((f) => typeof f.lat === 'number' && typeof f.lng === 'number');

      let distancias = [];

      if (GOOGLE_DISTANCE_MATRIX_API_KEY && coordsFarmacias.length) {
        try {
          const origins = `${latCliente},${lngCliente}`;
          const destinos = coordsFarmacias.map((f) => `${f.lat},${f.lng}`).join('|');
          const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&mode=driving&origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinos)}&key=${GOOGLE_DISTANCE_MATRIX_API_KEY}`;
          const resp = await fetch(url);
          if (resp.ok) {
            const data = await resp.json();
            const elements = data?.rows?.[0]?.elements || [];
            for (const el of elements) {
              if (el.status === 'OK' && el.distance?.value != null) {
                distancias.push(el.distance.value / 1000); // km
              }
            }
          }
        } catch (err) {
          console.error('Distance Matrix error', err);
        }
      }

      // Fallback o complemento: si Distance Matrix no dio nada, usar Haversine aproximado.
      if (!distancias.length) {
        for (const f of coordsFarmacias) {
          const R = 6371; // km
          const dLat = (f.lat - latCliente) * Math.PI / 180;
          const dLng = (f.lng - lngCliente) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2
            + Math.cos(latCliente * Math.PI / 180) * Math.cos(f.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          distancias.push(R * c);
        }
      }

      const distanciaRef = distancias.length ? Math.max(...distancias) : 0;

      // Buscar precio en el tabulador según la distancia de referencia.
      let precioTabla = TARIFAS_MOTO_KM[TARIFAS_MOTO_KM.length - 1].precio;
      for (const tramo of TARIFAS_MOTO_KM) {
        if (distanciaRef <= tramo.kmMax) {
          precioTabla = tramo.precio;
          break;
        }
      }

      const recargo = Math.max(0, numFarmacias - 1) * RECARGO_FARMACIA_ADICIONAL;
      costo = precioTabla + recargo;
    } else {
      // Sin coordenadas del cliente: fallback por número de farmacias (más barato que carro, pero coherente).
      const base = 1.5;
      const extra = Math.max(0, numFarmacias - 1) * 0.75;
      costo = base + extra;
    }

    // Redondear a 2 decimales y asegurar que no supere una fracción del subtotal.
    costo = Math.round(costo * 100) / 100;
    if (subtotal > 0 && costo > subtotal) {
      // Máximo 50% del subtotal (ajustable).
      const limite = subtotal * 0.5;
      costo = Math.round(Math.min(costo, limite) * 100) / 100;
    }

    res.json({ costo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al estimar delivery' });
  }
});

// Estados para filtro
router.get('/estados', (req, res) => {
  res.json(ESTADOS_VENEZUELA);
});

// --- Recordatorios de medicamentos ---
function calcularFechaFin(fechaCompra, cantidadInicial, cantidadPorToma, intervaloHoras) {
  const dosesPerDay = 24 / Math.max(intervaloHoras, 0.25);
  const totalDoses = cantidadInicial / Math.max(cantidadPorToma, 0.5);
  const daysTotal = totalDoses / dosesPerDay;
  return new Date(fechaCompra.getTime() + daysTotal * 24 * 60 * 60 * 1000);
}

// GET /api/cliente/recordatorios — lista los recordatorios del cliente; dispara notificación 2 días antes del fin si aplica.
router.get('/recordatorios', async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const list = await RecordatorioMedicamento.find({ clienteId, activo: true }).sort({ fechaEstimadaFin: 1 });
    const ahora = new Date();
    const dosDiasMs = 2 * 24 * 60 * 60 * 1000;

    for (const rec of list) {
      const falta = rec.fechaEstimadaFin.getTime() - ahora.getTime();
      if (!rec.notificadoFinProximo && falta > 0 && falta <= dosDiasMs) {
        rec.notificadoFinProximo = true;
        await rec.save();
        await Notificacion.create({
          userId: clienteId,
          tipo: 'recordatorio_quedapoco',
          mensaje: `Dona: Recuerda que solo te queda tratamiento para unos dos días de "${rec.descripcion}". Cuando quieras, podemos hacer otra compra. ¡Estoy aquí para ayudarte!`,
          recordatorioId: rec._id,
        });
      }
    }

    const lista = await RecordatorioMedicamento.find({ clienteId, activo: true }).sort({ fechaEstimadaFin: 1 });
    res.json(lista);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar recordatorios' });
  }
});

// POST /api/cliente/recordatorios — agregar medicamento. Body: codigo, descripcion, imagen?, fechaCompra, cantidadInicial, cantidadPorToma, intervaloHoras, precioReferencia?, hora?, dias?
router.post('/recordatorios', async (req, res) => {
  try {
    const { codigo, descripcion, imagen, fechaCompra, cantidadInicial, cantidadPorToma, intervaloHoras, precioReferencia, hora, dias } = req.body;
    if (!codigo || !descripcion || !fechaCompra || cantidadInicial == null || cantidadPorToma == null || intervaloHoras == null) {
      return res.status(400).json({ error: 'Faltan campos: codigo, descripcion, fechaCompra, cantidadInicial, cantidadPorToma, intervaloHoras' });
    }
    const fecha = new Date(fechaCompra);
    if (Number.isNaN(fecha.getTime())) return res.status(400).json({ error: 'fechaCompra inválida' });
    const cantInicial = Number(cantidadInicial) || 1;
    const cantToma = Number(cantidadPorToma) || 1;
    const intervalo = Number(intervaloHoras) || 8;
    const fechaFin = calcularFechaFin(fecha, cantInicial, cantToma, intervalo);
    const diasNorm = Array.isArray(dias) ? dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : undefined;

    const rec = await RecordatorioMedicamento.create({
      clienteId: getClienteId(req),
      codigo: String(codigo).trim(),
      descripcion: String(descripcion).trim(),
      imagen: imagen != null ? String(imagen) : undefined,
      fechaCompra: fecha,
      cantidadInicial: cantInicial,
      cantidadPorToma: cantToma,
      intervaloHoras: intervalo,
      precioReferencia: precioReferencia != null ? Number(precioReferencia) : undefined,
      fechaEstimadaFin: fechaFin,
      activo: true,
      hora: hora != null && String(hora).trim() ? String(hora).trim() : undefined,
      dias: diasNorm && diasNorm.length ? diasNorm : undefined,
    });
    res.status(201).json(rec);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al crear recordatorio' });
  }
});

// PATCH /api/cliente/recordatorios/:id
router.patch('/recordatorios/:id', async (req, res) => {
  try {
    const rec = await RecordatorioMedicamento.findOne({ _id: req.params.id, clienteId: getClienteId(req) });
    if (!rec) return res.status(404).json({ error: 'Recordatorio no encontrado' });
    const { fechaCompra, cantidadInicial, cantidadPorToma, intervaloHoras, precioReferencia, activo, hora, dias } = req.body;
    if (fechaCompra != null) rec.fechaCompra = new Date(fechaCompra);
    if (cantidadInicial != null) rec.cantidadInicial = Number(cantidadInicial) || 1;
    if (cantidadPorToma != null) rec.cantidadPorToma = Number(cantidadPorToma) || 1;
    if (intervaloHoras != null) rec.intervaloHoras = Number(intervaloHoras) || 8;
    if (precioReferencia !== undefined) rec.precioReferencia = precioReferencia != null ? Number(precioReferencia) : undefined;
    if (typeof activo === 'boolean') rec.activo = activo;
    if (hora !== undefined) rec.hora = hora != null && String(hora).trim() ? String(hora).trim() : null;
    if (dias !== undefined) rec.dias = Array.isArray(dias) ? dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : rec.dias;
    rec.fechaEstimadaFin = calcularFechaFin(rec.fechaCompra, rec.cantidadInicial, rec.cantidadPorToma, rec.intervaloHoras);
    await rec.save();
    res.json(rec);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar recordatorio' });
  }
});

// DELETE /api/cliente/recordatorios/:id
router.delete('/recordatorios/:id', async (req, res) => {
  try {
    const rec = await RecordatorioMedicamento.findOne({ _id: req.params.id, clienteId: getClienteId(req) });
    if (!rec) return res.status(404).json({ error: 'Recordatorio no encontrado' });
    rec.activo = false;
    await rec.save();
    res.json({ message: 'Recordatorio desactivado' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar recordatorio' });
  }
});

// --- Solicitar producto (cuando no hay stock): 1 vez cada 7 días por producto ---
router.post('/solicitar-producto', async (req, res) => {
  try {
    const codigo = req.body.codigo != null ? String(req.body.codigo).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'codigo requerido' });
    const clienteId = getClienteId(req);

    const hayStock = await Producto.exists({ codigo, existencia: { $gt: 0 } });
    if (hayStock) {
      return res.status(400).json({ error: 'Este producto ya está disponible. Puedes agregarlo al carrito.' });
    }

    const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ultimaSolicitud = await SolicitudProductoCliente.findOne({
      clienteId,
      codigo,
      createdAt: { $gte: hace7Dias },
    }).sort({ createdAt: -1 });
    if (ultimaSolicitud) {
      const proximaFecha = new Date(ultimaSolicitud.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      return res.status(400).json({
        error: 'Ya solicitaste este producto recientemente. Podrás volver a solicitarlo en 7 días.',
        proximaDisponible: proximaFecha,
      });
    }

    await SolicitudProductoCliente.create({ clienteId, codigo });
    res.status(201).json({ message: 'Solicitud registrada. Te avisaremos cuando esté disponible.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al registrar solicitud' });
  }
});

// --- Solicitar producto por nombre (no catalogado): guardar en solicitudes no catalogadas ---
router.post('/solicitar-producto-por-nombre', async (req, res) => {
  try {
    const nombre = req.body.nombre != null ? String(req.body.nombre).trim() : '';
    if (!nombre || nombre.length < 2) {
      return res.status(400).json({ error: 'nombre requerido (mínimo 2 caracteres)' });
    }
    const clienteId = getClienteId(req);

    const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ultimaSolicitud = await SolicitudProductoNoCatalogado.findOne({
      clienteId,
      nombre: new RegExp(`^${escapeRegex(nombre)}$`, 'i'),
      createdAt: { $gte: hace7Dias },
    }).sort({ createdAt: -1 });
    if (ultimaSolicitud) {
      const proximaFecha = new Date(ultimaSolicitud.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      return res.status(400).json({
        error: 'Ya solicitaste este producto por nombre recientemente. Podrás volver a solicitarlo en 7 días.',
        proximaDisponible: proximaFecha,
      });
    }

    await SolicitudProductoNoCatalogado.create({ clienteId, nombre });
    res.status(201).json({ message: 'Solicitud registrada. Te avisaremos si lo conseguimos.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al registrar solicitud por nombre' });
  }
});

// --- Recetas / escáner: buscar por texto y agregar al carrito ---
// GET /api/cliente/recetas/buscar?q= — busca en catálogo maestro y en Producto (con stock); devuelve RecetaBuscarItem[] plano para el frontend.
router.get('/recetas/buscar', async (req, res) => {
  try {
    const q = (req.query.q && String(req.query.q).trim()) || '';
    if (!q) return res.json([]);

    const search = new RegExp(q, 'i');
    const dbCatalogo = mongoose.connection.useDb(process.env.MONGO_DB_CATALOGO || 'Zas');
    const collMaestro = dbCatalogo.collection('catalogo_maestro');

    const fromMaestro = await collMaestro.find({
      $or: [
        { ean_13: search },
        { description: search },
        { brand: search },
      ],
    }).limit(50).toArray();

    const productos = await Producto.find({
      existencia: { $gt: 0 },
      $or: [
        { codigo: search },
        { descripcion: search },
        { marca: search },
      ],
    }).populate('farmaciaId', 'nombreFarmacia').limit(100);

    // Agrupamos por código para unificar catálogo maestro y productos con stock.
    const byCodigo = new Map();
    for (const d of fromMaestro) {
      const cod = (d.ean_13 || '').toString();
      if (!cod) continue;
      if (!byCodigo.has(cod)) {
        byCodigo.set(cod, {
          codigo: cod,
          descripcion: d.description || '',
          marca: d.brand || '',
          imagen: d.image_path || null,
          maestroId: d._id?.toString?.() || null,
          ofertas: [],
        });
      }
    }
    for (const p of productos) {
      const cod = (p.codigo || '').toString();
      if (!cod) continue;
      if (!byCodigo.has(cod)) {
        byCodigo.set(cod, {
          codigo: cod,
          descripcion: p.descripcion || '',
          marca: p.marca || '',
          imagen: p.foto || null,
          maestroId: null,
          ofertas: [],
        });
      }
      const precioCon = getPrecioConPorcentaje(p);
      byCodigo.get(cod).ofertas.push({
        productoId: p._id.toString(),
        farmaciaId: (p.farmaciaId?._id || p.farmaciaId)?.toString(),
        nombreFarmacia: p.farmaciaId?.nombreFarmacia,
        precio: precioCon,
        existencia: p.existencia,
      });
    }

    // Adaptamos la respuesta a RecetaBuscarItem[]:
    // { id: string, codigo: string, descripcion: string, precio: number, farmaciaId: string | null, existencia: number }
    const items = Array.from(byCodigo.values()).map((entry) => {
      const { codigo, descripcion, maestroId, ofertas } = entry;
      if (ofertas.length === 0) {
        // Solo catálogo maestro: sin stock asociado todavía.
        return {
          id: maestroId || codigo,
          codigo,
          descripcion,
          precio: 0,
          farmaciaId: null,
          existencia: 0,
        };
      }
      // Elegimos la mejor oferta (precio mínimo) para ese código.
      let best = ofertas[0];
      for (const ofr of ofertas) {
        if (ofr.precio < best.precio) best = ofr;
      }
      return {
        id: best.productoId,
        codigo,
        descripcion,
        precio: best.precio,
        farmaciaId: best.farmaciaId || null,
        existencia: best.existencia ?? 0,
      };
    });

    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al buscar receta' });
  }
});

// POST /api/cliente/recetas/analizar-imagen
// Body: multipart/form-data, campo "file" (JPEG, PNG, WebP; máx 10 MB).
// 200: { medicamentos: [...], es_recipe_valido, medicamento, dosis, cantidad, es_recipe }
// 400: { error: "..." } (falta archivo, formato inválido, imagen ilegible)
// 500: { error: "Error al analizar la imagen. Intenta de nuevo." }
const MIME_IMAGEN = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ERROR_ANALISIS = 'Error al analizar la imagen. Intenta de nuevo.';

router.post('/recetas/analizar-imagen', uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Falta la imagen del récipe.' });
    }
    const mime = (req.file.mimetype || '').toLowerCase();
    if (!MIME_IMAGEN.includes(mime)) {
      return res.status(400).json({
        error: 'Formato de imagen no válido. Usa JPEG, PNG o WebP.',
      });
    }
    if (!geminiClient || !GEMINI_API_KEY) {
      return res.status(500).json({ error: ERROR_ANALISIS });
    }

    const model = geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Usar buffer en memoria (evita disco en Render y fallos de path)
    const base64 = req.file.buffer.toString('base64');

    const prompt = [
      'Actúa como un farmacéutico experto.',
      'Analiza la imagen de este récipe médico y extrae la información en el siguiente formato JSON estrictamente:',
      "{ 'medicamentos': [ { 'nombre': '', 'concentracion': '', 'dosis': '', 'cantidad_total': 0 } ], 'es_recipe_valido': true/false, 'texto_receta': '' }.",
      "En 'texto_receta' incluye el texto completo que logras leer en la imagen (OCR), tal cual, en un solo string. Si no se puede leer, usa string vacío.",
      'Si el texto es ilegible, devuelve los campos vacíos.',
      'No añadas texto explicativo, solo el JSON.',
    ].join(' ');

    let text;
    try {
      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            data: base64,
            mimeType: req.file.mimetype || 'image/jpeg',
          },
        },
      ]);
      text = result.response.text().trim();
    } catch (err) {
      console.error('Error llamando a Gemini:', err);
      return res.status(500).json({ error: ERROR_ANALISIS });
    }

    let parsed = null;
    try {
      const cleaned = text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return res.status(400).json({
        error: 'No se pudo leer la imagen. Prueba con una foto más nítida.',
      });
    }

    const medsSource = Array.isArray(parsed.medicamentos) ? parsed.medicamentos : [];
    const medicamentos = medsSource.map((m) => ({
      nombre: typeof m?.nombre === 'string' ? m.nombre : '',
      concentracion: typeof m?.concentracion === 'string' ? m.concentracion : '',
      dosis: typeof m?.dosis === 'string' ? m.dosis : '',
      cantidad_total: Number.isFinite(Number(m?.cantidad_total)) ? Number(m.cantidad_total) : 0,
    })).filter((m) => m.nombre || m.concentracion || m.dosis || m.cantidad_total > 0);

    const esRecipeValido = typeof parsed.es_recipe_valido === 'boolean'
      ? parsed.es_recipe_valido
      : Boolean(parsed.es_recipe);

    const first = medicamentos[0] || {
      nombre: '',
      concentracion: '',
      dosis: '',
      cantidad_total: 0,
    };

    const textoReceta = typeof parsed.texto_receta === 'string' ? parsed.texto_receta.trim() : '';

    return res.json({
      medicamentos,
      es_recipe_valido: esRecipeValido,
      texto_receta: textoReceta,
      medicamento: first.nombre,
      dosis: first.concentracion || first.dosis,
      cantidad: first.cantidad_total ? String(first.cantidad_total) : '',
      es_recipe: esRecipeValido,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: ERROR_ANALISIS });
  }
});

// POST /api/cliente/recetas/agregar-al-carrito
// Soporta:
// - body: { items: [ { productoId, cantidad } ] }  (modo lote actual)
// - body: { productoId, cantidad }
// - body: { codigo, cantidad }
router.post('/recetas/agregar-al-carrito', async (req, res) => {
  try {
    let items = [];

    if (Array.isArray(req.body.items) && req.body.items.length) {
      // Modo actual: lote de items.
      items = req.body.items;
    } else if (req.body && (req.body.productoId || req.body.codigo)) {
      // Nuevo modo: un solo item, ya sea por productoId o por código.
      items = [{
        productoId: req.body.productoId,
        codigo: req.body.codigo,
        cantidad: req.body.cantidad,
      }];
    }

    if (!items.length) {
      return res.status(400).json({ error: 'Debe enviar items[] o un objeto con productoId/codigo y cantidad' });
    }

    const clienteId = getClienteId(req);
    const agregados = [];
    const errores = [];

    for (const it of items) {
      let productoId = it.productoId;
      const cantidad = Math.max(1, parseInt(it.cantidad, 10) || 1);

      // Si no viene productoId pero sí un código, buscamos un producto disponible para ese código.
      if (!productoId && it.codigo) {
        const codigo = String(it.codigo).trim();
        if (!codigo) {
          errores.push({ codigo: it.codigo, error: 'codigo vacío' });
          continue;
        }
        const candidatos = await Producto.find({ codigo, existencia: { $gt: 0 } });
        if (!candidatos.length) {
          errores.push({ codigo, error: 'No hay productos disponibles para este código' });
          continue;
        }
        // Elegimos el más barato disponible.
        let mejor = candidatos[0];
        let mejorPrecio = getPrecioConPorcentaje(mejor);
        for (const p of candidatos) {
          const precio = getPrecioConPorcentaje(p);
          if (precio < mejorPrecio) {
            mejor = p;
            mejorPrecio = precio;
          }
        }
        productoId = mejor._id.toString();
      }

      if (!productoId || !mongoose.Types.ObjectId.isValid(productoId)) {
        errores.push({ productoId, codigo: it.codigo, error: 'productoId inválido' });
        continue;
      }

      const producto = await Producto.findById(productoId);
      if (!producto || producto.existencia < cantidad) {
        errores.push({ productoId, error: 'Producto no disponible o sin stock suficiente' });
        continue;
      }
      let item = await Carrito.findOne({ clienteId, productoId });
      if (item) {
        item.cantidad = Math.min(item.cantidad + cantidad, producto.existencia);
        await item.save();
      } else {
        item = await Carrito.create({
          clienteId,
          productoId,
          cantidad: Math.min(cantidad, producto.existencia),
        });
      }
      agregados.push({ productoId, cantidad: item.cantidad });
    }

    const carrito = await Carrito.find({ clienteId }).populate('productoId');
    res.status(201).json({ carrito, agregados, errores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al agregar al carrito' });
  }
});

// Carrito: agregar
router.post('/carrito',
  body('productoId').isMongoId(),
  body('cantidad').isInt({ min: 1 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos' });

      const producto = await Producto.findById(req.body.productoId);
      if (!producto || producto.existencia < req.body.cantidad) {
        return res.status(400).json({ error: 'Producto no disponible o sin stock' });
      }

      let item = await Carrito.findOne({
        clienteId: getClienteId(req),
        productoId: req.body.productoId,
      });
      if (item) {
        item.cantidad = Math.min(item.cantidad + req.body.cantidad, producto.existencia);
        await item.save();
      } else {
        item = await Carrito.create({
          clienteId: getClienteId(req),
          productoId: req.body.productoId,
          cantidad: Math.min(req.body.cantidad, producto.existencia),
        });
      }

      const carrito = await Carrito.find({ clienteId: getClienteId(req) })
        .populate('productoId');
      res.json(carrito);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al agregar al carrito' });
    }
  }
);

// Carrito: listar
router.get('/carrito', async (req, res) => {
  try {
    const items = await Carrito.find({ clienteId: getClienteId(req) })
      .populate('productoId');
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener carrito' });
  }
});

// Carrito: actualizar cantidad
router.patch('/carrito/:productoId',
  body('cantidad').isInt({ min: 0 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Cantidad inválida' });
      if (req.body.cantidad === 0) {
        await Carrito.deleteOne({ clienteId: getClienteId(req), productoId: req.params.productoId });
      } else {
        const producto = await Producto.findById(req.params.productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
        await Carrito.updateOne(
          { clienteId: getClienteId(req), productoId: req.params.productoId },
          { cantidad: Math.min(req.body.cantidad, producto.existencia) }
        );
      }
      const carrito = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
      res.json(carrito);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar carrito' });
    }
  }
);

// Carrito: eliminar item
router.delete('/carrito/:productoId', async (req, res) => {
  try {
    await Carrito.deleteOne({ clienteId: getClienteId(req), productoId: req.params.productoId });
    const carrito = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
    res.json(carrito);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// Costo de delivery estimado según ubicación (lat, lng) y carrito. El costo no supera el subtotal.
router.get('/delivery/estimado', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const items = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
    let subtotal = 0;
    const byFarmacia = new Map();
    for (const it of items) {
      const p = it.productoId;
      if (!p) continue;
      const precioUnitario = getPrecioConPorcentaje(p);
      subtotal += precioUnitario * it.cantidad;
      const fid = (p.farmaciaId?.toString?.() || p.farmaciaId)?.toString();
      if (fid) byFarmacia.set(fid, (byFarmacia.get(fid) || 0) + precioUnitario * it.cantidad);
    }

    const costoDeliveryBase = 2;
    const costoDeliveryExtra = (byFarmacia.size - 1) * 1.5;
    let costo = Math.round((costoDeliveryBase + Math.max(0, costoDeliveryExtra)) * 100) / 100;

    if (Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))) {
      const ids = Array.from(byFarmacia.keys()).filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
      const farmacias = ids.length ? await Farmacia.find({ _id: { $in: ids } }).select('lat lng') : [];
      const latC = parseFloat(lat);
      const lngC = parseFloat(lng);
      let distTotal = 0;
      for (const f of farmacias) {
        if (f.lat != null && f.lng != null) {
          distTotal += Math.hypot(f.lat - latC, f.lng - lngC);
        }
      }
      const factorDist = 1 + Math.min(distTotal * 0.1, 3);
      costo = Math.round(costo * factorDist * 100) / 100;
    }

    if (subtotal > 0 && costo > subtotal) costo = Math.round(subtotal * 100) / 100;
    res.json({ costo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al estimar delivery' });
  }
});

// Resumen checkout: total + costo delivery (según lógica; aquí se puede usar distancia o fijo)
router.get('/checkout/resumen', async (req, res) => {
  try {
    const items = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
    const cliente = await User.findById(getClienteId(req));
    let subtotal = 0;
    const byFarmacia = new Map();

    for (const it of items) {
      const p = it.productoId;
      if (!p) continue;
      const precioUnitario = getPrecioConPorcentaje(p);
      const monto = precioUnitario * it.cantidad;
      subtotal += monto;
      const fid = p.farmaciaId?.toString() || p.farmaciaId;
      if (!byFarmacia.has(fid)) byFarmacia.set(fid, 0);
      byFarmacia.set(fid, byFarmacia.get(fid) + monto);
    }

    // Costo delivery: ejemplo base 2$ + 0.5$ por cada farmacia adicional
    const numFarmacias = byFarmacia.size;
    const costoDeliveryBase = 2;
    const costoDeliveryExtra = (numFarmacias - 1) * 1.5;
    const costoDelivery = Math.round((costoDeliveryBase + Math.max(0, costoDeliveryExtra)) * 100) / 100;
    const total = Math.round((subtotal + costoDelivery) * 100) / 100;

    res.json({
      subtotal,
      costoDelivery,
      total,
      numFarmacias,
      direccion: cliente?.direccion,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al calcular resumen' });
  }
});

// Procesar compra: subir comprobante y crear pedido(s) por farmacia. Body puede incluir direccionEntrega, latEntrega, lngEntrega.
router.post('/checkout/procesar',
  body('metodoPago').isIn(['pago_movil', 'transferencia', 'zelle', 'binance']),
  body('direccionEntrega').optional().trim(),
  body('latEntrega').optional().isFloat(),
  body('lngEntrega').optional().isFloat(),
  upload.single('comprobante'),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos' });

      if (!req.file) return res.status(400).json({ error: 'Debe cargar el comprobante de pago' });

      const cliente = await User.findById(getClienteId(req));
      const items = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
      if (!items.length) return res.status(400).json({ error: 'Carrito vacío' });

      const comprobanteUrl = `/uploads/${req.file.filename}`;
      const direccionEntrega = (req.body.direccionEntrega && String(req.body.direccionEntrega).trim()) || cliente.direccion || '';
      const lat = req.body.latEntrega != null ? Number(req.body.latEntrega) : cliente.ultimaLat;
      const lng = req.body.lngEntrega != null ? Number(req.body.lngEntrega) : cliente.ultimaLng;

      // Agrupar por farmacia
      const porFarmacia = new Map();
      for (const it of items) {
        const p = it.productoId;
        if (!p) continue;
        const fid = p.farmaciaId?.toString() || p.farmaciaId;
        if (!porFarmacia.has(fid)) porFarmacia.set(fid, []);
        const precioUnitario = getPrecioConPorcentaje(p);
        porFarmacia.get(fid).push({ productoId: p._id, cantidad: it.cantidad, precioUnitario, codigo: p.codigo, descripcion: p.descripcion });
      }

      const costoDeliveryBase = 2;
      const numFarmacias = porFarmacia.size;
      const costoDeliveryPorPedido = Math.round((costoDeliveryBase + (numFarmacias - 1) * 1.5) / numFarmacias * 100) / 100;

      const pedidosCreados = [];

      for (const [farmaciaId, articulos] of porFarmacia) {
        let subtotal = 0;
        const lineas = articulos.map((a) => {
          subtotal += a.precioUnitario * a.cantidad;
          return {
            productoId: a.productoId,
            codigo: a.codigo,
            descripcion: a.descripcion,
            cantidad: a.cantidad,
            precioUnitario: a.precioUnitario,
          };
        });
        const costoDelivery = costoDeliveryPorPedido;
        const total = Math.round((subtotal + costoDelivery) * 100) / 100;

        const pedido = await Pedido.create({
          clienteId: getClienteId(req),
          farmaciaId: new mongoose.Types.ObjectId(farmaciaId),
          items: lineas,
          subtotal,
          costoDelivery,
          total,
          direccionEntrega,
          lat,
          lng,
          metodoPago: req.body.metodoPago,
          comprobanteUrl,
          estado: 'pendiente_validacion',
        });
        pedidosCreados.push(pedido);

        const farmacia = await Farmacia.findById(farmaciaId);
        const userFarmacia = await User.findOne({ farmaciaId });
        if (userFarmacia) {
          await Notificacion.create({
            userId: userFarmacia._id,
            tipo: 'pedido_nuevo',
            mensaje: `Nuevo pedido #${pedido._id.toString().slice(-6)}`,
            pedidoId: pedido._id,
          });
        }
      }

      await Carrito.deleteMany({ clienteId: getClienteId(req) });

      res.status(201).json({ message: 'Compra procesada', pedidos: pedidosCreados });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al procesar compra' });
    }
  }
);

// Actualizar ubicación (GPS) del cliente
// Body: { lat: number | null, lng: number | null }
// Si vienen null o faltan, se ignoran (no rompe).
router.patch('/ubicacion',
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  async (req, res) => {
    try {
      const update = {};
      const lat = req.body.lat;
      const lng = req.body.lng;

      if (lat !== null && lat !== undefined && Number.isFinite(Number(lat))) {
        update.ultimaLat = Number(lat);
      }
      if (lng !== null && lng !== undefined && Number.isFinite(Number(lng))) {
        update.ultimaLng = Number(lng);
      }

      if (Object.keys(update).length === 0) {
        // Nada que actualizar, pero respondemos ok para no romper el flujo del frontend.
        return res.json({ ok: true });
      }

      await User.updateOne(
        { _id: getClienteId(req) },
        update
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar ubicación' });
    }
  }
);

// Mis pedidos (incluye etaEntrega y posición del delivery para seguimiento sencillo)
router.get('/mis-pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ clienteId: getClienteId(req) })
      .populate('farmaciaId', 'nombreFarmacia direccion estado lat lng')
      .populate('deliveryId', 'nombre ultimaLat ultimaLng')
      .sort({ createdAt: -1 });
    res.json(pedidos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// API simplificada para portal cliente: historial y pedidos en curso
// Forma: PedidoClienteApi[]
router.get('/pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ clienteId: getClienteId(req) })
      .populate('deliveryId', 'ultimaLat ultimaLng')
      .sort({ createdAt: -1 });

    const now = Date.now();
    const items = pedidos.map((p) => {
      const obj = p.toObject();
      let etaMinutos = null;
      let etaHoraLlegada = null;
      if (obj.etaEntrega instanceof Date) {
        const diffMs = obj.etaEntrega.getTime() - now;
        etaMinutos = Math.round(diffMs / (60 * 1000));
        if (etaMinutos < 0) etaMinutos = 0;
        etaHoraLlegada = obj.etaEntrega.toISOString();
      }
      return {
        _id: obj._id.toString(),
        estado: obj.estado,
        total: obj.total,
        direccionEntrega: obj.direccionEntrega,
        latEntrega: obj.lat,
        lngEntrega: obj.lng,
        deliveryLat: obj.deliveryId?.ultimaLat ?? null,
        deliveryLng: obj.deliveryId?.ultimaLng ?? null,
        etaMinutos,
        etaHoraLlegada,
        createdAt: obj.createdAt,
      };
    });

    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Seguimiento de un pedido: estado, dirección y coords de entrega, ETA, posición del delivery en tiempo real
router.get('/pedidos/:id/seguimiento', async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ _id: req.params.id, clienteId: getClienteId(req) })
      .populate('farmaciaId', 'nombreFarmacia direccion telefono lat lng')
      .populate('deliveryId', 'nombre telefono ultimaLat ultimaLng');
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    const p = pedido.toObject();
    res.json({
      id: p._id,
      estado: p.estado,
      direccionEntrega: p.direccionEntrega,
      latEntrega: p.lat,
      lngEntrega: p.lng,
      etaEntrega: p.etaEntrega,
      farmacia: p.farmaciaId,
      delivery: p.deliveryId ? {
        nombre: p.deliveryId.nombre,
        telefono: p.deliveryId.telefono,
        lat: p.deliveryId.ultimaLat,
        lng: p.deliveryId.ultimaLng,
      } : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener seguimiento' });
  }
});

export default router;
