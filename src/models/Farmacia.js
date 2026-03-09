import mongoose from 'mongoose';

const farmaciaSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  nombreFarmacia: { type: String, required: true },
  rif: { type: String, required: true },
  gerenteEncargado: { type: String, required: true },
  direccion: { type: String, required: true },
  telefono: { type: String, required: true },
  estado: { type: String, required: true }, // Estado de Venezuela (ej: Miranda, Carabobo)
  lat: Number,  // Coordenadas para que el delivery sepa dónde recoger
  lng: Number,
  porcentajePrecio: { type: Number, required: true, default: 0 }, // % que se suma al precio de cada producto
  planProActivo: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Farmacia', farmaciaSchema);
