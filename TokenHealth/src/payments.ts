// ============================================================================
// PAYMENT ACCESS MODULE
// ============================================================================
// Handles one-time tip unlock for 30-day full TokenHealth access
// Guaranteed unlock after payment (no randomness)

interface UserAccess {
    userId: string
    accessExpiresAt: number // timestamp when access expires
    unlockedAt: number // timestamp when access was granted
    method: 'tip' | 'interaction'
}

// In-memory cache (for production, use Redis or database)
const accessCache = new Map<string, UserAccess>()

/**
 * Check if user has active paid access (30-day subscription)
 */
export function hasPaidAccess(userId: string, _tokenAddress?: string): boolean {
    const key = userId.toLowerCase()
    const access = accessCache.get(key)
    
    if (!access) return false
    
    // Check if access has expired
    if (Date.now() > access.accessExpiresAt) {
        accessCache.delete(key)
        return false
    }
    
    return true
}

/**
 * Grant 30-day access after successful payment
 */
export function grantAccess(userId: string, method: 'tip' | 'interaction'): void {
    const key = userId.toLowerCase()
    const now = Date.now()
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
    
    accessCache.set(key, {
        userId: userId.toLowerCase(),
        accessExpiresAt: now + thirtyDaysMs,
        unlockedAt: now,
        method
    })
}

/**
 * Get access expiration info (for user feedback)
 */
export function getAccessInfo(userId: string): { hasAccess: boolean; expiresAt: number | null; daysRemaining: number | null } {
    const key = userId.toLowerCase()
    const access = accessCache.get(key)
    
    if (!access) {
        return { hasAccess: false, expiresAt: null, daysRemaining: null }
    }
    
    const now = Date.now()
    if (now > access.accessExpiresAt) {
        accessCache.delete(key)
        return { hasAccess: false, expiresAt: null, daysRemaining: null }
    }
    
    const daysRemaining = Math.ceil((access.accessExpiresAt - now) / (24 * 60 * 60 * 1000))
    return {
        hasAccess: true,
        expiresAt: access.accessExpiresAt,
        daysRemaining
    }
}

/**
 * Clear access (for testing or admin)
 */
export function clearAccess(userId: string): void {
    const key = userId.toLowerCase()
    accessCache.delete(key)
}

/**
 * Minimum tip amount in USDC (0.25 USDC = 250000 wei for 6 decimals)
 */
export const MINIMUM_TIP_USDC = '0.25' // Minimum 0.25 USDC for 30-day access
export const MINIMUM_TIP_WEI = BigInt(250000) // 0.25 USDC (6 decimals)

