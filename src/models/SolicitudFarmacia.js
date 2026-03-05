import mongoose from 'mongoose';

const solicitudFarmaciaSchema = new mongoose.Schema({
  rif: { type: String, required: true, trim: true },
  nombreFarmacia: { type: String, required: true, trim: true },
  direccion: { type: String, required: true, trim: true },
  nombreEncargado: { type: String, required: true, trim: true },
  telefono: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  estado: { type: String, enum: ['pendiente', 'aprobado', 'denegado'], default: 'pendiente' },
  estadoUbicacion: { type: String, trim: true }, // Estado de Venezuela (ej: Miranda)
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('SolicitudFarmacia', solicitudFarmaciaSchema);
