import Producto from '../models/Producto.js';
import Notificacion from '../models/Notificacion.js';
import SolicitudProductoCliente from '../models/SolicitudProductoCliente.js';

export async function notificarClientesProductoDisponible(codigo) {
  const conStock = await Producto.findOne({ codigo, existencia: { $gt: 0 } }).sort({ precioConPorcentaje: 1 });
  if (!conStock) return;
  const precioRef = conStock.precioConPorcentaje ?? conStock.precioBase;
  const descripcion = conStock.descripcion || codigo;
  const solicitudes = await SolicitudProductoCliente.find({ codigo, notificadoEnDisponible: null });
  const now = new Date();
  for (const doc of solicitudes) {
    const cid = doc.clienteId?.toString?.() || doc.clienteId;
    if (!cid) continue;
    await Notificacion.create({
      userId: cid,
      tipo: 'producto_solicitado_disponible',
      mensaje: `Dona: ¡Buenas noticias! Uno de los productos que pediste ya está disponible: "${descripcion}" desde $${Number(precioRef).toFixed(2)}. Pásate cuando quieras.`,
    });
  }
  if (solicitudes.length) {
    await SolicitudProductoCliente.updateMany(
      { codigo, notificadoEnDisponible: null },
      { $set: { notificadoEnDisponible: now } }
    );
  }
}
