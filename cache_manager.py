"""
Cache management utilities for Instagram posts.
Handles server-side caching with 30-day retention.
"""

import os
import requests
from datetime import datetime, timedelta
from models import db, InstagramCache, User
import logging
from config import Config

logger = logging.getLogger(__name__)

class CacheManager:
    """Manages Instagram post caching with image downloads"""
    
    CACHE_EXPIRY_DAYS = 30
    CACHE_IMAGE_FOLDER = 'cache/instagram_images'
    
    @staticmethod
    def ensure_cache_folder():
        """Create cache folder if it doesn't exist"""
        os.makedirs(CacheManager.CACHE_IMAGE_FOLDER, exist_ok=True)
    
    @staticmethod
    def download_image(image_url, cache_id):
        """
        Download image from URL and save locally.
        Returns the local filepath on success, None on failure.
        """
        try:
            CacheManager.ensure_cache_folder()
            
            # Get image extension
            ext = image_url.split('?')[0].split('.')[-1][:4]  # Get extension, limit to 4 chars
            if ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                ext = 'jpg'
            
            # Create filename
            filename = f"ig_cache_{cache_id}.{ext}"
            filepath = os.path.join(CacheManager.CACHE_IMAGE_FOLDER, filename)
            
            # Download with timeout
            response = requests.get(image_url, timeout=10, stream=True)
            response.raise_for_status()
            
            # Save image
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            logger.info(f"Successfully cached image: {filepath}")
            return filepath
        
        except Exception as e:
            logger.error(f"Failed to download image from {image_url}: {str(e)}")
            return None
    
    @staticmethod
    def cache_post(user_id, post_data):
        """
        Cache a single Instagram post.
        
        Args:
            user_id: ID of the user
            post_data: Dictionary containing Instagram post data
        
        Returns:
            InstagramCache object or None if caching failed
        """
        try:
            instagram_post_id = post_data.get('id')
            
            if not instagram_post_id:
                logger.warning("Post data missing 'id' field")
                return None
            
            # Check if already cached
            existing_cache = InstagramCache.query.filter_by(
                instagram_post_id=instagram_post_id
            ).first()
            
            if existing_cache:
                # Update existing cache
                existing_cache.post_data = post_data
                existing_cache.updated_at = datetime.utcnow()
                existing_cache.expires_at = datetime.utcnow() + timedelta(days=CacheManager.CACHE_EXPIRY_DAYS)
                cache = existing_cache
            else:
                # Create new cache record
                cache = InstagramCache(
                    user_id=user_id,
                    instagram_post_id=instagram_post_id,
                    post_data=post_data,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                    expires_at=datetime.utcnow() + timedelta(days=CacheManager.CACHE_EXPIRY_DAYS)
                )
            
            # Download and cache image if URL exists
            image_url = post_data.get('media_url') or post_data.get('thumbnail_url')
            if image_url:
                # Create placeholder ID for new caches
                if not existing_cache:
                    db.session.add(cache)
                    db.session.flush()  # Get ID
                
                filepath = CacheManager.download_image(image_url, cache.id)
                if filepath:
                    cache.cached_image_path = filepath
                    cache.image_filename = os.path.basename(filepath)
            
            db.session.add(cache)
            db.session.commit()
            
            logger.info(f"Successfully cached post {instagram_post_id} for user {user_id}")
            return cache
        
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to cache post: {str(e)}", exc_info=True)
            return None
    
    @staticmethod
    def cache_posts_batch(user_id, posts_data):
        """
        Cache multiple Instagram posts.
        
        Args:
            user_id: ID of the user
            posts_data: List of post dictionaries
        
        Returns:
            List of cached posts
        """
        cached_posts = []
        for post_data in posts_data:
            cached = CacheManager.cache_post(user_id, post_data)
            if cached:
                cached_posts.append(cached)
        
        return cached_posts
    
    @staticmethod
    def get_cached_posts(user_id, limit=25):
        """
        Get cached posts for a user (only valid/non-expired caches).
        
        Args:
            user_id: ID of the user
            limit: Maximum number of posts to return
        
        Returns:
            List of InstagramCache objects
        """
        now = datetime.utcnow()
        caches = InstagramCache.query.filter(
            InstagramCache.user_id == user_id,
            InstagramCache.expires_at > now
        ).order_by(
            InstagramCache.updated_at.desc()
        ).limit(limit).all()
        
        return caches
    
    @staticmethod
    def get_cached_post(instagram_post_id):
        """Get a specific cached post"""
        return InstagramCache.query.filter_by(
            instagram_post_id=instagram_post_id
        ).first()
    
    @staticmethod
    def clear_expired_cache():
        """Delete all expired cache entries and their images"""
        try:
            now = datetime.utcnow()
            expired_caches = InstagramCache.query.filter(
                InstagramCache.expires_at <= now
            ).all()
            
            deleted_count = 0
            for cache in expired_caches:
                # Delete cached image file
                if cache.cached_image_path and os.path.exists(cache.cached_image_path):
                    try:
                        os.remove(cache.cached_image_path)
                        logger.info(f"Deleted expired cache image: {cache.cached_image_path}")
                    except Exception as e:
                        logger.error(f"Failed to delete cache image: {str(e)}")
                
                # Delete cache record
                db.session.delete(cache)
                deleted_count += 1
            
            db.session.commit()
            logger.info(f"Cleared {deleted_count} expired cache entries")
            return deleted_count
        
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to clear expired cache: {str(e)}", exc_info=True)
            return 0
    
    @staticmethod
    def invalidate_user_cache(user_id):
        """Invalidate (delete) all cache for a specific user"""
        try:
            user_caches = InstagramCache.query.filter_by(user_id=user_id).all()
            
            deleted_count = 0
            for cache in user_caches:
                # Delete cached image file
                if cache.cached_image_path and os.path.exists(cache.cached_image_path):
                    try:
                        os.remove(cache.cached_image_path)
                    except Exception as e:
                        logger.warning(f"Failed to delete cache image: {str(e)}")
                
                db.session.delete(cache)
                deleted_count += 1
            
            db.session.commit()
            logger.info(f"Invalidated {deleted_count} cache entries for user {user_id}")
            return deleted_count
        
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to invalidate user cache: {str(e)}")
            return 0
    
    @staticmethod
    def get_cache_stats(user_id=None):
        """Get cache statistics"""
        now = datetime.utcnow()
        
        if user_id:
            total = InstagramCache.query.filter_by(user_id=user_id).count()
            valid = InstagramCache.query.filter(
                InstagramCache.user_id == user_id,
                InstagramCache.expires_at > now
            ).count()
            expired = total - valid
        else:
            total = InstagramCache.query.count()
            valid = InstagramCache.query.filter(
                InstagramCache.expires_at > now
            ).count()
            expired = total - valid
        
        return {
            'total': total,
            'valid': valid,
            'expired': expired,
            'expiry_days': CacheManager.CACHE_EXPIRY_DAYS
        }
    
    @staticmethod
    def cache_profile_picture(user_id, profile_picture_url):
        """
        Download and cache Instagram profile picture.
        Returns the downloaded image path or None if failed.
        """
        try:
            if not profile_picture_url:
                logger.debug(f'No profile picture URL provided for user {user_id}')
                return None
            
            CacheManager.ensure_cache_folder()
            
            # Get image extension from URL
            url_path = profile_picture_url.split('?')[0]
            ext = url_path.split('.')[-1][:4] if '.' in url_path else 'jpg'
            if ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                ext = 'jpg'
            
            # Create filename for profile picture
            filename = f"profile_pic_user_{user_id}.{ext}"
            filepath = os.path.join(CacheManager.CACHE_IMAGE_FOLDER, filename)
            
            # Download with timeout
            response = requests.get(profile_picture_url, timeout=10, stream=True)
            response.raise_for_status()
            
            # Save image
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            logger.info(f"Successfully cached profile picture for user {user_id}: {filepath}")
            return filepath
        
        except Exception as e:
            logger.error(f"Failed to cache profile picture for user {user_id}: {str(e)}")
            return None
