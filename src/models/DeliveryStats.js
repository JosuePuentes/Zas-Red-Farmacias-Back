import mongoose from 'mongoose';

const deliveryStatsSchema = new mongoose.Schema({
  deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pedido', required: true },
  montoGanado: { type: Number, required: true },
  kmRecorridos: { type: Number, default: 0 },
}, { timestamps: true });

deliveryStatsSchema.index({ deliveryId: 1 });

export default mongoose.model('DeliveryStats', deliveryStatsSchema);
