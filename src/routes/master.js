import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import Farmacia from '../models/Farmacia.js';
import SolicitudDelivery from '../models/SolicitudDelivery.js';
import SolicitudFarmacia from '../models/SolicitudFarmacia.js';
import SolicitudPlanPro from '../models/SolicitudPlanPro.js';
import DeliveryStats from '../models/DeliveryStats.js';
import { auth, requireRole } from '../middleware/auth.js';
import { ESTADOS_VENEZUELA } from '../constants/estados.js';

const router = Router();

router.use(auth, requireRole('master'));

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

// Listar todos los usuarios (para ver tipo: cliente, delivery, farmacia)
router.get('/usuarios', async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'master' } })
      .select('-password')
      .populate('farmaciaId')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar usuarios' });
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
