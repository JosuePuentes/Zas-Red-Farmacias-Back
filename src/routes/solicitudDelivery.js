import { Router } from 'express';
import SolicitudDelivery from '../models/SolicitudDelivery.js';
import { upload } from '../middleware/upload.js';

const router = Router();
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Registro público: solicitud para ser delivery (desde home). Multer primero para tener req.body y req.files.
router.post('/',
  upload.fields([
    { name: 'fotoLicencia', maxCount: 1 },
    { name: 'carnetCirculacion', maxCount: 1 },
    { name: 'fotoCarnet', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { correo, tipoVehiculo, cedula, nombreCompleto, direccion, telefono, numeroLicencia } = req.body || {};
      if (!correo || !emailRegex.test(String(correo).trim())) return res.status(400).json({ error: 'Correo inválido' });
      if (!['moto', 'carro'].includes(tipoVehiculo)) return res.status(400).json({ error: 'Tipo de vehículo inválido' });
      if (!cedula?.trim() || !nombreCompleto?.trim() || !direccion?.trim() || !telefono?.trim() || !numeroLicencia?.trim()) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
      }

      const fotoLicencia = req.files?.fotoLicencia?.[0];
      const carnetCirculacion = req.files?.carnetCirculacion?.[0];
      const fotoCarnet = req.files?.fotoCarnet?.[0];

      if (!fotoLicencia || !carnetCirculacion || !fotoCarnet) {
        return res.status(400).json({
          error: 'Debe cargar: foto de licencia, carnet de circulación y foto tipo carnet',
        });
      }

      const sol = await SolicitudDelivery.create({
        correo: req.body.correo,
        tipoVehiculo: req.body.tipoVehiculo,
        cedula: req.body.cedula,
        nombreCompleto: req.body.nombreCompleto,
        direccion: req.body.direccion,
        telefono: req.body.telefono,
        numeroLicencia: req.body.numeroLicencia,
        fotoLicenciaUrl: `/uploads/${fotoLicencia.filename}`,
        carnetCirculacionUrl: `/uploads/${carnetCirculacion.filename}`,
        fotoCarnetUrl: `/uploads/${fotoCarnet.filename}`,
        estado: 'pendiente',
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
