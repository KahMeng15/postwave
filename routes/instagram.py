from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User
from instagram_api import InstagramAPI
from datetime import datetime
import logging

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
    Fetch published posts from Instagram.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    if not user.instagram_account_id or not user.instagram_access_token:
        return jsonify({'error': 'Instagram not connected'}), 400
    
    try:
        limit = request.args.get('limit', 25, type=int)
        
        logger.info(f'Fetching Instagram posts for user {current_user_id}')
        posts = ig_api.get_media_list(
            user.instagram_access_token,
            user.instagram_account_id,
            limit=limit
        )
        
        return jsonify({
            'posts': posts,
            'count': len(posts)
        }), 200
    
    except Exception as e:
        error_msg = f'Failed to fetch Instagram posts: {str(e)}'
        logger.error(error_msg, exc_info=True)
        return jsonify({'error': error_msg}), 400
