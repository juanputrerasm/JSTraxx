/* The app's workers, started once. Vite bundles each `new Worker(new URL(...))` as a module worker. */
import { WorkerClient } from "../shared/worker-client.ts";

let asset: WorkerClient | null = null;

export function assetWorker(): WorkerClient {
  asset ??= new WorkerClient(new Worker(new URL("../worker/asset-worker.ts", import.meta.url), { type: "module" }));
  return asset;
}
