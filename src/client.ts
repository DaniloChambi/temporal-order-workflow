/**
 * client.ts
 *
 * Cliente que inicia el workflow de pedido y demuestra:
 * - Iniciar un workflow
 * - Enviar una señal (cancelación)
 * - Realizar una query (estado actual)
 *
 * Modos de ejecución:
 *   npm run start          → Inicia un pedido normal
 *   npm run start:cancel   → Inicia un pedido y lo cancela a mitad
 *   npm run start:query    → Inicia un pedido y consulta su estado
 */

import { Client, Connection } from '@temporalio/client';
import { orderWorkflow, cancelOrderSignal, getOrderStatusQuery } from './workflows/order.workflow';
import type { OrderWorkflowInput } from './workflows/order.workflow';
import { TASK_QUEUE } from './worker';

// ─── Datos de ejemplo para el pedido ─────────────────────────────────────────

const sampleOrder: OrderWorkflowInput = {
  orderId: `ORD-${Date.now()}`,
  customerId: 'CUSTOMER-001',
  customerEmail: 'cliente@ejemplo.com',
  currency: 'USD',
  items: [
    { productId: 'PROD-001', quantity: 2, price: 29.99 },
    { productId: 'PROD-002', quantity: 1, price: 59.99 },
    { productId: 'PROD-003', quantity: 3, price: 9.99 },
  ],
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--cancel')
    ? 'cancel'
    : args.includes('--query')
      ? 'query'
      : 'normal';

  console.log('─'.repeat(60));
  console.log('  🛒  Temporal.io - Order Processing Workflow');
  console.log('─'.repeat(60));
  console.log(`  Modo: ${mode.toUpperCase()}`);
  console.log(`  Order ID: ${sampleOrder.orderId}`);
  console.log(
    `  Total: $${sampleOrder.items.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2)} ${sampleOrder.currency}`,
  );
  console.log('─'.repeat(60) + '\n');

  // Conectar al servidor de Temporal
  const connection = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection, namespace: 'default' });

  // ── Iniciar el workflow ──────────────────────────────────────────────────
  console.log('🚀 Iniciando workflow...');

  const handle = await client.workflow.start(orderWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId: sampleOrder.orderId,
    args: [sampleOrder],

    // Tiempo máximo total para que el workflow complete.
    // Si el proceso cae y Temporal no puede reanudar en este tiempo, fallará.
    workflowExecutionTimeout: '1 hour',
  });

  console.log(`✅ Workflow iniciado: ${handle.workflowId}`);
  console.log(`🌐 Ver en Temporal UI: http://localhost:8233/namespaces/default/workflows/${handle.workflowId}\n`);

  // ── Modo CANCEL: enviar señal de cancelación ─────────────────────────────
  if (mode === 'cancel') {
    // Esperar un momento para que el workflow empiece
    await new Promise((resolve) => setTimeout(resolve, 800));

    console.log('📡 Enviando señal de cancelación...');
    await handle.signal(cancelOrderSignal, { reason: 'Cliente solicitó cancelación' });
    console.log('✅ Señal enviada.\n');
  }

  // ── Modo QUERY: consultar estado mientras corre ──────────────────────────
  if (mode === 'query') {
    // Polling del estado cada 500ms durante la ejecución
    const pollInterval = setInterval(async () => {
      try {
        const state = await handle.query(getOrderStatusQuery);
        console.log(`📊 Estado actual: ${state.status}`);
      } catch {
        // El workflow ya terminó
        clearInterval(pollInterval);
      }
    }, 500);

    // Limpiar el intervalo cuando el workflow termine
    setTimeout(() => clearInterval(pollInterval), 30_000);
  }

  // ── Esperar resultado del workflow ───────────────────────────────────────
  console.log('⏳ Esperando resultado del workflow...\n');

  try {
    const result = await handle.result();

    console.log('\n' + '─'.repeat(60));
    console.log('  📋  RESULTADO FINAL DEL WORKFLOW');
    console.log('─'.repeat(60));
    console.log(`  Order ID:      ${result.orderId}`);
    console.log(`  Status:        ${result.status}`);
    if (result.transactionId) {
      console.log(`  Transaction:   ${result.transactionId}`);
    }
    if (result.completedAt) {
      console.log(`  Completado:    ${result.completedAt}`);
    }
    if (result.cancelledAt) {
      console.log(`  Cancelado:     ${result.cancelledAt}`);
    }
    if (result.failureReason) {
      console.log(`  Fallo:         ${result.failureReason}`);
    }
    console.log('─'.repeat(60) + '\n');

    const icon =
      result.status === 'COMPLETED'
        ? '🎉'
        : result.status === 'CANCELLED'
          ? '🚫'
          : '❌';
    console.log(`${icon} Workflow finalizado con status: ${result.status}`);
  } catch (err) {
    console.error('\n❌ El workflow terminó con un error:', err);
  }

  await connection.close();
}

main().catch((err) => {
  console.error('Error fatal en el cliente:', err);
  process.exit(1);
});
