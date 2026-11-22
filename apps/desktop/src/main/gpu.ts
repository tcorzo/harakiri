/**
 * The `gpu_compositing` status from `app.getGPUFeatureStatus()` when Chromium does not composite
 * on the GPU, or null when it does. The window shows at once and paints either way, so a GPU
 * process that fell back to software is otherwise silent.
 */
export const softwareCompositing = (status: {
  readonly gpu_compositing?: string;
}): string | null => {
  const compositing = status.gpu_compositing ?? "unknown";

  return compositing.startsWith("enabled") ? null : compositing;
};
