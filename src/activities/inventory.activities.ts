/**
 * inventory.activities.ts
 *
 * Activities de inventario. Se ejecutan fuera del workflow para permitir
 * operaciones de I/O (llamadas a APIs externas, bases de datos, etc.).
 *
 * ⚠️ Las activities NO necesitan ser determinísticas.
 * ✅ Las activities SÍ deben ser idealmente idempotentes.
 */

import { log, sleep } from '@temporalio/activity';

export interface ReserveInventoryInput {
  orderId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface ReleaseInventoryInput {
  orderId: string;
  items: Array<{ productId: string; quantity: number }>;
}

/**
 * Reserva el stock de los productos del pedido.
 * Simula una llamada a un servicio de inventario externo.
 */
export async function reserveInventory(input: ReserveInventoryInput): Promise<void> {
  log.info('Reservando inventario...', { orderId: input.orderId, items: input.items });

  // Simular latencia de red (100-300ms)
  await sleep(150);

  // Simular falla aleatoria (10% de probabilidad) para demostrar reintentos
  if (Math.random() < 0.1) {
    throw new Error(`[Inventory] Servicio temporalmente no disponible. Order: ${input.orderId}`);
  }

  // Simular producto sin stock
  const outOfStock = input.items.find((item) => item.productId === 'PROD-OUT-OF-STOCK');
  if (outOfStock) {
    throw new Error(`[Inventory] Producto sin stock: ${outOfStock.productId}`);
  }

  log.info('✅ Inventario reservado exitosamente', { orderId: input.orderId });
}

/**
 * Libera el stock previamente reservado (compensación del patrón Saga).
 * Se llama si algún paso posterior del workflow falla.
 */
export async function releaseInventory(input: ReleaseInventoryInput): Promise<void> {
  log.info('↩️  Liberando inventario (compensación Saga)...', { orderId: input.orderId });

  await sleep(100);

  log.info('✅ Inventario liberado', { orderId: input.orderId });
}
