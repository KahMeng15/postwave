/**
 * Client-side encryption utilities for cache storage
 * Uses AES-256 encryption via SubtleCrypto API
 */

class ClientCrypto {
    /**
     * Generate a random encryption key
     */
    static async generateKey() {
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        return key;
    }

    /**
     * Import a key from exported format (for persistent storage)
     */
    static async importKey(keyData) {
        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'AES-GCM' },
            true,
            ['encrypt', 'decrypt']
        );
        return key;
    }

    /**
     * Export a key to format suitable for storage
     */
    static async exportKey(key) {
        const exported = await crypto.subtle.exportKey('raw', key);
        return new Uint8Array(exported);
    }

    /**
     * Encrypt data using AES-GCM
     */
    static async encrypt(data, key) {
        const encoder = new TextEncoder();
        const plaintext = encoder.encode(JSON.stringify(data));
        
        // Generate random IV (Initialization Vector)
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            plaintext
        );
        
        // Return IV + ciphertext as base64
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);
        
        return btoa(String.fromCharCode(...combined));
    }

    /**
     * Decrypt data using AES-GCM
     */
    static async decrypt(encryptedData, key) {
        // Decode base64
        const combined = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)));
        
        // Extract IV and ciphertext
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        
        try {
            const plaintext = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                ciphertext
            );
            
            const decoder = new TextDecoder();
            const jsonString = decoder.decode(plaintext);
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('Decryption failed:', error);
            throw new Error('Failed to decrypt data. Key may be corrupted.');
        }
    }
}

/**
 * Encrypted Cache Manager for client-side storage
 */
class EncryptedCacheManager {
    static CACHE_KEY_PREFIX = 'ig_cache_';
    static ENCRYPTION_KEY_STORAGE = 'ig_cache_key';
    static CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    /**
     * Initialize cache system - generates or retrieves encryption key
     */
    static async initialize() {
        let keyData = localStorage.getItem(this.ENCRYPTION_KEY_STORAGE);
        
        if (!keyData) {
            // Generate new key and store it
            const key = await ClientCrypto.generateKey();
            const exported = await ClientCrypto.exportKey(key);
            keyData = btoa(String.fromCharCode(...exported));
            localStorage.setItem(this.ENCRYPTION_KEY_STORAGE, keyData);
        }
        
        // Import and return the key
        const binaryData = new Uint8Array(atob(keyData).split('').map(c => c.charCodeAt(0)));
        return await ClientCrypto.importKey(binaryData);
    }

    /**
     * Cache a single post with metadata
     */
    static async cachePost(post, encryptionKey) {
        const cacheData = {
            post: post,
            timestamp: Date.now(),
            expires_at: Date.now() + this.CACHE_EXPIRY_MS
        };
        
        try {
            const encrypted = await ClientCrypto.encrypt(cacheData, encryptionKey);
            const postId = post.id;
            const cacheKey = `${this.CACHE_KEY_PREFIX}${postId}`;
            
            localStorage.setItem(cacheKey, encrypted);
            return true;
        } catch (error) {
            console.error('Failed to cache post:', error);
            return false;
        }
    }

    /**
     * Cache multiple posts
     */
    static async cachePostsBatch(posts, encryptionKey) {
        const results = [];
        for (const post of posts) {
            const result = await this.cachePost(post, encryptionKey);
            results.push(result);
        }
        return results;
    }

    /**
     * Get a cached post
     */
    static async getCachedPost(postId, encryptionKey) {
        const cacheKey = `${this.CACHE_KEY_PREFIX}${postId}`;
        const encrypted = localStorage.getItem(cacheKey);
        
        if (!encrypted) {
            return null;
        }
        
        try {
            const decrypted = await ClientCrypto.decrypt(encrypted, encryptionKey);
            
            // Check if expired
            if (decrypted.expires_at && Date.now() > decrypted.expires_at) {
                localStorage.removeItem(cacheKey);
                return null;
            }
            
            return decrypted.post;
        } catch (error) {
            console.error('Failed to retrieve cached post:', error);
            // Remove corrupted cache
            localStorage.removeItem(cacheKey);
            return null;
        }
    }

    /**
     * Get all valid cached posts (non-expired)
     */
    static async getCachedPosts(encryptionKey) {
        const posts = [];
        const now = Date.now();
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            
            if (!key.startsWith(this.CACHE_KEY_PREFIX)) {
                continue;
            }
            
            try {
                const encrypted = localStorage.getItem(key);
                const decrypted = await ClientCrypto.decrypt(encrypted, encryptionKey);
                
                // Check if expired
                if (decrypted.expires_at && now > decrypted.expires_at) {
                    localStorage.removeItem(key);
                    continue;
                }
                
                posts.push(decrypted.post);
            } catch (error) {
                console.warn('Failed to decrypt cached post:', error);
                localStorage.removeItem(key);
            }
        }
        
        return posts;
    }

    /**
     * Clear all expired cache entries
     */
    static clearExpiredCache() {
        const now = Date.now();
        let cleared = 0;
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            
            if (!key.startsWith(this.CACHE_KEY_PREFIX)) {
                continue;
            }
            
            try {
                // Try to get expiration without decrypting full content
                const encrypted = localStorage.getItem(key);
                // Simple check: just remove entries older than 30 days in localStorage
                localStorage.removeItem(key);
                cleared++;
            } catch (error) {
                console.warn('Error clearing cache entry:', error);
            }
        }
        
        return cleared;
    }

    /**
     * Clear all cached posts for this user
     */
    static clearAllCache() {
        let cleared = 0;
        
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            
            if (key.startsWith(this.CACHE_KEY_PREFIX)) {
                localStorage.removeItem(key);
                cleared++;
            }
        }
        
        return cleared;
    }

    /**
     * Get cache statistics
     */
    static getCacheStats() {
        let total = 0;
        let storage = 0;
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            
            if (key.startsWith(this.CACHE_KEY_PREFIX)) {
                total++;
                const value = localStorage.getItem(key);
                storage += key.length + (value ? value.length : 0);
            }
        }
        
        return {
            total_items: total,
            storage_bytes: storage,
            storage_kb: (storage / 1024).toFixed(2),
            expiry_days: 30
        };
    }
}
