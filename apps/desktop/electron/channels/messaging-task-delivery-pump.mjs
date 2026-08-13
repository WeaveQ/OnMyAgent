export function createMessagingTaskDeliveryPump(options = {}) {
  const store = options.store;
  const deliver = options.deliver;
  if (!store || typeof store.claimDeliveries !== "function") throw new Error("Messaging Task store is required");
  if (typeof deliver !== "function") throw new Error("Messaging Task delivery function is required");
  const intervalMs = Math.max(250, Number(options.intervalMs) || 5_000);
  let timer = null;
  let active = false;
  let inFlight = null;

  function schedule(delayMs = intervalMs) {
    if (!active || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
    timer.unref?.();
  }

  async function drainBatch() {
    const deliveries = store.claimDeliveries({ limit: 20 });
    for (const item of deliveries) {
      try {
        const result = await deliver({
          platform: item.platform,
          accountId: item.accountId,
          chatId: item.chatId,
          text: String(item.payload?.text ?? ""),
        });
        if (result?.ok === false) {
          store.releaseDelivery(item.id, item.claimToken, { code: "CHANNEL_DELIVERY_REJECTED" });
        } else {
          store.ackDelivery(item.id, item.claimToken);
        }
      } catch (error) {
        store.releaseDelivery(item.id, item.claimToken, error);
      }
    }
    return deliveries.length;
  }

  async function run() {
    if (!active) return 0;
    if (inFlight) return inFlight;
    inFlight = drainBatch().finally(() => {
      inFlight = null;
      schedule();
    });
    return inFlight;
  }

  return Object.freeze({
    start() {
      if (active) return;
      active = true;
      schedule(0);
    },
    trigger() {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = null;
      schedule(0);
    },
    async stop() {
      active = false;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
    },
    runOnce: drainBatch,
    status: () => ({ active, inFlight: Boolean(inFlight) }),
  });
}
