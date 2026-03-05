import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import Farmacia from '../models/Farmacia.js';
import SolicitudDelivery from '../models/SolicitudDelivery.js';
import { auth, requireRole } from '../middleware/auth.js';
import { ESTADOS_VENEZUELA } from '../constants/estados.js';

const router = Router();

router.use(auth, requireRole('master'));

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
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: err.array() });

      const { email, password, nombreFarmacia, rif, gerenteEncargado, direccion, telefono, estado, porcentajePrecio } = req.body;

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
router.get('/solicitudes-delivery', async (req, res) => {
  try {
    const list = await SolicitudDelivery.find({ estado: 'pendiente' }).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar solicitudes' });
  }
});

// Aprobar solicitud delivery: crear User delivery y asignar contraseña
router.post('/solicitudes-delivery/:id/aprobar',
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Contraseña requerida (mín. 6 caracteres)' });

      const sol = await SolicitudDelivery.findById(req.params.id);
      if (!sol || sol.estado !== 'pendiente') {
        return res.status(400).json({ error: 'Solicitud no encontrada o ya procesada' });
      }

      const exists = await User.findOne({ email: sol.correo.toLowerCase() });
      if (exists) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });

      const user = await User.create({
        email: sol.correo.toLowerCase(),
        password: req.body.password,
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
  }
);

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

// Pedidos globales (todos los pedidos para vista master)
router.get('/pedidos', async (req, res) => {
  try {
    const Pedido = (await import('../models/Pedido.js')).default;
    const pedidos = await Pedido.find()
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

export default router;
