// ============================================================================
// PAYMENT ACCESS MODULE (PERSISTENT STORAGE)
// ============================================================================
// Handles one-time tip unlock for 30-day full TokenHealth access
// Guaranteed unlock after payment (no randomness)
// Access grants persist across bot restarts using JSON file storage

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface UserAccess {
    userId: string
    accessExpiresAt: number // timestamp when access expires
    unlockedAt: number // timestamp when access was granted
    method: 'tip' | 'interaction'
}

// Storage file path (in project root)
const STORAGE_FILE = join(process.cwd(), 'access_grants.json')

// In-memory cache (synced with persistent storage)
const accessCache = new Map<string, UserAccess>()

/**
 * Load access grants from persistent storage
 */
function loadAccessGrants(): void {
    try {
        if (!existsSync(STORAGE_FILE)) {
            // File doesn't exist yet - create empty file
            writeFileSync(STORAGE_FILE, JSON.stringify({}, null, 2), 'utf-8')
            return
        }
        
        const fileContent = readFileSync(STORAGE_FILE, 'utf-8')
        const data = JSON.parse(fileContent || '{}')
        
        // Load into memory cache
        accessCache.clear()
        const now = Date.now()
        
        for (const [key, access] of Object.entries(data)) {
            const userAccess = access as UserAccess
            // Only load non-expired access
            if (userAccess.accessExpiresAt > now) {
                accessCache.set(key, userAccess)
            }
        }
        
        // Clean up expired entries from file
        saveAccessGrants()
    } catch (error) {
        console.error('[Payments] Error loading access grants:', error)
        // If file is corrupted, start fresh
        accessCache.clear()
        try {
            writeFileSync(STORAGE_FILE, JSON.stringify({}, null, 2), 'utf-8')
        } catch (writeError) {
            console.error('[Payments] Error creating storage file:', writeError)
        }
    }
}

/**
 * Save access grants to persistent storage
 */
function saveAccessGrants(): void {
    try {
        const now = Date.now()
        const data: Record<string, UserAccess> = {}
        
        // Only save non-expired access
        for (const [key, access] of accessCache.entries()) {
            if (access.accessExpiresAt > now) {
                data[key] = access
            }
        }
        
        writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
        console.error('[Payments] Error saving access grants:', error)
    }
}

// Load access grants on module initialization
loadAccessGrants()

/**
 * Check if user has active paid access (30-day subscription)
 * Checks both memory cache and expiration
 */
export function hasPaidAccess(userId: string, _tokenAddress?: string): boolean {
    const key = userId.toLowerCase()
    const access = accessCache.get(key)
    
    if (!access) return false
    
    // Check if access has expired
    const now = Date.now()
    if (now > access.accessExpiresAt) {
        accessCache.delete(key)
        saveAccessGrants() // Persist removal
        return false
    }
    
    return true
}

/**
 * Grant 30-day access after successful payment
 * Persists to storage file
 */
export function grantAccess(userId: string, method: 'tip' | 'interaction'): void {
    const key = userId.toLowerCase()
    const now = Date.now()
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
    
    const access: UserAccess = {
        userId: userId.toLowerCase(),
        accessExpiresAt: now + thirtyDaysMs,
        unlockedAt: now,
        method
    }
    
    accessCache.set(key, access)
    saveAccessGrants() // Persist immediately
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
        saveAccessGrants() // Persist removal
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
    saveAccessGrants() // Persist removal
}

/**
 * Minimum tip amount in USDC (0.25 USDC = 250000 wei for 6 decimals)
 */
export const MINIMUM_TIP_USDC = '0.25' // Minimum 0.25 USDC for 30-day access
export const MINIMUM_TIP_WEI = BigInt(250000) // 0.25 USDC (6 decimals)

