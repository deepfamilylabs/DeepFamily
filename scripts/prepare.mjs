try {
  const { default: husky } = await import("husky");
  husky();
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") {
    throw error;
  }
  console.log("[prepare] husky is not installed; skipping Git hook setup.");
}
