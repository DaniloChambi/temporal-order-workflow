/**
 * worker.ts
 *
 * El Worker es el proceso que:
 * 1. Se conecta al servidor de Temporal
 * 2. Escucha en una "Task Queue" específica
 * 3. Ejecuta Workflows y Activities cuando Temporal se los asigna
 *
 * Ejecutar con: npm run worker
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import * as InventoryActivities from './activities/inventory.activities';
import * as PaymentActivities from './activities/payment.activities';
import * as NotificationActivities from './activities/notification.activities';

// El nombre de la cola de tareas debe coincidir con el que usa el cliente
export const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'order-processing';

// Leer configuración desde variables de entorno (con fallback a localhost para dev local)
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';

async function run(): Promise<void> {
  console.log('🔧 Iniciando Temporal Worker...');
  console.log(`   Task Queue:      ${TASK_QUEUE}`);
  console.log(`   Temporal Server: ${TEMPORAL_ADDRESS}`);
  console.log(`   Namespace:       ${TEMPORAL_NAMESPACE}\n`);

  // Crear conexión al servidor de Temporal
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,

    // Apuntar al archivo del workflow (Temporal lo ejecuta en un sandbox V8)
    // El workflowsPath usa el TRANSPILADO, pero ts-node lo resuelve directamente
    workflowsPath: require.resolve('./workflows/order.workflow'),

    // Registrar todas las activities que este worker puede ejecutar
    activities: {
      ...InventoryActivities,
      ...PaymentActivities,
      ...NotificationActivities,
    },
  });

  // Manejar señal de apagado graceful
  process.on('SIGINT', () => {
    console.log('\n⚠️  Apagando worker gracefully...');
    worker.shutdown();
  });

  console.log('✅ Worker iniciado. Esperando tareas...');
  console.log('   Presiona Ctrl+C para detener.\n');

  // Iniciar el worker (bloquea hasta que se llame a worker.shutdown())
  await worker.run();

  await connection.close();
  console.log('Worker detenido.');
}

run().catch((err) => {
  console.error('❌ Error fatal en el worker:', err);
  process.exit(1);
});
