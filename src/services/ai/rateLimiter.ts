interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private readonly maxRequests = 10; // 10 requests per window
  private readonly windowMs = 60000; // 1 minute window

  checkLimit(userId: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = this.limits.get(userId);

    // No previous requests or window expired
    if (!entry || now >= entry.resetTime) {
      this.limits.set(userId, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return { allowed: true };
    }

    // Within window, check count
    if (entry.count < this.maxRequests) {
      entry.count++;
      return { allowed: true };
    }

    // Rate limit exceeded
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }

  reset(userId: string): void {
    this.limits.delete(userId);
  }

  // Clean up old entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [userId, entry] of this.limits.entries()) {
      if (now >= entry.resetTime) {
        this.limits.delete(userId);
      }
    }
  }
}

export const rateLimiter = new RateLimiter();

// Cleanup every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => rateLimiter.cleanup(), 300000);
}
