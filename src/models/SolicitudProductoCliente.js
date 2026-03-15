import mongoose from 'mongoose';

const solicitudProductoClienteSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  codigo: { type: String, required: true },
  notificadoEnDisponible: { type: Date },
}, { timestamps: true });

solicitudProductoClienteSchema.index({ clienteId: 1, codigo: 1 });
solicitudProductoClienteSchema.index({ codigo: 1 });
solicitudProductoClienteSchema.index({ codigo: 1, notificadoEnDisponible: 1 });

export default mongoose.model('SolicitudProductoCliente', solicitudProductoClienteSchema);
