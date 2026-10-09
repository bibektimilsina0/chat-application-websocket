export async function flushPromises(rounds = 60) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}