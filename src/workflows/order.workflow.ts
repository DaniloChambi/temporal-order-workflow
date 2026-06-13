/**
 * order.workflow.ts
 *
 * Workflow principal de procesamiento de pedidos.
 *
 * ⚠️  IMPORTANTE - REGLAS DE DETERMINISMO:
 * Los workflows de Temporal son "máquinas de estado reproducibles". Temporal
 * puede re-ejecutar (replay) el workflow desde el inicio usando el historial
 * de eventos almacenado. Por eso, el código aquí DEBE ser determinístico:
 *
 * ❌ NO usar: Math.random(), new Date(), Date.now(), setTimeout(), fetch(), fs.*
 * ✅ SÍ usar: proxyActivities(), defineSignal(), defineQuery(), sleep(), condition()
 *
 * Todo el I/O y código no-determinístico va en las Activities.
 */

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  sleep,
  condition,
  log,
  ActivityFailure,
  ApplicationFailure,
} from '@temporalio/workflow';

// ─── Importar tipos de las activities (solo tipos, no implementaciones) ───────
// Esto es fundamental: en el sandbox del workflow solo importamos los TIPOS.
// El runtime del workflow NO puede ejecutar código de Node.js directamente.
import type * as InventoryActivities from '../activities/inventory.activities';
import type * as PaymentActivities from '../activities/payment.activities';
import type * as NotificationActivities from '../activities/notification.activities';

// ─── Definición del input del workflow ────────────────────────────────────────

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface OrderWorkflowInput {
  orderId: string;
  customerId: string;
  customerEmail: string;
  items: OrderItem[];
  currency: string;
}

// ─── Estado del workflow ──────────────────────────────────────────────────────

export type OrderStatus =
  | 'PENDING'
  | 'RESERVING_INVENTORY'
  | 'PROCESSING_PAYMENT'
  | 'SHIPPING'
  | 'COMPLETED'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'FAILED';

export interface OrderState {
  status: OrderStatus;
  orderId: string;
  transactionId?: string;
  cancelledAt?: string;
  failureReason?: string;
  completedAt?: string;
}

// ─── Signals (mensajes que se envían AL workflow en ejecución) ────────────────

/** Signal para cancelar el pedido. Solo es posible antes del envío. */
export const cancelOrderSignal = defineSignal<[{ reason: string }]>('cancelOrder');

// ─── Queries (lectura del estado sin modificar el workflow) ───────────────────

/** Query para obtener el estado actual del pedido sin interrumpirlo. */
export const getOrderStatusQuery = defineQuery<OrderState>('getOrderStatus');

// ─── Proxy de Activities con opciones de retry ────────────────────────────────

/**
 * proxyActivities crea un proxy que enruta las llamadas a través del
 * servidor de Temporal, permitiendo retry automático, timeouts y más.
 *
 * scheduleToCloseTimeout: tiempo máximo total que Temporal intentará la activity.
 * startToCloseTimeout: tiempo máximo para que una sola ejecución complete.
 * retry: política de reintentos automáticos con backoff exponencial.
 */
const { reserveInventory, releaseInventory } = proxyActivities<typeof InventoryActivities>({
  scheduleToCloseTimeout: '5 minutes',
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 5,
    maximumInterval: '30 seconds',
    nonRetryableErrorTypes: ['InventoryOutOfStockError'],
  },
});

const { processPayment, refundPayment } = proxyActivities<typeof PaymentActivities>({
  scheduleToCloseTimeout: '10 minutes',
  startToCloseTimeout: '60 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    maximumInterval: '30 seconds',
  },
});

const { sendNotification } = proxyActivities<typeof NotificationActivities>({
  scheduleToCloseTimeout: '2 minutes',
  startToCloseTimeout: '15 seconds',
  retry: {
    initialInterval: '500 milliseconds',
    maximumAttempts: 10,
  },
});

// ─── Workflow Principal ───────────────────────────────────────────────────────

export async function orderWorkflow(input: OrderWorkflowInput): Promise<OrderState> {
  // Estado mutable del workflow (persiste entre replays gracias a Temporal)
  const state: OrderState = {
    status: 'PENDING',
    orderId: input.orderId,
  };

  // Flag para manejar la señal de cancelación
  let cancelRequested = false;
  let cancelReason = '';

  // ── Registrar handler del Signal de cancelación ──────────────────────────
  setHandler(cancelOrderSignal, ({ reason }) => {
    log.info('📡 Signal de cancelación recibido', { orderId: input.orderId, reason });
    cancelRequested = true;
    cancelReason = reason;
  });

  // ── Registrar handler del Query de estado ────────────────────────────────
  setHandler(getOrderStatusQuery, () => state);

  // Calcular monto total del pedido
  const totalAmount = input.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  log.info('🚀 Iniciando workflow de pedido', {
    orderId: input.orderId,
    totalAmount,
    currency: input.currency,
    items: input.items.length,
  });

  // ─── Patrón Saga: rastrear compensaciones ────────────────────────────────
  // Las compensaciones se ejecutan en orden INVERSO si algo falla.
  // Esto garantiza que el sistema quede en un estado consistente.
  const compensations: Array<() => Promise<void>> = [];

  try {
    // ── PASO 1: Verificar cancelación antes de empezar ───────────────────
    if (cancelRequested) {
      state.status = 'CANCELLED';
      state.cancelledAt = new Date().toISOString();
      log.info('Pedido cancelado antes de iniciar', { orderId: input.orderId });
      return state;
    }

    // ── PASO 2: Reservar inventario ──────────────────────────────────────
    state.status = 'RESERVING_INVENTORY';
    log.info('📦 Paso 1/3: Reservando inventario...');

    await reserveInventory({
      orderId: input.orderId,
      items: input.items.map(({ productId, quantity }) => ({ productId, quantity })),
    });

    // Registrar compensación: si algo falla después, liberar el inventario
    compensations.push(async () => {
      await releaseInventory({
        orderId: input.orderId,
        items: input.items.map(({ productId, quantity }) => ({ productId, quantity })),
      });
    });

    // ── Verificar señal de cancelación entre pasos ───────────────────────
    // condition() espera hasta que la condición sea verdadera (non-blocking aquí
    // porque usamos timeout de 0 — si la condición ya es verdadera retorna inmediato).
    const wasCancelled = await condition(() => cancelRequested, '1 second');
    if (wasCancelled) {
      log.info('Pedido cancelado después de reservar inventario. Ejecutando compensaciones...');
      await runCompensations(compensations);
      state.status = 'CANCELLED';
      state.cancelledAt = new Date().toISOString();
      await sendNotification({
        orderId: input.orderId,
        customerId: input.customerId,
        customerEmail: input.customerEmail,
        type: 'ORDER_CANCELLED',
      });
      return state;
    }

    // Notificar que el pedido fue confirmado
    await sendNotification({
      orderId: input.orderId,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      type: 'ORDER_CONFIRMED',
    });

    // ── PASO 3: Procesar pago ────────────────────────────────────────────
    state.status = 'PROCESSING_PAYMENT';
    log.info('💳 Paso 2/3: Procesando pago...');

    const paymentResult = await processPayment({
      orderId: input.orderId,
      customerId: input.customerId,
      amount: totalAmount,
      currency: input.currency,
    });

    if (paymentResult.status === 'declined') {
      // El pago fue rechazado: no es un error de red, es un rechazo de negocio.
      // Lanzar ApplicationFailure con nonRetryable=true para que Temporal
      // no reintente automáticamente (ya sabemos que el pago será rechazado).
      throw ApplicationFailure.nonRetryable(
        `Pago rechazado para el cliente ${input.customerId}`,
        'PaymentDeclinedError',
      );
    }

    state.transactionId = paymentResult.transactionId;

    // Registrar compensación: si el envío falla, reembolsar el pago
    compensations.push(async () => {
      await refundPayment({
        orderId: input.orderId,
        customerId: input.customerId,
        amount: totalAmount,
        currency: input.currency,
        reason: 'Fallo en el proceso de envío - reembolso automático por Saga',
      });
    });

    // Notificar pago recibido
    await sendNotification({
      orderId: input.orderId,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      type: 'PAYMENT_RECEIVED',
      metadata: { transactionId: paymentResult.transactionId },
    });

    // ── Verificar señal de cancelación antes del envío ───────────────────
    const wasCancelledBeforeShipping = await condition(() => cancelRequested, '1 second');
    if (wasCancelledBeforeShipping) {
      log.info('Pedido cancelado antes del envío. Ejecutando compensaciones...');
      await runCompensations(compensations);
      state.status = 'CANCELLED';
      state.cancelledAt = new Date().toISOString();
      await sendNotification({
        orderId: input.orderId,
        customerId: input.customerId,
        customerEmail: input.customerEmail,
        type: 'ORDER_CANCELLED',
      });
      await sendNotification({
        orderId: input.orderId,
        customerId: input.customerId,
        customerEmail: input.customerEmail,
        type: 'PAYMENT_REFUNDED',
      });
      return state;
    }

    // ── PASO 4: Enviar pedido ─────────────────────────────────────────────
    state.status = 'SHIPPING';
    log.info('🚚 Paso 3/3: Procesando envío...');

    // Simular tiempo de preparación del envío (en producción sería una activity real)
    await sleep('2 seconds');

    // Notificar envío
    await sendNotification({
      orderId: input.orderId,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      type: 'ORDER_SHIPPED',
    });

    // ── COMPLETADO ────────────────────────────────────────────────────────
    state.status = 'COMPLETED';
    state.completedAt = new Date().toISOString();

    log.info('🎉 Pedido completado exitosamente', {
      orderId: input.orderId,
      transactionId: state.transactionId,
    });

    return state;
  } catch (err) {
    // ── MANEJO DE ERRORES CON SAGA ────────────────────────────────────────
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error('❌ Error en el workflow de pedido', { orderId: input.orderId, error: errorMessage });

    state.status = 'FAILED';
    state.failureReason = errorMessage;

    // Ejecutar compensaciones en orden inverso (patrón Saga)
    if (compensations.length > 0) {
      log.info(`Ejecutando ${compensations.length} compensación(es) Saga...`);
      await runCompensations(compensations);
    }

    // Si fue un ActivityFailure con causa PaymentDeclinedError, no relanzar
    // para que el workflow termine con status FAILED (no como excepción no manejada)
    if (err instanceof ActivityFailure || err instanceof ApplicationFailure) {
      return state;
    }

    throw err;
  }
}

// ─── Función auxiliar: ejecutar compensaciones en orden inverso ───────────────

async function runCompensations(compensations: Array<() => Promise<void>>): Promise<void> {
  // Ejecutar en orden INVERSO (último registrado → primero en compensar)
  const reversed = [...compensations].reverse();

  for (const compensate of reversed) {
    try {
      await compensate();
    } catch (err) {
      // Loggear pero no interrumpir las demás compensaciones
      log.error('Error ejecutando compensación Saga (continuando con las demás)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
