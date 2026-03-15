/**
 * Caché opcional para GET /api/master/inventario.
 * TTL por defecto 3 minutos. Invalidar al actualizar inventario (upload Excel).
 */
const TTL_MS = Number(process.env.INVENTARIO_MASTER_CACHE_TTL_MS) || 3 * 60 * 1000; // 3 min
const cache = new Map();

function cacheKey(page, page_size) {
  return `inventario:${page}:${page_size}`;
}

export function getCachedInventario(page, page_size) {
  const key = cacheKey(page, page_size);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedInventario(page, page_size, data) {
  cache.set(cacheKey(page, page_size), {
    data,
    expiresAt: Date.now() + TTL_MS,
  });
}

/** Llamar tras actualizar inventario (carga Excel) para que la próxima petición obtenga datos frescos. */
export function invalidarCacheInventarioMaster() {
  cache.clear();
}
