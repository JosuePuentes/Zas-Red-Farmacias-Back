import mongoose from 'mongoose';

const proveedorSchema = new mongoose.Schema({
  farmaciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmacia', required: true },
  rif: { type: String, required: true },
  nombreProveedor: { type: String, required: true },
  telefono: { type: String, required: true },
  nombreAsesorVentas: { type: String, default: '' },
  direccion: { type: String, default: '' },
  condicionesComercialesPct: { type: Number, default: 0 },
  prontoPagoPct: { type: Number, default: 0 },
}, { timestamps: true });

proveedorSchema.index({ farmaciaId: 1 });

export default mongoose.model('Proveedor', proveedorSchema);
