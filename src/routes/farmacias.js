import { Router } from 'express';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import Farmacia from '../models/Farmacia.js';
import Producto, { CATEGORIAS_PRODUCTO } from '../models/Producto.js';
import Catalogo from '../models/Catalogo.js';
import { notificarClientesProductoDisponible } from '../util/notificarProductoDisponible.js';
import { invalidarCacheInventarioMaster } from '../util/cacheInventarioMaster.js';
import { auth, requireRole, attachUser } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

router.use(auth, attachUser);

function getFarmaciaIdFromParam(req) {
  const id = req.params.id;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function canAccessFarmacia(req, farmaciaId) {
  if (req.role === 'master') return true;
  if (req.role === 'farmacia') {
    const userFid = req.user?.farmaciaId?._id || req.user?.farmaciaId;
    return userFid && userFid.toString() === farmaciaId.toString();
  }
  return false;
}

function clampPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function calcularPrecioConDescuento(precioBase, descuentoPorcentaje) {
  const base = Number(precioBase) || 0;
  const pct = clampPercentage(descuentoPorcentaje);
  const factor = 1 - pct / 100;
  return Math.round(base * factor * 100) / 100;
}

// POST /api/farmacias/:id/inventario/cargar-excel
// Devuelve: creados, actualizados, vinculadosCatalogo, conflictosDescripcion
router.post('/:id/inventario/cargar-excel',
  requireRole('farmacia', 'master'),
  upload.single('archivo'),
  async (req, res) => {
    try {
      const farmaciaId = getFarmaciaIdFromParam(req);
      if (!farmaciaId) return res.status(400).json({ error: 'ID de farmacia inválido' });
      if (!canAccessFarmacia(req, farmaciaId)) return res.status(403).json({ error: 'Sin permiso para esta farmacia' });
      if (!req.file) return res.status(400).json({ error: 'No se envió archivo Excel' });

      const workbook = xlsx.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet);

      const farmacia = await Farmacia.findById(farmaciaId);
      const porcentaje = (farmacia?.porcentajePrecio || 0) / 100;

    let creados = 0;
    let actualizados = 0;
    let vinculadosCatalogo = 0;
    const conflictosDescripcion = [];
    const codigosProcesados = new Set();

    for (const row of rows) {
      const codigo = String(row.codigo ?? row.Codigo ?? '').trim();
      if (codigo) codigosProcesados.add(codigo);
        const descripcionArchivo = String(row.descripcion ?? row.Descripcion ?? '').trim();
        const marca = String(row.marca ?? row.Marca ?? '').trim();
        const precio = Number(row.precio ?? row.Precio ?? 0);
        const existencia = Number(row.existencia ?? row.Existencia ?? 0);

        if (!codigo || !descripcionArchivo) continue;

        const descuentoRaw = row.descuentoPorcentaje ?? row.DescuentoPorcentaje ?? row.descuento ?? row.Descuento;
        const descuentoPorcentaje = clampPercentage(descuentoRaw);
        const precioConPorcentaje = precio * (1 + porcentaje);
        const precioConDescuento = calcularPrecioConDescuento(precioConPorcentaje, descuentoPorcentaje);
        const categoriaRaw = String(row.categoria ?? row.Categoria ?? '').trim();
        const categoria = CATEGORIAS_PRODUCTO.includes(categoriaRaw) ? categoriaRaw : undefined;

        let descripcionSistema = null;
        const catalogoEntry = await Catalogo.findOne({ codigo });
        if (catalogoEntry) {
          descripcionSistema = catalogoEntry.descripcion;
          vinculadosCatalogo++;
        } else {
          const existente = await Producto.findOne({ farmaciaId, codigo });
          if (existente?.descripcion) descripcionSistema = existente.descripcion;
        }

        const hayConflicto = descripcionSistema && descripcionSistema.trim() !== descripcionArchivo.trim();
        if (hayConflicto) {
          conflictosDescripcion.push({
            codigo,
            descripcionSistema: descripcionSistema || '',
            descripcionArchivo,
          });
        }

        const existing = await Producto.findOne({ farmaciaId, codigo });
        const descripcionCatalogo = descripcionSistema || null;
        const descripcionPersonalizada = descripcionArchivo;
        const descripcionFinal = existing?.usarDescripcionCatalogo && descripcionCatalogo
          ? descripcionCatalogo
          : descripcionArchivo;

        if (existing) {
          existing.descripcion = descripcionFinal;
          existing.descripcionCatalogo = descripcionCatalogo ?? existing.descripcionCatalogo;
          existing.descripcionPersonalizada = descripcionPersonalizada;
          if (hayConflicto) existing.usarDescripcionCatalogo = true;
          existing.marca = marca;
          existing.precioBase = precioConPorcentaje;
          existing.existencia = existencia;
          existing.descuentoPorcentaje = descuentoPorcentaje;
          existing.precioConPorcentaje = descuentoPorcentaje ? precioConDescuento : precioConPorcentaje;
          if (categoria) existing.categoria = categoria;
          await existing.save();
          actualizados++;
        } else {
          await Producto.create({
            farmaciaId,
            codigo,
            descripcion: descripcionFinal,
            descripcionCatalogo: descripcionCatalogo,
            descripcionPersonalizada: descripcionPersonalizada,
            usarDescripcionCatalogo: !!descripcionCatalogo,
            marca,
            categoria,
            precioBase: precioConPorcentaje,
            descuentoPorcentaje,
            precioConPorcentaje: descuentoPorcentaje ? precioConDescuento : precioConPorcentaje,
            existencia,
          });
          creados++;
        }

        if (!catalogoEntry && (creados + actualizados) > 0) {
          await Catalogo.findOneAndUpdate(
            { codigo },
            { $set: { codigo, descripcion: descripcionArchivo } },
            { upsert: true }
          );
        }
      }

      for (const codigo of codigosProcesados) {
        const hayStock = await Producto.exists({ codigo, existencia: { $gt: 0 } });
        if (hayStock) {
          try {
            await notificarClientesProductoDisponible(codigo);
          } catch (err) {
            console.error('Notificar producto disponible:', err);
          }
        }
      }

      invalidarCacheInventarioMaster();

      res.json({
        creados,
        actualizados,
        vinculadosCatalogo,
        conflictosDescripcion,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al procesar Excel' });
    }
  }
);

export default router;
