from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt_identity
from models import db, User
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)


def refresh_user_cache_async(user_id):
    """
    Refresh Instagram cache for a user asynchronously.
    Called after login to get fresh data.
    """
    try:
        from instagram_api import InstagramAPI
        from cache_manager import CacheManager
        
        user = User.query.get(user_id)
        if not user or not user.instagram_account_id or not user.instagram_access_token:
            return
        
        ig_api = InstagramAPI()
        media_list = ig_api.get_media_list(
            user.instagram_access_token,
            user.instagram_account_id,
            limit=25
        )
        CacheManager.cache_posts_batch(user.id, media_list)
        logger.info(f'Refreshed cache on login for user {user_id}')
    except Exception as e:
        logger.debug(f'Non-blocking cache refresh failed for user {user_id}: {str(e)}')
        # Don't raise - login should still succeed even if cache refresh fails

@auth_bp.route('/register', methods=['POST'])
def register():
    """
    Register a new user.
    """
    data = request.get_json()
    
    # Validate input
    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Missing required fields'}), 400
    
    # Check if user already exists
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 400
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Email already exists'}), 400
    
    # Create new user
    user = User(
        username=data['username'],
        email=data['email']
    )
    user.set_password(data['password'])
    
    db.session.add(user)
    db.session.commit()
    
    # Create tokens
    access_token = create_access_token(identity=str(user.id))
    refresh_token = create_refresh_token(identity=str(user.id))
    
    return jsonify({
        'message': 'User registered successfully',
        'access_token': access_token,
        'refresh_token': refresh_token,
        'user': user.to_dict()
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Login user and return JWT tokens.
    Triggers cache refresh for connected Instagram accounts.
    """
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Missing username or password'}), 400
    
    # Find user
    user = User.query.filter_by(username=data['username']).first()
    
    if not user or not user.check_password(data['password']):
        return jsonify({'error': 'Invalid username or password'}), 401
    
    if not user.is_active:
        return jsonify({'error': 'Account is disabled'}), 403
    
    # Create tokens
    access_token = create_access_token(identity=str(user.id))
    refresh_token = create_refresh_token(identity=str(user.id))
    
    # Refresh cache asynchronously (non-blocking)
    try:
        from threading import Thread
        cache_thread = Thread(target=refresh_user_cache_async, args=(user.id,), daemon=True)
        cache_thread.start()
    except Exception as e:
        logger.debug(f'Failed to start cache refresh thread: {str(e)}')
    
    return jsonify({
        'access_token': access_token,
        'refresh_token': refresh_token,
        'user': user.to_dict()
    }), 200


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """
    Refresh access token.
    """
    current_user_id = int(get_jwt_identity())
    access_token = create_access_token(identity=str(current_user_id))
    
    return jsonify({'access_token': access_token}), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """
    Get current user information.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    return jsonify(user.to_dict()), 200


@auth_bp.route('/change-password', methods=['POST'])
@jwt_required()
def change_password():
    """
    Change user password.
    """
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    data = request.get_json()
    
    if not data or not data.get('old_password') or not data.get('new_password'):
        return jsonify({'error': 'Missing required fields'}), 400
    
    if not user.check_password(data['old_password']):
        return jsonify({'error': 'Invalid old password'}), 401
    
    user.set_password(data['new_password'])
    db.session.commit()
    
    return jsonify({'message': 'Password changed successfully'}), 200
