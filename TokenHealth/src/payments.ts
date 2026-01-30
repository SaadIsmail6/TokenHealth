// ============================================================================
// PAYMENT ACCESS MODULE
// ============================================================================
// Handles paid access to full TokenHealth reports
// Guaranteed unlock after payment (no randomness)

interface PaymentAccess {
    userId: string
    tokenAddress: string
    unlockedAt: number // timestamp
    method: 'tip' | 'interaction'
}

// In-memory cache (for production, use Redis or database)
const accessCache = new Map<string, PaymentAccess>()

// Cache key: userId:tokenAddress (lowercase)
function getCacheKey(userId: string, tokenAddress: string): string {
    return `${userId.toLowerCase()}:${tokenAddress.toLowerCase()}`
}

/**
 * Check if user has paid access for a specific token
 */
export function hasPaidAccess(userId: string, tokenAddress: string): boolean {
    const key = getCacheKey(userId, tokenAddress)
    const access = accessCache.get(key)
    
    if (!access) return false
    
    // Access expires after 24 hours (optional - can be removed for permanent access)
    const expiresAt = access.unlockedAt + (24 * 60 * 60 * 1000)
    if (Date.now() > expiresAt) {
        accessCache.delete(key)
        return false
    }
    
    return true
}

/**
 * Grant paid access after successful payment
 */
export function grantAccess(userId: string, tokenAddress: string, method: 'tip' | 'interaction'): void {
    const key = getCacheKey(userId, tokenAddress)
    accessCache.set(key, {
        userId: userId.toLowerCase(),
        tokenAddress: tokenAddress.toLowerCase(),
        unlockedAt: Date.now(),
        method
    })
}

/**
 * Clear access (for testing or admin)
 */
export function clearAccess(userId: string, tokenAddress: string): void {
    const key = getCacheKey(userId, tokenAddress)
    accessCache.delete(key)
}

/**
 * Payment price in USDC (adjustable)
 */
export const PAYMENT_PRICE_USDC = '0.10' // $0.10 per full report

