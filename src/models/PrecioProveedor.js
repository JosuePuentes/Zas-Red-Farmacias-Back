import mongoose from 'mongoose';

const precioProveedorSchema = new mongoose.Schema({
  farmaciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmacia', required: true },
  proveedorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor', required: true },
  codigo: { type: String, required: true },
  descripcion: { type: String, default: '' },
  marca: { type: String, default: '' },
  precio: { type: Number, required: true },
  existencia: { type: Number, default: 0 },
}, { timestamps: true });

precioProveedorSchema.index({ farmaciaId: 1, proveedorId: 1, codigo: 1 }, { unique: true });
precioProveedorSchema.index({ farmaciaId: 1, codigo: 1 });

export default mongoose.model('PrecioProveedor', precioProveedorSchema);
