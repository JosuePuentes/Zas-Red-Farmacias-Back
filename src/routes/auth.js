import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { auth, attachUser } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Login único: correo + contraseña. Devuelve usuario y role para que el front redirija al panel correcto.
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: err.array() });

      const { email, password } = req.body;
      const user = await User.findOne({ email: email.toLowerCase(), activo: true });
      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
      }

      const token = jwt.sign(
        { userId: user._id, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      const payload = {
        token,
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
          nombre: user.nombre,
          farmaciaId: user.farmaciaId,
          fotoCarnet: user.fotoCarnet,
          deliveryAprobado: user.deliveryAprobado,
          activoRecepcionPedidos: user.activoRecepcionPedidos,
        },
      };

      return res.json(payload);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error en el servidor' });
    }
  }
);

// Registro de cliente desde la home
router.post('/register/cliente',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('cedula').notEmpty().trim(),
  body('nombre').notEmpty().trim(),
  body('apellido').notEmpty().trim(),
  body('direccion').notEmpty().trim(),
  body('telefono').optional().trim(),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: err.array() });

      const { email, password, cedula, nombre, apellido, direccion, telefono } = req.body;
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });

      const user = await User.create({
        email: email.toLowerCase(),
        password,
        role: 'cliente',
        cedula,
        nombre,
        apellido,
        direccion,
        telefono: telefono || '',
      });

      const token = jwt.sign(
        { userId: user._id, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        token,
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
          nombre: user.nombre,
          apellido: user.apellido,
          cedula: user.cedula,
          direccion: user.direccion,
          telefono: user.telefono,
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error en el servidor' });
    }
  }
);

// Yo (usuario logueado)
router.get('/me', auth, attachUser, (req, res) => {
  if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(req.user);
});

export default router;
