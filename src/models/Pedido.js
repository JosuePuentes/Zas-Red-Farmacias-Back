import mongoose from 'mongoose';

const itemPedidoSchema = new mongoose.Schema({
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
  codigo: String,
  descripcion: String,
  cantidad: { type: Number, required: true },
  precioUnitario: { type: Number, required: true },
});

const pedidoSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  farmaciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmacia', required: true },
  items: [itemPedidoSchema],
  subtotal: { type: Number, required: true },
  costoDelivery: { type: Number, required: true, default: 0 },
  total: { type: Number, required: true },
  direccionEntrega: { type: String, required: true },
  lat: Number,
  lng: Number,
  metodoPago: { type: String, enum: ['pago_movil', 'transferencia', 'zelle', 'binance'] },
  comprobanteUrl: String,
  estado: {
    type: String,
    enum: [
      'pendiente_validacion', // Pagado, esperando que farmacia valide
      'validado',             // Farmacia aprobó, disponible para delivery
      'denegado',             // Farmacia rechazó
      'asignado_delivery',    // Un delivery aceptó
      'en_camino',
      'entregado',
    ],
    default: 'pendiente_validacion',
  },
  deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  aceptadoEn: Date,
  tiempoLimiteAceptar: Date, // 1 minuto para que delivery acepte
}, { timestamps: true });

pedidoSchema.index({ farmaciaId: 1, estado: 1 });
pedidoSchema.index({ deliveryId: 1, estado: 1 });
pedidoSchema.index({ clienteId: 1 });
pedidoSchema.index({ createdAt: 1 });

export default mongoose.model('Pedido', pedidoSchema);
