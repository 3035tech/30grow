const Redis = require('ioredis');

const REDIS_URL = 'redis://:dtov_redis@127.0.0.1:56379/0';
const KEY_PREFIX = 'team30_dtov';

/** Reset only disposable DTOV rate-limit counters between browser cases. */
class ClearDtovRateLimitsReporter {
  constructor() {
    this.redis = null;
  }

  async onTestBegin() {
    if (process.env.DTOV !== '1'
      || process.env.REDIS_URL !== REDIS_URL
      || process.env.REDIS_KEY_PREFIX !== KEY_PREFIX) {
      throw new Error('Rate-limit reset reporter requires the fixed local DTOV Redis target.');
    }

    if (!this.redis) {
      this.redis = new Redis(REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
      });
      await this.redis.connect();
    }

    let cursor = '0';
    const pattern = `${KEY_PREFIX}:rl:v1:*`;
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length) await this.redis.unlink(...keys);
    } while (cursor !== '0');
  }

  async onEnd() {
    if (this.redis) await this.redis.quit();
  }
}

module.exports = ClearDtovRateLimitsReporter;
