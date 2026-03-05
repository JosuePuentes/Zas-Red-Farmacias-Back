import mongoose from 'mongoose';

const carritoSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  cantidad: { type: Number, required: true, min: 1 },
}, { timestamps: true });

carritoSchema.index({ clienteId: 1, productoId: 1 }, { unique: true });

export default mongoose.model('Carrito', carritoSchema);
