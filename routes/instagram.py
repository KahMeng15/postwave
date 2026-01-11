from flask import Blueprint, request, jsonify, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, Team, InstagramCache
from instagram_api import InstagramAPI
from cache_manager import CacheManager
from datetime import datetime
import logging
import os

# Setup logging
logger = logging.getLogger(__name__)

instagram_bp = Blueprint('instagram', __name__)
ig_api = InstagramAPI()


@instagram_bp.route('/connect', methods=['POST'])
@jwt_required()
def connect_instagram():
    """
    Connect Instagram Business Account using access token.
    
    Required: access_token
    Optional: page_id (for page lookup) OR instagram_account_id (direct)
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    data = request.get_json()
    
    if not data or not data.get('access_token'):
        logger.error('Missing required field: access_token')
        return jsonify({'error': 'Missing access_token'}), 400
    
    try:
        logger.info(f'Attempting to connect Instagram for user {current_user_id}')
        
        # Get long-lived token
        logger.debug('Converting short-lived token to long-lived token...')
        token_data = ig_api.get_long_lived_token(data['access_token'])
        logger.info('Successfully obtained long-lived token')
        
        # Get Instagram Business Account ID - two methods
        ig_account_id = None
        
        # Method 1: Direct Instagram Account ID provided (bypass page lookup)
        if data.get('instagram_account_id'):
            ig_account_id = data['instagram_account_id']
            logger.info(f'Using directly provided Instagram Account ID: {ig_account_id}')
        
        # Method 2: Look up via Facebook Page ID
        elif data.get('page_id'):
            logger.debug(f'Getting Instagram Business Account for page {data["page_id"]}...')
            ig_account_id = ig_api.get_instagram_business_account(
                token_data['access_token'],
                data['page_id']
            )
            
            if not ig_account_id:
                error_msg = 'No Instagram Business Account found for this page. Try providing instagram_account_id directly instead.'
                logger.error(error_msg)
                return jsonify({'error': error_msg}), 400
            
            logger.info(f'Found Instagram Business Account via page: {ig_account_id}')
        else:
            return jsonify({'error': 'Must provide either page_id or instagram_account_id'}), 400
        
        logger.info(f'Using Instagram Business Account: {ig_account_id}')
        
        # Get account info
        logger.debug('Retrieving account information...')
        account_info = ig_api.get_account_info(token_data['access_token'], ig_account_id)
        
        # Update user
        user.instagram_account_id = ig_account_id
        user.instagram_access_token = token_data['access_token']
        user.instagram_username = account_info.get('username')
        user.token_expires_at = token_data['expires_at']
        
        db.session.commit()
        logger.info(f'Instagram connected successfully for user {current_user_id}: @{account_info.get("username")}')
        
        return jsonify({
            'message': 'Instagram connected successfully',
            'instagram_username': account_info.get('username'),
            'account_info': account_info
        }), 200
    
    except Exception as e:
        error_msg = f'Instagram connection failed: {str(e)}'
        logger.error(error_msg, exc_info=True)
        return jsonify({'error': error_msg, 'details': str(e)}), 400


@instagram_bp.route('/fetch-account-id', methods=['POST'])
@jwt_required()
def fetch_account_id():
    """
    Fetch Instagram Business Account ID from access token.
    This allows auto-discovery of the account ID without manual entry.
    
    Required: access_token
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    data = request.get_json()
    
    if not data or not data.get('access_token'):
        logger.error('Missing required field: access_token')
        return jsonify({'error': 'Missing access_token'}), 400
    
    try:
        logger.info(f'Fetching Instagram Account ID from token for user {current_user_id}')
        
        # Convert short-lived token to long-lived token
        logger.debug('Converting short-lived token to long-lived token...')
        token_data = ig_api.get_long_lived_token(data['access_token'])
        logger.info('Successfully obtained long-lived token')
        
        # Get Instagram Business Account ID directly from token
        logger.debug('Fetching Instagram Business Account ID...')
        ig_account_id = ig_api.get_instagram_account_id_from_token(token_data['access_token'])
        
        logger.info(f'Successfully fetched Instagram Account ID: {ig_account_id}')
        
        return jsonify({
            'instagram_account_id': ig_account_id,
            'message': 'Account ID fetched successfully'
        }), 200
    
    except Exception as e:
        error_msg = f'Failed to fetch account ID: {str(e)}'
        logger.error(error_msg, exc_info=True)
        return jsonify({'error': error_msg, 'details': str(e)}), 400


@instagram_bp.route('/disconnect', methods=['POST'])
@jwt_required()
def disconnect_instagram():
    """
    Disconnect Instagram account.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    user.instagram_account_id = None
    user.instagram_access_token = None
    user.instagram_username = None
    user.token_expires_at = None
    
    db.session.commit()
    
    return jsonify({'message': 'Instagram disconnected successfully'}), 200


@instagram_bp.route('/status', methods=['GET'])
@jwt_required()
def instagram_status():
    """
    Check Instagram connection status.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    if not user.instagram_account_id or not user.instagram_access_token:
        return jsonify({
            'connected': False,
            'message': 'Instagram not connected'
        }), 200
    
    # Check if token is expired
    if user.token_expires_at and user.token_expires_at < datetime.utcnow():
        return jsonify({
            'connected': False,
            'message': 'Access token expired',
            'expired': True
        }), 200
    
    try:
        # Try to get account info to verify connection
        account_info = ig_api.get_account_info(
            user.instagram_access_token,
            user.instagram_account_id
        )
        
        return jsonify({
            'connected': True,
            'instagram_username': user.instagram_username,
            'account_info': account_info,
            'token_expires_at': user.token_expires_at.isoformat() if user.token_expires_at else None
        }), 200
    
    except Exception as e:
        return jsonify({
            'connected': False,
            'error': str(e)
        }), 200


@instagram_bp.route('/posts', methods=['GET'])
@jwt_required()
def get_instagram_posts():
    """
    Fetch published posts from Instagram with caching.
    
    Query params:
    - limit: Number of posts to fetch (default: 25)
    - use_cache: Whether to use cached data (default: true)
    - refresh: Force refresh from Instagram (overrides use_cache)
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Get user's first team membership
    team_member = user.team_memberships[0] if user.team_memberships else None
    if not team_member:
        return jsonify({'error': 'No team membership found'}), 400
    
    team = team_member.team
    if not team:
        return jsonify({'error': 'Team not found'}), 404
    
    if not team.instagram_account_id or not team.instagram_access_token:
        return jsonify({'error': 'Instagram not connected'}), 400
    
    try:
        limit = request.args.get('limit', 25, type=int)
        refresh = request.args.get('refresh', 'false').lower() == 'true'
        use_cache = not refresh and request.args.get('use_cache', 'true').lower() == 'true'
        
        if refresh:
            logger.info(f'Force refresh requested for user {current_user_id}')
            use_cache = False
        
        # Fetch with caching
        posts, from_cache = ig_api.get_media_list_with_cache(
            team.instagram_access_token,
            team.instagram_account_id,
            team.id,
            limit=limit,
            use_cache=use_cache
        )
        
        # Enhance posts with cached image URLs
        for post in posts:
            cache = CacheManager.get_cached_post(post.get('id'))
            if cache and cache.cached_image_path:
                post['cached_image_url'] = f"/api/instagram/cache-image/{cache.id}"
        
        return jsonify({
            'posts': posts,
            'count': len(posts),
            'from_cache': from_cache,
            'cache_expiry_days': CacheManager.CACHE_EXPIRY_DAYS
        }), 200
    
    except Exception as e:
        error_msg = f'Failed to fetch Instagram posts: {str(e)}'
        logger.error(error_msg, exc_info=True)
        return jsonify({'error': error_msg}), 400


@instagram_bp.route('/refresh-cache', methods=['POST'])
@jwt_required()
def refresh_cache():
    """
    Force refresh Instagram posts cache.
    This endpoint fetches fresh data from Instagram and updates the cache.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    if not user.instagram_account_id or not user.instagram_access_token:
        return jsonify({'error': 'Instagram not connected'}), 400
    
    try:
        limit = request.args.get('limit', 25, type=int)
        
        logger.info(f'Refreshing Instagram cache for user {current_user_id}')
        
        # Fetch fresh data (bypass cache)
        posts, _ = ig_api.get_media_list_with_cache(
            user.instagram_access_token,
            user.instagram_account_id,
            current_user_id,
            limit=limit,
            use_cache=False
        )
        
        # Enhance posts with cached image URLs
        for post in posts:
            cache = CacheManager.get_cached_post(post.get('id'))
            if cache and cache.cached_image_path:
                post['cached_image_url'] = f"/api/instagram/cache-image/{cache.id}"
        
        return jsonify({
            'message': 'Cache refreshed successfully',
            'posts': posts,
            'count': len(posts),
            'from_cache': False
        }), 200
    
    except Exception as e:
        error_msg = f'Failed to refresh cache: {str(e)}'
        logger.error(error_msg, exc_info=True)
        return jsonify({'error': error_msg}), 400


@instagram_bp.route('/cache-image/<int:cache_id>', methods=['GET'])
def get_cached_image(cache_id):
    """
    Serve cached Instagram image.
    """
    try:
        cache = InstagramCache.query.get(cache_id)
        
        if not cache or not cache.cached_image_path or not os.path.exists(cache.cached_image_path):
            return jsonify({'error': 'Image not found'}), 404
        
        return send_file(
            cache.cached_image_path,
            mimetype='image/jpeg',
            as_attachment=False
        )
    
    except Exception as e:
        logger.error(f'Failed to serve cached image: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to serve image'}), 500


@instagram_bp.route('/cache-stats', methods=['GET'])
@jwt_required()
def get_cache_stats():
    """
    Get cache statistics for the current user.
    """
    current_user_id = int(get_jwt_identity())
    
    try:
        stats = CacheManager.get_cache_stats(current_user_id)
        return jsonify(stats), 200
    
    except Exception as e:
        logger.error(f'Failed to get cache stats: {str(e)}')
        return jsonify({'error': 'Failed to get cache stats'}), 500


@instagram_bp.route('/cache/clear', methods=['POST'])
@jwt_required()
def clear_user_cache():
    """
    Clear all cache for the current user.
    """
    current_user_id = int(get_jwt_identity())
    
    try:
        deleted_count = CacheManager.invalidate_user_cache(current_user_id)
        return jsonify({
            'message': f'Cache cleared successfully',
            'deleted_count': deleted_count
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to clear cache: {str(e)}')
        return jsonify({'error': 'Failed to clear cache'}), 500

@instagram_bp.route('/fetch-profile-picture', methods=['POST'])
@jwt_required()
def fetch_profile_picture():
    """
    Fetch and cache the Instagram profile picture for the current user.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    if not user.instagram_account_id or not user.instagram_access_token:
        return jsonify({'error': 'Instagram account not connected'}), 400
    
    try:
        logger.info(f'Fetching profile picture for user {current_user_id}')
        
        # Get account info which includes profile_picture_url
        account_info = ig_api.get_account_info(
            user.instagram_access_token,
            user.instagram_account_id
        )
        
        profile_picture_url = account_info.get('profile_picture_url')
        
        if profile_picture_url:
            # Cache the profile picture locally
            cached_path = CacheManager.cache_profile_picture(current_user_id, profile_picture_url)
            
            # Save the profile picture URL to user record
            user.instagram_profile_picture = profile_picture_url
            db.session.commit()
            
            logger.info(f'Profile picture cached successfully for user {current_user_id}')
            
            return jsonify({
                'message': 'Profile picture fetched and cached successfully',
                'profile_picture_url': profile_picture_url,
                'cached_path': cached_path
            }), 200
        else:
            logger.warning(f'No profile picture URL in account info for user {current_user_id}')
            return jsonify({'error': 'No profile picture available'}), 404
    
    except Exception as e:
        error_msg = f'Failed to fetch profile picture: {str(e)}'
        logger.error(error_msg, exc_info=True)
        return jsonify({'error': error_msg}), 400
