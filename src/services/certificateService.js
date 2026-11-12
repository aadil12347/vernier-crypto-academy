import crypto from 'node:crypto';

export async function issueCertificateForUser(store, user) {
  if (!user || user.max_tier_level < 1) {
    const err = new Error('Enroll in at least Starter Pass ($1) to claim a completion certificate.');
    err.status = 403;
    throw err;
  }

  const tier = user.max_tier_level;
  const stats = await store.getUserTierCompletionStats(user.id, tier);
  const total = Number(stats?.totalLessons || 0);
  const done = Number(stats?.completedLessons || 0);

  if (total === 0 || done < total) {
    const err = new Error(
      `Complete all ${total} lessons in your unlocked tier (${done}/${total} done) to claim your certificate.`
    );
    err.status = 400;
    err.code = 'LESSONS_INCOMPLETE';
    throw err;
  }

  const existing = await store.getCertificateForUserTier(user.id, tier);
  if (existing) return existing;

  const serial = `VRN-${new Date().getFullYear()}-T${tier}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  return store.createCertificate({
    serialCode: serial,
    userId: user.id,
    tierLevel: tier,
  });
}
