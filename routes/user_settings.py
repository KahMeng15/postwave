from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, ActivityLog
from datetime import datetime
import logging
import bcrypt

logger = logging.getLogger(__name__)
user_settings_bp = Blueprint('user_settings', __name__, url_prefix='/api/user-settings')


def log_activity(user_id, action_type, description, resource_type=None, resource_id=None, metadata=None, team_id=None):
    """Helper function to log activities"""
    try:
        log_entry = ActivityLog(
            team_id=team_id,
            user_id=user_id,
            action_type=action_type,
            description=description,
            resource_type=resource_type,
            resource_id=resource_id,
            extra_data=metadata,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent', '')
        )
        db.session.add(log_entry)
        db.session.commit()
    except Exception as e:
        logger.error(f'Failed to log activity: {str(e)}')


# ==================== USER PROFILE ====================

@user_settings_bp.route('/profile', methods=['GET'])
@jwt_required()
def get_profile():
    """Get current user's profile"""
    current_user_id = int(get_jwt_identity())
    
    try:
        user = User.query.get(current_user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'id': user.id,
            'name': user.name,
            'email': user.email,
            'created_at': user.created_at.isoformat(),
            'is_super_admin': user.is_super_admin,
            'instagram_connected': bool(user.instagram_account_id),
            'instagram_username': user.instagram_username
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get profile: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get profile'}), 500


@user_settings_bp.route('/profile/name', methods=['PUT'])
@jwt_required()
def update_name():
    """Update user's display name"""
    current_user_id = int(get_jwt_identity())
    
    try:
        user = User.query.get(current_user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        data = request.get_json()
        new_name = data.get('name', '').strip()
        
        if not new_name:
            return jsonify({'error': 'Name cannot be empty'}), 400
        
        if len(new_name) > 100:
            return jsonify({'error': 'Name is too long'}), 400
        
        old_name = user.name
        user.name = new_name
        db.session.commit()
        
        log_activity(
            current_user_id,
            'config_changed',
            f'Updated display name from "{old_name}" to "{new_name}"',
            resource_type='user',
            resource_id=current_user_id
        )
        
        return jsonify({
            'message': 'Name updated successfully',
            'name': user.name
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to update name: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to update name'}), 500


# ==================== EMAIL MANAGEMENT ====================

@user_settings_bp.route('/profile/email', methods=['PUT'])
@jwt_required()
def update_email():
    """Update user's email address"""
    current_user_id = int(get_jwt_identity())
    
    try:
        user = User.query.get(current_user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        data = request.get_json()
        new_email = data.get('email', '').strip().lower()
        current_password = data.get('password', '')
        
        if not new_email:
            return jsonify({'error': 'Email cannot be empty'}), 400
        
        if not current_password:
            return jsonify({'error': 'Current password is required'}), 400
        
        # Verify current password
        if not user.check_password(current_password):
            return jsonify({'error': 'Current password is incorrect'}), 401
        
        # Check if email already exists
        existing_user = User.query.filter_by(email=new_email).first()
        if existing_user and existing_user.id != current_user_id:
            return jsonify({'error': 'Email already in use'}), 400
        
        old_email = user.email
        user.email = new_email
        db.session.commit()
        
        log_activity(
            current_user_id,
            'config_changed',
            f'Updated email from "{old_email}" to "{new_email}"',
            resource_type='user',
            resource_id=current_user_id
        )
        
        return jsonify({
            'message': 'Email updated successfully',
            'email': user.email
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to update email: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to update email'}), 500


# ==================== PASSWORD MANAGEMENT ====================

@user_settings_bp.route('/profile/password', methods=['PUT'])
@jwt_required()
def update_password():
    """Update user's password"""
    current_user_id = int(get_jwt_identity())
    
    try:
        user = User.query.get(current_user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        data = request.get_json()
        current_password = data.get('current_password', '')
        new_password = data.get('new_password', '')
        confirm_password = data.get('confirm_password', '')
        
        if not current_password:
            return jsonify({'error': 'Current password is required'}), 400
        
        if not new_password:
            return jsonify({'error': 'New password is required'}), 400
        
        if new_password != confirm_password:
            return jsonify({'error': 'Passwords do not match'}), 400
        
        if len(new_password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        # Verify current password
        if not user.check_password(current_password):
            return jsonify({'error': 'Current password is incorrect'}), 401
        
        # Check if new password is same as old password
        if user.check_password(new_password):
            return jsonify({'error': 'New password cannot be the same as current password'}), 400
        
        user.set_password(new_password)
        db.session.commit()
        
        log_activity(
            current_user_id,
            'config_changed',
            'Updated password',
            resource_type='user',
            resource_id=current_user_id
        )
        
        return jsonify({
            'message': 'Password updated successfully'
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to update password: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to update password'}), 500


# ==================== USER ACTIVITY LOGS ====================

@user_settings_bp.route('/logs', methods=['GET'])
@jwt_required()
def get_user_logs():
    """Get current user's activity logs"""
    current_user_id = int(get_jwt_identity())
    
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)
        action_type = request.args.get('action_type', '', type=str)
        search = request.args.get('search', '', type=str)
        
        query = ActivityLog.query.filter_by(user_id=current_user_id)
        
        if action_type:
            query = query.filter_by(action_type=action_type)
        
        if search:
            query = query.filter(ActivityLog.description.ilike(f'%{search}%'))
        
        logs = query.order_by(ActivityLog.created_at.desc()).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        return jsonify({
            'logs': [log.to_dict() for log in logs.items],
            'total': logs.total,
            'pages': logs.pages,
            'current_page': page
        }), 200
    
    except Exception as e:
        logger.error(f'Failed to get user logs: {str(e)}', exc_info=True)
        return jsonify({'error': 'Failed to get user logs'}), 500
