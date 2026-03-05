import mongoose from 'mongoose';

const solicitudDeliverySchema = new mongoose.Schema({
  correo: { type: String, required: true },
  tipoVehiculo: { type: String, enum: ['moto', 'carro'], required: true },
  cedula: { type: String, required: true },
  nombreCompleto: { type: String, required: true },
  direccion: { type: String, required: true },
  telefono: { type: String, required: true },
  numeroLicencia: { type: String, required: true },
  fotoLicenciaUrl: { type: String, required: true },
  carnetCirculacionUrl: { type: String, required: true },
  fotoCarnetUrl: { type: String, required: true },
  estado: {
    type: String,
    enum: ['pendiente', 'aprobado', 'denegado'],
    default: 'pendiente',
  },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Cuando se aprueba y se crea User
}, { timestamps: true });

export default mongoose.model('SolicitudDelivery', solicitudDeliverySchema);
