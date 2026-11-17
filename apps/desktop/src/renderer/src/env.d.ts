import type { HarakiriBridge } from "../../shared/bridge";

declare global {
  interface Window {
    readonly harakiri: HarakiriBridge;
  }
}
