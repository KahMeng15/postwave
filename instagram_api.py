import os
import requests
from datetime import datetime, timedelta
from config import Config
import logging

logger = logging.getLogger(__name__)

class InstagramAPI:
    """
    Instagram Graph API integration for Business accounts.
    
    Requirements:
    1. Instagram Business Account
    2. Facebook Page connected to the Instagram account
    3. Facebook App with Instagram Graph API permissions
    """
    
    def __init__(self):
        self.base_url = Config.INSTAGRAM_GRAPH_URL
        self.app_id = Config.INSTAGRAM_APP_ID
        self.app_secret = Config.INSTAGRAM_APP_SECRET
    
    def get_long_lived_token(self, short_lived_token):
        """
        Exchange a short-lived access token for a long-lived token (60 days).
        """
        url = f"{self.base_url}/oauth/access_token"
        params = {
            'grant_type': 'fb_exchange_token',
            'client_id': self.app_id,
            'client_secret': self.app_secret,
            'fb_exchange_token': short_lived_token
        }
        
        logger.debug(f'Requesting long-lived token from {url}')
        response = requests.get(url, params=params)
        
        if response.status_code == 200:
            data = response.json()
            expires_in = data.get('expires_in', 5184000)  # 60 days default
            logger.info(f'Successfully exchanged token, expires in {expires_in} seconds')
            return {
                'access_token': data['access_token'],
                'expires_at': datetime.utcnow() + timedelta(seconds=expires_in)
            }
        else:
            error_msg = f"Failed to get long-lived token: {response.status_code} - {response.text}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def get_instagram_account_id_from_token(self, access_token):
        """
        Get Instagram Business Account ID directly from access token.
        Tries multiple approaches to find the Instagram Business Account.
        """
        # Try Approach 1: /me/accounts with instagram_business_account field
        try:
            url = f"{self.base_url}/me/accounts"
            params = {
                'fields': 'id,name,instagram_business_account',
                'access_token': access_token
            }
            
            response = requests.get(url, params=params)
            
            if response.status_code == 200:
                data = response.json()
                pages = data.get('data', [])
                
                # Find first page with Instagram Business Account
                for page in pages:
                    ig_account = page.get('instagram_business_account', {})
                    ig_id = ig_account.get('id')
                    
                    if ig_id:
                        logger.info(f'Found Instagram Business Account: {ig_id}')
                        return ig_id
        except Exception as e:
            logger.debug(f'Approach 1 failed: {str(e)}')
        
        # Try Approach 2: /me/instagram_accounts (direct access)
        try:
            url = f"{self.base_url}/me/instagram_accounts"
            params = {
                'access_token': access_token
            }
            
            response = requests.get(url, params=params)
            
            if response.status_code == 200:
                data = response.json()
                accounts = data.get('data', [])
                
                if accounts and len(accounts) > 0:
                    ig_id = accounts[0].get('id')
                    logger.info(f'Found Instagram Business Account: {ig_id}')
                    return ig_id
        except Exception as e:
            logger.debug(f'Approach 2 failed: {str(e)}')
        
        # If both approaches fail, provide helpful error message
        error_msg = (
            'No Instagram Business Account found. '
            'Please ensure you have a Facebook Page connected to an Instagram Business Account.'
        )
        logger.error(error_msg)
        raise Exception(error_msg)
    
    def get_instagram_business_account(self, access_token, page_id):
        """
        Get Instagram Business Account ID from Facebook Page.
        """
        url = f"{self.base_url}/{page_id}"
        params = {
            'fields': 'instagram_business_account',
            'access_token': access_token
        }
        
        logger.debug(f'Fetching Instagram Business Account for page {page_id}')
        response = requests.get(url, params=params)
        
        if response.status_code == 200:
            data = response.json()
            ig_id = data.get('instagram_business_account', {}).get('id')
            if ig_id:
                logger.info(f'Found Instagram Business Account: {ig_id}')
            else:
                logger.warning(f'No instagram_business_account in response: {data}')
            return ig_id
        else:
            error_msg = f"Failed to get Instagram account: {response.status_code} - {response.text}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def get_account_info(self, access_token, ig_account_id):
        """
        Get Instagram Business Account information.
        """
        url = f"{self.base_url}/{ig_account_id}"
        params = {
            'fields': 'username,profile_picture_url,followers_count,media_count',
            'access_token': access_token
        }
        
        logger.debug(f'Fetching account info for {ig_account_id}')
        response = requests.get(url, params=params)
        
        if response.status_code == 200:
            logger.info(f'Successfully retrieved account info')
            return response.json()
        else:
            error_msg = f"Failed to get account info: {response.status_code} - {response.text}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def get_media_list(self, access_token, ig_account_id, limit=25):
        """
        Get list of published media from Instagram account.
        """
        url = f"{self.base_url}/{ig_account_id}/media"
        params = {
            'fields': 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
            'access_token': access_token,
            'limit': limit
        }
        
        logger.debug(f'Fetching media list for {ig_account_id}')
        response = requests.get(url, params=params)
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f'Successfully retrieved {len(data.get("data", []))} media items')
            return data.get('data', [])
        else:
            error_msg = f"Failed to get media list: {response.status_code} - {response.text}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def get_media_list_with_cache(self, access_token, ig_account_id, user_id, limit=25, use_cache=True):
        """
        Get list of published media from Instagram account with caching support.
        
        Args:
            access_token: Instagram API access token
            ig_account_id: Instagram account ID
            user_id: User ID for cache storage
            limit: Number of items to fetch
            use_cache: If True, return cached data if available; if False, force fresh fetch
        
        Returns:
            Tuple of (posts_list, from_cache)
        """
        from cache_manager import CacheManager
        
        # Try to return cached data if requested
        if use_cache:
            cached_posts = CacheManager.get_cached_posts(user_id, limit=limit)
            if cached_posts:
                logger.info(f'Returning {len(cached_posts)} posts from cache for user {user_id}')
                posts_data = [cache.post_data for cache in cached_posts]
                return posts_data, True
        
        # Fetch fresh data from Instagram API
        try:
            logger.info(f'Fetching fresh posts from Instagram API for user {user_id}')
            posts_data = self.get_media_list(access_token, ig_account_id, limit=limit)
            
            # Cache the posts
            CacheManager.cache_posts_batch(user_id, posts_data)
            
            return posts_data, False
        
        except Exception as e:
            logger.error(f'Failed to fetch from API: {str(e)}')
            # Fall back to cache even if use_cache was False
            cached_posts = CacheManager.get_cached_posts(user_id, limit=limit)
            if cached_posts:
                logger.warning(f'Falling back to cached posts after API failure')
                posts_data = [cache.post_data for cache in cached_posts]
                return posts_data, True
            else:
                # No cache available, re-raise the exception
                raise
    
    def create_media_container(self, access_token, ig_account_id, image_url, caption=None, is_carousel_item=False):
        """
        Create a media container for single image or carousel item.
        image_url: Publicly accessible URL to the image or video
        """
        url = f"{self.base_url}/{ig_account_id}/media"
        
        params = {
            'access_token': access_token
        }
        
        if is_carousel_item:
            params['is_carousel_item'] = 'true'
            params['image_url'] = image_url
        else:
            params['image_url'] = image_url
            if caption:
                params['caption'] = caption
        
        logger.debug(f'Creating media container with URL: {image_url}')
        response = requests.post(url, params=params)
        
        if response.status_code == 200:
            logger.info(f'Successfully created media container')
            return response.json().get('id')
        else:
            error_msg = f"Failed to create media container: {response.json()}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def create_carousel_container(self, access_token, ig_account_id, children_ids, caption=None):
        """
        Create a carousel container with multiple media items.
        """
        url = f"{self.base_url}/{ig_account_id}/media"
        
        params = {
            'media_type': 'CAROUSEL',
            'children': ','.join(children_ids),
            'access_token': access_token
        }
        
        if caption:
            params['caption'] = caption
        
        response = requests.post(url, params=params)
        if response.status_code == 200:
            return response.json().get('id')
        else:
            raise Exception(f"Failed to create carousel container: {response.json()}")
    
    def publish_media(self, access_token, ig_account_id, container_id):
        """
        Publish a media container to Instagram.
        """
        url = f"{self.base_url}/{ig_account_id}/media_publish"
        
        params = {
            'creation_id': container_id,
            'access_token': access_token
        }
        
        response = requests.post(url, params=params)
        if response.status_code == 200:
            return response.json().get('id')
        else:
            raise Exception(f"Failed to publish media: {response.json()}")
    
    def publish_post(self, access_token, ig_account_id, media_urls, caption=None):
        """
        Complete flow to publish a post (single image or carousel).
        media_urls: list of publicly accessible URLs to images/videos
        """
        try:
            if len(media_urls) == 1:
                # Single image post
                container_id = self.create_media_container(
                    access_token, ig_account_id, media_urls[0], caption
                )
            else:
                # Carousel post (2-10 images)
                if len(media_urls) > 10:
                    raise Exception("Maximum 10 images allowed in a carousel")
                
                # Create containers for each image
                children_ids = []
                for media_url in media_urls:
                    child_id = self.create_media_container(
                        access_token, ig_account_id, media_url, is_carousel_item=True
                    )
                    children_ids.append(child_id)
                
                # Create carousel container
                container_id = self.create_carousel_container(
                    access_token, ig_account_id, children_ids, caption
                )
            
            # Publish the post
            post_id = self.publish_media(access_token, ig_account_id, container_id)
            return post_id
        
        except Exception as e:
            raise Exception(f"Failed to publish post: {str(e)}")
