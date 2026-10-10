import { createHash } from 'node:crypto';

export async function clearTestLoopbackLimits(database) {
  if (!/^orbit_test(?:_[a-z0-9]+)?$/.test(database.databaseName))
    throw new Error('Rate-limit cleanup is restricted to explicitly named orbit_test databases.');
  const buckets = [];
  for (const [scope, duration] of [
    ['requests', 60000],
    ['register', 3600000],
    ['login-ip', 900000],
    ['recovery-ip', 3600000],
    ['verify-link', 3600000],
    ['reset-link', 3600000],
    ['verification-ip', 3600000],
  ]) {
    const current = Math.floor(Date.now() / duration);
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
      for (const window of [current - 1, current]) {
        buckets.push(createHash('sha256').update(`${scope}:${ip}:${window}`).digest('hex'));
      }
    }
  }
  // These exact buckets belong to loopback verification traffic. Do not clear
  // the collection, change configured limits, or remove account-specific keys.
  const result = await database
    .collection('auth_rate_limits')
    .deleteMany({ _id: { $in: buckets } });
  return result.deletedCount;
}
