import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import SolicitudFarmacia from '../models/SolicitudFarmacia.js';
import User from '../models/User.js';

const router = Router();

// Registro público: solicitud para ser farmacia (RIF, nombre farmacia, dirección, encargado, teléfono, correo, contraseña)
router.post('/',
  body('rif').notEmpty().trim(),
  body('nombreFarmacia').notEmpty().trim(),
  body('direccion').notEmpty().trim(),
  body('nombreEncargado').notEmpty().trim(),
  body('telefono').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('estadoUbicacion').optional().trim(),
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: err.array() });

      const { rif, nombreFarmacia, direccion, nombreEncargado, telefono, email, password, estadoUbicacion, lat, lng } = req.body;
      const emailNorm = email.toLowerCase().trim();

      const yaUsuario = await User.findOne({ email: emailNorm });
      if (yaUsuario) return res.status(400).json({ error: 'Ya existe una cuenta con ese correo' });

      const pendiente = await SolicitudFarmacia.findOne({ email: emailNorm, estado: 'pendiente' });
      if (pendiente) return res.status(400).json({ error: 'Ya tienes una solicitud en revisión con ese correo' });

      const passwordHash = await bcrypt.hash(password, 10);
      const sol = await SolicitudFarmacia.create({
        rif: rif.trim(),
        nombreFarmacia: nombreFarmacia.trim(),
        direccion: direccion.trim(),
        nombreEncargado: nombreEncargado.trim(),
        telefono: telefono.trim(),
        email: emailNorm,
        password: passwordHash,
        estado: 'pendiente',
        estadoUbicacion: estadoUbicacion?.trim() || '',
        lat: lat != null ? Number(lat) : undefined,
        lng: lng != null ? Number(lng) : undefined,
      });

      res.status(201).json({
        message: 'Solicitud enviada. Será revisada por el administrador.',
        id: sol._id,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al enviar solicitud' });
    }
  }
);

export default router;
