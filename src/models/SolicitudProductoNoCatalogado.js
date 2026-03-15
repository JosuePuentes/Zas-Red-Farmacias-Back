import mongoose from 'mongoose';

const solicitudProductoNoCatalogadoSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  nombre: { type: String, required: true, trim: true },
}, { timestamps: true });

solicitudProductoNoCatalogadoSchema.index({ clienteId: 1, nombre: 1 });
solicitudProductoNoCatalogadoSchema.index({ nombre: 1 });

export default mongoose.model('SolicitudProductoNoCatalogado', solicitudProductoNoCatalogadoSchema);
