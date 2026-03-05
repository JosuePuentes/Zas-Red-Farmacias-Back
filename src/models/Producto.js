import mongoose from 'mongoose';

const productoSchema = new mongoose.Schema({
  farmaciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmacia', required: true },
  codigo: { type: String, required: true },
  descripcion: { type: String, required: true },
  principioActivo: String,
  presentacion: String,
  marca: String,
  precioBase: { type: Number, required: true },
  existencia: { type: Number, required: true, default: 0 },
  foto: String,
}, { timestamps: true });

// Índice para búsqueda por farmacia y filtros
productoSchema.index({ farmaciaId: 1, codigo: 1 }, { unique: true });
productoSchema.index({ farmaciaId: 1, descripcion: 'text', marca: 'text' });

export default mongoose.model('Producto', productoSchema);
