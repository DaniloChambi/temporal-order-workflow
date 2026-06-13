/**
 * notification.activities.ts
 *
 * Activities de notificaciones. Envía emails/SMS al cliente en cada
 * etapa del ciclo de vida del pedido.
 *
 * En una app real, aquí iría la integración con SendGrid, Twilio, etc.
 */

import { log, sleep } from '@temporalio/activity';

export interface SendNotificationInput {
  orderId: string;
  customerId: string;
  customerEmail: string;
  type:
    | 'ORDER_CONFIRMED'
    | 'PAYMENT_RECEIVED'
    | 'ORDER_SHIPPED'
    | 'ORDER_CANCELLED'
    | 'PAYMENT_REFUNDED';
  metadata?: Record<string, unknown>;
}

const NOTIFICATION_TEMPLATES: Record<string, string> = {
  ORDER_CONFIRMED: '🛒 Tu pedido #{orderId} ha sido confirmado.',
  PAYMENT_RECEIVED: '💳 Pago recibido para el pedido #{orderId}.',
  ORDER_SHIPPED: '📦 Tu pedido #{orderId} ha sido enviado.',
  ORDER_CANCELLED: '❌ Tu pedido #{orderId} ha sido cancelado.',
  PAYMENT_REFUNDED: '💰 Reembolso procesado para el pedido #{orderId}.',
};

/**
 * Envía una notificación al cliente.
 * Simula el envío de un email o SMS.
 */
export async function sendNotification(input: SendNotificationInput): Promise<void> {
  const template = NOTIFICATION_TEMPLATES[input.type] ?? 'Actualización de tu pedido #{orderId}';
  const message = template.replace('{orderId}', input.orderId);

  log.info('📧 Enviando notificación...', {
    to: input.customerEmail,
    type: input.type,
    message,
  });

  // Simular latencia de envío
  await sleep(80);

  log.info('✅ Notificación enviada', { type: input.type, to: input.customerEmail });
}
