import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Farmacia from '../models/Farmacia.js';
import Producto from '../models/Producto.js';
import SolicitudDelivery from '../models/SolicitudDelivery.js';
import SolicitudFarmacia from '../models/SolicitudFarmacia.js';
import SolicitudPlanPro from '../models/SolicitudPlanPro.js';
import SolicitudProductoCliente from '../models/SolicitudProductoCliente.js';
import SolicitudProductoNoCatalogado from '../models/SolicitudProductoNoCatalogado.js';
import DeliveryStats from '../models/DeliveryStats.js';
import { auth, requireRole } from '../middleware/auth.js';
import { ESTADOS_VENEZUELA } from '../constants/estados.js';
import { getCachedInventario, setCachedInventario } from '../util/cacheInventarioMaster.js';

const router = Router();
const __dirnameMaster = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirnameMaster, '../../uploads');

router.use(auth, requireRole('master'));

// GET /documento-imagen?path=uploads/archivo.jpeg — sirve archivos de uploads solo para admin (evita CORS en panel)
router.get('/documento-imagen', (req, res) => {
  try {
    const rawPath = (req.query.path && String(req.query.path).trim()) || '';
    if (!rawPath || rawPath.includes('..')) {
      return res.status(400).json({ error: 'path inválido' });
    }
    const normalized = path.normalize(rawPath).replace(/^\//, '');
    if (normalized !== 'uploads' && !normalized.startsWith('uploads/')) {
      return res.status(400).json({ error: 'Solo se permiten rutas bajo uploads/' });
    }
    const relative = normalized === 'uploads' ? '' : normalized.replace(/^uploads\/?/, '');
    const fullPath = path.join(uploadDir, relative);
    const resolved = path.resolve(fullPath);
    const baseResolved = path.resolve(uploadDir);
    if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.sendFile(resolved);
  } catch (e) {
    console.error('documento-imagen', e);
    res.status(500).json({ error: 'Error al servir el archivo' });
  }
});

// Listar todas las farmacias (para que master elija "entrar como" una farmacia)
router.get('/farmacias', async (req, res) => {
  try {
    const list = await Farmacia.find()
      .select('nombreFarmacia rif estado direccion telefono lat lng planProActivo usuarioId')
      .populate('usuarioId', 'email')
      .sort({ nombreFarmacia: 1 });

    const mapped = list.map((f) => {
      const obj = f.toObject();
      return {
        _id: obj._id,
        nombreFarmacia: obj.nombreFarmacia,
        rif: obj.rif,
        direccion: obj.direccion,
        telefono: obj.telefono,
        estado: obj.estado,
        lat: obj.lat,
        lng: obj.lng,
        email: obj.usuarioId?.email || null,
        planProActivo: obj.planProActivo,
      };
    });

    res.json(mapped);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar farmacias' });
  }
});

// GET /api/master/inventario/solicitudes-detalle?codigo=XXX — detalle de quién solicitó un producto (para expandir fila sin cargar todo).
router.get('/inventario/solicitudes-detalle', async (req, res) => {
  try {
    const codigo = req.query.codigo != null ? String(req.query.codigo).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'codigo requerido' });

    const solicitudes = await SolicitudProductoCliente.find({ codigo })
      .select('clienteId createdAt')
      .populate('clienteId', 'nombre apellido email')
      .sort({ createdAt: -1 })
      .lean();

    const detalle = solicitudes.map((s) => {
      const user = s.clienteId;
      return {
        userId: user?._id ?? s.clienteId,
        nombre: user?.nombre && user?.apellido ? `${user.nombre} ${user.apellido}`.trim() : user?.email || null,
        email: user?.email ?? null,
        fecha: s.createdAt,
      };
    });

    res.json({ codigo, detalle });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener detalle de solicitudes' });
  }
});

// GET /api/master/inventario — solo admin (master). Paginado: page, page_size. Respuesta { items, total }.
// Soporta búsqueda q por codigo/descripcion/marca (contiene, no solo empieza por). Usa catálogo maestro como base.
router.get('/inventario', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const page_size = Math.min(500, Math.max(1, parseInt(req.query.page_size, 10) || 300));
    const skip = (page - 1) * page_size;

    const qRaw = (req.query.q && String(req.query.q).trim()) || '';
    const q = qRaw.toLowerCase();
    const soloConSolicitudes = String(req.query.solo_con_solicitudes || '').toLowerCase() === 'true';

    const useCache = !q && !soloConSolicitudes;
    if (useCache) {
      const cached = getCachedInventario(page, page_size);
      if (cached) return res.json(cached);
    }

    const dbCatalogo = mongoose.connection.useDb(process.env.MONGO_DB_CATALOGO || 'Zas');
    const coll = dbCatalogo.collection('catalogo_maestro');

    const baseFilter = { ean_13: { $exists: true, $ne: '' } };
    let catalogFilter = baseFilter;
    if (q) {
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const palabras = q.split(/\s+/).filter((p) => p);
      if (palabras.length) {
        const andConds = palabras.map((palabra) => {
          const re = new RegExp(escapeRegex(palabra), 'i');
          return {
            $or: [
              { ean_13: re },
              { description: re },
              { brand: re },
            ],
          };
        });
        catalogFilter = {
          ...baseFilter,
          $and: andConds,
        };
      }
    }

    let catalogoDocs;
    let total = 0;

    if (soloConSolicitudes) {
      // Modo especial: solo productos que tienen solicitudes (en cualquier página).
      const aggSolicitudes = await SolicitudProductoCliente.aggregate([
        { $group: { _id: '$codigo', cantidad: { $sum: 1 } } },
      ]);
      const codigosSolicitados = aggSolicitudes.map((s) => s._id).filter(Boolean);

      if (!codigosSolicitados.length) {
        return res.json({ items: [], total: 0 });
      }

      catalogFilter = { ...catalogFilter, ean_13: { $in: codigosSolicitados } };
      total = await coll.countDocuments(catalogFilter);
      catalogoDocs = await coll
        .find(catalogFilter, { projection: { ean_13: 1, description: 1, brand: 1 } })
        .sort({ ean_13: 1 })
        .toArray();
    } else {
      total = await coll.countDocuments(catalogFilter);
      catalogoDocs = await coll
        .find(catalogFilter, { projection: { ean_13: 1, description: 1, brand: 1 } })
        .sort({ ean_13: 1 })
        .skip(skip)
        .limit(page_size)
        .toArray();
    }

    const codigos = catalogoDocs.map((d) => d.ean_13).filter(Boolean);
    if (codigos.length === 0) {
      const out = { items: [], total };
      setCachedInventario(page, page_size, out);
      return res.json(out);
    }

    const [productoAgg, solicitudesAgg, totalSolicitudesGlobalAgg] = await Promise.all([
      Producto.aggregate([
        { $match: { codigo: { $in: codigos } } },
        { $sort: { codigo: 1 } },
        {
          $group: {
            _id: '$codigo',
            existenciaGlobal: { $sum: '$existencia' },
            descripcion: { $first: '$descripcion' },
            marca: { $first: '$marca' },
            categoria: { $first: '$categoria' },
          },
        },
      ]),
      SolicitudProductoCliente.aggregate([
        { $match: { codigo: { $in: codigos } } },
        { $group: { _id: '$codigo', cantidad: { $sum: 1 } } },
      ]),
      // Total global de solicitudes (todas las páginas / todos los códigos)
      SolicitudProductoCliente.aggregate([
        { $group: { _id: null, cantidad: { $sum: 1 } } },
      ]),
    ]);

    const byCodigo = new Map(productoAgg.map((p) => [p._id, p]));
    const solicitudesByCodigo = new Map(solicitudesAgg.map((s) => [s._id, s.cantidad]));

    const items = catalogoDocs.map((d) => {
      const codigo = d.ean_13;
      const p = byCodigo.get(codigo);
      const descripcion = (p?.descripcion && p.descripcion.trim()) || (d.description && d.description.trim()) || '';
      const marca = (p?.marca && p.marca.trim()) || (d.brand && d.brand.trim()) || '';
      const departamento = p?.categoria ?? null;
      const existenciaGlobal = p?.existenciaGlobal ?? 0;
      const cantidad = solicitudesByCodigo.get(codigo) ?? 0;
      return {
        codigo,
        descripcion,
        marca,
        departamento,
        existenciaGlobal,
        solicitudes: { cantidad },
      };
    });

    const totalSolicitudesGlobal = totalSolicitudesGlobalAgg[0]?.cantidad ?? 0;

    const out = { items, total, totalSolicitudes: totalSolicitudesGlobal };
    if (useCache) {
      setCachedInventario(page, page_size, out);
    }
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener inventario maestro' });
  }
});

// GET /api/master/notificaciones-productos
// Agrupa solicitudes por código (catalogadas) y por nombre (no catalogadas) para mostrar en la campana de Admin.
router.get('/notificaciones-productos', async (req, res) => {
  try {
    // 1) Solicitudes por código (productos en catálogo)
    const aggCodigos = await SolicitudProductoCliente.aggregate([
      {
        $group: {
          _id: '$codigo',
          totalSolicitudes: { $sum: 1 },
          fecha: { $max: '$createdAt' },
        },
      },
    ]);

    const codigos = aggCodigos.map((s) => s._id).filter(Boolean);

    let descripcionByCodigo = new Map();
    if (codigos.length) {
      const dbCatalogo = mongoose.connection.useDb(process.env.MONGO_DB_CATALOGO || 'Zas');
      const coll = dbCatalogo.collection('catalogo_maestro');

      const catalogDocs = await coll
        .find(
          { ean_13: { $in: codigos } },
          { projection: { ean_13: 1, description: 1 } }
        )
        .toArray();
      descripcionByCodigo = new Map(
        catalogDocs
          .filter((d) => d.ean_13)
          .map((d) => [d.ean_13, (d.description || '').trim()])
      );
    }

    const notifsCodigos = aggCodigos.map((s) => {
      const codigo = s._id;
      const descCatalogo = descripcionByCodigo.get(codigo) || '';
      return {
        id: codigo,
        codigo,
        descripcion: descCatalogo || codigo,
        totalSolicitudes: s.totalSolicitudes || 0,
        fecha: s.fecha,
      };
    });

    // 2) Solicitudes no catalogadas (por nombre)
    const aggNoCat = await SolicitudProductoNoCatalogado.aggregate([
      {
        $addFields: {
          nombreNorm: { $toLower: '$nombre' },
        },
      },
      {
        $group: {
          _id: '$nombreNorm',
          nombreDisplay: { $first: '$nombre' },
          totalSolicitudes: { $sum: 1 },
          fecha: { $max: '$createdAt' },
        },
      },
    ]);

    const notifsNoCat = aggNoCat.map((s, idx) => {
      const nombre = (s.nombreDisplay || '').trim() || s._id || `no-cat-${idx}`;
      const id = `no-cat:${s._id || idx}`;
      return {
        id,
        descripcion: `${nombre} (no en catálogo)`,
        totalSolicitudes: s.totalSolicitudes || 0,
        noCatalogado: true,
        fecha: s.fecha,
      };
    });

    const all = [...notifsCodigos, ...notifsNoCat].sort((a, b) => {
      const da = a.fecha ? new Date(a.fecha).getTime() : 0;
      const db = b.fecha ? new Date(b.fecha).getTime() : 0;
      return db - da;
    });

    res.json(all);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener notificaciones de productos' });
  }
});

// GET /api/master/solicitudes-no-catalogadas — solicitudes por nombre (productos no en catálogo), agrupado por nombre.
router.get('/solicitudes-no-catalogadas', async (req, res) => {
  try {
    const list = await SolicitudProductoNoCatalogado.aggregate([
      { $match: { nombre: { $exists: true, $ne: '' } } },
      { $addFields: { nombreNorm: { $toLower: '$nombre' } } },
      { $group: { _id: '$nombreNorm', cantidad: { $sum: 1 }, nombreDisplay: { $first: '$nombre' } } },
      { $project: { nombre: '$nombreDisplay', cantidad: 1, _id: 0 } },
      { $sort: { cantidad: -1 } },
    ]);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar solicitudes no catalogadas' });
  }
});

// Listar todos los usuarios (para ver tipo: cliente, delivery, farmacia). Incluye estado (ej. "Miranda") para que Admin muestre el listado de clientes.
router.get('/usuarios', async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'master' } })
      .select('-password')
      .populate('farmaciaId')
      .sort({ createdAt: -1 })
      .lean();
    const list = users.map((u) => ({
      ...u,
      estado: u.estado ?? '',
      municipio: u.municipio ?? '',
    }));
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

// Listar repartidores (usuarios con role delivery) para el panel master
router.get('/delivery', async (req, res) => {
  try {
    const list = await User.find({ role: 'delivery' })
      .select('-password')
      .sort({ nombre: 1, createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar repartidores' });
  }
});

// Crear farmacia + usuario de farmacia (maestro crea usuario farmacia)
router.post('/farmacias',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('nombreFarmacia').notEmpty().trim(),
  body('rif').notEmpty().trim(),
  body('gerenteEncargado').notEmpty().trim(),
  body('direccion').notEmpty().trim(),
  body('telefono').notEmpty().trim(),
  body('estado').isIn(ESTADOS_VENEZUELA),
  body('porcentajePrecio').isFloat({ min: 0, max: 100 }),
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: err.array() });

      const { email, password, nombreFarmacia, rif, gerenteEncargado, direccion, telefono, estado, porcentajePrecio, lat, lng } = req.body;

      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });

      const user = await User.create({
        email: email.toLowerCase(),
        password,
        role: 'farmacia',
        nombre: gerenteEncargado,
      });

      const farmacia = await Farmacia.create({
        usuarioId: user._id,
        nombreFarmacia,
        rif,
        gerenteEncargado,
        direccion,
        telefono,
        estado,
        lat: lat != null ? Number(lat) : undefined,
        lng: lng != null ? Number(lng) : undefined,
        porcentajePrecio: Number(porcentajePrecio),
      });

      await User.updateOne({ _id: user._id }, { farmaciaId: farmacia._id });

      res.status(201).json({
        user: { _id: user._id, email: user.email, role: 'farmacia', farmaciaId: farmacia._id },
        farmacia: { _id: farmacia._id, nombreFarmacia, rif, estado, porcentajePrecio: farmacia.porcentajePrecio },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al crear farmacia' });
    }
  }
);

// Listar solicitudes de delivery pendientes
// Devuelve SolicitudDeliveryMaster[] con:
// {
//   _id,
//   tipoVehiculo,
//   cedula,
//   nombresCompletos,
//   direccion,
//   telefono,
//   correo,
//   numeroLicencia,
//   matriculaVehiculo?,
//   estado,
//   fotoLicenciaUrl?,
//   carnetCirculacionUrl?,
//   fotoCarnetUrl?,
//   fotoVehiculoUrl?,
// }
router.get('/solicitudes-delivery', async (req, res) => {
  try {
    const list = await SolicitudDelivery.find({ estado: 'pendiente' }).sort({ createdAt: -1 });

    const mapped = list.map((s) => ({
      _id: s._id,
      tipoVehiculo: s.tipoVehiculo,
      cedula: s.cedula,
      nombresCompletos: s.nombreCompleto,
      direccion: s.direccion,
      telefono: s.telefono,
      correo: s.correo,
      numeroLicencia: s.numeroLicencia,
      matriculaVehiculo: s.matriculaVehiculo,
      estado: s.estado,
      fotoLicenciaUrl: s.fotoLicenciaUrl || null,
      carnetCirculacionUrl: s.carnetCirculacionUrl || null,
      fotoCarnetUrl: s.fotoCarnetUrl || null,
      fotoVehiculoUrl: s.fotoVehiculoUrl || null,
    }));

    res.json(mapped);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar solicitudes' });
  }
});

// Listar solicitudes de farmacia pendientes
router.get('/solicitudes-farmacia', async (req, res) => {
  try {
    const list = await SolicitudFarmacia.find({ estado: 'pendiente' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar solicitudes de farmacia' });
  }
});

// Aprobar solicitud farmacia: crear User (farmacia) + Farmacia y vincular
router.post('/solicitudes-farmacia/:id/aprobar', async (req, res) => {
  try {
    const sol = await SolicitudFarmacia.findById(req.params.id);
    if (!sol || sol.estado !== 'pendiente') {
      return res.status(400).json({ error: 'Solicitud no encontrada o ya procesada' });
    }
    const exists = await User.findOne({ email: sol.email });
    if (exists) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });

    const estadoVzla = ESTADOS_VENEZUELA.includes(sol.estadoUbicacion?.trim())
      ? sol.estadoUbicacion.trim()
      : (ESTADOS_VENEZUELA[0] || 'Distrito Capital');

    const user = await User.create({
      email: sol.email,
      password: 'temp', // se reemplaza abajo con el hash de la solicitud (evitar doble hash)
      role: 'farmacia',
      nombre: sol.nombreEncargado,
    });
    await User.updateOne({ _id: user._id }, { $set: { password: sol.password } });

    const farmacia = await Farmacia.create({
      usuarioId: user._id,
      nombreFarmacia: sol.nombreFarmacia,
      rif: sol.rif,
      gerenteEncargado: sol.nombreEncargado,
      direccion: sol.direccion,
      telefono: sol.telefono,
      estado: estadoVzla,
      lat: sol.lat,
      lng: sol.lng,
      porcentajePrecio: 0,
    });

    await User.updateOne({ _id: user._id }, { farmaciaId: farmacia._id });
    await SolicitudFarmacia.updateOne(
      { _id: req.params.id },
      { estado: 'aprobado', usuarioId: user._id }
    );

    res.json({ message: 'Farmacia aprobada', userId: user._id, farmaciaId: farmacia._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al aprobar solicitud' });
  }
});

// Denegar solicitud farmacia
router.post('/solicitudes-farmacia/:id/denegar', async (req, res) => {
  try {
    await SolicitudFarmacia.updateOne(
      { _id: req.params.id, estado: 'pendiente' },
      { estado: 'denegado' }
    );
    res.json({ message: 'Solicitud denegada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al denegar' });
  }
});

// --- Plan Pro ---
// GET /api/master/solicitudes-plan-pro
router.get('/solicitudes-plan-pro', async (req, res) => {
  try {
    const list = await SolicitudPlanPro.find()
      .populate('farmaciaId', 'nombreFarmacia rif estado')
      .sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar solicitudes Plan Pro' });
  }
});

// POST /api/master/solicitudes-plan-pro/:id/aprobar
router.post('/solicitudes-plan-pro/:id/aprobar', async (req, res) => {
  try {
    const sol = await SolicitudPlanPro.findById(req.params.id);
    if (!sol || sol.estado !== 'pendiente') {
      return res.status(400).json({ error: 'Solicitud no encontrada o ya procesada' });
    }
    await Farmacia.updateOne({ _id: sol.farmaciaId }, { planProActivo: true });
    await SolicitudPlanPro.updateOne({ _id: req.params.id }, { estado: 'aprobado' });
    res.json({ message: 'Plan Pro aprobado', farmaciaId: sol.farmaciaId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al aprobar' });
  }
});

// POST /api/master/solicitudes-plan-pro/:id/denegar
router.post('/solicitudes-plan-pro/:id/denegar', async (req, res) => {
  try {
    await SolicitudPlanPro.updateOne(
      { _id: req.params.id, estado: 'pendiente' },
      { estado: 'denegado' }
    );
    res.json({ message: 'Solicitud Plan Pro denegada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al denegar' });
  }
});

// Aprobar solicitud delivery: crear User delivery usando la contraseña guardada en la solicitud
router.post('/solicitudes-delivery/:id/aprobar', async (req, res) => {
  try {
    const sol = await SolicitudDelivery.findById(req.params.id);
    if (!sol || sol.estado !== 'pendiente') {
      return res.status(400).json({ error: 'Solicitud no encontrada o ya procesada' });
    }

    const exists = await User.findOne({ email: sol.correo.toLowerCase() });
    if (exists) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });

    const user = await User.create({
      email: sol.correo.toLowerCase(),
      password: sol.password, // ya viene hasheada desde el formulario de solicitud
      role: 'delivery',
      nombre: sol.nombreCompleto,
      cedula: sol.cedula,
      direccion: sol.direccion,
      telefono: sol.telefono,
      fotoCarnet: sol.fotoCarnetUrl,
      deliveryAprobado: true,
    });

    await SolicitudDelivery.updateOne(
      { _id: req.params.id },
      { estado: 'aprobado', usuarioId: user._id }
    );

    res.json({ message: 'Delivery aprobado', userId: user._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al aprobar' });
  }
});

// Resumen de finanzas: comisiones por ventas (3%) y delivery (20%)
router.get('/finanzas/resumen', async (req, res) => {
  try {
    const Pedido = (await import('../models/Pedido.js')).default;

    // Ventas por farmacia (solo pedidos entregados)
    const ventasAgg = await Pedido.aggregate([
      { $match: { estado: 'entregado' } },
      {
        $group: {
          _id: '$farmaciaId',
          totalVentas: { $sum: '$subtotal' },
        },
      },
    ]);

    const farmaciaIds = ventasAgg.map((v) => v._id).filter(Boolean);
    const farmacias = farmaciaIds.length
      ? await Farmacia.find({ _id: { $in: farmaciaIds } }).select('nombreFarmacia')
      : [];
    const farmaciaById = new Map(farmacias.map((f) => [f._id.toString(), f]));

    let totalVentas = 0;
    let totalComisionVentas3Pct = 0;
    const porFarmacia = ventasAgg.map((v) => {
      const tv = v.totalVentas || 0;
      const com = tv * 0.03;
      totalVentas += tv;
      totalComisionVentas3Pct += com;
      const fid = v._id?.toString();
      const f = fid ? farmaciaById.get(fid) : null;
      return {
        farmaciaId: fid,
        nombreFarmacia: f?.nombreFarmacia || 'Desconocida',
        totalVentas: Math.round(tv * 100) / 100,
        comision3Pct: Math.round(com * 100) / 100,
      };
    });

    // Delivery: stats por repartidor
    const deliveryAgg = await DeliveryStats.aggregate([
      {
        $group: {
          _id: '$deliveryId',
          totalBruto: { $sum: '$montoGanado' },
        },
      },
    ]);

    const deliveryIds = deliveryAgg.map((d) => d._id).filter(Boolean);
    const deliveries = deliveryIds.length
      ? await User.find({ _id: { $in: deliveryIds } }).select('nombre email')
      : [];
    const deliveryById = new Map(deliveries.map((d) => [d._id.toString(), d]));

    let totalDeliveryBruto = 0;
    let totalComisionDelivery20Pct = 0;
    const porDelivery = deliveryAgg.map((d) => {
      const bruto = d.totalBruto || 0;
      const com = bruto * 0.2;
      const pagar = bruto * 0.8;
      totalDeliveryBruto += bruto;
      totalComisionDelivery20Pct += com;
      const did = d._id?.toString();
      const u = did ? deliveryById.get(did) : null;
      return {
        deliveryId: did,
        nombre: u?.nombre || 'Desconocido',
        email: u?.email || null,
        totalDeliveryBruto: Math.round(bruto * 100) / 100,
        pagarDelivery: Math.round(pagar * 100) / 100,
        comisionApp20Pct: Math.round(com * 100) / 100,
      };
    });

    const gananciaTotalApp = totalComisionVentas3Pct + totalComisionDelivery20Pct;

    res.json({
      totalVentas: Math.round(totalVentas * 100) / 100,
      totalComisionVentas3Pct: Math.round(totalComisionVentas3Pct * 100) / 100,
      porFarmacia,
      totalDeliveryBruto: Math.round(totalDeliveryBruto * 100) / 100,
      totalComisionDelivery20Pct: Math.round(totalComisionDelivery20Pct * 100) / 100,
      porDelivery,
      gananciaTotalApp: Math.round(gananciaTotalApp * 100) / 100,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener resumen de finanzas' });
  }
});

// Denegar solicitud delivery
router.post('/solicitudes-delivery/:id/denegar', async (req, res) => {
  try {
    await SolicitudDelivery.updateOne(
      { _id: req.params.id, estado: 'pendiente' },
      { estado: 'denegado' }
    );
    res.json({ message: 'Solicitud denegada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al denegar' });
  }
});

// Pedidos globales (todos los pedidos para vista master). Query: fechaDesde, fechaHasta (ISO)
router.get('/pedidos', async (req, res) => {
  try {
    const Pedido = (await import('../models/Pedido.js')).default;
    const { fechaDesde, fechaHasta } = req.query;
    const filter = {};
    if (fechaDesde || fechaHasta) {
      filter.createdAt = {};
      if (fechaDesde) filter.createdAt.$gte = new Date(fechaDesde);
      if (fechaHasta) filter.createdAt.$lte = new Date(fechaHasta + 'T23:59:59.999Z');
    }
    const pedidos = await Pedido.find(filter)
      .populate('clienteId', 'nombre apellido email telefono direccion cedula')
      .populate('farmaciaId', 'nombreFarmacia rif direccion telefono')
      .populate('deliveryId', 'nombre email telefono')
      .sort({ createdAt: -1 });
    res.json(pedidos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Estadísticas para dashboard: pedidos procesados, productos vendidos, clientes, ventas, delivery. Query: fechaDesde, fechaHasta (ISO)
router.get('/estadisticas', async (req, res) => {
  try {
    const Pedido = (await import('../models/Pedido.js')).default;
    const { fechaDesde, fechaHasta } = req.query;
    const match = {};
    if (fechaDesde || fechaHasta) {
      match.createdAt = {};
      if (fechaDesde) match.createdAt.$gte = new Date(fechaDesde);
      if (fechaHasta) match.createdAt.$lte = new Date(fechaHasta + 'T23:59:59.999Z');
    }

    const matchEntregados = { ...match, estado: 'entregado' };
    const estadosProcesados = ['validado', 'asignado_delivery', 'en_camino', 'entregado'];

    const [
      totalPedidos,
      pedidosProcesados,
      pedidosEntregados,
      aggProductosVentas,
      aggClientes,
    ] = await Promise.all([
      Pedido.countDocuments(match),
      Pedido.countDocuments({ ...match, estado: { $in: estadosProcesados } }),
      Pedido.countDocuments(matchEntregados),
      Pedido.aggregate([
        { $match: matchEntregados },
        { $unwind: '$items' },
        { $group: { _id: null, totalProductos: { $sum: '$items.cantidad' }, totalVentas: { $sum: '$total' } } },
      ]),
      Pedido.aggregate([
        { $match: match },
        { $group: { _id: '$clienteId' } },
        { $count: 'total' },
      ]),
    ]);

    const totalProductosVendidos = aggProductosVentas[0]?.totalProductos ?? 0;
    const totalVentas = aggProductosVentas[0]?.totalVentas ?? 0;
    const totalClientes = aggClientes[0]?.total ?? 0;

    res.json({
      totalPedidos,
      pedidosProcesados,
      pedidosEntregados,
      totalProductosVendidos,
      totalClientes,
      totalVentas,
      totalDelivery: pedidosEntregados,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

export default router;
