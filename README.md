# 🛒 Temporal.io — Order Processing Workflow

Un ejemplo completo y funcional de un **workflow de procesamiento de pedidos** construido con [Temporal.io](https://temporal.io) y TypeScript.

## ¿Qué demuestra este proyecto?

| Concepto | Archivo | Descripción |
|---|---|---|
| **Workflow determinístico** | `order.workflow.ts` | Orquestación sin I/O directo |
| **Patrón Saga** | `order.workflow.ts` | Compensaciones automáticas en caso de fallo |
| **Activities** | `src/activities/` | Lógica de negocio con I/O (APIs externas) |
| **Signals** | `cancelOrderSignal` | Cancelar un pedido en medio del flujo |
| **Queries** | `getOrderStatusQuery` | Consultar estado sin interrumpir el workflow |
| **Retry Policies** | `proxyActivities(...)` | Backoff exponencial por tipo de activity |
| **Timeouts** | `proxyActivities(...)` | `scheduleToClose` y `startToClose` |

## Arquitectura

```
┌─────────────┐     start/signal/query     ┌──────────────────┐
│  client.ts  │ ──────────────────────────► │  Temporal Server │
└─────────────┘                             │  (localhost:7233) │
                                            └────────┬─────────┘
                                                     │ dispatch
                                            ┌────────▼─────────┐
                                            │    worker.ts      │
                                            │  ┌─────────────┐  │
                                            │  │  Workflow   │  │
                                            │  │ (Sandbox V8)│  │
                                            │  └──────┬──────┘  │
                                            │         │ calls   │
                                            │  ┌──────▼──────┐  │
                                            │  │ Activities  │  │
                                            │  │(Node.js I/O)│  │
                                            │  └─────────────┘  │
                                            └───────────────────┘
```

## Flujo del Workflow (Patrón Saga)

```
PENDING
  │
  ▼
RESERVING_INVENTORY ──► [Compensación: releaseInventory]
  │                              ▲
  ▼                              │
PROCESSING_PAYMENT ──────────────┘ ──► [Compensación: refundPayment]
  │                                             ▲
  ▼                                             │
SHIPPING ─────────────────────────────────────┘
  │
  ▼
COMPLETED ✅
```

Si cualquier paso falla, las compensaciones se ejecutan **en orden inverso**.

## Requisitos

- **Node.js** 18+
- **Temporal CLI** ([instalar](https://docs.temporal.io/cli))

```bash
# Instalar Temporal CLI en macOS
brew install temporal
```

## Instalación

```bash
npm install
```

## Ejecutar

### 1. Iniciar Temporal Dev Server (en una terminal)

```bash
temporal server start-dev
```

Esto levanta el servidor en `localhost:7233` y la Web UI en `http://localhost:8233`.

### 2. Iniciar el Worker (en otra terminal)

```bash
npm run worker
```

El worker se conecta al servidor y espera tareas.

### 3. Disparar el workflow (en otra terminal)

```bash
# Flujo normal (pedido completo)
npm run start

# Flujo con cancelación (se envía signal de cancelación a mitad)
npm run start:cancel

# Flujo con polling de estado (se hacen queries cada 500ms)
npm run start:query
```

## Ver en Temporal Web UI

Abre [http://localhost:8233](http://localhost:8233) para ver:

- El historial de eventos del workflow (cada activity, señal y query)
- El DAG visual del flujo
- Los reintentos automáticos de activities fallidas
- El estado en tiempo real

## Conceptos Clave

### 🔁 Patrón Saga

Las compensaciones se registran en un array a medida que los pasos avanzan. Si algo falla, se ejecutan en **orden inverso**:

```
Avance:       [reserveInventory] → [processPayment] → [sendOrder]
Compensación: [releaseInventory] ← [refundPayment]   ← (no alcanzó)
```

### 📡 Signals

Los signals permiten enviar mensajes a un workflow **en ejecución**:

```typescript
// Definir el signal (en el workflow)
export const cancelOrderSignal = defineSignal<[{ reason: string }]>('cancelOrder');

// Enviar el signal (desde el cliente)
await handle.signal(cancelOrderSignal, { reason: 'Cliente solicitó cancelación' });
```

### 🔍 Queries

Las queries permiten leer el estado del workflow **sin modificarlo**:

```typescript
// Definir la query (en el workflow)
export const getOrderStatusQuery = defineQuery<OrderState>('getOrderStatus');

// Consultar (desde el cliente)
const state = await handle.query(getOrderStatusQuery);
```

### 🛡 Retry Policies

Temporal reintenta automáticamente las activities fallidas:

```typescript
const { processPayment } = proxyActivities<typeof PaymentActivities>({
  retry: {
    initialInterval: '2 seconds',   // Espera inicial entre reintentos
    backoffCoefficient: 2,          // Duplica el tiempo en cada reintento
    maximumAttempts: 3,             // Máximo 3 intentos
    maximumInterval: '30 seconds',  // Espera máxima entre reintentos
  },
});
```

## Estructura del Proyecto

```
src/
├── activities/
│   ├── inventory.activities.ts    # Reservar/liberar stock
│   ├── payment.activities.ts      # Cobrar/reembolsar pagos
│   └── notification.activities.ts # Enviar emails/SMS
├── workflows/
│   └── order.workflow.ts          # Orquestación (Saga + Signals + Queries)
├── worker.ts                      # Worker (ejecuta activities + workflows)
└── client.ts                      # Cliente (inicia workflows, envía signals)
```
