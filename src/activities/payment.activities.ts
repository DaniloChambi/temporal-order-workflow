/**
 * payment.activities.ts
 *
 * Activities de pago. Maneja el cobro y reembolso de pagos.
 *
 * En una app real, aquí iría la integración con Stripe, PayPal, etc.
 */

import { log, sleep } from '@temporalio/activity';

export interface ProcessPaymentInput {
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
}

export interface RefundPaymentInput {
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
  reason: string;
}

export interface PaymentResult {
  transactionId: string;
  status: 'approved' | 'declined';
  processedAt: string;
}

/**
 * Procesa el pago del pedido.
 * Simula una llamada al gateway de pagos.
 */
export async function processPayment(input: ProcessPaymentInput): Promise<PaymentResult> {
  log.info('💳 Procesando pago...', {
    orderId: input.orderId,
    amount: input.amount,
    currency: input.currency,
  });

  // Simular latencia de procesamiento de pago (200-500ms)
  await sleep(300);

  // Simular pago rechazado para clientes de prueba
  if (input.customerId === 'CUSTOMER-DECLINED') {
    return {
      transactionId: '',
      status: 'declined',
      processedAt: new Date().toISOString(),
    };
  }

  // Simular error temporal del gateway (15% de probabilidad → Temporal reintentará)
  if (Math.random() < 0.15) {
    throw new Error(`[Payment] Gateway de pagos no disponible temporalmente. Order: ${input.orderId}`);
  }

  const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

  log.info('✅ Pago aprobado', { orderId: input.orderId, transactionId });

  return {
    transactionId,
    status: 'approved',
    processedAt: new Date().toISOString(),
  };
}

/**
 * Reembolsa el pago (compensación del patrón Saga).
 * Se llama si el envío falla después de haberse cobrado.
 */
export async function refundPayment(input: RefundPaymentInput): Promise<void> {
  log.info('↩️  Procesando reembolso (compensación Saga)...', {
    orderId: input.orderId,
    amount: input.amount,
    reason: input.reason,
  });

  await sleep(200);

  log.info('✅ Reembolso procesado', { orderId: input.orderId });
}
